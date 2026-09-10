-- Suspension with teeth: the customer is held read only by an expiry of now, and what the expiry
-- was before is kept so that lifting the suspension restores it rather than granting forever.
ALTER TABLE "customers" ADD COLUMN "suspended_at" TIMESTAMPTZ(3);
ALTER TABLE "customer_entitlements" ADD COLUMN "expires_at_before_suspension" TIMESTAMPTZ(3);
