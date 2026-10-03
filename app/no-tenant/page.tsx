import { signOut } from '../actions/auth'

export default function NoTenantPage() {
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
                maxWidth: '520px',
                width: '100%',
                boxShadow: '0 4px 12px rgba(0,0,0,0.05)',
                textAlign: 'center',
            }}>
                <div style={{
                    width: '64px',
                    height: '64px',
                    margin: '0 auto 16px',
                    background: '#fef3c7',
                    borderRadius: '50%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '32px',
                }}>
                    ⚠️
                </div>

                <h1 style={{
                    color: '#0f172a',
                    fontSize: '1.5rem',
                    fontWeight: 600,
                    marginBottom: '12px',
                }}>
                    Usuario sin empresa asignada
                </h1>

                <p style={{
                    color: '#64748b',
                    marginBottom: '24px',
                    lineHeight: 1.5,
                }}>
                    Tu cuenta está autenticada pero no pertenece a ninguna empresa.
                    Esto sucede cuando un usuario fue creado antes del flujo de invitaciones
                    multi-tenant, o si tu perfil perdió la asignación de empresa.
                </p>

                <div style={{
                    background: '#f8fafc',
                    padding: '16px',
                    borderRadius: '8px',
                    marginBottom: '24px',
                    fontSize: '0.875rem',
                    color: '#475569',
                    textAlign: 'left',
                }}>
                    <strong>Solución:</strong>
                    <ol style={{ marginTop: '8px', paddingLeft: '20px' }}>
                        <li>Cierra sesión (botón abajo)</li>
                        <li>Vuelve a iniciar sesión para regenerar tu sesión</li>
                        <li>Si el problema persiste, contacta al administrador</li>
                    </ol>
                </div>

                <form action={signOut}>
                    <button
                        type="submit"
                        style={{
                            padding: '12px 24px',
                            background: '#6366f1',
                            color: 'white',
                            border: 'none',
                            borderRadius: '6px',
                            fontSize: '0.875rem',
                            fontWeight: 600,
                            cursor: 'pointer',
                        }}
                    >
                        Cerrar sesión
                    </button>
                </form>
            </div>
        </div>
    )
}