'use server'

import { supabaseAdmin } from '../../lib/supabase';
import { getCurrentCompany } from '../../lib/company';
import { requireRole, requireOwner } from '../../lib/supabase/auth-helpers';
import { requireBranchContext } from '../../lib/supabase/branch-context';
import { isUserInBranch } from '../../lib/supabase/branch-membership-queries';
import { getColombiaToday, getColombiaDayRange } from '../../lib/timezone';
import { err, warnSilently } from '../../lib/errors';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface FinancialReport {
  success: boolean;
  date: string;
  /**
   * Alcance del reporte:
   *   - 'current' = sucursal activa del usuario.
   *   - 'branch'  = una sucursal específica elegida por el owner (via branchFilter=UUID).
   *   - 'all'     = empresa completa (consolidado).
   * Permite a la UI mostrar el toggle visual correcto.
   */
  scope: 'current' | 'branch' | 'all';
  /**
   * ID de la sucursal cuando `scope === 'current'` o `scope === 'branch'`.
   * `null` cuando `scope === 'all'`.
   */
  branchId: string | null;
  /**
   * Nombre legible de la sucursal cuando `scope === 'current'` o `'branch'`.
   * `null` cuando `scope === 'all'`. Útil para el encabezado del PDF.
   */
  branchName: string | null;
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
    goal: number;             // Meta de ventas para aplicar comision (commission_threshold)
  };
  kpis: {
    totalCompletedSales: number; // Total de ventas (Cualquier método)
    commissionEarned: number;
    commissionApplied: boolean;
  };
  error?: string;
}

/**
 * Reporte financiero diario.
 *
 * FASE 11 (Bloque C — Commit 4):
 *   El alcance del reporte se controla con `branchFilter`:
 *     - 'current' (default): usa `requireBranchContext()` para resolver la
 *       sucursal activa del usuario y filtra por esa sucursal. Managers y
 *       owners la usan por defecto.
 *     - 'all': NO usa `requireBranchContext` (puede ser null para platform
 *       admins que solo navegan Reportes para una empresa puntual) y NO
 *       filtra por `branch_id`. Suma de toda la empresa. Solo owners.
 *     - string (UUID de sucursal): trata el valor como un branch_id.
 *       Valida que (a) pertenezca a la empresa activa del usuario,
 *       (b) esté activa y (c) el usuario tenga membrisía en esa sucursal.
 *       Filtra por ese `branch_id`. Solo owners (los managers solo ven
 *       su sucursal actual; la UI no expone el selector para ellos).
 *
 *   - El `FinancialReport.scope` devuelto es:
 *       - 'current' si branchFilter === 'current'
 *       - 'branch'  si branchFilter  era un UUID válido
 *       - 'all'     si branchFilter === 'all'
 *
 *   - `branchName` se devuelve cuando `scope !== 'all'`, para que la UI
 *     (PDF header, label del dropdown) pueda mostrar el nombre de la
 *     sucursal sin un fetch extra.
 */
export async function getFinancialReport(
  date?: string,
  branchFilter: 'current' | 'all' | string = 'current'
): Promise<FinancialReport> {
  try {
    // 1. Resolver contexto autenticado + tenant activo.
    //    `requireAuthContext` valida sesión y carga el rol de la
    //    membresía activa (Fase 10). Lanza 'UNAUTHENTICATED' o
    //    'NO_COMPANY_CONTEXT' si no hay sesión / empresa activa.
    //
    //    IMPORTANTE: todas las queries siguientes usan `supabaseAdmin`
    //    (bypass RLS). Por eso filtramos explícitamente por
    //    `company_id` para mantener el aislamiento multi-tenant. Sin
    //    este filtro, cualquier usuario autenticado vería datos
    //    financieros de TODAS las empresas (Hallazgo C2 Bloque A).
    const ctx = await requireRole(['owner', 'manager'])
    const companyId = ctx.companyId
    const userRole = ctx.role as string

    // ─── Resolución del alcance (Commit 4) ────────────────────────────
    // Tres modos:
    //   'current' → usa la del JWT/fallback (default).
    //   'all'     → consolidado (solo owners).
    //   <UUID>    → una sucursal específica (solo owners).
    //
    // `activeBranchId` es el branch_id que se usará para filtrar las
    // queries. `scope` y `branchName` se devuelven al cliente para que
    // la UI muestre el alcance correcto y el PDF incluya el nombre.
    //
    // La resolución del nombre y la validación de pertenencia /
    // actividad se hacen ANTES de las queries de datos para fallar
    // rápido (mejor UX y menos queries si el input es inválido).
    let activeBranchId: string | null = null
    let scope: 'current' | 'branch' | 'all' = 'current'
    let branchName: string | null = null

    if (branchFilter === 'current') {
      const { branchId } = await requireBranchContext()
      activeBranchId = branchId
      scope = 'current'
      branchName = await getBranchName(branchId)
    } else if (branchFilter === 'all') {
      // Solo owners pueden ver el consolidado de la empresa.
      // Los managers que intenten pasar 'all' caen en FORBIDDEN.
      requireOwner(ctx.role)
      scope = 'all'
      activeBranchId = null
      branchName = null
    } else if (typeof branchFilter === 'string' && UUID_RE.test(branchFilter)) {
      // UUID de sucursal explícito. Solo owners: los managers solo ven
      // su propia sucursal actual.
      requireOwner(ctx.role)

      const { branch, error: branchError } = await loadBranchForTenant(
        branchFilter,
        companyId
      )
      if (branchError || !branch) {
        throw err('NOT_FOUND', `branch not in tenant: ${branchFilter}`, {
          userMessage: 'Sucursal no encontrada en esta empresa.',
        })
      }
      if (!branch.active) {
        throw err('VALIDATION', `branch inactive: ${branchFilter}`, {
          userMessage: 'La sucursal está desactivada.',
        })
      }

      // Defense in depth: aunque la sucursal sea de la empresa, validamos
      // que el usuario tenga membrisía explícita. Evita que un owner con
      // membrisía en MAIN+Norte consulte una sucursal futura que el
      // owner aún no le asignó (caso borde).
      const hasMembership = await isUserInBranch(ctx.user.id, branchFilter)
      if (!hasMembership) {
        throw err('FORBIDDEN', `user ${ctx.user.id} not in branch ${branchFilter}`, {
          userMessage: 'No tienes permiso para ver esa sucursal.',
        })
      }

      activeBranchId = branchFilter
      scope = 'branch'
      branchName = branch.name
    } else {
      // branchFilter tiene un valor inesperado (string que no es
      // 'current', 'all' ni UUID). Lo tratamos como VALIDATION para que
      // la UI se entere y muestre error.
      throw err('VALIDATION', `branchFilter inválido: ${String(branchFilter)}`, {
        userMessage: 'Alcance del reporte inválido.',
      })
    }

    // Usar fecha local de Colombia (UTC-5) para determinar "Hoy"
    const today = getColombiaToday();

    const targetDate = date || today;

    // Solo 'owner' y 'technician' pueden ver días pasados.
    const canViewHistory = ['owner', 'technician'].includes(userRole.toLowerCase());

    if (!canViewHistory && targetDate !== today) {
      throw err('FORBIDDEN', 'cannot view past date', {
        userMessage: `Solo tienes permiso para ver el informe del día actual. (Rol detectado: ${userRole})`,
      });
    }

    // Obtener rangos del día en zona horaria de Colombia
    const { start: startOfDay, end: endOfDay } = getColombiaDayRange(targetDate);

    // FASE 11 (Bloque C): helper para aplicar filtro por branch_id
    // cuando hay una sucursal activa (`activeBranchId !== null`).
    // Para 'all' queda desactivado y la query suma de toda la empresa.
    const applyBranchFilter = <Q extends { eq: (col: string, val: unknown) => Q }>(q: Q): Q => {
      if (activeBranchId) q.eq('branch_id', activeBranchId)
      return q
    }

    // 2. Obtener Fondo Inicial (filtrado por tenant + branch si aplica)
    let sessionQuery = supabaseAdmin
      .from('cash_sessions')
      .select('initial_fund')
      .eq('company_id', companyId)
      .gte('opening_time', startOfDay)
      .lte('opening_time', endOfDay)
      .order('opening_time', { ascending: false })
      .limit(1)
    sessionQuery = applyBranchFilter(sessionQuery)
    const { data: session } = await sessionQuery.maybeSingle();

    const initialFund = Number(session?.initial_fund || 0);

    // 3. Ventas en EFECTIVO (CASH)
    let cashSalesQuery = supabaseAdmin
      .from('sales')
      .select('paid_amount')
      .eq('company_id', companyId)
      .neq('status', 'cancelled')
      .eq('payment_method', 'CASH')
      .gte('created_at', startOfDay)
      .lte('created_at', endOfDay);
    cashSalesQuery = applyBranchFilter(cashSalesQuery)
    const { data: cashSales } = await cashSalesQuery;

    const cashFromSales = cashSales?.reduce((sum, s) => sum + Number(s.paid_amount), 0) || 0;

    // 4. Desglose de otras Ventas (No afectan el efectivo esperado directamente, pero son informativas)
    let otherSalesQuery = supabaseAdmin
      .from('sales')
      .select('paid_amount, payment_method')
      .eq('company_id', companyId)
      .neq('status', 'cancelled')
      .neq('payment_method', 'CASH')
      .gte('created_at', startOfDay)
      .lte('created_at', endOfDay);
    otherSalesQuery = applyBranchFilter(otherSalesQuery)
    const { data: otherSales } = await otherSalesQuery;

    const cardSales = otherSales?.filter(s => s.payment_method === 'CARD').reduce((sum, s) => sum + Number(s.paid_amount), 0) || 0;
    const transferSales = otherSales?.filter(s => s.payment_method === 'BANK_TRANSFER').reduce((sum, s) => sum + Number(s.paid_amount), 0) || 0;
    const creditSales = otherSales?.filter(s => s.payment_method === 'CREDIT').reduce((sum, s) => sum + Number(s.paid_amount), 0) || 0;

    // 5. Cobros a Clientes en EFECTIVO (CASH)
    let cpQuery = supabaseAdmin
      .from('customer_payments')
      .select('amount')
      .eq('company_id', companyId)
      .eq('method', 'CASH')
      .gte('created_at', startOfDay)
      .lte('created_at', endOfDay);
    cpQuery = applyBranchFilter(cpQuery)
    const { data: customerPayments } = await cpQuery;

    const cashFromCustomers = customerPayments?.reduce((sum, p) => sum + Number(p.amount), 0) || 0;

    // 6. Egresos en EFECTIVO (CASH)
    let expQuery = supabaseAdmin
      .from('expenses')
      .select('amount')
      .eq('company_id', companyId)
      .eq('method', 'CASH')
      .gte('created_at', startOfDay)
      .lte('created_at', endOfDay);
    expQuery = applyBranchFilter(expQuery)
    const { data: expenses } = await expQuery;
    const cashExpenses = expenses?.reduce((sum, e) => sum + Number(e.amount), 0) || 0;

    let spQuery = supabaseAdmin
      .from('supplier_payments')
      .select('amount')
      .eq('company_id', companyId)
      .eq('method', 'CASH')
      .gte('created_at', startOfDay)
      .lte('created_at', endOfDay);
    spQuery = applyBranchFilter(spQuery)
    const { data: supplierPayments } = await spQuery;
    const cashToSuppliers = supplierPayments?.reduce((sum, p) => sum + Number(p.amount), 0) || 0;

    // 7. KPIs (Ventas totales sin importar método)
    let allSalesQuery = supabaseAdmin
      .from('sales')
      .select('total_with_discount')
      .eq('company_id', companyId)
      .eq('status', 'completed')
      .gte('created_at', startOfDay)
      .lte('created_at', endOfDay);
    allSalesQuery = applyBranchFilter(allSalesQuery)
    const { data: allSales } = await allSalesQuery;

    const totalCompletedSales = allSales?.reduce((sum, s) => sum + Number(s.total_with_discount), 0) || 0;

    const company = await getCurrentCompany();
    const COMMISSION_THRESHOLD = company?.settings.commission_threshold ?? 1800000;
    const COMMISSION_RATE = company?.settings.commission_rate ?? 0.012;
    const isCommissionEligible = totalCompletedSales > COMMISSION_THRESHOLD;
    const commissionEarned = isCommissionEligible ? (totalCompletedSales * COMMISSION_RATE) : 0;

    const expectedCash = (initialFund + cashFromSales + cashFromCustomers) - (cashExpenses + cashToSuppliers + commissionEarned);

    return {
      success: true,
      date: targetDate,
      scope,
      branchId: activeBranchId,
      branchName,
      summary: {
        initialFund,
        cashFromSales,
        cardSales,
        transferSales,
        creditSales,
        cashFromCustomers,
        cashExpenses,
        cashToSuppliers,
        expectedCash,
        goal: COMMISSION_THRESHOLD
      },
      kpis: { totalCompletedSales, commissionEarned, commissionApplied: isCommissionEligible }
    };

  } catch (err: any) {
    warnSilently('getFinancialReport', err);
    return {
      success: false,
      date: date || '',
      scope: branchFilter === 'all' ? 'all' : (branchFilter === 'current' ? 'current' : 'branch'),
      branchId: null,
      branchName: null,
      error: err?.message || 'Ocurrió un error generando el reporte.',
      summary: {} as any, kpis: {} as any
    };
  }
}

/**
 * Lee el nombre de una sucursal por su id (helper interno).
 * Devuelve null si no existe o si la query falla — el caller maneja el
 * fallback mostrando solo el branchId si lo necesita.
 */
async function getBranchName(branchId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from('branches')
    .select('name')
    .eq('id', branchId)
    .maybeSingle()

  if (error || !data) return null
  return (data.name as string | null) ?? null
}

/**
 * Helper interno: carga una sucursal y verifica que pertenezca al tenant.
 *
 * Usado por `getFinancialReport` cuando `branchFilter` es un UUID.
 * Devuelve `{ branch, error: null }` si la sucursal existe y pertenece
 * a la empresa, o `{ branch: null, error }` en caso contrario.
 *
 * Defense in depth: aunque `listBranchesAction` filtra por
 * `company_id`, aquí hacemos el filtro explícito para evitar que un
 * bug en el futuro permita leer sucursales de OTRA empresa.
 */
async function loadBranchForTenant(
  branchId: string,
  companyId: string
): Promise<{
  branch: { id: string; company_id: string; name: string; active: boolean; is_main: boolean } | null
  error: string | null
}> {
  const { data, error } = await supabaseAdmin
    .from('branches')
    .select('id, company_id, name, active, is_main')
    .eq('id', branchId)
    .eq('company_id', companyId)
    .maybeSingle()

  if (error) {
    return { branch: null, error: error.message }
  }
  if (!data) {
    return { branch: null, error: 'not_found' }
  }
  return {
    branch: data as { id: string; company_id: string; name: string; active: boolean; is_main: boolean },
    error: null,
  }
}

/**
 * Obtiene estadísticas rápidas para el Dashboard
 *
 * FASE 11 (Bloque C): siempre usa scope='current' (sucursal activa).
 * El reporte consolidado ('all') solo se usa explícitamente desde
 * la UI de Reportes.
 */
export async function getDashboardStats() {
    await requireRole(['owner', 'manager'])
    const today = getColombiaToday();
    const report = await getFinancialReport(today, 'current');

    if (!report.success) return null;

    return {
        totalSales: report.kpis.totalCompletedSales,
        totalExpenses: report.summary.cashExpenses + report.summary.cashToSuppliers,
        netCash: report.summary.expectedCash,
        goal: report.summary.goal,
        progress: (report.kpis.totalCompletedSales / report.summary.goal) * 100
    };
}

/**
 * Devuelve la meta de comisión del tenant formateada en pesos COP.
 * Usado por componentes cliente que necesitan mostrar la meta.
 */
export async function getCommissionGoalFormatted(): Promise<string> {
    await requireRole(['owner', 'manager'])
    const company = await getCurrentCompany();
    const goal = company?.settings.commission_threshold ?? 1800000;
    return `$${goal.toLocaleString('es-CO')}`;
}