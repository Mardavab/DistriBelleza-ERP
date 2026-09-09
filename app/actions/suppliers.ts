'use server'

import { supabaseAdmin } from '../../lib/supabase';
import { revalidatePath, unstable_noStore as noStore } from 'next/cache';

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
  billed_to?: string | null;
  invoice_type?: 'remision' | 'electronica';
  invoice_file_url?: string | null;
  receipt_file_url?: string | null;
  created_at: string;
  updated_at: string;
};

// ─── HELPER: Subida de archivos ───────────────────────────────────────────────

async function uploadInvoiceFile(file: File | null, prefix: string): Promise<string | null> {
  if (!file || file.size === 0 || file.name === 'undefined') return null;
  
  try {
    const fileExt = file.name.split('.').pop() || 'png';
    const fileName = `${prefix}-${Date.now()}.${fileExt}`;
    
    // Convertir a array buffer para Supabase Storage en entorno de Node/Next.js
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const { error } = await supabaseAdmin.storage
      .from('proveedores_archivos')
      .upload(fileName, buffer, {
        contentType: file.type || 'image/png',
        upsert: false
      });

    if (error) throw error;

    const { data: publicUrlData } = supabaseAdmin.storage
      .from('proveedores_archivos')
      .getPublicUrl(fileName);

    return publicUrlData.publicUrl;
  } catch (error) {
    console.error('Error uploading file:', error);
    return null;
  }
}

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
export async function createSupplierInvoice(formData: FormData): Promise<{ success: boolean; data?: SupplierInvoice; error?: string }> {
  try {
    const supplier_id = formData.get('supplier_id') as string;
    const invoice_number = formData.get('invoice_number') as string;
    const issue_date = formData.get('issue_date') as string;
    const due_date = formData.get('due_date') as string;
    const amount = Number(formData.get('amount'));
    const description = formData.get('description') as string;
    const billed_to = formData.get('billed_to') as string;
    const invoice_type = formData.get('invoice_type') as string;
    const invoice_file = formData.get('invoice_file') as File | null;

    if (!supplier_id) return { success: false, error: 'Debes seleccionar un proveedor.' };
    if (!issue_date) return { success: false, error: 'La fecha de expedición es obligatoria.' };
    if (!due_date) return { success: false, error: 'La fecha de vencimiento es obligatoria.' };
    if (!amount || amount <= 0) return { success: false, error: 'El valor debe ser mayor a cero.' };

    let invoice_file_url = null;
    if (invoice_file && invoice_file.size > 0) {
      invoice_file_url = await uploadInvoiceFile(invoice_file, 'inv');
    }

    const { data, error } = await supabaseAdmin
      .from('supplier_invoices')
      .insert({
        supplier_id,
        invoice_number: invoice_number?.trim() || null,
        issue_date,
        due_date,
        amount,
        status: 'pending',
        description: description?.trim() || null,
        billed_to: billed_to?.trim() || null,
        invoice_type: invoice_type || 'remision',
        invoice_file_url,
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
 * Actualiza una factura existente.
 */
export async function updateSupplierInvoice(
  id: string,
  formData: FormData
): Promise<{ success: boolean; error?: string }> {
  try {
    const supplier_id = formData.get('supplier_id') as string;
    const invoice_number = formData.get('invoice_number') as string;
    const issue_date = formData.get('issue_date') as string;
    const due_date = formData.get('due_date') as string;
    const amount = Number(formData.get('amount'));
    const description = formData.get('description') as string;
    const billed_to = formData.get('billed_to') as string;
    const invoice_type = formData.get('invoice_type') as string;
    const invoice_file = formData.get('invoice_file') as File | null;

    if (!supplier_id) return { success: false, error: 'Debes seleccionar un proveedor.' };
    if (!issue_date) return { success: false, error: 'La fecha de expedición es obligatoria.' };
    if (!due_date) return { success: false, error: 'La fecha de vencimiento es obligatoria.' };
    if (!amount || amount <= 0) return { success: false, error: 'El valor debe ser mayor a cero.' };

    const updateData: any = {
      supplier_id,
      invoice_number: invoice_number?.trim() || null,
      issue_date,
      due_date,
      amount,
      description: description?.trim() || null,
      billed_to: billed_to?.trim() || null,
      invoice_type: invoice_type || 'remision',
      updated_at: new Date().toISOString(),
    };

    if (invoice_file && invoice_file.size > 0) {
      const invoice_file_url = await uploadInvoiceFile(invoice_file, 'inv');
      if (invoice_file_url) updateData.invoice_file_url = invoice_file_url;
    }

    const { error } = await supabaseAdmin
      .from('supplier_invoices')
      .update(updateData)
      .eq('id', id);

    if (error) throw error;
    revalidatePath('/');
    return { success: true };
  } catch (error: any) {
    console.error('Error updating invoice:', error);
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
 * Marca una factura como pagada completamente, permitiendo adjuntar comprobante.
 */
export async function markInvoiceAsPaid(
  id: string,
  formData?: FormData
): Promise<{ success: boolean; error?: string }> {
  try {
    let receipt_file_url = null;
    
    if (formData) {
      const receipt_file = formData.get('receipt_file') as File | null;
      if (receipt_file && receipt_file.size > 0) {
        receipt_file_url = await uploadInvoiceFile(receipt_file, 'rcpt');
      }
    }

    // Obtener el total de la factura para actualizar paid_amount si es necesario
    const { data: inv, error: fetchErr } = await supabaseAdmin
      .from('supplier_invoices')
      .select('amount')
      .eq('id', id)
      .single();
      
    if (fetchErr || !inv) throw fetchErr ?? new Error('Factura no encontrada.');

    const updateData: any = { 
      status: 'paid', 
      paid_amount: inv.amount,
      updated_at: new Date().toISOString() 
    };
    
    if (receipt_file_url) {
      updateData.receipt_file_url = receipt_file_url;
    }

    const { error } = await supabaseAdmin
      .from('supplier_invoices')
      .update(updateData)
      .eq('id', id);

    if (error) throw error;
    revalidatePath('/');
    return { success: true };
  } catch (error: any) {
    console.error('Error marking as paid:', error);
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
