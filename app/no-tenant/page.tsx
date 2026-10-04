import { signOut } from '../actions/auth'
import { UserX } from 'lucide-react'

export default function NoTenantPage() {
    return (
        <div style={{
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            minHeight: '100vh',
            background: 'var(--color-bg)',
            padding: 'var(--space-6)',
        }}>
            <div className="ui-card" style={{
                maxWidth: '520px',
                width: '100%',
                textAlign: 'center',
                padding: 'var(--space-10)',
            }}>
                <div style={{
                    width: '64px',
                    height: '64px',
                    margin: '0 auto var(--space-6)',
                    background: 'var(--color-warning-light)',
                    borderRadius: 'var(--radius-2xl)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                }}>
                    <UserX size={32} color="var(--color-warning-dark)" />
                </div>

                <h1 style={{
                    color: 'var(--color-text)',
                    fontSize: 'var(--font-xl)',
                    fontWeight: 'var(--font-weight-bold)',
                    margin: '0 0 var(--space-3)',
                }}>
                    Sin empresa asignada
                </h1>

                <p style={{
                    color: 'var(--color-text-mute)',
                    marginBottom: 'var(--space-6)',
                    lineHeight: 1.6,
                    fontSize: 'var(--font-base)',
                }}>
                    Tu cuenta está autenticada pero no pertenece a ninguna empresa,
                    así que no hay un tenant al que entrar.
                </p>

                <div className="ui-alert ui-alert-warning" style={{
                    textAlign: 'left',
                    display: 'block',
                    marginBottom: 'var(--space-6)',
                }}>
                    <strong style={{ display: 'block', marginBottom: 'var(--space-2)' }}>
                        Esto puede significar dos cosas:
                    </strong>
                    <ol style={{ margin: 0, paddingLeft: 'var(--space-5)', lineHeight: 1.7 }}>
                        <li>Falta una invitación: pídele al administrador de la plataforma que te invite a una empresa.</li>
                        <li>Tu empresa fue desactivada o te retiraron de ella: entonces este acceso ya no es válido.</li>
                    </ol>
                </div>

                <form action={signOut}>
                    <button
                        type="submit"
                        className="ui-btn ui-btn-primary"
                        style={{ width: '100%' }}
                    >
                        Cerrar sesión
                    </button>
                </form>
            </div>
        </div>
    )
}