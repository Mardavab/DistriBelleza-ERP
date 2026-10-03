import { createClient } from '@supabase/supabase-js';

// Protección runtime contra uso accidental desde Client Components.
// Si este archivo se importa desde un componente cliente, se lanza
// el error en build/runtime. Esto cierra el hallazgo P0.5
// (filtración de service role key al bundle del navegador).
//
// Equivalente a `import 'server-only'` pero sin requerir el paquete.
// Para reactivarlo con el paquete oficial:
//   1. npm install server-only
//   2. Reemplazar este bloque por: import 'server-only'
if (typeof window !== 'undefined') {
    throw new Error(
        'lib/supabase.ts debe usarse solo en Server Components / Server Actions. ' +
        'Importarlo desde un Client Component expone la SUPABASE_SERVICE_ROLE_KEY.'
    )
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// Cliente estándar para el cliente (respeta RLS)
// NOTA: este cliente NO se debe usar en server components o actions
// porque bypasea RLS. Usar `lib/supabase/server.ts` para cliente con sesión.
export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Cliente administrativo para Server Actions (bypasea RLS)
// ⚠️ CRÍTICO: el runtime check arriba previene que este archivo sea
// importado desde un Client Component. Si el build falla con el error
// "lib/supabase.ts debe usarse solo en Server Components",
// significa que algún Client Component está intentando importar
// `supabaseAdmin` — lo cual filtraría la service role key al cliente.
export const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: {
        autoRefreshToken: false,
        persistSession: false
    }
});