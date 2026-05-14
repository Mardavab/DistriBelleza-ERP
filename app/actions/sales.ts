'use server'

import { supabaseAdmin } from '../../lib/supabase';
import { revalidatePath, unstable_noStore as noStore } from 'next/cache';

export interface POSItem {
  variant_id: string;
  quantity: number;
  expected_updated_at: string;
  discount: number;
}

export async function searchPOSProducts(query: string) {
  noStore();
  if (!query || query.length < 2) return [];

  const { data, error } = await supabaseAdmin.rpc('search_inventory', {
    search_term: query
  });

  if (error) return [];
  return data as any[];
}

export async function getDefaultProducts(page: number = 1, pageSize: number = 6) {
  noStore();
  const { data, error, count } = await supabaseAdmin
    .from('product_variants')
    .select('id, sku, stock, price, name, updated_at, products!inner(name, brand, price_base)', { count: 'exact' })
    .gt('stock', 0)
    .order('updated_at', { ascending: false })
    .range((page - 1) * pageSize, page * pageSize - 1);

  if (error) {
    console.error("Error fetching default products:", error);
    return { data: [], count: 0 };
  }

  const formattedData = data.map((v: any) => ({
    variant_id: v.id,
    product_name: v.products.name,
    product_brand: v.products.brand,
    variant_name: v.name,
    sku: v.sku,
    price: v.price ?? v.products.price_base,
    stock: v.stock,
    updated_at: v.updated_at
  }));

  return { data: formattedData, count: count || 0 };
}

import { createClient } from '../../lib/supabase/server';

export async function processPOSSale(
  customerId: string | null,
  items: POSItem[],
  paymentMethod: 'CASH' | 'CARD' | 'BANK_TRANSFER' | 'CREDIT',
  transferType: 'NEQUI' | 'DAVIPLATA' | 'BANCOLOMBIA' | 'OTHER' | 'QR' | null = null,
  totalDiscount: number = 0
) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    const { data, error } = await supabaseAdmin.rpc('process_sale', {
      p_customer_id: customerId,
      p_items: items,
      p_payment_method: paymentMethod,
      p_transfer_type: transferType,
      p_total_discount: totalDiscount,
      p_user_id: user?.id || null
    });

    if (error) {
      if (error.message.includes('No hay una sesión de caja abierta')) {
        return { success: false, error: 'DEBE ABRIR CAJA ANTES DE VENDER.' };
      }
      return { success: false, error: error.message };
    }

    const result = data as { success: boolean; error?: string; code?: string; sale_id?: string; paid?: number };

    if (!result.success) {
      if (result.error?.includes('CONFLICT_409')) {
        return { success: false, error: 'Conflicto de stock.', isConflict: true };
      }
      return { success: false, error: result.error };
    }

    return {
      success: true,
      saleId: result.sale_id,
      paid: result.paid,
      message: 'Venta exitosa.'
    };

  } catch (err: any) {
    console.error("Error in processPOSSale:", err);
    return { success: false, error: 'Error inesperado.' };
  } finally {
    revalidatePath('/');
  }
}
