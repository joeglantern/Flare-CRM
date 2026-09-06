#!/bin/bash
# Creates the least-privilege roles (docs/08 M1) on first initialisation of the data volume.
# In dev (no CRM_*_PASSWORD set) this is skipped and the superuser is used.
set -e
if [ -z "${CRM_APP_PASSWORD:-}" ]; then
  echo "CRM_APP_PASSWORD not set; skipping role creation (dev mode)"
  exit 0
fi
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-SQL
  CREATE ROLE crm_migrate LOGIN PASSWORD '${CRM_MIGRATE_PASSWORD}';
  CREATE ROLE crm_app LOGIN PASSWORD '${CRM_APP_PASSWORD}';
  CREATE ROLE crm_backup LOGIN PASSWORD '${CRM_BACKUP_PASSWORD}';

  -- migrations own the schema; the app gets DML only; backups read only
  GRANT ALL ON SCHEMA public TO crm_migrate;
  ALTER SCHEMA public OWNER TO crm_migrate;
  GRANT USAGE ON SCHEMA public TO crm_app, crm_backup;
  ALTER DEFAULT PRIVILEGES FOR ROLE crm_migrate IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO crm_app;
  ALTER DEFAULT PRIVILEGES FOR ROLE crm_migrate IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO crm_app;
  ALTER DEFAULT PRIVILEGES FOR ROLE crm_migrate IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO crm_app;
  ALTER DEFAULT PRIVILEGES FOR ROLE crm_migrate IN SCHEMA public GRANT SELECT ON TABLES TO crm_backup;
  ALTER DEFAULT PRIVILEGES FOR ROLE crm_migrate IN SCHEMA public GRANT SELECT ON SEQUENCES TO crm_backup;
SQL
echo "roles crm_migrate / crm_app / crm_backup created"
