'use server'

import { supabaseAdmin } from '../../lib/supabase';
import { revalidatePath, unstable_noStore as noStore } from 'next/cache';
import { createClient } from '../../lib/supabase/server';
import { getCurrentCompanyId } from '../../lib/supabase/company-context';
import { getCurrentCompany } from '../../lib/company';
import { getColombiaToday } from '../../lib/timezone';

export async function getActiveCashSession() {
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
      console.error("Error fetching cash session:", error);
      return null;
    }

    if (!data) return null;

    const todayColombiaISO = getColombiaToday();
    const startOfDayUTC = new Date(todayColombiaISO + 'T05:00:00.000Z');

    if (new Date(data.opening_time) < startOfDayUTC) {
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
  } catch (error: any) {
    if (error.message === 'UNAUTHENTICATED' || error.message === 'NO_COMPANY_CONTEXT') {
      return null;
    }
    console.error("Unexpected error fetching cash session:", error);
    return null;
  }
}

export async function openCashSession(initialFund: number) {
  try {
    const supabase = createClient();
    const companyId = await getCurrentCompanyId();

    const { data: openSession } = await supabaseAdmin
      .from('cash_sessions')
      .select('id')
      .eq('status', 'open')
      .eq('company_id', companyId)
      .maybeSingle();

    if (openSession) return { success: false, error: 'Ya existe una sesión de caja abierta.' };

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: 'No se encontró una sesión de usuario válida.' };

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

    if (error) throw error;

    revalidatePath('/');
    return { success: true, data };
  } catch (error: any) {
    if (error.message === 'UNAUTHENTICATED' || error.message === 'NO_COMPANY_CONTEXT') {
      return { success: false, error: 'Usuario sin empresa asignada.' };
    }
    console.error("Error opening cash session:", error);
    return { success: false, error: error.message };
  }
}

export async function getCashSessionSummary(sessionId: string) {
  noStore();
  try {
    const companyId = await getCurrentCompanyId();

    const { data: session } = await supabaseAdmin
      .from('cash_sessions')
      .select('*')
      .eq('id', sessionId)
      .eq('company_id', companyId)
      .single();

    if (!session) throw new Error("No se encontró la sesión.");

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
      success: true,
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
  } catch (error: any) {
    if (error.message === 'UNAUTHENTICATED' || error.message === 'NO_COMPANY_CONTEXT') {
      return { success: false, error: 'Usuario sin empresa asignada.' };
    }
    return { success: false, error: error.message };
  }
}

export async function closeCashSession(sessionId: string) {
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

    if (updateError) throw updateError;

    revalidatePath('/');
    return { success: true };
  } catch (error: any) {
    if (error.message === 'UNAUTHENTICATED' || error.message === 'NO_COMPANY_CONTEXT') {
      return { success: false, error: 'Usuario sin empresa asignada.' };
    }
    console.error("Error closing cash session:", error);
    return { success: false, error: error.message };
  }
}

export async function addExpense(description: string, amount: number) {
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

    if (error) throw error;
    revalidatePath('/');
    return { success: true };
  } catch (error: any) {
    if (error.message === 'UNAUTHENTICATED' || error.message === 'NO_COMPANY_CONTEXT') {
      return { success: false, error: 'Usuario sin empresa asignada.' };
    }
    console.error("Error adding expense:", error);
    return { success: false, error: error.message };
  }
}