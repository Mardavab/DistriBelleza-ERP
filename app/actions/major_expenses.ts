'use server'

import { supabaseAdmin } from '../../lib/supabase';
import { createClient } from '../../lib/supabase/server';
import { revalidatePath } from 'next/cache';

export async function getMajorExpenses() {
  try {
    const { data, error } = await supabaseAdmin
      .from('major_expenses')
      .select('*')
      .order('expense_date', { ascending: false });

    if (error) throw error;
    return { success: true, data };
  } catch (error: any) {
    console.error("Error fetching major expenses:", error);
    return { success: false, error: error.message, data: [] };
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

    if (!user) return { success: false, error: 'No se encontró una sesión de usuario válida.' };

    // Verify user is owner
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .maybeSingle();

    if (profile?.role !== 'owner') {
      return { success: false, error: 'Solo el propietario puede registrar gastos mayores.' };
    }

    const { error } = await supabaseAdmin
      .from('major_expenses')
      .insert({
        category,
        description,
        amount,
        expense_date: expenseDate,
        notes,
        created_by: user.id
      });

    if (error) throw error;
    revalidatePath('/');
    return { success: true };
  } catch (error: any) {
    console.error("Error adding major expense:", error);
    return { success: false, error: error.message };
  }
}

export async function deleteMajorExpense(id: string) {
  try {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) return { success: false, error: 'No se encontró una sesión de usuario válida.' };

    // Verify user is owner
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .maybeSingle();

    if (profile?.role !== 'owner') {
      return { success: false, error: 'Solo el propietario puede eliminar gastos mayores.' };
    }

    const { error } = await supabaseAdmin
      .from('major_expenses')
      .delete()
      .eq('id', id);

    if (error) throw error;
    revalidatePath('/');
    return { success: true };
  } catch (error: any) {
    console.error("Error deleting major expense:", error);
    return { success: false, error: error.message };
  }
}
