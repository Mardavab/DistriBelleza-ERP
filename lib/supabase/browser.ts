/**
 * Cliente Supabase para uso en el navegador (Client Components).
 *
 * Complementa a `lib/supabase/server.ts` (que usa cookies) y `lib/supabase.ts`
 * (que tiene el service role key, server-only).
 *
 * Usa createBrowserClient de @supabase/ssr para mantener la sesión
 * sincronizada con cookies httpOnly que el server también lee.
 */

import { createBrowserClient } from '@supabase/ssr';

let cached: ReturnType<typeof createBrowserClient> | null = null;

export function createSupabaseBrowserClient() {
    if (!cached) {
        const url = process.env['NEXT_PUBLIC_SUPABASE_URL']!;
        const anonKey = process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY']!;
        cached = createBrowserClient(url, anonKey);
    }
    return cached;
}