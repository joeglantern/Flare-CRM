-- Match callers on the last nine digits of their number. Deployments that saved the settings page
-- before this became the default stored it as off; they are switched on with everyone else. The
-- setting stays in Settings for anyone who wants exact matching back.
UPDATE "settings"
   SET "value" = jsonb_set("value"::jsonb, '{allowSuffixMatch}', 'true'::jsonb)
 WHERE "key" = 'matching'
   AND ("value"::jsonb ->> 'allowSuffixMatch') = 'false';
