'use server'

import { supabaseAdmin } from '../../lib/supabase';
import { createClient } from '../../lib/supabase/server';
import { revalidatePath, unstable_noStore as noStore } from 'next/cache';
import { getCurrentCompanyId } from '../../lib/supabase/company-context';
import { handleActionError, AppError, err } from '../../lib/errors';

export interface POSItem {
  variant_id: string;
  quantity: number;
  expected_updated_at: string;
  discount: number;
}

/**
 * Resultado de búsqueda en inventario del POS.
 * Incluye `barcode` (código de barras físico) además del SKU, ya que algunos
 * productos tienen códigos distintos en cada campo.
 */
export interface POSSearchResult {
  variant_id: string;
  product_name: string;
  product_brand: string;
  variant_name: string;
  sku: string;
  barcode: string | null;
  price: number;
  stock: number;
}

export async function searchPOSProducts(query: string): Promise<POSSearchResult[]> {
  noStore();
  // Trim defensivo: muchos lectores de código de barras envían \r\n al final
  // del código, y eso rompe la búsqueda con `=` (equality).
  const cleaned = (query ?? '').replace(/[\r\n]+/g, '').trim();
  if (!cleaned || cleaned.length < 2) return [];

  const companyId = await getCurrentCompanyId();

  const { data, error } = await supabaseAdmin.rpc('tenant_search_inventory', {
    p_company_id: companyId,
    search_term: cleaned
  });

  if (error) return [];
  return (data ?? []) as POSSearchResult[];
}

export async function getDefaultProducts(page: number = 1, pageSize: number = 200) {
  noStore();
  const companyId = await getCurrentCompanyId();

  const { data, error, count } = await supabaseAdmin
    .from('product_variants')
    .select('id, sku, stock, price, name, updated_at, products!inner(name, brand, price_base)', { count: 'exact' })
    .eq('company_id', companyId)
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

export type ProcessPOSSaleResult =
  | {
      success: true;
      saleId: string;
      paid: number;
      message: string;
      receipt: {
        saleId: string;
        createdAt: string;
        cashier: string;
        items: Array<{ productName: string; quantity: number; unitPrice: number; discount: number }>;
        subtotal: number;
        totalDiscount: number;
        total: number;
        paymentMethod: string;
        transferType?: string;
        cashReceived?: number;
      };
    }
  | {
      success: false;
      error: string;
      code: import('../../lib/errors').AppErrorCode;
    };

export async function processPOSSale(
  customerId: string | null,
  items: POSItem[],
  paymentMethod: 'CASH' | 'CARD' | 'BANK_TRANSFER' | 'CREDIT',
  transferType: 'NEQUI' | 'DAVIPLATA' | 'BANCOLOMBIA' | 'OTHER' | 'QR' | null = null,
  totalDiscount: number = 0
): Promise<ProcessPOSSaleResult> {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    const companyId = await getCurrentCompanyId();

    const { data, error } = await supabaseAdmin.rpc('tenant_process_sale', {
      p_company_id: companyId,
      p_customer_id: customerId,
      p_items: items,
      p_payment_method: paymentMethod,
      p_transfer_type: transferType,
      p_total_discount: totalDiscount,
    });

    if (error) {
      // Errores específicos de la RPC con código legacy para no romper contratos.
      if (error.message.includes('No hay una sesión de caja abierta')) {
        throw new AppError(
          'FORBIDDEN',
          'No hay sesión de caja abierta',
          { userMessage: 'DEBE ABRIR CAJA ANTES DE VENDER.' },
        );
      }
      throw err('EXTERNAL', `tenant_process_sale: ${error.message}`, { cause: error });
    }

    const result = data as { success: boolean; error?: string; code?: string; sale_id?: string; paid?: number };

    if (!result.success) {
      if (result.error?.includes('CONFLICT_409')) {
        throw new AppError(
          'CONFLICT',
          'Conflicto de stock',
          { userMessage: 'Conflicto de stock.' },
        );
      }
      throw new AppError(
        'VALIDATION',
        result.error ?? 'Venta rechazada por el servidor',
        { userMessage: result.error ?? 'No se pudo registrar la venta.' },
      );
    }

    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('full_name')
      .eq('id', user?.id)
      .maybeSingle();

    const { data: saleDetail } = await supabaseAdmin
      .from('sales')
      .select('total_amount, discount_amount, total_with_discount, paid_amount, created_at')
      .eq('id', result.sale_id)
      .eq('company_id', companyId)
      .single();

    const { data: saleItems } = await supabaseAdmin
      .from('sale_items')
      .select('quantity, unit_price, discount_amount, products(name)')
      .eq('sale_id', result.sale_id)
      .eq('company_id', companyId);

    const receiptItems = (saleItems || []).map((si: any) => ({
      productName: si.products?.name || 'Producto',
      quantity: si.quantity,
      unitPrice: Number(si.unit_price),
      discount: Number(si.discount_amount || 0),
    }));

    return {
      success: true as const,
      saleId: result.sale_id,
      paid: result.paid,
      message: 'Venta exitosa.',
      receipt: {
        saleId: result.sale_id,
        createdAt: saleDetail?.created_at || new Date().toISOString(),
        cashier: profile?.full_name || user?.email || '',
        items: receiptItems,
        subtotal: Number(saleDetail?.total_amount || 0),
        totalDiscount: Number(saleDetail?.discount_amount || 0),
        total: Number(saleDetail?.total_with_discount || 0),
        paymentMethod,
        transferType: transferType || undefined,
        cashReceived: paymentMethod === 'CASH' ? Number(result.paid) : undefined,
      }
    };

  } catch (caught) {
    return handleActionError(caught, 'processPOSSale');
  } finally {
    revalidatePath('/');
  }
}