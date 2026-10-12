'use server'

import { supabaseAdmin } from '../../lib/supabase';
import { revalidatePath, unstable_noStore as noStore } from 'next/cache';
import { createClient } from '../../lib/supabase/server';
import { getCurrentCompanyId } from '../../lib/supabase/company-context';
import { getCurrentCompany } from '../../lib/company';
import { getColombiaToday } from '../../lib/timezone';
import { handleActionError, err, warnSilently, type AppErrorCode } from '../../lib/errors';

export type CashSessionWithTotals = {
  id: string;
  company_id: string;
  user_id: string;
  initial_fund: number;
  status: 'open' | 'closed';
  opening_time: string;
  closing_time: string | null;
  totalSold: number;
};

export type ActionFailure = { success: false; error: string; code: AppErrorCode };
export type ActionSuccess<T = unknown> = { success: true; data?: T };
export type ActionResult<T = unknown> = ActionSuccess<T> | ActionFailure;

/**
 * Helper para narrowing discriminante en componentes que reciben
 * `ActionResult`. Alternativa a `if (res.success)` cuando TS no logra
 * narrow por sí solo (típicamente cuando hay un `any` en el camino).
 *
 * ```ts
 * if (isSuccess(res)) {
 *   // res es ActionSuccess<T>, tiene .data
 * } else {
 *   // res es ActionFailure, tiene .error
 * }
 * ```
 */
export function isSuccess<T>(res: ActionResult<T>): res is ActionSuccess<T> {
  return res.success === true;
}

export function isFailure<T>(res: ActionResult<T>): res is ActionFailure {
  return res.success === false;
}

export type GetActiveResult = CashSessionWithTotals | null;

export type OpenCashResult =
  | { success: true; data: any }
  | ActionFailure;

export type GetSummaryResult =
  | {
      success: true;
      summary: {
        totalSales: number;
        totalAmount: number;
        cashSales: number;
        otherSales: number;
        totalExpenses: number;
        cashExpenses: number;
        expenseCount: number;
        commissionEarned: number;
        isCommissionEligible: boolean;
      };
    }
  | ActionFailure;

export type CloseCashResult = { success: true } | ActionFailure;
export type AddExpenseResult = { success: true } | ActionFailure;

export async function getActiveCashSession(): Promise<GetActiveResult> {
  noStore();
  try {
    const companyId = await getCurrentCompanyId();

    const { data, error } = await supabaseAdmin
      .from('cash_sessions')
      .select('*')
      .eq('status', 'open')
      .eq('company_id', companyId)
      .maybeSingle();

    if (error) {
      warnSilently('getActiveCashSession:fetch', error);
      return null;
    }

    if (!data) return null;

    const todayColombiaISO = getColombiaToday();
    const startOfDayUTC = new Date(todayColombiaISO + 'T05:00:00.000Z');

    if (new Date(data.opening_time) < startOfDayUTC) {
      // eslint-disable-next-line no-console
      console.log(`Auto-cerrando sesión ${data.id} por ser de un día anterior.`);
      await supabaseAdmin
        .from('cash_sessions')
        .update({ status: 'closed', closing_time: new Date().toISOString() })
        .eq('id', data.id)
        .eq('company_id', companyId);
      revalidatePath('/');
      return null;
    }

    const filterStartTime = data.opening_time;

    const { data: salesData } = await supabaseAdmin
      .from('sales')
      .select('total_with_discount')
      .eq('status', 'completed')
      .eq('company_id', companyId)
      .gte('created_at', filterStartTime);

    const totalSold = salesData?.reduce((sum, s) => sum + Number(s.total_with_discount), 0) || 0;

    return { ...data, totalSold };
  } catch (error) {
    // Una sesión de caja no encontrada / sin sesión es estado normal del sistema,
    // no un error. Otros errores sí se loguean.
    const msg = error instanceof Error ? error.message : String(error);
    if (msg !== 'UNAUTHENTICATED' && msg !== 'NO_COMPANY_CONTEXT') {
      warnSilently('getActiveCashSession', error);
    }
    return null;
  }
}

export async function openCashSession(initialFund: number): Promise<OpenCashResult> {
  try {
    const supabase = createClient();
    const companyId = await getCurrentCompanyId();

    const { data: openSession } = await supabaseAdmin
      .from('cash_sessions')
      .select('id')
      .eq('status', 'open')
      .eq('company_id', companyId)
      .maybeSingle();

    if (openSession) {
      throw err('CONFLICT', 'Sesión de caja ya abierta', {
        userMessage: 'Ya existe una sesión de caja abierta.',
      });
    }

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      throw err('UNAUTHENTICATED', 'No user in openCashSession');
    }

    const { data, error } = await supabaseAdmin
      .from('cash_sessions')
      .insert({
        company_id: companyId,
        user_id: user.id,
        initial_fund: initialFund,
        status: 'open',
        opening_time: new Date().toISOString()
      })
      .select()
      .single();

    if (error) {
      throw err('EXTERNAL', `openCashSession:insert: ${error.message}`, { cause: error });
    }

    revalidatePath('/');
    return { success: true as const, data };
  } catch (caught) {
    return handleActionError(caught, 'openCashSession');
  }
}

export async function getCashSessionSummary(sessionId: string): Promise<GetSummaryResult> {
  noStore();
  try {
    const companyId = await getCurrentCompanyId();

    const { data: session } = await supabaseAdmin
      .from('cash_sessions')
      .select('*')
      .eq('id', sessionId)
      .eq('company_id', companyId)
      .single();

    if (!session) {
      throw err('NOT_FOUND', `Cash session ${sessionId} not found`, {
        userMessage: 'No se encontró la sesión.',
      });
    }

    const todayColombiaISO = getColombiaToday();
    const startOfDayUTC = new Date(todayColombiaISO + 'T05:00:00.000Z');

    const filterStartTime = new Date(session.opening_time) > startOfDayUTC
      ? session.opening_time
      : startOfDayUTC.toISOString();

    const { data: sales } = await supabaseAdmin
      .from('sales')
      .select('total_with_discount, payment_method')
      .eq('status', 'completed')
      .eq('company_id', companyId)
      .gte('created_at', filterStartTime);

    const { data: expenses } = await supabaseAdmin
      .from('expenses')
      .select('amount, method')
      .eq('company_id', companyId)
      .gte('created_at', filterStartTime);

    const totalCompletedSales = sales?.reduce((sum, s) => sum + Number(s.total_with_discount), 0) || 0;
    const totalExpenses = expenses?.reduce((sum, e) => sum + Number(e.amount), 0) || 0;
    const cashExpenses = expenses?.filter(e => e.method === 'CASH').reduce((sum, e) => sum + Number(e.amount), 0) || 0;

    const company = await getCurrentCompany();
    const COMMISSION_THRESHOLD = company?.settings.commission_threshold ?? 1800000;
    const COMMISSION_RATE = company?.settings.commission_rate ?? 0.012;

    const isCommissionEligible = totalCompletedSales > COMMISSION_THRESHOLD;
    const commissionEarned = isCommissionEligible ? (totalCompletedSales * COMMISSION_RATE) : 0;

    const cashSales = sales?.filter(s => s.payment_method === 'CASH').reduce((sum, s) => sum + Number(s.total_with_discount), 0) || 0;

    return {
      success: true as const,
      summary: {
        totalSales: sales?.length || 0,
        totalAmount: totalCompletedSales,
        cashSales,
        otherSales: sales?.filter(s => s.payment_method !== 'CASH').reduce((sum, s) => sum + Number(s.total_with_discount), 0) || 0,
        totalExpenses,
        cashExpenses,
        expenseCount: expenses?.length || 0,
        commissionEarned,
        isCommissionEligible
      }
    };
  } catch (caught) {
    return handleActionError(caught, 'getCashSessionSummary');
  }
}

export async function closeCashSession(sessionId: string): Promise<CloseCashResult> {
  try {
    const companyId = await getCurrentCompanyId();

    const { error: updateError } = await supabaseAdmin
      .from('cash_sessions')
      .update({
        status: 'closed',
        closing_time: new Date().toISOString()
      })
      .eq('id', sessionId)
      .eq('company_id', companyId);

    if (updateError) {
      throw err('EXTERNAL', `closeCashSession:update: ${updateError.message}`, { cause: updateError });
    }

    revalidatePath('/');
    return { success: true as const };
  } catch (caught) {
    return handleActionError(caught, 'closeCashSession');
  }
}

export async function addExpense(description: string, amount: number): Promise<AddExpenseResult> {
  try {
    const companyId = await getCurrentCompanyId();

    const { error } = await supabaseAdmin
      .from('expenses')
      .insert({
        company_id: companyId,
        description,
        amount,
        method: 'CASH'
      });

    if (error) {
      throw err('EXTERNAL', `addExpense:insert: ${error.message}`, { cause: error });
    }
    revalidatePath('/');
    return { success: true as const };
  } catch (caught) {
    return handleActionError(caught, 'addExpense');
  }
}