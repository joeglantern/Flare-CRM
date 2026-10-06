-- Email (SMTP) and PBX connection details entered by an admin in the CRM. One row per
-- integration; the whole value is encrypted, since each carries a password or API secret.
CREATE TABLE "integration_config" (
    "key" TEXT NOT NULL,
    "data_encrypted" BYTEA NOT NULL,
    "updated_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "integration_config_pkey" PRIMARY KEY ("key")
);
