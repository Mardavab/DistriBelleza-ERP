'use server'

import { supabaseAdmin } from '../../lib/supabase';
import { revalidatePath } from 'next/cache';
import { getCurrentCompanyId } from '../../lib/supabase/company-context';

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

    if (error) throw error;
    return data || [];
  } catch (error: any) {
    if (error.message === 'UNAUTHENTICATED' || error.message === 'NO_COMPANY_CONTEXT') {
      return [];
    }
    console.error("Error fetching inventory:", error);
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

    if (error) throw error;
    return data || [];
  } catch {
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

    if (pError) throw pError;

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

    if (vError) throw vError;

    const movements = insertedVariants.map(v => ({
      company_id: companyId,
      product_id: product.id,
      type: 'in',
      quantity: v.stock,
      reason: 'Carga inicial de producto'
    })).filter(m => m.quantity > 0);

    if (movements.length > 0) {
      await supabaseAdmin.from('inventory_movements').insert(movements);
    }

    revalidatePath('/');
    return { success: true };
  } catch (error: any) {
    if (error.message === 'UNAUTHENTICATED') {
      return { success: false, error: 'No autenticado.' };
    }
    if (error.message === 'NO_COMPANY_CONTEXT') {
      return { success: false, error: 'Usuario sin empresa asignada.' };
    }
    console.error("Error creating product:", error);
    return { success: false, error: error.message };
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

    if (pError) throw pError;

    const { data: currentVariants, error: cvError } = await supabaseAdmin
      .from('product_variants')
      .select('*')
      .eq('product_id', productId)
      .eq('company_id', companyId);

    if (cvError) throw cvError;

    const incomingIds = variants.filter(v => v.id).map(v => v.id);
    const variantsToDelete = currentVariants.filter(cv => !incomingIds.includes(cv.id)).map(cv => cv.id);

    if (variantsToDelete.length > 0) {
      await supabaseAdmin
        .from('product_variants')
        .delete()
        .in('id', variantsToDelete)
        .eq('company_id', companyId);
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

      if (uError) throw uError;

      const oldStock = currentV ? currentV.stock : 0;
      const diff = newStock - oldStock;
      if (diff !== 0) {
        await supabaseAdmin.from('inventory_movements').insert({
          company_id: companyId,
          product_id: productId,
          type: diff > 0 ? 'in' : 'out',
          quantity: Math.abs(diff),
          reason: currentV ? 'Ajuste manual de inventario' : 'Nueva variante añadida'
        });
      }
    }

    revalidatePath('/');
    return { success: true };
  } catch (error: any) {
    if (error.message === 'UNAUTHENTICATED') {
      return { success: false, error: 'No autenticado.' };
    }
    if (error.message === 'NO_COMPANY_CONTEXT') {
      return { success: false, error: 'Usuario sin empresa asignada.' };
    }
    console.error("Error updating product:", error);
    return { success: false, error: error.message };
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

    if (error) throw error;

    revalidatePath('/');
    return { success: true };
  } catch (error: any) {
    if (error.message === 'UNAUTHENTICATED') {
      return { success: false, error: 'No autenticado.' };
    }
    if (error.message === 'NO_COMPANY_CONTEXT') {
      return { success: false, error: 'Usuario sin empresa asignada.' };
    }
    console.error("Error deleting product:", error);
    return { success: false, error: error.message };
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

    if (error) throw error;
    revalidatePath('/');
    return { success: true, data };
  } catch (error: any) {
    if (error.message === 'UNAUTHENTICATED') {
      return { success: false, error: 'No autenticado.' };
    }
    if (error.message === 'NO_COMPANY_CONTEXT') {
      return { success: false, error: 'Usuario sin empresa asignada.' };
    }
    console.error("Error creating category:", error);
    return { success: false, error: error.message };
  }
}