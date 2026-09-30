-- The owner console link as an admin entered it in the CRM, instead of in the server's .env. At
-- most one row: a stack talks to one console. The secret is stored encrypted by the application.
CREATE TABLE "console_link_config" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "console_url" TEXT NOT NULL,
    "stack_id" TEXT NOT NULL,
    "secret_encrypted" BYTEA NOT NULL,
    "public_keys" TEXT[],
    "updated_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "console_link_config_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "console_link_config_single_row" CHECK ("id" = 1)
);
