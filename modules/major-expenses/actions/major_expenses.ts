'use server'

import { supabaseAdmin } from '../../../lib/supabase';
import { revalidatePath } from 'next/cache';
import { requireAuthContext, requireOwner } from '../../../lib/supabase/auth-helpers';
import { requireBranchContext } from '../../../lib/supabase/branch-context';
import { handleActionError, err, type ActionResult } from '../../../lib/errors';
import { audit } from '../../../lib/audit';

export async function getMajorExpenses() {
  try {
    // Gastos Mayores es un módulo solo-owner: también en lectura.
    const ctx = await requireAuthContext();
    requireOwner(ctx.role);

    // FASE 11 (Bloque C): major_expenses.branch_id es NOT NULL.
    // Filtramos por la sucursal activa del usuario para que un owner
    // con varias sucursales solo vea los gastos de la que está operando.
    const { branchId } = await requireBranchContext();

    const { data, error } = await supabaseAdmin
      .from('major_expenses')
      .select('*')
      .eq('branch_id', branchId)
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
): Promise<ActionResult<never>> {
  try {
    // FASE 10: el rol se lee de la membresía activa (no de profiles.role,
    // que se elimina en 10.5). requireAuthContext valida sesión + membresía.
    const ctx = await requireAuthContext();
    requireOwner(ctx.role);

    // FASE 11 (Bloque C): major_expenses.branch_id es NOT NULL desde 11.3.
    // Lo tomamos de la sucursal activa del JWT (validada contra branch_memberships).
    const { branchId } = await requireBranchContext();

    const { error } = await supabaseAdmin
      .from('major_expenses')
      .insert({
        company_id: ctx.companyId,
        branch_id: branchId,
        category,
        description,
        amount,
        expense_date: expenseDate,
        notes,
        created_by: ctx.user.id
      });

    if (error) throw err('EXTERNAL', `major_expenses.insert: ${error.message}`, { cause: error });
    await audit(ctx, 'addMajorExpense', 'major_expense', {
      payload: { category, description, amount, expenseDate },
    });

    revalidatePath('/');
    return { success: true as const };
  } catch (caught) {
    return handleActionError(caught, 'addMajorExpense');
  }
}

export async function deleteMajorExpense(id: string): Promise<ActionResult<never>> {
  try {
    // FASE 10: el rol se lee de la membresía activa (no de profiles.role,
    // que se elimina en 10.5). requireAuthContext valida sesión + membresía.
    const ctx = await requireAuthContext();
    requireOwner(ctx.role);

    // FASE 11 (Bloque C): defense in depth — filtramos también por branch_id
    // para impedir que un owner borre gastos de otra sucursal vía id.
    const { branchId } = await requireBranchContext();

    const { error } = await supabaseAdmin
      .from('major_expenses')
      .delete()
      .eq('id', id)
      .eq('company_id', ctx.companyId)
      .eq('branch_id', branchId);

    if (error) throw err('EXTERNAL', `major_expenses.delete: ${error.message}`, { cause: error });
    await audit(ctx, 'deleteMajorExpense', 'major_expense', {
      entityId: id,
    });

    revalidatePath('/');
    return { success: true as const };
  } catch (caught) {
    return handleActionError(caught, 'deleteMajorExpense');
  }
}