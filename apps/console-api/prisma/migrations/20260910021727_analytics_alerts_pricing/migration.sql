-- AlterTable
ALTER TABLE "customer_entitlements" ADD COLUMN     "price_monthly_minor_override" INTEGER;

-- AlterTable
ALTER TABLE "plans" ADD COLUMN     "currency" TEXT NOT NULL DEFAULT 'KES',
ADD COLUMN     "price_monthly_minor" INTEGER;

-- CreateTable
CREATE TABLE "stack_samples" (
    "id" UUID NOT NULL,
    "stack_id" TEXT NOT NULL,
    "customer_id" UUID NOT NULL,
    "at" TIMESTAMPTZ(3) NOT NULL,
    "seats_active" INTEGER NOT NULL,
    "storage_bytes" BIGINT NOT NULL,
    "attachments_bytes" BIGINT NOT NULL,
    "recordings_bytes" BIGINT NOT NULL,
    "backups_bytes" BIGINT NOT NULL,
    "ready_ok" BOOLEAN NOT NULL,
    "version" TEXT NOT NULL,
    "last_backup_at" TIMESTAMPTZ(3),

    CONSTRAINT "stack_samples_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stack_days" (
    "stack_id" TEXT NOT NULL,
    "customer_id" UUID NOT NULL,
    "day" DATE NOT NULL,
    "samples" INTEGER NOT NULL,
    "connected_minutes" INTEGER NOT NULL,
    "seats_max" INTEGER NOT NULL,
    "seats_avg" INTEGER NOT NULL,
    "storage_max_bytes" BIGINT NOT NULL,
    "ready_failures" INTEGER NOT NULL,
    "versions" TEXT[],
    "backup_seen_at" TIMESTAMPTZ(3),

    CONSTRAINT "stack_days_pkey" PRIMARY KEY ("stack_id","day")
);

-- CreateTable
CREATE TABLE "fleet_days" (
    "day" DATE NOT NULL,
    "customers" INTEGER NOT NULL,
    "customers_live" INTEGER NOT NULL,
    "seats_used" INTEGER NOT NULL,
    "seats_sold" INTEGER NOT NULL,
    "storage_bytes" BIGINT NOT NULL,
    "mrr_minor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'KES',

    CONSTRAINT "fleet_days_pkey" PRIMARY KEY ("day")
);

-- CreateTable
CREATE TABLE "console_alerts" (
    "id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "customer_id" UUID NOT NULL,
    "stack_id" TEXT,
    "opened_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMPTZ(3),
    "last_notified_at" TIMESTAMPTZ(3),
    "context" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "console_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "announcements" (
    "id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "message" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "delivered" INTEGER NOT NULL,
    "sent_by_id" UUID NOT NULL,
    "sent_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "announcements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "stack_samples_stack_id_at_idx" ON "stack_samples"("stack_id", "at" DESC);

-- CreateIndex
CREATE INDEX "stack_samples_customer_id_at_idx" ON "stack_samples"("customer_id", "at" DESC);

-- CreateIndex
CREATE INDEX "stack_samples_at_idx" ON "stack_samples"("at");

-- CreateIndex
CREATE INDEX "stack_days_customer_id_day_idx" ON "stack_days"("customer_id", "day");

-- CreateIndex
CREATE INDEX "console_alerts_customer_id_kind_resolved_at_idx" ON "console_alerts"("customer_id", "kind", "resolved_at");

-- CreateIndex
CREATE INDEX "console_alerts_resolved_at_opened_at_idx" ON "console_alerts"("resolved_at", "opened_at" DESC);

-- CreateIndex
CREATE INDEX "announcements_customer_id_sent_at_idx" ON "announcements"("customer_id", "sent_at" DESC);

-- AddForeignKey
ALTER TABLE "stack_samples" ADD CONSTRAINT "stack_samples_stack_id_fkey" FOREIGN KEY ("stack_id") REFERENCES "stacks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stack_days" ADD CONSTRAINT "stack_days_stack_id_fkey" FOREIGN KEY ("stack_id") REFERENCES "stacks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "console_alerts" ADD CONSTRAINT "console_alerts_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
