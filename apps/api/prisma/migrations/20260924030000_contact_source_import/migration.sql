-- Contacts imported from the PBX phonebook were written with source 'yeastar', which is not a
-- contact source the API accepts, so reading any of them failed with a 500. They are imports.
UPDATE "contacts" SET "source" = 'import' WHERE "source" = 'yeastar';
