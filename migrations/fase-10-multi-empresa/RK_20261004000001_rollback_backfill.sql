-- ROLLBACK: borrar backfill (solo si es seguro)
BEGIN;
DELETE FROM company_memberships;
COMMIT;
