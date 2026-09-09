'use server'

import { supabaseAdmin } from '../../lib/supabase';
import { unstable_noStore as noStore, revalidatePath } from 'next/cache';
import { getColombiaToday } from '../../lib/timezone';

/**
 * Obtiene el historial de ventas recientes.
 */
export async function getSalesHistory() {
  noStore();
  try {
    // Calcular el inicio del día en Colombia (UTC-5)
    const todayColombiaISO = getColombiaToday();
    const startOfDayUTC = new Date(todayColombiaISO + 'T05:00:00.000Z'); // 00:00 COT = 05:00 UTC

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
      .gte('created_at', startOfDayUTC.toISOString())
      .order('created_at', { ascending: false })
      .limit(200);

    if (error) throw error;
    return { success: true, data };
  } catch (error: any) {
    console.error("Error fetching sales history:", error);
    return { success: false, error: error.message };
  }
}

/**
 * Elimina una venta y revierte el stock.
 */
export async function deleteSale(saleId: string) {
  try {
    const { data, error } = await supabaseAdmin.rpc('delete_sale', {
      p_sale_id: saleId
    });

    if (error) throw error;

    // El RPC devuelve un JSONB con {success: boolean, error?: string}
    const result = data as { success: boolean; error?: string };
    if (!result.success) throw new Error(result.error);

    revalidatePath('/');
    return { success: true };
  } catch (error: any) {
    console.error("Error deleting sale:", error);
    return { success: false, error: error.message };
  }
}
