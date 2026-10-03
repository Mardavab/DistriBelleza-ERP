-- ==========================================
-- MIGRACIÓN 20261003400001 - RPC accept_invitation
-- ==========================================
-- OBJETIVO: RPC que valida una invitación por token y devuelve los
--           metadatos (company_id, role, email) para que el cliente
--           pueda crear el usuario con auth.admin.createUser.
-- IDEMPOTENTE: Sí. CREATE OR REPLACE.
-- ==========================================

CREATE OR REPLACE FUNCTION accept_invitation(p_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_invitation invitations%ROWTYPE;
BEGIN
    -- Buscar invitación válida (no usada, no expirada)
    SELECT * INTO v_invitation
    FROM invitations
    WHERE token = p_token
      AND used_at IS NULL
      AND expires_at > now();

    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Invitación inválida o expirada'
        );
    END IF;

    -- Validar que la empresa está activa
    PERFORM 1 FROM companies WHERE id = v_invitation.company_id AND active = true;
    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'La empresa asociada a esta invitación está inactiva'
        );
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'email', v_invitation.email,
        'company_id', v_invitation.company_id,
        'role', v_invitation.role,
        'expires_at', v_invitation.expires_at
    );
END;
$$;

COMMENT ON FUNCTION accept_invitation IS
    'Valida un token de invitación. Devuelve los metadatos (email, company_id, role) que el cliente usa para crear el usuario con auth.admin.createUser.';

-- ==========================================
-- VERIFICACIÓN POST-EJECUCIÓN
-- ==========================================
-- SELECT proname FROM pg_proc WHERE proname = 'accept_invitation';
-- Debe devolver 1 fila.
-- ==========================================