-- The person who gave a task is told once when it passes its due time unfinished.
ALTER TABLE "tasks" ADD COLUMN "overdue_notified_at" TIMESTAMPTZ(3);

CREATE INDEX "tasks_due_at_overdue_notified_at_idx" ON "tasks"("due_at", "overdue_notified_at");
