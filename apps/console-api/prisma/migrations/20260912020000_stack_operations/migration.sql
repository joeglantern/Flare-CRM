-- Something an operator needs to remember about one particular server, as opposed to its label.
ALTER TABLE "stacks" ADD COLUMN "notes" TEXT NOT NULL DEFAULT '';

-- Revoked stacks are filtered out of almost every question asked about the fleet, and outstanding
-- documents are now counted only for stacks that could still answer.
CREATE INDEX "stacks_revoked_at_idx" ON "stacks"("revoked_at");
CREATE INDEX "entitlement_issues_status_idx" ON "entitlement_issues"("status");

-- Documents that were waiting for a stack already revoked are closed here, once, for the same
-- reason they are closed from now on: nothing is waiting on a credential that will never connect.
UPDATE "entitlement_issues" SET "status" = 'superseded'
WHERE "status" IN ('pending', 'delivered')
  AND "stack_id" IN (SELECT "id" FROM "stacks" WHERE "revoked_at" IS NOT NULL);
