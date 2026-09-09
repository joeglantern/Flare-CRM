-- CreateTable
CREATE TABLE "entitlements" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "envelope" JSONB,
    "payload" JSONB NOT NULL,
    "key_id" TEXT,
    "issue_id" TEXT,
    "issued_at" TIMESTAMPTZ(3),
    "expires_at" TIMESTAMPTZ(3),
    "received_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "entitlements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "entitlement_history" (
    "id" UUID NOT NULL,
    "source" TEXT NOT NULL,
    "key_id" TEXT,
    "issue_id" TEXT,
    "issued_at" TIMESTAMPTZ(3),
    "payload" JSONB NOT NULL,
    "applied_by_id" UUID,
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "entitlement_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "entitlement_history_received_at_idx" ON "entitlement_history"("received_at");

-- The history of applied documents is append-only (docs/20 §2), like the audit log: a row-level
-- trigger for every role, and no DELETE grant for the application role even if the trigger were
-- dropped. TRUNCATE (tests) is statement-level and unaffected.
CREATE OR REPLACE FUNCTION entitlement_history_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'entitlement_history is append-only';
END $$;
CREATE TRIGGER "entitlement_history_no_update_delete" BEFORE UPDATE OR DELETE ON "entitlement_history"
  FOR EACH ROW EXECUTE FUNCTION entitlement_history_immutable();
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crm_app') THEN
    REVOKE DELETE, TRUNCATE ON "entitlement_history" FROM crm_app;
  END IF;
END $$;
