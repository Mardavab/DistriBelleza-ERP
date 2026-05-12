'use server'

import { supabaseAdmin } from '../../lib/supabase';

/**
 * Obtiene el precio de una variante aplicando la lógica de Herencia de Precio.
 * 1. Intenta obtener el precio de la variante.
 * 2. Si es NULL, intenta obtener el precio del producto padre.
 * 3. Si ambos son NULL o el producto no existe, lanza un error 422.
 * 
 * @param variantId UUID de la variante
 * @returns El precio final heredado
 */
export async function getEffectivePrice(variantId: string) {
  try {
    // 1. Consultar variante y su producto padre en una sola query optimizada
    const { data: variant, error: vError } = await supabaseAdmin
      .from('product_variants')
      .select('price, product:products(id, price)')
      .eq('id', variantId)
      .single();

    if (vError || !variant) {
      throw new Error('La variante especificada no existe.');
    }

    // Lógica de Herencia
    const variantPrice = variant.price;
    const productPrice = (variant.product as any)?.price;

    // Caso 1: Variante tiene precio propio
    if (variantPrice !== null && variantPrice !== undefined) {
      return Number(variantPrice);
    }

    // Caso 2: Herencia del producto padre
    if (productPrice !== null && productPrice !== undefined && Number(productPrice) > 0) {
      return Number(productPrice);
    }

    // Caso 3: Fallo de herencia (Ambos NULL) -> Error 422
    const error: any = new Error('Error 422: No se ha podido determinar el precio. Ni la variante ni el producto base tienen un precio definido.');
    error.status = 422;
    error.digest = 'PRICE_INHERITANCE_FAILED'; // Útil para Next.js error boundaries
    throw error;

  } catch (err: any) {
    console.error('[Action: getEffectivePrice]', err.message);
    throw err;
  }
}

/**
 * Realiza una transferencia de stock entre variantes de forma atómica.
 * Utiliza la función RPC 'transfer_stock' definida en PostgreSQL para garantizar 
 * la integridad de los datos y evitar condiciones de carrera (Race Conditions).
 * 
 * @param fromId ID variante origen
 * @param toId ID variante destino
 * @param qty Cantidad a transferir
 */
export async function transferInventory(fromId: string, toId: string, qty: number) {
  try {
    // Validación básica en el servidor antes de ir a DB
    if (qty <= 0) {
      return { success: false, error: 'La cantidad debe ser un número positivo.' };
    }

    if (fromId === toId) {
      return { success: false, error: 'No se puede transferir stock a la misma variante.' };
    }

    // Llamada a la función RPC atómica
    const { data, error: rpcError } = await supabaseAdmin.rpc('transfer_stock', {
      from_variant_id: fromId,
      to_variant_id: toId,
      quantity_to_move: qty
    });

    if (rpcError) {
      console.error('[Action: transferInventory] RPC Error:', rpcError.message);
      return { success: false, error: 'Error interno en la base de datos al procesar la transferencia.' };
    }

    const result = data as { success: boolean; error?: string; message?: string };

    if (!result.success) {
      return { success: false, error: result.error };
    }

    return { success: true, message: result.message };

  } catch (err: any) {
    console.error('[Action: transferInventory] Unexpected Error:', err.message);
    return { success: false, error: 'Ocurrió un error inesperado al procesar la transferencia.' };
  }
}
