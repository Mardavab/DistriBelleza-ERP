'use server'

import { supabaseAdmin } from '../../lib/supabase';
import { revalidatePath, unstable_noStore as noStore } from 'next/cache';
import { createClient } from '../../lib/supabase/server';
import { getColombiaToday } from '../../lib/timezone';

/**
 * Verifica si hay una sesión de caja abierta y calcula el total vendido.
 */
export async function getActiveCashSession() {
  noStore();
  try {
    const { data, error } = await supabaseAdmin
      .from('cash_sessions')
      .select('*')
      .eq('status', 'open')
      .maybeSingle();

    if (error) {
      console.error("Error fetching cash session:", error);
      return null;
    }

    if (!data) return null;

    // Calcular el inicio del día en Colombia (UTC-5)
    const todayColombiaISO = getColombiaToday();
    const startOfDayUTC = new Date(todayColombiaISO + 'T05:00:00.000Z'); // 00:00 COT

    // AUTO-CIERRE: Si la sesión se abrió en un día anterior, cerrarla automáticamente
    if (new Date(data.opening_time) < startOfDayUTC) {
      console.log(`Auto-cerrando sesión ${data.id} por ser de un día anterior.`);
      await supabaseAdmin
        .from('cash_sessions')
        .update({ status: 'closed', closing_time: new Date().toISOString() })
        .eq('id', data.id);
      revalidatePath('/');
      return null;
    }

    // Usar el máximo entre la apertura de caja y el inicio del día (aunque con el auto-cierre siempre será data.opening_time)
    const filterStartTime = data.opening_time;

    // Obtener total vendido hoy para esta sesión
    const { data: salesData } = await supabaseAdmin
      .from('sales')
      .select('total_with_discount')
      .eq('status', 'completed')
      .gte('created_at', filterStartTime);

    const totalSold = salesData?.reduce((sum, s) => sum + Number(s.total_with_discount), 0) || 0;

    return { ...data, totalSold };
  } catch (error) {
    console.error("Unexpected error fetching cash session:", error);
    return null;
  }
}

/**
 * Abre una nueva sesión de caja validando seguridad.
 */
export async function openCashSession(initialFund: number) {
  try {
    const supabase = createClient();
    
    // 1. Verificar si ya hay una sesión abierta
    const { data: openSession } = await supabaseAdmin
      .from('cash_sessions')
      .select('id')
      .eq('status', 'open')
      .maybeSingle();

    if (openSession) return { success: false, error: 'Ya existe una sesión de caja abierta.' };

    // 2. Obtener usuario actual
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: 'No se encontró una sesión de usuario válida.' };

    const { data, error } = await supabaseAdmin
      .from('cash_sessions')
      .insert({
        user_id: user.id,
        initial_fund: initialFund,
        status: 'open',
        opening_time: new Date().toISOString()
      })
      .select()
      .single();

    if (error) throw error;

    revalidatePath('/');
    return { success: true, data };
  } catch (error: any) {
    console.error("Error opening cash session:", error);
    return { success: false, error: error.message };
  }
}

/**
 * Obtiene el resumen de una sesión SIN CERRARLA.
 * Incluye gastos registrados durante la sesión para el cierre de caja.
 */
export async function getCashSessionSummary(sessionId: string) {
  noStore();
  try {
    const { data: session } = await supabaseAdmin
      .from('cash_sessions')
      .select('*')
      .eq('id', sessionId)
      .single();

    if (!session) throw new Error("No se encontró la sesión.");

    // Calcular el inicio del día en Colombia (UTC-5)
    const todayColombiaISO = getColombiaToday();
    const startOfDayUTC = new Date(todayColombiaISO + 'T05:00:00.000Z');

    // Filtrar desde que inició la sesión PERO solo dentro del día actual
    const filterStartTime = new Date(session.opening_time) > startOfDayUTC 
      ? session.opening_time 
      : startOfDayUTC.toISOString();

    const { data: sales } = await supabaseAdmin
      .from('sales')
      .select('total_with_discount, payment_method')
      .eq('status', 'completed')
      .gte('created_at', filterStartTime);

    // Obtener gastos registrados hoy durante la sesión
    const { data: expenses } = await supabaseAdmin
      .from('expenses')
      .select('amount, method')
      .gte('created_at', filterStartTime);

    const totalCompletedSales = sales?.reduce((sum, s) => sum + Number(s.total_with_discount), 0) || 0;
    const totalExpenses = expenses?.reduce((sum, e) => sum + Number(e.amount), 0) || 0;
    const cashExpenses = expenses?.filter(e => e.method === 'CASH').reduce((sum, e) => sum + Number(e.amount), 0) || 0;

    const COMMISSION_THRESHOLD = 1800000;
    const COMMISSION_RATE = 0.012; 
    
    const isCommissionEligible = totalCompletedSales > COMMISSION_THRESHOLD;
    const commissionEarned = isCommissionEligible ? (totalCompletedSales * COMMISSION_RATE) : 0;

    const cashSales = sales?.filter(s => s.payment_method === 'CASH').reduce((sum, s) => sum + Number(s.total_with_discount), 0) || 0;

    return {
      success: true,
      summary: {
        totalSales: sales?.length || 0,
        totalAmount: totalCompletedSales,
        cashSales,
        otherSales: sales?.filter(s => s.payment_method !== 'CASH').reduce((sum, s) => sum + Number(s.total_with_discount), 0) || 0,
        totalExpenses,
        cashExpenses,
        expenseCount: expenses?.length || 0,
        commissionEarned,
        isCommissionEligible
      }
    };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

/**
 * Cierra una sesión de caja definitivamente.
 */
export async function closeCashSession(sessionId: string) {
  try {
    const { error: updateError } = await supabaseAdmin
      .from('cash_sessions')
      .update({
        status: 'closed',
        closing_time: new Date().toISOString()
      })
      .eq('id', sessionId);

    if (updateError) throw updateError;

    revalidatePath('/');
    return { success: true };
  } catch (error: any) {
    console.error("Error closing cash session:", error);
    return { success: false, error: error.message };
  }
}

export async function addExpense(description: string, amount: number) {
  try {
    const { error } = await supabaseAdmin
      .from('expenses')
      .insert({
        description,
        amount,
        method: 'CASH'
      });

    if (error) throw error;
    revalidatePath('/');
    return { success: true };
  } catch (error: any) {
    console.error("Error adding expense:", error);
    return { success: false, error: error.message };
  }
}
