-- Runs once on first initialisation of the data volume. citext is what makes an owner's email
-- address case-insensitive; the append-only trigger on the audit log comes with the migration.
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
