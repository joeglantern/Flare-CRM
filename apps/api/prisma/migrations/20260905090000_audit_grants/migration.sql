-- docs/08 K1/M1: the application role may never delete audit rows, even if the trigger were dropped.
-- The role exists only in production (created by infra/docker/postgres/init/02-roles.sh).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crm_app') THEN
    REVOKE DELETE, TRUNCATE ON "audit_logs" FROM crm_app;
  END IF;
END $$;
