-- Tasks can be handed back. The task records who gave it to its current assignee, so a hand-back
-- knows where to return it, and keeps its own history of assignments and hand-backs with the reason
-- given. Tasks from before this have no assigner on record; a hand-back returns those to whoever
-- created them.
ALTER TABLE "tasks" ADD COLUMN "assigned_by_id" UUID;

CREATE TABLE "task_events" (
    "id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "actor_id" UUID,
    "from_user_id" UUID,
    "to_user_id" UUID,
    "note" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "task_events_task_id_created_at_idx" ON "task_events"("task_id", "created_at");

ALTER TABLE "task_events" ADD CONSTRAINT "task_events_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "task_events" ADD CONSTRAINT "task_events_kind_chk" CHECK ("kind" IN ('assigned','handed_back'));
