import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

/**
 * Middleware de Supabase SSR + protección de rutas multi-tenant.
 *
 * FASE 4:
 *   - Refresca la sesión del usuario en cada request.
 *   - Redirige a /login si no hay sesión intentando acceder a /.
 *   - Redirige a /no-tenant si el usuario está autenticado pero no tiene
 *     company_id en su app_metadata.
 *   - Redirige a / si el usuario autenticado intenta acceder a /login.
 *
 * EXCEPCIÓN (consola de plataforma):
 *   Las cuentas con rol `technician` no pertenecen a ninguna empresa por
 *   diseño, así que pueden entrar a / sin company_id. El claim `role` se
 *   inyecta en app_metadata mediante la migración fase 9. Si el claim no
 *   existe, se aplica el comportamiento seguro por defecto (redirigir).
 */
export async function middleware(request: NextRequest) {
    let response = NextResponse.next({
        request: { headers: request.headers },
    })

    const supabase = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
            cookies: {
                getAll() {
                    return request.cookies.getAll()
                },
                setAll(cookiesToSet) {
                    cookiesToSet.forEach(({ name, value }) =>
                        request.cookies.set(name, value)
                    )
                    response = NextResponse.next({
                        request: { headers: request.headers },
                    })
                    cookiesToSet.forEach(({ name, value, options }) =>
                        response.cookies.set(name, value, options)
                    )
                },
            },
        }
    )

    const { data: { user } } = await supabase.auth.getUser()

    const pathname = request.nextUrl.pathname

    // Cuentas de plataforma: pueden navegar sin company_id.
    const isPlatformAdmin = user?.app_metadata?.role === 'technician'

    // ============================================================
    // Reglas de protección de rutas
    // ============================================================

    // 1) / requiere sesión válida + company_id (o rol de plataforma)
    if (pathname === '/') {
        if (!user) {
            return NextResponse.redirect(new URL('/login', request.url))
        }
        const companyId = user.app_metadata?.company_id
        if (!companyId && !isPlatformAdmin) {
            return NextResponse.redirect(new URL('/no-tenant', request.url))
        }
    }

    // 2) /login: si ya está autenticado, redirigir a /
    if (pathname === '/login' && user) {
        const companyId = user.app_metadata?.company_id
        if (companyId || isPlatformAdmin) {
            return NextResponse.redirect(new URL('/', request.url))
        }
    }

    // 3) /no-tenant: solo para usuarios de empresa sin tenant.
    //    Un técnico nunca debería caer aquí.
    if (pathname === '/no-tenant') {
        if (!user) {
            return NextResponse.redirect(new URL('/login', request.url))
        }
        if (isPlatformAdmin || user.app_metadata?.company_id) {
            return NextResponse.redirect(new URL('/', request.url))
        }
    }

    return response
}

export const config = {
    matcher: [
        /*
         * Match all request paths except for the ones starting with:
         * - _next/static (static files)
         * - _next/image (image optimization files)
         * - favicon.ico (favicon file)
         * - Archivos de imagen/asset
         */
        '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
    ],
}