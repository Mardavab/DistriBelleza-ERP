'use server'

import { supabaseAdmin } from '../../lib/supabase';

/**
 * Obtiene el historial de ventas recientes.
 */
export async function getSalesHistory() {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

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
      .gte('created_at', today.toISOString())
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) throw error;
    return { success: true, data };
  } catch (error: any) {
    console.error("Error fetching sales history:", error);
    return { success: false, error: error.message };
  }
}
