'use server'

import { supabaseAdmin } from '../../lib/supabase';
import { createClient } from '../../lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { getCurrentCompanyId } from '../../lib/supabase/company-context';
import { handleActionError, err } from '../../lib/errors';

export async function getMajorExpenses() {
  try {
    const companyId = await getCurrentCompanyId();

    const { data, error } = await supabaseAdmin
      .from('major_expenses')
      .select('*')
      .eq('company_id', companyId)
      .order('expense_date', { ascending: false });

    if (error) throw err('EXTERNAL', `major_expenses.list: ${error.message}`, { cause: error });
    return { success: true as const, data };
  } catch (caught) {
    return handleActionError(caught, 'getMajorExpenses');
  }
}

export async function addMajorExpense(
  category: string,
  description: string,
  amount: number,
  expenseDate: string,
  notes: string | null
) {
  try {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) throw err('UNAUTHENTICATED', 'no user in addMajorExpense');

    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .maybeSingle();

    if (profile?.role !== 'owner') {
      throw err('FORBIDDEN', 'not owner', {
        userMessage: 'Solo el propietario puede registrar gastos mayores.',
      });
    }

    const companyId = await getCurrentCompanyId();

    const { error } = await supabaseAdmin
      .from('major_expenses')
      .insert({
        company_id: companyId,
        category,
        description,
        amount,
        expense_date: expenseDate,
        notes,
        created_by: user.id
      });

    if (error) throw err('EXTERNAL', `major_expenses.insert: ${error.message}`, { cause: error });
    revalidatePath('/');
    return { success: true as const };
  } catch (caught) {
    return handleActionError(caught, 'addMajorExpense');
  }
}

export async function deleteMajorExpense(id: string) {
  try {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) throw err('UNAUTHENTICATED', 'no user in deleteMajorExpense');

    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .maybeSingle();

    if (profile?.role !== 'owner') {
      throw err('FORBIDDEN', 'not owner', {
        userMessage: 'Solo el propietario puede eliminar gastos mayores.',
      });
    }

    const companyId = await getCurrentCompanyId();

    const { error } = await supabaseAdmin
      .from('major_expenses')
      .delete()
      .eq('id', id)
      .eq('company_id', companyId);

    if (error) throw err('EXTERNAL', `major_expenses.delete: ${error.message}`, { cause: error });
    revalidatePath('/');
    return { success: true as const };
  } catch (caught) {
    return handleActionError(caught, 'deleteMajorExpense');
  }
}