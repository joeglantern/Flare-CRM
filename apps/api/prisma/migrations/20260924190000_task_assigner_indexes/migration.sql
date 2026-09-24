-- An agent's task list matches on who made and who gave each task as well as who holds it, so both
-- columns are indexed like the assignee already is.
CREATE INDEX "tasks_assigned_by_id_idx" ON "tasks"("assigned_by_id");
CREATE INDEX "tasks_created_by_id_idx" ON "tasks"("created_by_id");
