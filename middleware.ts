import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

/**
 * Middleware de Supabase SSR + protección de rutas multi-tenant.
 *
 * FASE 4:
 *   - Refresca la sesión del usuario en cada request.
 *   - Redirige a /login si no hay sesión intentando acceder a una ruta
 *     protegida (/, /pos, /inventario, /proveedores, /reportes,
 *     /gastos-mayores, /sucursales, /configuracion, /plataforma).
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
    //
    // Se lee el flag DENORMALIZADO `app_metadata.is_platform_admin`, que es
    // espejo de `profiles.is_platform_admin` (lo escriben switchActiveCompanyAction
    // y switchActiveBranchAction, igual que app_metadata.role).
    //
    // NO inferirlo de `role === 'technician'`: 'technician' también es un rol
    // válido de membresía de empresa (branch-memberships.ts ALLOWED_ROLES), así
    // que ese chequeo dejaba saltar la validación de company_id a cualquier
    // miembro con ese rol. Ver AGENTS.md §5.
    const appMeta = (user?.app_metadata ?? {}) as {
        company_id?: string
        role?: string
        is_platform_admin?: boolean
    }
    const isPlatformAdmin = appMeta.is_platform_admin === true

    // Rol de membresía en la empresa activa. Si falta el claim, se asume el
    // más restrictivo de los dos niveles de empresa (manager): así una ruta
    // owner-only queda denegada por defecto en vez de abierta.
    const membershipRole = appMeta.role ?? 'manager'

    // ============================================================
    // Mapa ruta -> nivel mínimo de acceso
    // ============================================================
    //   owner      todas las rutas de empresa
    //   manager    /, /pos, /inventario
    //   technician SOLO /plataforma* (sin datos de empresa)
    //
    // Orden importa: se evalúa de más específico a menos.
    const ROUTE_TIERS: Array<{ prefix: string; tier: 'platform' | 'owner' | 'manager' }> = [
        { prefix: '/plataforma', tier: 'platform' },
        { prefix: '/proveedores', tier: 'owner' },
        { prefix: '/gastos-mayores', tier: 'owner' },
        { prefix: '/reportes', tier: 'owner' },
        { prefix: '/sucursales', tier: 'owner' },
        { prefix: '/configuracion', tier: 'owner' },
        { prefix: '/pos', tier: 'manager' },
        { prefix: '/inventario', tier: 'manager' },
        { prefix: '/', tier: 'manager' },
    ]

    function routeTier(p: string): 'platform' | 'owner' | 'manager' | 'public' {
        for (const { prefix, tier } of ROUTE_TIERS) {
            if (p === prefix || p.startsWith(`${prefix}/`)) return tier
        }
        return 'public'
    }

    const tier = routeTier(pathname)

    // 1) Rutas protegidas: sesión + nivel de acceso.
    if (tier !== 'public') {
        if (!user) {
            return NextResponse.redirect(new URL('/login', request.url))
        }

        if (tier === 'platform') {
            // Consola de plataforma: solo cuentas de plataforma.
            if (!isPlatformAdmin) {
                return NextResponse.redirect(new URL('/', request.url))
            }
        } else {
            // Rutas de empresa: ningún técnico toca datos de un tenant.
            if (isPlatformAdmin) {
                return NextResponse.redirect(new URL('/plataforma', request.url))
            }
            if (!appMeta.company_id) {
                return NextResponse.redirect(new URL('/no-tenant', request.url))
            }
            if (tier === 'owner' && membershipRole !== 'owner') {
                return NextResponse.redirect(new URL('/', request.url))
            }
        }
    }

    // 2) /login: si ya está autenticado, redirigir a su consola.
    if (pathname === '/login' && user) {
        if (isPlatformAdmin) {
            return NextResponse.redirect(new URL('/plataforma', request.url))
        }
        if (appMeta.company_id) {
            return NextResponse.redirect(new URL('/', request.url))
        }
    }

    // 3) /no-tenant: solo para usuarios de empresa sin tenant.
    //    Un técnico nunca debería caer aquí.
    if (pathname === '/no-tenant') {
        if (!user) {
            return NextResponse.redirect(new URL('/login', request.url))
        }
        if (isPlatformAdmin) {
            return NextResponse.redirect(new URL('/plataforma', request.url))
        }
        if (appMeta.company_id) {
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