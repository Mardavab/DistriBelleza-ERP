'use client';

import { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';

/**
 * Componente cliente que evita que el usuario pueda "volver" vía el botón Back
 * del navegador a una página protegida después de cerrar sesión.
 *
 * Estrategia:
 * 1. Al montar /login, reemplaza la entrada actual del history para que el
 *    back button no traiga la página protegida.
 * 2. Cuando el navegador dispara `popstate` (Back/Forward), re-empuja /login
 *    para mantener al usuario en esta pantalla.
 *
 * Esto NO previene navegación por links internos (eso lo maneja Next.js).
 */
export default function LoginBackGuard() {
    const router = useRouter();
    const pathname = usePathname();

    useEffect(() => {
        if (pathname !== '/login') return;

        // 1. Reemplazar la entrada del history con /login. Si veníamos de
        //    una página protegida (logout), esa entrada desaparece.
        if (typeof window !== 'undefined' && window.history?.replaceState) {
            window.history.replaceState(null, '', '/login');
        }

        // 2. Si presiona Back, empujar /login otra vez.
        const onPopState = () => {
            window.history.pushState(null, '', '/login');
            router.replace('/login');
        };

        window.addEventListener('popstate', onPopState);
        return () => window.removeEventListener('popstate', onPopState);
    }, [pathname, router]);

    return null;
}