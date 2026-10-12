'use server'

import { supabaseAdmin } from '../../lib/supabase';
import { revalidatePath, unstable_noStore as noStore } from 'next/cache';
import { getCurrentCompanyId } from '../../lib/supabase/company-context';
import { handleActionError, err, warnSilently } from '../../lib/errors';

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
    // Prefijo con company_id para aislamiento multi-tenant en storage
    const companyId = await getCurrentCompanyId();
    const fileName = `${companyId}/${prefix}-${Date.now()}.${fileExt}`;

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const { error } = await supabaseAdmin.storage
      .from('proveedores_archivos')
      .upload(fileName, buffer, {
        contentType: file.type || 'image/png',
        upsert: false
      });

    if (error) throw err('EXTERNAL', `storage.upload: ${error.message}`, { cause: error });

    const { data: publicUrlData } = supabaseAdmin.storage
      .from('proveedores_archivos')
      .getPublicUrl(fileName);

    return publicUrlData.publicUrl;
  } catch (caught) {
    warnSilently('uploadInvoiceFile', caught);
    return null;
  }
}

// ─── PROVEEDORES ──────────────────────────────────────────────────────────────

export async function getSuppliers(): Promise<{ success: boolean; data?: Supplier[]; error?: string }> {
  noStore();
  try {
    const companyId = await getCurrentCompanyId();

    const { data, error } = await supabaseAdmin
      .from('suppliers')
      .select('*')
      .eq('active', true)
      .eq('company_id', companyId)
      .order('name', { ascending: true });

    if (error) throw err('EXTERNAL', `suppliers.list: ${error.message}`, { cause: error });
    return { success: true as const, data: data || [] };
  } catch (caught) {
    return handleActionError(caught, 'getSuppliers');
  }
}

export async function createSupplier(payload: {
  name: string;
  phone?: string;
  email?: string;
  address?: string;
}): Promise<{ success: boolean; data?: Supplier; error?: string }> {
  try {
    if (!payload.name?.trim()) {
      throw err('VALIDATION', 'supplier name missing', {
        userMessage: 'El nombre del proveedor es obligatorio.',
      });
    }

    const companyId = await getCurrentCompanyId();

    const { data, error } = await supabaseAdmin
      .from('suppliers')
      .insert({
        company_id: companyId,
        name: payload.name.trim(),
        phone: payload.phone?.trim() || null,
        email: payload.email?.trim() || null,
        address: payload.address?.trim() || null,
        active: true,
      })
      .select()
      .single();

    if (error) throw err('EXTERNAL', `suppliers.insert: ${error.message}`, { cause: error });
    revalidatePath('/');
    return { success: true as const, data };
  } catch (caught) {
    return handleActionError(caught, 'createSupplier');
  }
}

export async function updateSupplier(
  id: string,
  payload: { name: string; phone?: string; email?: string; address?: string }
): Promise<{ success: boolean; error?: string }> {
  try {
    const companyId = await getCurrentCompanyId();

    const { error } = await supabaseAdmin
      .from('suppliers')
      .update({
        name: payload.name.trim(),
        phone: payload.phone?.trim() || null,
        email: payload.email?.trim() || null,
        address: payload.address?.trim() || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('company_id', companyId);

    if (error) throw err('EXTERNAL', `suppliers.update: ${error.message}`, { cause: error });
    revalidatePath('/');
    return { success: true as const };
  } catch (caught) {
    return handleActionError(caught, 'updateSupplier');
  }
}

export async function deleteSupplier(id: string): Promise<{ success: boolean; error?: string }> {
  try {
    const companyId = await getCurrentCompanyId();

    const { error } = await supabaseAdmin
      .from('suppliers')
      .update({ active: false, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('company_id', companyId);

    if (error) throw err('EXTERNAL', `suppliers.delete: ${error.message}`, { cause: error });
    revalidatePath('/');
    return { success: true as const };
  } catch (caught) {
    return handleActionError(caught, 'deleteSupplier');
  }
}

// ─── FACTURAS DE PROVEEDORES ──────────────────────────────────────────────────

export async function getSupplierInvoices(): Promise<{
  success: boolean;
  data?: SupplierInvoice[];
  error?: string;
}> {
  noStore();
  try {
    const companyId = await getCurrentCompanyId();

    const { data, error } = await supabaseAdmin
      .from('supplier_invoices')
      .select(`
        *,
        suppliers ( name )
      `)
      .eq('company_id', companyId)
      .order('due_date', { ascending: true });

    if (error) throw err('EXTERNAL', `supplier_invoices.list: ${error.message}`, { cause: error });

    const normalized = (data || []).map((inv: any) => ({
      ...inv,
      supplier_name: inv.suppliers?.name ?? '—',
    }));

    return { success: true as const, data: normalized };
  } catch (caught) {
    return handleActionError(caught, 'getSupplierInvoices');
  }
}

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

    if (!supplier_id) throw err('VALIDATION', 'supplier required', {
      userMessage: 'Debes seleccionar un proveedor.',
    });
    if (!issue_date) throw err('VALIDATION', 'issue_date required', {
      userMessage: 'La fecha de expedición es obligatoria.',
    });
    if (!due_date) throw err('VALIDATION', 'due_date required', {
      userMessage: 'La fecha de vencimiento es obligatoria.',
    });
    if (!amount || amount <= 0) throw err('VALIDATION', 'amount must be > 0', {
      userMessage: 'El valor debe ser mayor a cero.',
    });

    const companyId = await getCurrentCompanyId();

    let invoice_file_url = null;
    if (invoice_file && invoice_file.size > 0) {
      invoice_file_url = await uploadInvoiceFile(invoice_file, 'inv');
    }

    const { data, error } = await supabaseAdmin
      .from('supplier_invoices')
      .insert({
        company_id: companyId,
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

    if (error) throw err('EXTERNAL', `supplier_invoices.insert: ${error.message}`, { cause: error });
    revalidatePath('/');
    return { success: true as const, data };
  } catch (caught) {
    return handleActionError(caught, 'createSupplierInvoice');
  }
}

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

    if (!supplier_id) throw err('VALIDATION', 'supplier required', {
      userMessage: 'Debes seleccionar un proveedor.',
    });
    if (!issue_date) throw err('VALIDATION', 'issue_date required', {
      userMessage: 'La fecha de expedición es obligatoria.',
    });
    if (!due_date) throw err('VALIDATION', 'due_date required', {
      userMessage: 'La fecha de vencimiento es obligatoria.',
    });
    if (!amount || amount <= 0) throw err('VALIDATION', 'amount must be > 0', {
      userMessage: 'El valor debe ser mayor a cero.',
    });

    const companyId = await getCurrentCompanyId();

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
      .eq('id', id)
      .eq('company_id', companyId);

    if (error) throw err('EXTERNAL', `supplier_invoices.update: ${error.message}`, { cause: error });
    revalidatePath('/');
    return { success: true as const };
  } catch (caught) {
    return handleActionError(caught, 'updateSupplierInvoice');
  }
}

export async function updateInvoiceStatus(
  id: string,
  status: 'pending' | 'paid' | 'overdue' | 'cancelled'
): Promise<{ success: boolean; error?: string }> {
  try {
    const companyId = await getCurrentCompanyId();

    const { error } = await supabaseAdmin
      .from('supplier_invoices')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('company_id', companyId);

    if (error) throw err('EXTERNAL', `supplier_invoices.update(status): ${error.message}`, { cause: error });
    revalidatePath('/');
    return { success: true as const };
  } catch (caught) {
    return handleActionError(caught, 'updateInvoiceStatus');
  }
}

export async function deleteSupplierInvoice(id: string): Promise<{ success: boolean; error?: string }> {
  try {
    const companyId = await getCurrentCompanyId();

    const { error } = await supabaseAdmin
      .from('supplier_invoices')
      .delete()
      .eq('id', id)
      .eq('company_id', companyId);

    if (error) throw err('EXTERNAL', `supplier_invoices.delete: ${error.message}`, { cause: error });
    revalidatePath('/');
    return { success: true as const };
  } catch (caught) {
    return handleActionError(caught, 'deleteSupplierInvoice');
  }
}

export async function markInvoiceAsPaid(
  id: string,
  formData?: FormData
): Promise<{ success: boolean; error?: string }> {
  try {
    const companyId = await getCurrentCompanyId();
    let receipt_file_url = null;

    if (formData) {
      const receipt_file = formData.get('receipt_file') as File | null;
      if (receipt_file && receipt_file.size > 0) {
        receipt_file_url = await uploadInvoiceFile(receipt_file, 'rcpt');
      }
    }

    const { data: inv, error: fetchErr } = await supabaseAdmin
      .from('supplier_invoices')
      .select('amount')
      .eq('id', id)
      .eq('company_id', companyId)
      .single();

    if (fetchErr || !inv) {
      throw err('NOT_FOUND', `invoice not found: ${id}`, { cause: fetchErr });
    }

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
      .eq('id', id)
      .eq('company_id', companyId);

    if (error) throw err('EXTERNAL', `supplier_invoices.update(paid): ${error.message}`, { cause: error });
    revalidatePath('/');
    return { success: true as const };
  } catch (caught) {
    return handleActionError(caught, 'markInvoiceAsPaid');
  }
}

export async function addInvoicePayment(
  id: string,
  paymentAmount: number
): Promise<{ success: boolean; newPaidAmount?: number; newStatus?: string; error?: string }> {
  try {
    if (!paymentAmount || paymentAmount <= 0) {
      throw err('VALIDATION', 'payment must be > 0', {
        userMessage: 'El valor del abono debe ser mayor a cero.',
      });
    }

    const companyId = await getCurrentCompanyId();

    const { data: inv, error: fetchErr } = await supabaseAdmin
      .from('supplier_invoices')
      .select('amount, paid_amount, status')
      .eq('id', id)
      .eq('company_id', companyId)
      .single();

    if (fetchErr || !inv) {
      throw err('NOT_FOUND', `invoice not found: ${id}`, { cause: fetchErr });
    }
    if (inv.status === 'paid') throw err('CONFLICT', 'invoice already paid', {
      userMessage: 'Esta factura ya está completamente pagada.',
    });
    if (inv.status === 'cancelled') throw err('CONFLICT', 'invoice cancelled', {
      userMessage: 'No se puede abonar a una factura cancelada.',
    });

    const currentPaid = Number(inv.paid_amount ?? 0);
    const total = Number(inv.amount);
    const remaining = total - currentPaid;

    if (paymentAmount > remaining) {
      throw err('VALIDATION', 'payment exceeds remaining', {
        userMessage: `El abono (${paymentAmount.toLocaleString('es-CO')}) supera el saldo pendiente (${remaining.toLocaleString('es-CO')}).`,
      });
    }

    const newPaidAmount = currentPaid + paymentAmount;
    const newStatus: 'paid' | 'pending' = newPaidAmount >= total ? 'paid' : 'pending';

    const { error: updateErr } = await supabaseAdmin
      .from('supplier_invoices')
      .update({
        paid_amount: newPaidAmount,
        status: newStatus,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('company_id', companyId);

    if (updateErr) throw err('EXTERNAL', `supplier_invoices.update(payment): ${updateErr.message}`, { cause: updateErr });

    revalidatePath('/');
    return { success: true as const, newPaidAmount, newStatus };
  } catch (caught) {
    return handleActionError(caught, 'addInvoicePayment');
  }
}