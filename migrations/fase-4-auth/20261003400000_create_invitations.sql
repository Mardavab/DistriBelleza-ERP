-- ==========================================
-- MIGRACIÓN 20261003400000 - Crear tabla invitations
-- Fase 4 - Auth, JWT y sesión multi-tenant
-- ==========================================
-- OBJETIVO: Tabla para invitaciones de nuevos usuarios a un tenant.
--           Reemplaza la creación directa de usuarios en auth.users.
--           Cada invitación está atada a un company_id y un rol.
-- IDEMPOTENTE: Sí. Usa IF NOT EXISTS.
-- ==========================================

BEGIN;

CREATE TABLE IF NOT EXISTS invitations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id),
    email VARCHAR(200) NOT NULL,
    role VARCHAR(50) NOT NULL DEFAULT 'manager',
    invited_by UUID REFERENCES profiles(id),
    token VARCHAR(100) UNIQUE NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    accepted_user_id UUID REFERENCES auth.users(id),
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_invitations_token ON invitations(token);
CREATE INDEX IF NOT EXISTS idx_invitations_company ON invitations(company_id);
CREATE INDEX IF NOT EXISTS idx_invitations_email ON invitations(email);

-- Prevenir invitaciones duplicadas activas para el mismo email en el mismo tenant
CREATE UNIQUE INDEX IF NOT EXISTS idx_invitations_pending
    ON invitations(email, company_id)
    WHERE used_at IS NULL;

COMMENT ON TABLE invitations IS
    'Invitaciones pendientes de nuevos usuarios a un tenant. Cada invitación tiene un token único que se envía por email. Cuando el usuario completa el registro, used_at se setea y se crea el usuario en auth.users con company_id en app_metadata.';
COMMENT ON COLUMN invitations.role IS
    'Rol que tendrá el usuario al aceptar la invitación (owner/technician/manager).';
COMMENT ON COLUMN invitations.token IS
    'Token único enviado al invitado. Se usa en /accept-invitation?token=XXX';
COMMENT ON COLUMN invitations.expires_at IS
    'Fecha de expiración. Por defecto 7 días desde la creación.';
COMMENT ON COLUMN invitations.used_at IS
    'Timestamp de cuando el invitado completó el registro. NULL = pendiente.';

COMMIT;

-- ==========================================
-- VERIFICACIÓN POST-EJECUCIÓN
-- ==========================================
-- SELECT column_name, data_type, is_nullable
-- FROM information_schema.columns
-- WHERE table_schema = 'public' AND table_name = 'invitations'
-- ORDER BY ordinal_position;
-- Debe devolver 10 columnas.
-- ==========================================