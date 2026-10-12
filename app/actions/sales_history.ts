'use server'

import { supabaseAdmin } from '../../lib/supabase';
import { unstable_noStore as noStore, revalidatePath } from 'next/cache';
import { getCurrentCompanyId } from '../../lib/supabase/company-context';
import { getColombiaToday } from '../../lib/timezone';
import { handleActionError, err } from '../../lib/errors';

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

    if (error) throw err('EXTERNAL', `sales.list: ${error.message}`, { cause: error });
    return { success: true as const, data };
  } catch (caught) {
    return handleActionError(caught, 'getSalesHistory');
  }
}

export async function deleteSale(saleId: string) {
  try {
    const companyId = await getCurrentCompanyId();

    const { data, error } = await supabaseAdmin.rpc('tenant_delete_sale', {
      p_company_id: companyId,
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