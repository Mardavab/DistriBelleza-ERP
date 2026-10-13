'use server'

import { supabaseAdmin } from '../../lib/supabase';
import { unstable_noStore as noStore, revalidatePath } from 'next/cache';
import { requireBranchContext } from '../../lib/supabase/branch-context';
import { getCompanyIdForBranch } from '../../lib/supabase/branch-membership-queries';
import { getColombiaToday } from '../../lib/timezone';
import { handleActionError, err } from '../../lib/errors';

export async function getSalesHistory() {
  noStore();
  try {
    // FASE 11 (Bloque C): filtramos ventas de la SUCURSAL activa.
    const { branchId } = await requireBranchContext();
    const companyId = await getCompanyIdForBranch(branchId);
    if (!companyId) return { success: true as const, data: [] };

    const todayColombiaISO = getColombiaToday();
    const startOfDayUTC = new Date(todayColombiaISO + 'T05:00:00.000Z');

    const { data, error } = await supabaseAdmin
      .from('sales')
      .select(`
        id,
        created_at,
        total_with_discount,
        payment_method,
        status,
        branch_id,
        profiles (full_name),
        sale_items (
          quantity,
          unit_price,
          discount_amount,
          products (name)
        )
      `)
      .eq('company_id', companyId)
      .eq('branch_id', branchId)
      .gte('created_at', startOfDayUTC.toISOString())
      .order('created_at', { ascending: false })
      .limit(200);

    if (error) throw err('EXTERNAL', `sales.list: ${error.message}`, { cause: error });
    return { success: true as const, data };
  } catch (caught) {
    return handleActionError(caught, 'getSalesHistory');
  }
}

export async function deleteSale(saleId: string) {
  try {
    // FASE 11 (Bloque C): tenant_delete_sale ahora requiere p_branch_id.
    const { branchId } = await requireBranchContext();
    const companyId = await getCompanyIdForBranch(branchId);
    if (!companyId) {
      throw err('VALIDATION', 'Sucursal sin empresa asociada', {
        userMessage: 'No se pudo determinar la empresa de la sucursal.',
      });
    }

    const { data, error } = await supabaseAdmin.rpc('tenant_delete_sale', {
      p_company_id: companyId,
      p_branch_id: branchId,
      p_sale_id: saleId
    });

    if (error) throw err('EXTERNAL', `tenant_delete_sale: ${error.message}`, { cause: error });

    const result = data as { success: boolean; error?: string };
    if (!result.success) throw err('VALIDATION', `tenant_delete_sale: ${result.error ?? 'failed'}`, {
      userMessage: result.error,
    });

    revalidatePath('/');
    return { success: true as const };
  } catch (caught) {
    return handleActionError(caught, 'deleteSale');
  }
}