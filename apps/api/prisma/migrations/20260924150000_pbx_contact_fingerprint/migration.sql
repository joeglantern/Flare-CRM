-- The PBX side of each link as last read. The PBX publishes no contact events, so an edit made
-- there is found by comparing what it holds now with this. Empty means no baseline yet: the next
-- run records one rather than treating whatever the PBX holds as an edit.
ALTER TABLE "pbx_contact_links" ADD COLUMN "pbx_fingerprint" TEXT NOT NULL DEFAULT '';
