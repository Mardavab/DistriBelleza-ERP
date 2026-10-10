-- ROLLBACK: eliminar tabla de membresías
BEGIN;
DROP TABLE IF EXISTS company_memberships;
COMMIT;
