'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Clock, LogOut } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { createSupabaseBrowserClient } from '../../lib/supabase/browser';
import { signOut } from '../../app/actions/auth';

/**
 * Auto-logout por inactividad.
 *
 * Patrón:
 * - Escucha eventos de actividad (mouse, teclado, touch, scroll).
 * - Reinicia un timer en cada interacción.
 * - Tras `IDLE_TIMEOUT_MS` sin actividad, hace signOut.
 * - `WARNING_MS` antes del logout, muestra un modal con countdown.
 *
 * Configuración vía variables de entorno (con defaults):
 *   NEXT_PUBLIC_IDLE_TIMEOUT_MS (default 30 min)
 *   NEXT_PUBLIC_IDLE_WARNING_MS  (default 60 s)
 */

const DEFAULT_IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 min
const DEFAULT_WARNING_MS = 60 * 1000;          // 60 s

function getConfig() {
    const timeout = Number(process.env['NEXT_PUBLIC_IDLE_TIMEOUT_MS']) || DEFAULT_IDLE_TIMEOUT_MS;
    const warning = Number(process.env['NEXT_PUBLIC_IDLE_WARNING_MS']) || DEFAULT_WARNING_MS;
    // El warning no puede ser mayor o igual al timeout.
    const safeWarning = Math.min(warning, timeout - 5_000);
    return { timeout, warning: safeWarning };
}

const ACTIVITY_EVENTS: Array<keyof DocumentEventMap> = [
    'mousedown',
    'keydown',
    'touchstart',
    'scroll',
    'click',
];

export default function IdleLogout() {
    const router = useRouter();
    const [warningOpen, setWarningOpen] = useState(false);
    const [secondsLeft, setSecondsLeft] = useState(0);

    const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const warningTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const lastActivityRef = useRef<number>(Date.now());

    const clearTimers = () => {
        if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
        if (warningTimerRef.current) clearTimeout(warningTimerRef.current);
        if (countdownRef.current) clearInterval(countdownRef.current);
        idleTimerRef.current = null;
        warningTimerRef.current = null;
        countdownRef.current = null;
    };

    const performLogout = async () => {
        clearTimers();
        setWarningOpen(false);
        try {
            await signOut();
        } catch {
            // signOut puede tirar si la sesión ya expiró.
        }
        // Forzar redirect (signOut también lo hace, pero por si acaso).
        router.replace('/login');
    };

    const resetTimers = () => {
        clearTimers();
        setWarningOpen(false);
        lastActivityRef.current = Date.now();

        const { timeout, warning } = getConfig();

        // Warning a `warning` ms antes del logout.
        warningTimerRef.current = setTimeout(() => {
            setWarningOpen(true);
            const target = Date.now() + warning;
            setSecondsLeft(Math.ceil(warning / 1000));

            countdownRef.current = setInterval(() => {
                const remaining = Math.max(0, Math.ceil((target - Date.now()) / 1000));
                setSecondsLeft(remaining);
                if (remaining <= 0) {
                    if (countdownRef.current) clearInterval(countdownRef.current);
                }
            }, 1_000);

            // Logout al cabo de `warning` ms desde que se mostró el warning.
            idleTimerRef.current = setTimeout(() => {
                performLogout();
            }, warning);
        }, timeout - warning);
    };

    // Handler único que actualiza lastActivity + reinicia timers.
    const onActivity = () => {
        // No reiniciar si estamos en el warning (deja que el countdown corra).
        if (warningOpen) return;
        resetTimers();
    };

    useEffect(() => {
        // Solo activar si hay sesión activa.
        let mounted = true;

        (async () => {
            try {
                const supabase = createSupabaseBrowserClient();
                const { data } = await supabase.auth.getUser();
                if (!mounted) return;
                if (!data.user) {
                    // Sin sesión, no montamos listeners.
                    return;
                }
            } catch {
                return;
            }

            // Inicializar timers.
            resetTimers();

            for (const ev of ACTIVITY_EVENTS) {
                document.addEventListener(ev, onActivity, { passive: true });
            }

            // También en visibilitychange: si vuelve de background con > X tiempo,
            // forzar logout (cubre casos donde el timer del navegador se durmió).
            document.addEventListener('visibilitychange', () => {
                if (document.visibilityState === 'visible') {
                    const elapsed = Date.now() - lastActivityRef.current;
                    const { timeout } = getConfig();
                    if (elapsed >= timeout) {
                        performLogout();
                    } else {
                        // Si el warning ya estaba abierto antes de ir a background,
                        // refrescar el countdown.
                        if (warningOpen) {
                            resetTimers();
                        }
                    }
                }
            });
        })();

        return () => {
            mounted = false;
            clearTimers();
            for (const ev of ACTIVITY_EVENTS) {
                document.removeEventListener(ev, onActivity);
            }
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const handleStay = () => {
        // Usuario quiere seguir: reiniciamos contadores y cerramos el modal.
        resetTimers();
    };

    if (!warningOpen) return null;

    return (
        <div className="idle-logout-overlay" role="dialog" aria-modal="true">
            <div className="idle-logout-modal">
                <div className="idle-logout-icon">
                    <Clock size={48} />
                </div>
                <h2>¿Sigues ahí?</h2>
                <p>
                    Por seguridad, tu cuenta va a cerrarse automáticamente en{' '}
                    <strong>{secondsLeft}s</strong> por inactividad.
                </p>
                <p className="idle-logout-hint">Mueve el mouse o tocá una tecla para seguir trabajando.</p>
                <div className="idle-logout-actions">
                    <button
                        type="button"
                        className="ui-btn ui-btn-secondary"
                        onClick={performLogout}
                    >
                        <LogOut size={16} /> Cerrar sesión ahora
                    </button>
                    <button
                        type="button"
                        className="ui-btn ui-btn-primary"
                        onClick={handleStay}
                    >
                        Seguir trabajando
                    </button>
                </div>
            </div>
            <style jsx>{`
                .idle-logout-overlay {
                    position: fixed;
                    inset: 0;
                    background: rgba(15, 23, 42, 0.55);
                    backdrop-filter: blur(8px);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    z-index: 9999;
                    animation: idle-fade-in 0.2s ease;
                }
                @keyframes idle-fade-in {
                    from { opacity: 0; }
                    to { opacity: 1; }
                }
                .idle-logout-modal {
                    background: var(--bg-card);
                    padding: var(--space-8);
                    border-radius: var(--radius-2xl);
                    box-shadow: var(--shadow-xl);
                    max-width: 420px;
                    width: calc(100% - 32px);
                    text-align: center;
                    animation: idle-pop 0.3s cubic-bezier(0.16, 1, 0.3, 1);
                }
                @keyframes idle-pop {
                    from { opacity: 0; transform: scale(0.95); }
                    to { opacity: 1; transform: scale(1); }
                }
                .idle-logout-icon {
                    width: 80px;
                    height: 80px;
                    border-radius: 50%;
                    background: var(--color-warning-light);
                    color: var(--color-warning-dark);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    margin: 0 auto var(--space-4);
                }
                .idle-logout-modal h2 {
                    margin: 0 0 var(--space-3);
                    font-size: var(--font-xl);
                    color: var(--color-text);
                }
                .idle-logout-modal p {
                    margin: var(--space-2) 0;
                    color: var(--color-text-mute);
                    font-size: var(--font-base);
                }
                .idle-logout-modal p strong {
                    color: var(--color-danger-dark);
                    font-size: var(--font-lg);
                }
                .idle-logout-hint {
                    font-size: var(--font-sm) !important;
                    color: var(--color-text-light) !important;
                    margin-top: var(--space-3) !important;
                }
                .idle-logout-actions {
                    display: flex;
                    gap: var(--space-3);
                    margin-top: var(--space-6);
                }
                .idle-logout-actions :global(.ui-btn) {
                    flex: 1;
                }
            `}</style>
        </div>
    );
}