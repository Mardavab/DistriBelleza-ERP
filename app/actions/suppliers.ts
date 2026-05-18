'use server'

import { supabaseAdmin } from '../../lib/supabase';
import { revalidatePath } from 'next/cache';
import { unstable_noStore as noStore } from 'next/cache';

// ─── TIPOS ────────────────────────────────────────────────────────────────────

export type Supplier = {
  id: string;
  name: string;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
};

export type SupplierInvoice = {
  id: string;
  supplier_id: string;
  supplier_name?: string;
  invoice_number?: string | null;
  issue_date: string;
  due_date: string;
  amount: number;
  paid_amount: number;
  status: 'pending' | 'paid' | 'overdue' | 'cancelled';
  description?: string | null;
  created_at: string;
  updated_at: string;
};

// ─── PROVEEDORES ──────────────────────────────────────────────────────────────

/**
 * Obtiene todos los proveedores activos.
 */
export async function getSuppliers(): Promise<{ success: boolean; data?: Supplier[]; error?: string }> {
  noStore();
  try {
    const { data, error } = await supabaseAdmin
      .from('suppliers')
      .select('*')
      .eq('active', true)
      .order('name', { ascending: true });

    if (error) throw error;
    return { success: true, data: data || [] };
  } catch (error: any) {
    console.error('Error fetching suppliers:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Crea un nuevo proveedor.
 */
export async function createSupplier(payload: {
  name: string;
  phone?: string;
  email?: string;
  address?: string;
}): Promise<{ success: boolean; data?: Supplier; error?: string }> {
  try {
    if (!payload.name?.trim()) {
      return { success: false, error: 'El nombre del proveedor es obligatorio.' };
    }

    const { data, error } = await supabaseAdmin
      .from('suppliers')
      .insert({
        name: payload.name.trim(),
        phone: payload.phone?.trim() || null,
        email: payload.email?.trim() || null,
        address: payload.address?.trim() || null,
        active: true,
      })
      .select()
      .single();

    if (error) throw error;
    revalidatePath('/');
    return { success: true, data };
  } catch (error: any) {
    console.error('Error creating supplier:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Actualiza un proveedor existente.
 */
export async function updateSupplier(
  id: string,
  payload: { name: string; phone?: string; email?: string; address?: string }
): Promise<{ success: boolean; error?: string }> {
  try {
    const { error } = await supabaseAdmin
      .from('suppliers')
      .update({
        name: payload.name.trim(),
        phone: payload.phone?.trim() || null,
        email: payload.email?.trim() || null,
        address: payload.address?.trim() || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id);

    if (error) throw error;
    revalidatePath('/');
    return { success: true };
  } catch (error: any) {
    console.error('Error updating supplier:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Desactiva (soft-delete) un proveedor.
 */
export async function deleteSupplier(id: string): Promise<{ success: boolean; error?: string }> {
  try {
    const { error } = await supabaseAdmin
      .from('suppliers')
      .update({ active: false, updated_at: new Date().toISOString() })
      .eq('id', id);

    if (error) throw error;
    revalidatePath('/');
    return { success: true };
  } catch (error: any) {
    console.error('Error deleting supplier:', error);
    return { success: false, error: error.message };
  }
}

// ─── FACTURAS DE PROVEEDORES ──────────────────────────────────────────────────

/**
 * Obtiene todas las facturas de proveedores con nombre del proveedor.
 */
export async function getSupplierInvoices(): Promise<{
  success: boolean;
  data?: SupplierInvoice[];
  error?: string;
}> {
  noStore();
  try {
    const { data, error } = await supabaseAdmin
      .from('supplier_invoices')
      .select(`
        *,
        suppliers ( name )
      `)
      .order('due_date', { ascending: true });

    if (error) throw error;

    const normalized = (data || []).map((inv: any) => ({
      ...inv,
      supplier_name: inv.suppliers?.name ?? '—',
    }));

    return { success: true, data: normalized };
  } catch (error: any) {
    console.error('Error fetching supplier invoices:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Crea una nueva factura de proveedor.
 */
export async function createSupplierInvoice(payload: {
  supplier_id: string;
  invoice_number?: string;
  issue_date: string;
  due_date: string;
  amount: number;
  description?: string;
}): Promise<{ success: boolean; data?: SupplierInvoice; error?: string }> {
  try {
    if (!payload.supplier_id) return { success: false, error: 'Debes seleccionar un proveedor.' };
    if (!payload.issue_date) return { success: false, error: 'La fecha de expedición es obligatoria.' };
    if (!payload.due_date) return { success: false, error: 'La fecha de vencimiento es obligatoria.' };
    if (!payload.amount || payload.amount <= 0) return { success: false, error: 'El valor debe ser mayor a cero.' };

    const { data, error } = await supabaseAdmin
      .from('supplier_invoices')
      .insert({
        supplier_id: payload.supplier_id,
        invoice_number: payload.invoice_number?.trim() || null,
        issue_date: payload.issue_date,
        due_date: payload.due_date,
        amount: payload.amount,
        status: 'pending',
        description: payload.description?.trim() || null,
      })
      .select()
      .single();

    if (error) throw error;
    revalidatePath('/');
    return { success: true, data };
  } catch (error: any) {
    console.error('Error creating invoice:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Actualiza el estado de una factura (pending, paid, overdue, cancelled).
 */
export async function updateInvoiceStatus(
  id: string,
  status: 'pending' | 'paid' | 'overdue' | 'cancelled'
): Promise<{ success: boolean; error?: string }> {
  try {
    const { error } = await supabaseAdmin
      .from('supplier_invoices')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', id);

    if (error) throw error;
    revalidatePath('/');
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

/**
 * Elimina una factura de proveedor.
 */
export async function deleteSupplierInvoice(id: string): Promise<{ success: boolean; error?: string }> {
  try {
    const { error } = await supabaseAdmin
      .from('supplier_invoices')
      .delete()
      .eq('id', id);

    if (error) throw error;
    revalidatePath('/');
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

/**
 * Registra un abono parcial o total a una factura de proveedor.
 * Si el abono cubre el total pendiente, la factura se marca como pagada automáticamente.
 */
export async function addInvoicePayment(
  id: string,
  paymentAmount: number
): Promise<{ success: boolean; newPaidAmount?: number; newStatus?: string; error?: string }> {
  try {
    if (!paymentAmount || paymentAmount <= 0) {
      return { success: false, error: 'El valor del abono debe ser mayor a cero.' };
    }

    // 1. Obtener factura actual
    const { data: inv, error: fetchErr } = await supabaseAdmin
      .from('supplier_invoices')
      .select('amount, paid_amount, status')
      .eq('id', id)
      .single();

    if (fetchErr || !inv) throw fetchErr ?? new Error('Factura no encontrada.');
    if (inv.status === 'paid')      return { success: false, error: 'Esta factura ya está completamente pagada.' };
    if (inv.status === 'cancelled') return { success: false, error: 'No se puede abonar a una factura cancelada.' };

    const currentPaid = Number(inv.paid_amount ?? 0);
    const total       = Number(inv.amount);
    const remaining   = total - currentPaid;

    if (paymentAmount > remaining) {
      return {
        success: false,
        error: `El abono (${paymentAmount.toLocaleString('es-CO')}) supera el saldo pendiente (${remaining.toLocaleString('es-CO')}).`,
      };
    }

    const newPaidAmount = currentPaid + paymentAmount;
    const newStatus: 'paid' | 'pending' = newPaidAmount >= total ? 'paid' : 'pending';

    // 2. Actualizar factura
    const { error: updateErr } = await supabaseAdmin
      .from('supplier_invoices')
      .update({
        paid_amount: newPaidAmount,
        status: newStatus,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id);

    if (updateErr) throw updateErr;

    revalidatePath('/');
    return { success: true, newPaidAmount, newStatus };
  } catch (error: any) {
    console.error('Error adding invoice payment:', error);
    return { success: false, error: error.message };
  }
}
