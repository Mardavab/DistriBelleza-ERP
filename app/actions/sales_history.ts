'use server'

import { supabaseAdmin } from '../../lib/supabase';
import { unstable_noStore as noStore, revalidatePath } from 'next/cache';
import { getCurrentCompanyId } from '../../lib/supabase/company-context';
import { getColombiaToday } from '../../lib/timezone';

export async function getSalesHistory() {
  noStore();
  try {
    const companyId = await getCurrentCompanyId();

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
        profiles (full_name),
        sale_items (
          quantity,
          unit_price,
          discount_amount,
          products (name)
        )
      `)
      .eq('company_id', companyId)
      .gte('created_at', startOfDayUTC.toISOString())
      .order('created_at', { ascending: false })
      .limit(200);

    if (error) throw error;
    return { success: true, data };
  } catch (error: any) {
    if (error.message === 'UNAUTHENTICATED' || error.message === 'NO_COMPANY_CONTEXT') {
      return { success: false, error: 'Usuario sin empresa asignada.' };
    }
    console.error("Error fetching sales history:", error);
    return { success: false, error: error.message };
  }
}

export async function deleteSale(saleId: string) {
  try {
    const companyId = await getCurrentCompanyId();

    const { data, error } = await supabaseAdmin.rpc('tenant_delete_sale', {
      p_company_id: companyId,
      p_sale_id: saleId
    });

    if (error) throw error;

    const result = data as { success: boolean; error?: string };
    if (!result.success) throw new Error(result.error);

    revalidatePath('/');
    return { success: true };
  } catch (error: any) {
    if (error.message === 'UNAUTHENTICATED' || error.message === 'NO_COMPANY_CONTEXT') {
      return { success: false, error: 'Usuario sin empresa asignada.' };
    }
    console.error("Error deleting sale:", error);
    return { success: false, error: error.message };
  }
}