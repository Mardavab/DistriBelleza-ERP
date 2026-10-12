'use server'

import { supabaseAdmin } from '../../lib/supabase';
import { revalidatePath } from 'next/cache';
import { getCurrentCompanyId } from '../../lib/supabase/company-context';
import { handleActionError, warnSilently, isAppError, err } from '../../lib/errors';

export async function getInventory() {
  try {
    const companyId = await getCurrentCompanyId();

    const { data, error } = await supabaseAdmin
      .from('product_variants')
      .select(`
        *,
        products (
          id,
          name,
          brand,
          category_id,
          price_base,
          active
        )
      `)
      .eq('company_id', companyId)
      .order('created_at', { ascending: false });

    if (error) throw err('EXTERNAL', `product_variants.list: ${error.message}`, { cause: error });
    return data || [];
  } catch (caught) {
    // Sin contexto de tenant es estado normal durante login; no logueamos.
    if (isAppError(caught) && (caught.code === 'UNAUTHENTICATED' || caught.code === 'NO_COMPANY_CONTEXT')) {
      return [];
    }
    warnSilently('getInventory', caught);
    return [];
  }
}

export async function getCategories() {
  try {
    const companyId = await getCurrentCompanyId();

    const { data, error } = await supabaseAdmin
      .from('categories')
      .select('*')
      .eq('company_id', companyId)
      .order('name');

    if (error) throw err('EXTERNAL', `categories.list: ${error.message}`, { cause: error });
    return data || [];
  } catch {
    // Fallback para listar categorías globales cuando no hay tenant context.
    const { data } = await supabaseAdmin.from('categories').select('*').order('name');
    return data || [];
  }
}

export async function createProductWithVariants(productData: any, variants: any[]) {
  try {
    const companyId = await getCurrentCompanyId();

    const { data: product, error: pError } = await supabaseAdmin
      .from('products')
      .insert({
        company_id: companyId,
        name: productData.name,
        brand: productData.brand,
        category_id: productData.category_id,
        price_base: productData.price_base || null,
        active: true
      })
      .select()
      .single();

    if (pError) throw err('EXTERNAL', `products.insert: ${pError.message}`, { cause: pError });

    const variantsToInsert = variants.map(v => ({
      company_id: companyId,
      product_id: product.id,
      name: v.name,
      sku: v.sku,
      barcode: v.barcode || null,
      stock: v.stock || 0,
      price: v.price || null,
      active: true
    }));

    const { data: insertedVariants, error: vError } = await supabaseAdmin
      .from('product_variants')
      .insert(variantsToInsert)
      .select();

    if (vError) throw err('EXTERNAL', `product_variants.insert: ${vError.message}`, { cause: vError });

    const movements = insertedVariants.map(v => ({
      company_id: companyId,
      product_id: product.id,
      type: 'in',
      quantity: v.stock,
      reason: 'Carga inicial de producto'
    })).filter(m => m.quantity > 0);

    if (movements.length > 0) {
      const { error: movError } = await supabaseAdmin.from('inventory_movements').insert(movements);
      if (movError) throw err('EXTERNAL', `inventory_movements.insert: ${movError.message}`, { cause: movError });
    }

    revalidatePath('/');
    return { success: true as const };
  } catch (caught) {
    return handleActionError(caught, 'createProductWithVariants');
  }
}

export async function updateProductWithVariants(productId: string, productData: any, variants: any[]) {
  try {
    const companyId = await getCurrentCompanyId();

    const { error: pError } = await supabaseAdmin
      .from('products')
      .update({
        name: productData.name,
        brand: productData.brand,
        category_id: productData.category_id,
        price_base: productData.price_base || null
      })
      .eq('id', productId)
      .eq('company_id', companyId);

    if (pError) throw err('EXTERNAL', `products.update: ${pError.message}`, { cause: pError });

    const { data: currentVariants, error: cvError } = await supabaseAdmin
      .from('product_variants')
      .select('*')
      .eq('product_id', productId)
      .eq('company_id', companyId);

    if (cvError) throw err('EXTERNAL', `product_variants.list: ${cvError.message}`, { cause: cvError });

    const incomingIds = variants.filter(v => v.id).map(v => v.id);
    const variantsToDelete = currentVariants.filter(cv => !incomingIds.includes(cv.id)).map(cv => cv.id);

    if (variantsToDelete.length > 0) {
      const { error: delError } = await supabaseAdmin
        .from('product_variants')
        .delete()
        .in('id', variantsToDelete)
        .eq('company_id', companyId);
      if (delError) throw err('EXTERNAL', `product_variants.delete: ${delError.message}`, { cause: delError });
    }

    for (const v of variants) {
      const currentV = currentVariants.find(cv => cv.id === v.id);
      const newStock = v.stock || 0;

      const { data: upserted, error: uError } = await supabaseAdmin
        .from('product_variants')
        .upsert({
          company_id: companyId,
          id: v.id || undefined,
          product_id: productId,
          name: v.name,
          sku: v.sku,
          barcode: v.barcode || null,
          stock: newStock,
          price: v.price || null,
          active: true
        })
        .select()
        .single();

      if (uError) throw err('EXTERNAL', `product_variants.upsert: ${uError.message}`, { cause: uError });

      const oldStock = currentV ? currentV.stock : 0;
      const diff = newStock - oldStock;
      if (diff !== 0) {
        const { error: movError } = await supabaseAdmin.from('inventory_movements').insert({
          company_id: companyId,
          product_id: productId,
          type: diff > 0 ? 'in' : 'out',
          quantity: Math.abs(diff),
          reason: currentV ? 'Ajuste manual de inventario' : 'Nueva variante añadida'
        });
        if (movError) throw err('EXTERNAL', `inventory_movements.insert: ${movError.message}`, { cause: movError });
      }
    }

    revalidatePath('/');
    return { success: true as const };
  } catch (caught) {
    return handleActionError(caught, 'updateProductWithVariants');
  }
}

export async function deleteProduct(productId: string) {
  try {
    const companyId = await getCurrentCompanyId();

    const { error } = await supabaseAdmin
      .from('products')
      .delete()
      .eq('id', productId)
      .eq('company_id', companyId);

    if (error) throw err('EXTERNAL', `products.delete: ${error.message}`, { cause: error });

    revalidatePath('/');
    return { success: true as const };
  } catch (caught) {
    return handleActionError(caught, 'deleteProduct');
  }
}

export async function createCategory(name: string, description?: string) {
  try {
    const companyId = await getCurrentCompanyId();

    const { data, error } = await supabaseAdmin
      .from('categories')
      .insert({ company_id: companyId, name, description })
      .select()
      .single();

    if (error) throw err('EXTERNAL', `categories.insert: ${error.message}`, { cause: error });
    revalidatePath('/');
    return { success: true as const, data };
  } catch (caught) {
    return handleActionError(caught, 'createCategory');
  }
}