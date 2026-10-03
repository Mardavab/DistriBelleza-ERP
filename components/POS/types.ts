/**
 * Tipos compartidos del POS.
 *
 * Antes: CartItem, PersistedPosSession y helpers estaban definidos dentro
 * de POS.tsx (1420 líneas). Ahora están aquí, en su propio archivo.
 *
 * Esta separación permite que CartPanel, CheckoutForm, ProductSearch, etc.
 * compartan los mismos tipos sin importar todo el POS.tsx.
 */

export interface CartItem {
    variant_id: string;
    product_name: string;
    variant_name: string;
    sku: string;
    price: number;
    quantity: number;
    discount: number;
    expected_updated_at?: string;
}

export interface PersistedPosSession {
    cart: CartItem[];
    cashReceived: string | number;
    customerId: string;
    totalDiscount: string | number;
    paymentMethod: 'CASH' | 'CARD' | 'BANK_TRANSFER' | 'CREDIT';
    transferType: 'NEQUI' | 'DAVIPLATA' | 'BANCOLOMBIA' | 'OTHER' | 'QR';
    savedAt: number;
}

export type POSMode = 'cart' | 'expenses' | 'major';
export type PaymentMethod = 'CASH' | 'CARD' | 'BANK_TRANSFER' | 'CREDIT';
export type TransferType = 'NEQUI' | 'DAVIPLATA' | 'BANCOLOMBIA' | 'OTHER' | 'QR';

export const POS_SESSION_KEY = 'pos_session_v1';
export const POS_SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24h

/**
 * Lee la sesión persistida del carrito desde localStorage.
 * Descarta sesiones con más de 24h de antigüedad.
 */
export function loadPosSession(): PersistedPosSession | null {
    if (typeof window === 'undefined') return null;
    try {
        const raw = localStorage.getItem(POS_SESSION_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as PersistedPosSession;
        if (Date.now() - parsed.savedAt > POS_SESSION_MAX_AGE_MS) return null;
        return parsed;
    } catch {
        return null;
    }
}

/**
 * Persiste la sesión del carrito a localStorage.
 */
export function savePosSession(s: Omit<PersistedPosSession, 'savedAt'>) {
    if (typeof window === 'undefined') return;
    try {
        localStorage.setItem(POS_SESSION_KEY, JSON.stringify({ ...s, savedAt: Date.now() }));
    } catch {}
}

/**
 * Limpia la sesión persistida (se llama al completar una venta).
 */
export function clearPosSession() {
    if (typeof window === 'undefined') return;
    try { localStorage.removeItem(POS_SESSION_KEY); } catch {}
}