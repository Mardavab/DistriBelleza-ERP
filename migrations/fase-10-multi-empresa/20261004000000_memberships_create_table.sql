-- ==========================================
-- MIGRACIÓN 20261004000000 - Tabla de membresías multi-empresa
-- Fase 10 - Multi-empresa por usuario
-- ==========================================

BEGIN;

CREATE TABLE IF NOT EXISTS company_memberships (
    user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    company_id   UUID NOT NULL REFERENCES companies(id)   ON DELETE CASCADE,
    role         user_role NOT NULL,
    is_default   BOOLEAN NOT NULL DEFAULT false,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, company_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_membership_default_per_user
    ON company_memberships (user_id) WHERE is_default;

CREATE INDEX IF NOT EXISTS idx_memberships_user_id
    ON company_memberships (user_id);

COMMIT;
