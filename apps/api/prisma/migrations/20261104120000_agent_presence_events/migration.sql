-- Sign-ins, sign-outs, connections and phone state, kept as a record of what happened. Sessions live
-- in Valkey and expire without trace, and live presence is only broadcast, so neither can answer
-- "when did this agent start yesterday".
CREATE TABLE "agent_presence_events" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "channel" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "reason" TEXT,
    "extension" TEXT,
    "inferred" BOOLEAN NOT NULL DEFAULT false,
    "at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "agent_presence_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "agent_presence_events_user_id_channel_at_idx" ON "agent_presence_events"("user_id", "channel", "at");
CREATE INDEX "agent_presence_events_at_idx" ON "agent_presence_events"("at");

-- Deleting an account takes its events with it, and an account with real work cannot be deleted.
ALTER TABLE "agent_presence_events" ADD CONSTRAINT "agent_presence_events_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Attendance decides pay and discipline, so a recorded time cannot be edited afterwards. DELETE stays
-- open because the cascade above needs it.
CREATE OR REPLACE FUNCTION agent_presence_events_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'agent_presence_events is append-only';
END $$;
CREATE TRIGGER "agent_presence_events_no_update" BEFORE UPDATE ON "agent_presence_events"
  FOR EACH ROW EXECUTE FUNCTION agent_presence_events_immutable();
