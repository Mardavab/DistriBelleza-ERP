'use server'

import { createClient } from '../../lib/supabase/server';
import { supabaseAdmin } from '../../lib/supabase';

export interface FinancialReport {
  success: boolean;
  date: string;
  summary: {
    initialFund: number;
    cashFromSales: number;    // Solo ventas en CASH
    cardSales: number;        // Solo ventas en CARD
    transferSales: number;    // Solo ventas en BANK_TRANSFER
    creditSales: number;      // Solo ventas en CREDIT
    cashFromCustomers: number; // Solo cobros en CASH
    cashExpenses: number;     // Solo gastos en CASH
    cashToSuppliers: number;  // Solo pagos a prov en CASH
    expectedCash: number;     // Fondo + Ventas(CASH) + Cobros(CASH) - Gastos(CASH) - Prov(CASH)
  };
  kpis: {
    totalCompletedSales: number; // Total de ventas (Cualquier método)
    commissionEarned: number;
    commissionApplied: boolean;
  };
  error?: string;
}

export async function getFinancialReport(date?: string): Promise<FinancialReport> {
  try {
    const supabase = createClient();
    
    // 1. Verificar Autenticación y Rol
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
        return { success: false, date: '', error: 'Sesión expirada o no autorizado.', summary: {} as any, kpis: {} as any };
    }

    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single();

    // Prioridad al rol del perfil, luego metadata del auth, por último manager
    const userRole = profile?.role || user.app_metadata?.role || user.user_metadata?.role || 'manager';
    
    // Usar fecha local de Colombia (UTC-5) para determinar "Hoy"
    const now = new Date();
    const colTime = new Date(now.getTime() - (5 * 60 * 60 * 1000));
    const today = colTime.toISOString().split('T')[0];
    
    const targetDate = date || today;

    // Solo 'owner' y 'technician' pueden ver días pasados.
    const canViewHistory = ['owner', 'technician'].includes(userRole.toLowerCase());
    
    if (!canViewHistory && targetDate !== today) {
      throw new Error(`Solo tienes permiso para ver el informe del día actual. (Rol detectado: ${userRole})`);
    }

    // Ajustar rangos para considerar el desfase de Colombia (UTC-5)
    // El día en Colombia empieza a las 05:00:00 UTC y termina a las 04:59:59 UTC del día siguiente
    const start = new Date(`${targetDate}T00:00:00-05:00`);
    const end = new Date(`${targetDate}T23:59:59-05:00`);
    
    const startOfDay = start.toISOString();
    const endOfDay = end.toISOString();

    // 2. Obtener Fondo Inicial
    const { data: session } = await supabaseAdmin
      .from('cash_sessions')
      .select('initial_fund')
      .gte('opening_time', startOfDay)
      .lte('opening_time', endOfDay)
      .order('opening_time', { ascending: false })
      .limit(1)
      .maybeSingle();

    const initialFund = Number(session?.initial_fund || 0);

    // 3. Ventas en EFECTIVO (CASH)
    const { data: cashSales } = await supabaseAdmin
      .from('sales')
      .select('paid_amount')
      .neq('status', 'cancelled')
      .eq('payment_method', 'CASH')
      .gte('created_at', startOfDay)
      .lte('created_at', endOfDay);

    const cashFromSales = cashSales?.reduce((sum, s) => sum + Number(s.paid_amount), 0) || 0;

    // 4. Desglose de otras Ventas (No afectan el efectivo esperado directamente, pero son informativas)
    const { data: otherSales } = await supabaseAdmin
      .from('sales')
      .select('paid_amount, payment_method')
      .neq('status', 'cancelled')
      .neq('payment_method', 'CASH')
      .gte('created_at', startOfDay)
      .lte('created_at', endOfDay);

    const cardSales = otherSales?.filter(s => s.payment_method === 'CARD').reduce((sum, s) => sum + Number(s.paid_amount), 0) || 0;
    const transferSales = otherSales?.filter(s => s.payment_method === 'BANK_TRANSFER').reduce((sum, s) => sum + Number(s.paid_amount), 0) || 0;
    const creditSales = otherSales?.filter(s => s.payment_method === 'CREDIT').reduce((sum, s) => sum + Number(s.paid_amount), 0) || 0;
    
    // 5. Cobros a Clientes en EFECTIVO (CASH)
    const { data: customerPayments } = await supabaseAdmin
      .from('customer_payments')
      .select('amount')
      .eq('method', 'CASH')
      .gte('created_at', startOfDay)
      .lte('created_at', endOfDay);

    const cashFromCustomers = customerPayments?.reduce((sum, p) => sum + Number(p.amount), 0) || 0;

    // 5. Egresos en EFECTIVO (CASH)
    const { data: expenses } = await supabaseAdmin
      .from('expenses')
      .select('amount')
      .eq('method', 'CASH')
      .gte('created_at', startOfDay)
      .lte('created_at', endOfDay);
    const cashExpenses = expenses?.reduce((sum, e) => sum + Number(e.amount), 0) || 0;

    const { data: supplierPayments } = await supabaseAdmin
      .from('supplier_payments')
      .select('amount')
      .eq('method', 'CASH')
      .gte('created_at', startOfDay)
      .lte('created_at', endOfDay);
    const cashToSuppliers = supplierPayments?.reduce((sum, p) => sum + Number(p.amount), 0) || 0;

    // 6. KPIs (Ventas totales sin importar método)
    const { data: allSales } = await supabaseAdmin
      .from('sales')
      .select('total_with_discount')
      .eq('status', 'completed')
      .gte('created_at', startOfDay)
      .lte('created_at', endOfDay);

    const totalCompletedSales = allSales?.reduce((sum, s) => sum + Number(s.total_with_discount), 0) || 0;
    
    const COMMISSION_THRESHOLD = 1800000;
    const isCommissionEligible = totalCompletedSales > COMMISSION_THRESHOLD;
    const commissionEarned = isCommissionEligible ? (totalCompletedSales * 0.012) : 0;

    const expectedCash = (initialFund + cashFromSales + cashFromCustomers) - (cashExpenses + cashToSuppliers);

    return {
      success: true,
      date: targetDate,
      summary: { 
        initialFund, 
        cashFromSales, 
        cardSales,
        transferSales,
        creditSales,
        cashFromCustomers, 
        cashExpenses, 
        cashToSuppliers, 
        expectedCash 
      },
      kpis: { totalCompletedSales, commissionEarned, commissionApplied: isCommissionEligible }
    };

  } catch (err: any) {
    return { 
      success: false, 
      date: date || '', 
      error: err.message,
      summary: {} as any, kpis: {} as any 
    };
  }
}

/**
 * Obtiene estadísticas rápidas para el Dashboard
 */
export async function getDashboardStats() {
    const now = new Date();
    const colTime = new Date(now.getTime() - (5 * 60 * 60 * 1000));
    const today = colTime.toISOString().split('T')[0];
    const report = await getFinancialReport(today);
    
    if (!report.success) return null;

    return {
        totalSales: report.kpis.totalCompletedSales,
        totalExpenses: report.summary.cashExpenses + report.summary.cashToSuppliers,
        netCash: report.summary.expectedCash,
        goal: 1800000,
        progress: (report.kpis.totalCompletedSales / 1800000) * 100
    };
}
