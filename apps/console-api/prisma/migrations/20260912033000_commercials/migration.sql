-- What a customer is actually charged, as opposed to what the plan says on the shelf.
--
-- A trial is not a discount of a hundred percent: it ends on a date and then they pay the full
-- price, and the console should be able to say how much is about to start being owed. A discount is
-- a percentage with an end of its own, because "twenty percent off until March" is how these are
-- actually agreed. Both are recorded here rather than folded into the price override, so the shelf
-- price stays visible next to what is being paid.
ALTER TABLE "customer_entitlements"
    ADD COLUMN "trial_ends_at" TIMESTAMPTZ(3),
    ADD COLUMN "renews_on" DATE,
    ADD COLUMN "discount_percent" INTEGER,
    ADD COLUMN "discount_until" TIMESTAMPTZ(3),
    ADD COLUMN "discount_note" TEXT NOT NULL DEFAULT '';

-- A plan nobody should be sold any more, without deleting one that customers are still on.
ALTER TABLE "plans" ADD COLUMN "is_archived" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "customer_entitlements_renews_on_idx" ON "customer_entitlements"("renews_on");

-- CreateIndex
CREATE INDEX "customer_entitlements_trial_ends_at_idx" ON "customer_entitlements"("trial_ends_at");
