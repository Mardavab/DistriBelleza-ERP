'use server'

import { supabaseAdmin } from '../../lib/supabase';
import { revalidatePath } from 'next/cache';
import { getCurrentCompanyId } from '../../lib/supabase/company-context';
import { requireBranchContext } from '../../lib/supabase/branch-context';
import { getCompanyIdForBranch } from '../../lib/supabase/branch-membership-queries';
import { requireRole } from '../../lib/supabase/auth-helpers';
import { handleActionError, warnSilently, isAppError, err } from '../../lib/errors';
import { audit } from '../../lib/audit';

export async function getInventory() {
  try {
    await requireRole(['owner', 'manager']);
    // BLOQUE D (Fase 11): las sucursales comparten inventario. Leemos
    // directamente de `product_variants.stock` (fuente de verdad única
    // por empresa), con JOIN a `products` para los datos de catálogo.
    // NO hay `branch_stock` ni filtro por sucursal para stock.
    const companyId = await getCurrentCompanyId();

    const { data, error } = await supabaseAdmin
      .from('product_variants')
      .select(`
        *,
        products!inner (
          id,
          name,
          brand,
          category_id,
          price_base,
          active
        )
      `)
      .eq('company_id', companyId)
      .order('updated_at', { ascending: false });

    if (error) throw err('EXTERNAL', `product_variants.list: ${error.message}`, { cause: error });

    return (data ?? []) as any[];
  } catch (caught) {
    // Sin contexto de tenant es estado normal durante login.
    if (isAppError(caught) && (
      caught.code === 'UNAUTHENTICATED' ||
      caught.code === 'NO_COMPANY_CONTEXT'
    )) {
      return [];
    }
    warnSilently('getInventory', caught);
    return [];
  }
}

export async function getCategories() {
  try {
    await requireRole(['owner', 'manager']);
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
    const ctx = await requireRole(['owner', 'manager']);
    // BLOQUE D (Fase 11): el stock inicial se asigna a
    // `product_variants.stock` (NO a `branch_stock`, que ya no existe).
    // Las sucursales comparten inventario: el stock es global de la
    // empresa. Mantenemos `requireBranchContext` solo para registrar
    // el `inventory_movement` con el branch_id de la sucursal donde se
    // hizo el alta (los movimientos siguen siendo por sucursal).
    const { branchId } = await requireBranchContext();
    const companyId = await getCompanyIdForBranch(branchId);
    if (!companyId) {
      throw err('VALIDATION', 'Sucursal sin empresa asociada', {
        userMessage: 'No se pudo determinar la empresa de la sucursal.',
      });
    }

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

    // Insertar variantes con su stock real (vive en product_variants.stock).
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

    // Insertar inventory_movements (uno por variante con stock > 0).
    // El movement se asigna a la sucursal donde se hizo el alta,
    // aunque el stock afectado sea el global de la empresa.
    const movements = insertedVariants.map(v => {
      const inputVariant = variants.find((iv: any) => iv.sku === v.sku)
      const initialStock = inputVariant?.stock || 0
      return {
        company_id: companyId,
        branch_id: branchId,
        product_id: product.id,
        type: 'in',
        quantity: initialStock,
        reason: 'Carga inicial de producto',
      }
    }).filter(m => m.quantity > 0);

    if (movements.length > 0) {
      const { error: movError } = await supabaseAdmin.from('inventory_movements').insert(movements);
      if (movError) throw err('EXTERNAL', `inventory_movements.insert: ${movError.message}`, { cause: movError });
    }

    await audit(ctx, 'createProductWithVariants', 'product', {
      payload: { name: productData?.name, sku: productData?.sku, variantCount: variants.length },
    });

    revalidatePath('/');
    return { success: true as const };
  } catch (caught) {
    return handleActionError(caught, 'createProductWithVariants');
  }
}

export async function updateProductWithVariants(productId: string, productData: any, variants: any[]) {
  try {
    const ctx = await requireRole(['owner', 'manager']);
    // BLOQUE D (Fase 11): operamos sobre `product_variants.stock` (no
    // `branch_stock`, que ya no existe). Las sucursales comparten
    // inventario. Mantenemos `requireBranchContext` solo para asignar
    // el `branch_id` al `inventory_movement` de ajuste (los movimientos
    // siguen siendo por sucursal aunque el stock afectado sea global).
    const { branchId } = await requireBranchContext();
    const companyId = await getCompanyIdForBranch(branchId);
    if (!companyId) {
      throw err('VALIDATION', 'Sucursal sin empresa asociada', {
        userMessage: 'No se pudo determinar la empresa de la sucursal.',
      });
    }

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

    // Map de stock actual por variante (global de la empresa).
    const currentStockByVariant = new Map<string, number>()
    for (const cv of currentVariants ?? []) {
      currentStockByVariant.set(cv.id, Number(cv.stock ?? 0))
    }

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

      // Upsert de la variante con su stock real (vive en product_variants.stock).
      const { error: uError } = await supabaseAdmin
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

      // Calcular diff contra el stock anterior (global de la empresa).
      const oldStock = v.id ? (currentStockByVariant.get(v.id) ?? 0) : 0;
      const diff = newStock - oldStock;
      if (diff !== 0) {
        const { error: movError } = await supabaseAdmin.from('inventory_movements').insert({
          company_id: companyId,
          branch_id: branchId,
          product_id: productId,
          type: diff > 0 ? 'in' : 'out',
          quantity: Math.abs(diff),
          reason: currentV ? 'Ajuste manual de inventario' : 'Nueva variante añadida'
        });
        if (movError) throw err('EXTERNAL', `inventory_movements.insert: ${movError.message}`, { cause: movError });
      }
    }

    await audit(ctx, 'updateProductWithVariants', 'product', {
      entityId: productId,
      payload: { name: productData?.name, sku: productData?.sku, variantCount: variants.length },
    });

    revalidatePath('/');
    return { success: true as const };
  } catch (caught) {
    return handleActionError(caught, 'updateProductWithVariants');
  }
}

export async function deleteProduct(productId: string) {
  try {
    const ctx = await requireRole(['owner', 'manager']);
    const companyId = await getCurrentCompanyId();

    const { error } = await supabaseAdmin
      .from('products')
      .delete()
      .eq('id', productId)
      .eq('company_id', companyId);

    if (error) throw err('EXTERNAL', `products.delete: ${error.message}`, { cause: error });

    await audit(ctx, 'deleteProduct', 'product', { entityId: productId });

    revalidatePath('/');
    return { success: true as const };
  } catch (caught) {
    return handleActionError(caught, 'deleteProduct');
  }
}

export async function createCategory(name: string, description?: string) {
  try {
    const ctx = await requireRole(['owner', 'manager']);
    const companyId = await getCurrentCompanyId();

    const { data, error } = await supabaseAdmin
      .from('categories')
      .insert({ company_id: companyId, name, description })
      .select()
      .single();

    if (error) throw err('EXTERNAL', `categories.insert: ${error.message}`, { cause: error });
    await audit(ctx, 'createCategory', 'category', {
      entityId: (data as { id?: string })?.id ?? null,
      payload: { name, description: description ?? null },
    });

    revalidatePath('/');
    return { success: true as const, data };
  } catch (caught) {
    return handleActionError(caught, 'createCategory');
  }
}