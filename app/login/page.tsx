import { createClient } from '../../lib/supabase/server'
import { getCurrentCompanySafe } from '../../lib/company'
import { redirect } from 'next/navigation'

export default async function LoginPage() {
    const company = await getCurrentCompanySafe()
    const tradeName = company?.trade_name || company?.legal_name || 'ERP'

    // Si ya está autenticado con tenant, redirigir a /
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (user && user.app_metadata?.company_id) {
        redirect('/')
    }

    async function login(formData: FormData) {
        'use server'
        const { login } = await import('../../app/actions/auth')
        await login(formData)
    }

    return (
        <div style={{
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            minHeight: '100vh',
            background: '#f1f5f9',
            fontFamily: 'system-ui, sans-serif',
        }}>
            <div style={{
                background: 'white',
                padding: '40px',
                borderRadius: '16px',
                width: '100%',
                maxWidth: '420px',
                boxShadow: '0 10px 25px -5px rgba(0,0,0,0.1)',
            }}>
                <div style={{ textAlign: 'center', marginBottom: '24px' }}>
                    <h1 style={{
                        margin: 0,
                        fontSize: '1.75rem',
                        color: '#0f172a',
                        fontWeight: 700,
                    }}>
                        {tradeName}
                    </h1>
                    <p style={{
                        margin: '8px 0 0',
                        color: '#64748b',
                        fontSize: '0.875rem',
                    }}>
                        Iniciar sesión
                    </p>
                </div>

                <form action={login}>
                    <div style={{ marginBottom: '16px' }}>
                        <label style={{
                            display: 'block',
                            fontSize: '0.875rem',
                            fontWeight: 500,
                            color: '#334155',
                            marginBottom: '6px',
                        }}>
                            Correo electrónico
                        </label>
                        <input
                            type="email"
                            name="email"
                            required
                            autoComplete="email"
                            placeholder="usuario@correo.com"
                            style={{
                                width: '100%',
                                padding: '12px',
                                border: '1px solid #e2e8f0',
                                borderRadius: '8px',
                                fontSize: '0.875rem',
                            }}
                        />
                    </div>

                    <div style={{ marginBottom: '24px' }}>
                        <label style={{
                            display: 'block',
                            fontSize: '0.875rem',
                            fontWeight: 500,
                            color: '#334155',
                            marginBottom: '6px',
                        }}>
                            Contraseña
                        </label>
                        <input
                            type="password"
                            name="password"
                            required
                            autoComplete="current-password"
                            placeholder="••••••••"
                            style={{
                                width: '100%',
                                padding: '12px',
                                border: '1px solid #e2e8f0',
                                borderRadius: '8px',
                                fontSize: '0.875rem',
                            }}
                        />
                    </div>

                    <button
                        type="submit"
                        style={{
                            width: '100%',
                            padding: '12px',
                            background: '#6366f1',
                            color: 'white',
                            border: 'none',
                            borderRadius: '8px',
                            fontSize: '0.875rem',
                            fontWeight: 600,
                            cursor: 'pointer',
                        }}
                    >
                        Entrar
                    </button>
                </form>

                <p style={{
                    marginTop: '24px',
                    textAlign: 'center',
                    color: '#94a3b8',
                    fontSize: '0.75rem',
                }}>
                    © 2026 {tradeName}. Todos los derechos reservados.
                </p>
            </div>
        </div>
    )
}