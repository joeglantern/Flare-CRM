-- A document can be issued by the machine rather than by an owner. The register and issue scripts
-- run on a console nobody has signed in to yet, and a null issuer says so instead of putting some
-- owner's name against work they did not do.
ALTER TABLE "entitlement_issues" ALTER COLUMN "issued_by_id" DROP NOT NULL;
