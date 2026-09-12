-- An alert is a fact with a timestamp. What changes is how it stands with whoever is looking after
-- it: seen, set aside, closed by hand, or cleared because the thing stopped being true.
ALTER TABLE "console_alerts"
    ADD COLUMN "acknowledged_at" TIMESTAMPTZ(3),
    ADD COLUMN "acknowledged_by_id" UUID,
    ADD COLUMN "acknowledge_note" TEXT,
    ADD COLUMN "snoozed_until" TIMESTAMPTZ(3),
    ADD COLUMN "closed_at" TIMESTAMPTZ(3),
    ADD COLUMN "closed_by_id" UUID,
    ADD COLUMN "close_reason" TEXT,
    ADD COLUMN "notify_count" INTEGER NOT NULL DEFAULT 0,
    -- Promoted out of the context blob: the inbox sorts and searches on this sentence.
    ADD COLUMN "summary" TEXT;

-- CreateIndex
CREATE INDEX "console_alerts_kind_opened_at_idx" ON "console_alerts"("kind", "opened_at" DESC);

-- CreateIndex
CREATE INDEX "console_alerts_snoozed_until_idx" ON "console_alerts"("snoozed_until");

-- The summary each open alert already carries, moved where the inbox can read it.
UPDATE "console_alerts"
SET "summary" = "context" ->> 'summary'
WHERE "summary" IS NULL AND "context" ? 'summary';

-- An alert is now kept once per kind per customer per stack, so an open row without a stack would
-- close and reopen on the first sweep after this. Give it the customer's oldest live stack instead.
UPDATE "console_alerts" a
SET "stack_id" = (
  SELECT s."id" FROM "stacks" s
  WHERE s."customer_id" = a."customer_id" AND s."revoked_at" IS NULL
  ORDER BY s."created_at" LIMIT 1)
WHERE a."resolved_at" IS NULL AND a."stack_id" IS NULL;

-- CreateTable
CREATE TABLE "alert_mutes" (
    "id" UUID NOT NULL,
    "kind" TEXT,
    "customer_id" UUID,
    "reason" TEXT NOT NULL,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3),

    CONSTRAINT "alert_mutes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "alert_mutes_customer_id_idx" ON "alert_mutes"("customer_id");

-- AddForeignKey
ALTER TABLE "alert_mutes" ADD CONSTRAINT "alert_mutes_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
