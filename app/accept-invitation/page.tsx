import { acceptInvitationAction } from '../actions/users'
import { createClient } from '../../lib/supabase/server'

export default async function AcceptInvitationPage({
    searchParams,
}: {
    searchParams: { token?: string }
}) {
    const token = searchParams.token

    if (!token) {
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
                    padding: '32px',
                    borderRadius: '12px',
                    maxWidth: '480px',
                    boxShadow: '0 4px 12px rgba(0,0,0,0.05)',
                    textAlign: 'center',
                }}>
                    <h1 style={{ color: '#ef4444', fontSize: '1.25rem' }}>Invitación inválida</h1>
                    <p style={{ color: '#64748b', marginTop: '12px' }}>
                        No se proporcionó un token de invitación válido.
                    </p>
                </div>
            </div>
        )
    }

    // Pre-cargar invitación para mostrar el email al usuario
    const supabase = createClient()
    const { data: rpcData } = await supabase.rpc('accept_invitation', { p_token: token })
    const invitation = rpcData as {
        success: boolean
        error?: string
        email?: string
    }

    if (!invitation?.success) {
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
                    padding: '32px',
                    borderRadius: '12px',
                    maxWidth: '480px',
                    boxShadow: '0 4px 12px rgba(0,0,0,0.05)',
                    textAlign: 'center',
                }}>
                    <h1 style={{ color: '#ef4444', fontSize: '1.25rem' }}>
                        Invitación expirada o ya usada
                    </h1>
                    <p style={{ color: '#64748b', marginTop: '12px' }}>
                        {invitation?.error || 'Pide a tu administrador que te envíe una nueva invitación.'}
                    </p>
                </div>
            </div>
        )
    }

    // Form de aceptación
    async function handleSubmit(formData: FormData) {
        'use server'
        formData.append('token', token!)
        await acceptInvitationAction(formData)
    }

    return (
        <div style={{
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            minHeight: '100vh',
            background: '#f1f5f9',
            fontFamily: 'system-ui, sans-serif',
            padding: '20px',
        }}>
            <div style={{
                background: 'white',
                padding: '40px',
                borderRadius: '12px',
                maxWidth: '480px',
                width: '100%',
                boxShadow: '0 4px 12px rgba(0,0,0,0.05)',
            }}>
                <h1 style={{
                    color: '#0f172a',
                    fontSize: '1.5rem',
                    fontWeight: 600,
                    marginBottom: '8px',
                }}>
                    Completa tu registro
                </h1>
                <p style={{ color: '#64748b', marginBottom: '24px', fontSize: '0.875rem' }}>
                    Has sido invitado a <strong>Dista Belleza</strong>. Crea tu contraseña para activar tu cuenta.
                </p>

                <form action={handleSubmit}>
                    <div style={{ marginBottom: '16px' }}>
                        <label style={{
                            display: 'block',
                            fontSize: '0.875rem',
                            fontWeight: 500,
                            color: '#334155',
                            marginBottom: '6px',
                        }}>
                            Email
                        </label>
                        <input
                            type="email"
                            value={invitation.email}
                            disabled
                            style={{
                                width: '100%',
                                padding: '10px 12px',
                                border: '1px solid #e2e8f0',
                                borderRadius: '6px',
                                background: '#f8fafc',
                                color: '#64748b',
                                fontSize: '0.875rem',
                            }}
                        />
                    </div>

                    <div style={{ marginBottom: '16px' }}>
                        <label style={{
                            display: 'block',
                            fontSize: '0.875rem',
                            fontWeight: 500,
                            color: '#334155',
                            marginBottom: '6px',
                        }}>
                            Nombre completo *
                        </label>
                        <input
                            type="text"
                            name="full_name"
                            required
                            placeholder="Tu nombre"
                            style={{
                                width: '100%',
                                padding: '10px 12px',
                                border: '1px solid #e2e8f0',
                                borderRadius: '6px',
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
                            Contraseña *
                        </label>
                        <input
                            type="password"
                            name="password"
                            required
                            minLength={6}
                            placeholder="Mínimo 6 caracteres"
                            style={{
                                width: '100%',
                                padding: '10px 12px',
                                border: '1px solid #e2e8f0',
                                borderRadius: '6px',
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
                            borderRadius: '6px',
                            fontSize: '0.875rem',
                            fontWeight: 600,
                            cursor: 'pointer',
                        }}
                    >
                        Activar mi cuenta
                    </button>
                </form>
            </div>
        </div>
    )
}