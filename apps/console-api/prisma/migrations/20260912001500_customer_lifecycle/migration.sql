-- Archiving is filing, not deleting, and it is not a status: `status` is what a customer's own CRM
-- enforces, so adding a word like "archived" to it would quietly expire their document and put
-- them into read only. These columns sit beside it instead.
ALTER TABLE "customers"
    ADD COLUMN "archived_at" TIMESTAMPTZ(3),
    ADD COLUMN "archived_by_id" UUID,
    ADD COLUMN "archive_reason" TEXT,
    ADD COLUMN "churn_reason" TEXT,
    ADD COLUMN "churned_at" TIMESTAMPTZ(3),
    ADD COLUMN "onboarding_stage" TEXT NOT NULL DEFAULT 'signed_up',
    ADD COLUMN "onboarding_checklist" JSONB NOT NULL DEFAULT '{}';

-- CreateIndex
CREATE INDEX "customers_archived_at_idx" ON "customers"("archived_at");

-- CreateIndex
CREATE INDEX "customers_status_archived_at_idx" ON "customers"("status", "archived_at");

-- CreateTable
CREATE TABLE "customer_contacts" (
    "id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL DEFAULT '',
    "phone" TEXT,
    "role" TEXT NOT NULL DEFAULT '',
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "customer_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_notes" (
    "id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "author_id" UUID,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_notes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "customer_contacts_customer_id_is_primary_idx" ON "customer_contacts"("customer_id", "is_primary");

-- CreateIndex
CREATE INDEX "customer_notes_customer_id_created_at_idx" ON "customer_notes"("customer_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "customer_contacts" ADD CONSTRAINT "customer_contacts_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_notes" ADD CONSTRAINT "customer_notes_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A customer is archived, never deleted, and the database is where that is settled rather than in
-- the absence of a route. Same rule as the audit log, enforced the same way. A row trigger does not
-- fire on TRUNCATE, so the test harness can still empty the schema between tests.
CREATE OR REPLACE FUNCTION customers_no_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'customers are archived, never deleted';
END $$;
CREATE TRIGGER "customers_no_delete" BEFORE DELETE ON "customers"
  FOR EACH ROW EXECUTE FUNCTION customers_no_delete();
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'console_app') THEN
    REVOKE DELETE ON "customers" FROM console_app;
  END IF;
END $$;
