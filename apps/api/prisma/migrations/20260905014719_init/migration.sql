-- Extensions (trusted in PostgreSQL 13+, installable by the migration role). docs/05
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "email" CITEXT NOT NULL,
    "email_verified" BOOLEAN NOT NULL DEFAULT false,
    "image" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "role" TEXT DEFAULT 'agent',
    "banned" BOOLEAN DEFAULT false,
    "ban_reason" TEXT,
    "ban_expires" TIMESTAMPTZ(3),
    "two_factor_enabled" BOOLEAN DEFAULT false,
    "extension" TEXT,
    "team_id" UUID,
    "phone" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'Africa/Nairobi',
    "locale" TEXT NOT NULL DEFAULT 'en',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "avatar_key" TEXT,
    "last_seen_at" TIMESTAMPTZ(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "impersonated_by" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounts" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "issuer" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "access_token" TEXT,
    "refresh_token" TEXT,
    "id_token" TEXT,
    "access_token_expires_at" TIMESTAMPTZ(3),
    "refresh_token_expires_at" TIMESTAMPTZ(3),
    "scope" TEXT,
    "password" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verifications" (
    "id" UUID NOT NULL,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "verifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "two_factors" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "secret" TEXT NOT NULL,
    "backup_codes" TEXT NOT NULL,
    "verified" BOOLEAN DEFAULT true,
    "failed_verification_count" INTEGER DEFAULT 0,
    "locked_until" TIMESTAMPTZ(3),

    CONSTRAINT "two_factors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "teams" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "manager_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "teams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "companies" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "industry" TEXT,
    "website" TEXT,
    "phone_e164" TEXT,
    "email" CITEXT,
    "address" JSONB,
    "owner_id" UUID,
    "custom_fields" JSONB NOT NULL DEFAULT '{}',
    "created_by_id" UUID,
    "deleted_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contacts" (
    "id" UUID NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT,
    "display_name" TEXT NOT NULL,
    "company_id" UUID,
    "job_title" TEXT,
    "avatar_key" TEXT,
    "owner_id" UUID,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "custom_fields" JSONB NOT NULL DEFAULT '{}',
    "preferred_channel" TEXT,
    "do_not_call" BOOLEAN NOT NULL DEFAULT false,
    "legal_hold" BOOLEAN NOT NULL DEFAULT false,
    "created_by_id" UUID,
    "deleted_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "search_vector" tsvector,

    CONSTRAINT "contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_phones" (
    "id" UUID NOT NULL,
    "contact_id" UUID NOT NULL,
    "e164" TEXT NOT NULL,
    "raw" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'mobile',
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contact_phones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_emails" (
    "id" UUID NOT NULL,
    "contact_id" UUID NOT NULL,
    "email" CITEXT NOT NULL,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contact_emails_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "custom_field_definitions" (
    "id" UUID NOT NULL,
    "entity" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "options" JSONB,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "custom_field_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pipelines" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "pipelines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pipeline_stages" (
    "id" UUID NOT NULL,
    "pipeline_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "probability" INTEGER NOT NULL DEFAULT 0,
    "type" TEXT NOT NULL DEFAULT 'open',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "pipeline_stages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leads" (
    "id" UUID NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT,
    "company_name" TEXT,
    "phone_e164" TEXT,
    "phone_raw" TEXT,
    "email" CITEXT,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "source_ref" TEXT,
    "status" TEXT NOT NULL DEFAULT 'new',
    "owner_id" UUID,
    "notes" TEXT,
    "custom_fields" JSONB NOT NULL DEFAULT '{}',
    "converted_contact_id" UUID,
    "converted_deal_id" UUID,
    "converted_at" TIMESTAMPTZ(3),
    "created_by_id" UUID,
    "deleted_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deals" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "contact_id" UUID,
    "company_id" UUID,
    "pipeline_id" UUID NOT NULL,
    "stage_id" UUID NOT NULL,
    "value" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "currency" CHAR(3) NOT NULL DEFAULT 'KES',
    "probability" INTEGER NOT NULL DEFAULT 0,
    "expected_close_date" DATE,
    "owner_id" UUID,
    "status" TEXT NOT NULL DEFAULT 'open',
    "won_at" TIMESTAMPTZ(3),
    "lost_at" TIMESTAMPTZ(3),
    "lost_reason" TEXT,
    "custom_fields" JSONB NOT NULL DEFAULT '{}',
    "created_by_id" UUID,
    "deleted_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "deals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deal_stage_history" (
    "id" UUID NOT NULL,
    "deal_id" UUID NOT NULL,
    "from_stage_id" UUID,
    "to_stage_id" UUID NOT NULL,
    "changed_by_id" UUID,
    "changed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deal_stage_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tasks" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "type" TEXT NOT NULL DEFAULT 'follow_up',
    "status" TEXT NOT NULL DEFAULT 'open',
    "priority" TEXT NOT NULL DEFAULT 'normal',
    "due_at" TIMESTAMPTZ(3),
    "remind_at" TIMESTAMPTZ(3),
    "reminder_job_id" TEXT,
    "reminder_sent_at" TIMESTAMPTZ(3),
    "assignee_id" UUID,
    "contact_id" UUID,
    "deal_id" UUID,
    "company_id" UUID,
    "source_call_id" UUID,
    "completed_at" TIMESTAMPTZ(3),
    "created_by_id" UUID,
    "deleted_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notes" (
    "id" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "author_id" UUID NOT NULL,
    "contact_id" UUID,
    "deal_id" UUID,
    "company_id" UUID,
    "call_id" UUID,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "call_dispositions" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "call_dispositions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "calls" (
    "id" UUID NOT NULL,
    "pbx_call_id" TEXT NOT NULL,
    "pbx_cdr_uid" TEXT,
    "direction" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ringing',
    "from_number" TEXT NOT NULL,
    "to_number" TEXT NOT NULL,
    "external_e164" TEXT,
    "contact_id" UUID,
    "user_id" UUID,
    "extension" TEXT,
    "trunk_name" TEXT,
    "did_number" TEXT,
    "call_path" TEXT,
    "started_at" TIMESTAMPTZ(3) NOT NULL,
    "answered_at" TIMESTAMPTZ(3),
    "ended_at" TIMESTAMPTZ(3),
    "ring_duration_sec" INTEGER,
    "talk_duration_sec" INTEGER,
    "total_duration_sec" INTEGER,
    "disposition_id" UUID,
    "disposition_note" TEXT,
    "disposition_set_by_id" UUID,
    "disposition_set_at" TIMESTAMPTZ(3),
    "recording_file_name" TEXT,
    "recording_status" TEXT NOT NULL DEFAULT 'none',
    "recording_key" TEXT,
    "recording_size_bytes" BIGINT,
    "recording_sha256" TEXT,
    "pbx_raw_cdr" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "calls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "channels" (
    "id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "external_id" TEXT,
    "config" JSONB NOT NULL DEFAULT '{}',
    "secrets_encrypted" BYTEA,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "channels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversations" (
    "id" UUID NOT NULL,
    "channel_id" UUID NOT NULL,
    "contact_id" UUID,
    "external_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "assignee_id" UUID,
    "last_message_at" TIMESTAMPTZ(3),
    "last_inbound_at" TIMESTAMPTZ(3),
    "unread_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "direction" TEXT NOT NULL,
    "external_message_id" TEXT,
    "content_type" TEXT NOT NULL DEFAULT 'text',
    "body" TEXT,
    "status" TEXT NOT NULL DEFAULT 'received',
    "error_code" TEXT,
    "error_message" TEXT,
    "sent_by_id" UUID,
    "sent_at" TIMESTAMPTZ(3) NOT NULL,
    "delivered_at" TIMESTAMPTZ(3),
    "read_at" TIMESTAMPTZ(3),
    "raw" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attachments" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" BIGINT NOT NULL,
    "sha256" TEXT,
    "message_id" UUID,
    "note_id" UUID,
    "uploaded_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activities" (
    "id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "contact_id" UUID,
    "deal_id" UUID,
    "company_id" UUID,
    "actor_id" UUID,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "summary" TEXT NOT NULL,
    "ref_table" TEXT NOT NULL,
    "ref_id" UUID NOT NULL,
    "meta" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "search_vector" tsvector,

    CONSTRAINT "activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "actor_id" UUID,
    "actor_type" TEXT NOT NULL DEFAULT 'user',
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entity_id" UUID,
    "before" JSONB,
    "after" JSONB,
    "ip" TEXT,
    "user_agent" TEXT,
    "request_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "data" JSONB NOT NULL DEFAULT '{}',
    "read_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_preferences" (
    "user_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "in_app" BOOLEAN NOT NULL DEFAULT true,
    "email" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("user_id","type")
);

-- CreateTable
CREATE TABLE "pbx_events" (
    "id" UUID NOT NULL,
    "event_type" INTEGER NOT NULL,
    "pbx_call_id" TEXT,
    "sn" TEXT,
    "payload" JSONB NOT NULL,
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ(3),
    "error" TEXT,

    CONSTRAINT "pbx_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "web_forms" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "fields" JSONB NOT NULL DEFAULT '[]',
    "allowed_origins" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "default_owner_id" UUID,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "submissions_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "web_forms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_jobs" (
    "id" UUID NOT NULL,
    "entity" TEXT NOT NULL,
    "file_key" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "total_rows" INTEGER NOT NULL DEFAULT 0,
    "processed_rows" INTEGER NOT NULL DEFAULT 0,
    "created_rows" INTEGER NOT NULL DEFAULT 0,
    "updated_rows" INTEGER NOT NULL DEFAULT 0,
    "error_rows" INTEGER NOT NULL DEFAULT 0,
    "errors" JSONB NOT NULL DEFAULT '[]',
    "mapping" JSONB NOT NULL DEFAULT '{}',
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ(3),

    CONSTRAINT "import_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updated_by_id" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_extension_key" ON "users"("extension");

-- CreateIndex
CREATE INDEX "users_team_id_idx" ON "users"("team_id");

-- CreateIndex
CREATE INDEX "users_role_idx" ON "users"("role");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_key" ON "sessions"("token");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- CreateIndex
CREATE INDEX "sessions_expires_at_idx" ON "sessions"("expires_at");

-- CreateIndex
CREATE INDEX "accounts_user_id_idx" ON "accounts"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_issuer_account_id_key" ON "accounts"("issuer", "account_id");

-- CreateIndex
CREATE INDEX "verifications_identifier_idx" ON "verifications"("identifier");

-- CreateIndex
CREATE INDEX "two_factors_user_id_idx" ON "two_factors"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "teams_name_key" ON "teams"("name");

-- CreateIndex
CREATE INDEX "companies_owner_id_idx" ON "companies"("owner_id");

-- CreateIndex
CREATE INDEX "companies_phone_e164_idx" ON "companies"("phone_e164");

-- CreateIndex
CREATE INDEX "companies_deleted_at_idx" ON "companies"("deleted_at");

-- CreateIndex
CREATE INDEX "companies_name_trgm" ON "companies" USING GIN ("name" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "contacts_owner_id_idx" ON "contacts"("owner_id");

-- CreateIndex
CREATE INDEX "contacts_company_id_idx" ON "contacts"("company_id");

-- CreateIndex
CREATE INDEX "contacts_deleted_at_idx" ON "contacts"("deleted_at");

-- CreateIndex
CREATE INDEX "contacts_tags_idx" ON "contacts" USING GIN ("tags");

-- CreateIndex
CREATE INDEX "contacts_display_name_trgm" ON "contacts" USING GIN ("display_name" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "contacts_search_idx" ON "contacts" USING GIN ("search_vector");

-- CreateIndex
CREATE INDEX "contact_phones_contact_id_idx" ON "contact_phones"("contact_id");

-- CreateIndex
CREATE INDEX "contact_phones_e164_idx" ON "contact_phones"("e164");

-- CreateIndex
CREATE INDEX "contact_emails_contact_id_idx" ON "contact_emails"("contact_id");

-- CreateIndex
CREATE INDEX "contact_emails_email_idx" ON "contact_emails"("email");

-- CreateIndex
CREATE UNIQUE INDEX "custom_field_definitions_entity_key_key" ON "custom_field_definitions"("entity", "key");

-- CreateIndex
CREATE UNIQUE INDEX "pipelines_name_key" ON "pipelines"("name");

-- CreateIndex
CREATE INDEX "pipeline_stages_pipeline_id_sort_order_idx" ON "pipeline_stages"("pipeline_id", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "pipeline_stages_pipeline_id_name_key" ON "pipeline_stages"("pipeline_id", "name");

-- CreateIndex
CREATE INDEX "leads_owner_id_idx" ON "leads"("owner_id");

-- CreateIndex
CREATE INDEX "leads_phone_e164_idx" ON "leads"("phone_e164");

-- CreateIndex
CREATE INDEX "leads_email_idx" ON "leads"("email");

-- CreateIndex
CREATE INDEX "leads_status_idx" ON "leads"("status");

-- CreateIndex
CREATE INDEX "leads_deleted_at_idx" ON "leads"("deleted_at");

-- CreateIndex
CREATE INDEX "deals_contact_id_idx" ON "deals"("contact_id");

-- CreateIndex
CREATE INDEX "deals_company_id_idx" ON "deals"("company_id");

-- CreateIndex
CREATE INDEX "deals_stage_id_idx" ON "deals"("stage_id");

-- CreateIndex
CREATE INDEX "deals_owner_id_idx" ON "deals"("owner_id");

-- CreateIndex
CREATE INDEX "deals_status_idx" ON "deals"("status");

-- CreateIndex
CREATE INDEX "deals_expected_close_date_idx" ON "deals"("expected_close_date");

-- CreateIndex
CREATE INDEX "deals_deleted_at_idx" ON "deals"("deleted_at");

-- CreateIndex
CREATE INDEX "deal_stage_history_deal_id_changed_at_idx" ON "deal_stage_history"("deal_id", "changed_at");

-- CreateIndex
CREATE INDEX "tasks_assignee_id_status_idx" ON "tasks"("assignee_id", "status");

-- CreateIndex
CREATE INDEX "tasks_due_at_idx" ON "tasks"("due_at");

-- CreateIndex
CREATE INDEX "tasks_contact_id_idx" ON "tasks"("contact_id");

-- CreateIndex
CREATE INDEX "tasks_deal_id_idx" ON "tasks"("deal_id");

-- CreateIndex
CREATE INDEX "tasks_deleted_at_idx" ON "tasks"("deleted_at");

-- CreateIndex
CREATE INDEX "notes_contact_id_created_at_idx" ON "notes"("contact_id", "created_at");

-- CreateIndex
CREATE INDEX "notes_deal_id_created_at_idx" ON "notes"("deal_id", "created_at");

-- CreateIndex
CREATE INDEX "notes_company_id_idx" ON "notes"("company_id");

-- CreateIndex
CREATE INDEX "notes_call_id_idx" ON "notes"("call_id");

-- CreateIndex
CREATE UNIQUE INDEX "call_dispositions_name_key" ON "call_dispositions"("name");

-- CreateIndex
CREATE UNIQUE INDEX "calls_pbx_cdr_uid_key" ON "calls"("pbx_cdr_uid");

-- CreateIndex
CREATE INDEX "calls_pbx_call_id_idx" ON "calls"("pbx_call_id");

-- CreateIndex
CREATE INDEX "calls_contact_id_started_at_idx" ON "calls"("contact_id", "started_at" DESC);

-- CreateIndex
CREATE INDEX "calls_user_id_started_at_idx" ON "calls"("user_id", "started_at" DESC);

-- CreateIndex
CREATE INDEX "calls_started_at_idx" ON "calls"("started_at" DESC);

-- CreateIndex
CREATE INDEX "calls_external_e164_idx" ON "calls"("external_e164");

-- CreateIndex
CREATE INDEX "calls_status_idx" ON "calls"("status");

-- CreateIndex
CREATE UNIQUE INDEX "channels_type_external_id_key" ON "channels"("type", "external_id");

-- CreateIndex
CREATE INDEX "conversations_contact_id_idx" ON "conversations"("contact_id");

-- CreateIndex
CREATE INDEX "conversations_assignee_id_status_idx" ON "conversations"("assignee_id", "status");

-- CreateIndex
CREATE INDEX "conversations_last_message_at_idx" ON "conversations"("last_message_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "conversations_channel_id_external_id_key" ON "conversations"("channel_id", "external_id");

-- CreateIndex
CREATE INDEX "messages_conversation_id_sent_at_idx" ON "messages"("conversation_id", "sent_at");

-- CreateIndex
CREATE UNIQUE INDEX "messages_conversation_id_external_message_id_key" ON "messages"("conversation_id", "external_message_id");

-- CreateIndex
CREATE UNIQUE INDEX "attachments_key_key" ON "attachments"("key");

-- CreateIndex
CREATE INDEX "attachments_message_id_idx" ON "attachments"("message_id");

-- CreateIndex
CREATE INDEX "attachments_note_id_idx" ON "attachments"("note_id");

-- CreateIndex
CREATE INDEX "activities_contact_id_occurred_at_idx" ON "activities"("contact_id", "occurred_at" DESC);

-- CreateIndex
CREATE INDEX "activities_deal_id_occurred_at_idx" ON "activities"("deal_id", "occurred_at" DESC);

-- CreateIndex
CREATE INDEX "activities_company_id_occurred_at_idx" ON "activities"("company_id", "occurred_at" DESC);

-- CreateIndex
CREATE INDEX "activities_ref_table_ref_id_idx" ON "activities"("ref_table", "ref_id");

-- CreateIndex
CREATE INDEX "activities_search_idx" ON "activities" USING GIN ("search_vector");

-- CreateIndex
CREATE INDEX "audit_logs_entity_entity_id_created_at_idx" ON "audit_logs"("entity", "entity_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_actor_id_created_at_idx" ON "audit_logs"("actor_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");

-- CreateIndex
CREATE INDEX "notifications_user_id_read_at_created_at_idx" ON "notifications"("user_id", "read_at", "created_at" DESC);

-- CreateIndex
CREATE INDEX "pbx_events_pbx_call_id_idx" ON "pbx_events"("pbx_call_id");

-- CreateIndex
CREATE INDEX "pbx_events_received_at_idx" ON "pbx_events"("received_at");

-- CreateIndex
CREATE UNIQUE INDEX "web_forms_token_key" ON "web_forms"("token");

-- CreateIndex
CREATE INDEX "import_jobs_created_by_id_created_at_idx" ON "import_jobs"("created_by_id", "created_at");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "two_factors" ADD CONSTRAINT "two_factors_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teams" ADD CONSTRAINT "teams_manager_id_fkey" FOREIGN KEY ("manager_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "companies" ADD CONSTRAINT "companies_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_phones" ADD CONSTRAINT "contact_phones_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_emails" ADD CONSTRAINT "contact_emails_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pipeline_stages" ADD CONSTRAINT "pipeline_stages_pipeline_id_fkey" FOREIGN KEY ("pipeline_id") REFERENCES "pipelines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_converted_contact_id_fkey" FOREIGN KEY ("converted_contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_converted_deal_id_fkey" FOREIGN KEY ("converted_deal_id") REFERENCES "deals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deals" ADD CONSTRAINT "deals_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deals" ADD CONSTRAINT "deals_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deals" ADD CONSTRAINT "deals_pipeline_id_fkey" FOREIGN KEY ("pipeline_id") REFERENCES "pipelines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deals" ADD CONSTRAINT "deals_stage_id_fkey" FOREIGN KEY ("stage_id") REFERENCES "pipeline_stages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deals" ADD CONSTRAINT "deals_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deal_stage_history" ADD CONSTRAINT "deal_stage_history_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "deals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deal_stage_history" ADD CONSTRAINT "deal_stage_history_from_stage_id_fkey" FOREIGN KEY ("from_stage_id") REFERENCES "pipeline_stages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deal_stage_history" ADD CONSTRAINT "deal_stage_history_to_stage_id_fkey" FOREIGN KEY ("to_stage_id") REFERENCES "pipeline_stages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assignee_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "deals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_source_call_id_fkey" FOREIGN KEY ("source_call_id") REFERENCES "calls"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notes" ADD CONSTRAINT "notes_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notes" ADD CONSTRAINT "notes_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notes" ADD CONSTRAINT "notes_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "deals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notes" ADD CONSTRAINT "notes_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notes" ADD CONSTRAINT "notes_call_id_fkey" FOREIGN KEY ("call_id") REFERENCES "calls"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calls" ADD CONSTRAINT "calls_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calls" ADD CONSTRAINT "calls_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calls" ADD CONSTRAINT "calls_disposition_id_fkey" FOREIGN KEY ("disposition_id") REFERENCES "call_dispositions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "channels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_assignee_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_note_id_fkey" FOREIGN KEY ("note_id") REFERENCES "notes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "deals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ═══════════════════════════════════════════════════════════════════════════════════════
-- Hand-written additions (docs/05): partial unique indexes, search vectors, CHECKs,
-- audit immutability. Never edit after this migration has been applied anywhere.
-- ═══════════════════════════════════════════════════════════════════════════════════════

-- De-duplication on phone/email among non-deleted rows (R-7.1.4); one primary per contact.
CREATE UNIQUE INDEX "contact_phones_e164_active_uq" ON "contact_phones" ("e164") WHERE "deleted_at" IS NULL;
CREATE UNIQUE INDEX "contact_phones_primary_uq" ON "contact_phones" ("contact_id") WHERE "is_primary" AND "deleted_at" IS NULL;
CREATE UNIQUE INDEX "contact_emails_email_active_uq" ON "contact_emails" ("email") WHERE "deleted_at" IS NULL;
CREATE UNIQUE INDEX "contact_emails_primary_uq" ON "contact_emails" ("contact_id") WHERE "is_primary" AND "deleted_at" IS NULL;
CREATE UNIQUE INDEX "pipelines_default_uq" ON "pipelines" ("is_default") WHERE "is_default";


-- Integrity checks.
ALTER TABLE "notes" ADD CONSTRAINT "notes_parent_chk"
  CHECK ("contact_id" IS NOT NULL OR "deal_id" IS NOT NULL OR "company_id" IS NOT NULL OR "call_id" IS NOT NULL);
ALTER TABLE "pipeline_stages" ADD CONSTRAINT "pipeline_stages_probability_chk" CHECK ("probability" BETWEEN 0 AND 100);
ALTER TABLE "deals" ADD CONSTRAINT "deals_probability_chk" CHECK ("probability" BETWEEN 0 AND 100);
ALTER TABLE "deals" ADD CONSTRAINT "deals_value_chk" CHECK ("value" >= 0);
ALTER TABLE "calls" ADD CONSTRAINT "calls_direction_chk" CHECK ("direction" IN ('inbound','outbound','internal'));
ALTER TABLE "messages" ADD CONSTRAINT "messages_direction_chk" CHECK ("direction" IN ('inbound','outbound'));

-- Timeline full-text search: generated column (R-6.2).
ALTER TABLE "activities" DROP COLUMN "search_vector";
ALTER TABLE "activities" ADD COLUMN "search_vector" tsvector
  GENERATED ALWAYS AS (to_tsvector('simple', coalesce("summary", '') || ' ' || coalesce("meta"->>'text', ''))) STORED;
CREATE INDEX "activities_search_idx" ON "activities" USING gin ("search_vector");

-- Contact full-text search: maintained by triggers on contacts + phones + emails.
CREATE OR REPLACE FUNCTION contacts_search_vector_value(p_id uuid, p_display_name text, p_job_title text, p_company_id uuid)
RETURNS tsvector LANGUAGE sql STABLE AS $$
  SELECT to_tsvector('simple',
    coalesce(p_display_name, '') || ' ' || coalesce(p_job_title, '') || ' ' ||
    coalesce((SELECT c.name FROM companies c WHERE c.id = p_company_id), '') || ' ' ||
    coalesce((SELECT string_agg(p.e164 || ' ' || p.raw, ' ') FROM contact_phones p WHERE p.contact_id = p_id AND p.deleted_at IS NULL), '') || ' ' ||
    coalesce((SELECT string_agg(e.email::text, ' ') FROM contact_emails e WHERE e.contact_id = p_id AND e.deleted_at IS NULL), ''));
$$;

CREATE OR REPLACE FUNCTION contacts_search_vector_trg() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.search_vector := contacts_search_vector_value(NEW.id, NEW.display_name, NEW.job_title, NEW.company_id);
  RETURN NEW;
END $$;

CREATE TRIGGER "contacts_search_vector_biu"
  BEFORE INSERT OR UPDATE OF "display_name", "job_title", "company_id" ON "contacts"
  FOR EACH ROW EXECUTE FUNCTION contacts_search_vector_trg();

CREATE OR REPLACE FUNCTION contact_children_search_trg() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_contact_id uuid := COALESCE(NEW.contact_id, OLD.contact_id);
BEGIN
  UPDATE contacts c SET search_vector = contacts_search_vector_value(c.id, c.display_name, c.job_title, c.company_id) WHERE c.id = v_contact_id;
  RETURN NULL;
END $$;

CREATE TRIGGER "contact_phones_search_aiud" AFTER INSERT OR UPDATE OR DELETE ON "contact_phones"
  FOR EACH ROW EXECUTE FUNCTION contact_children_search_trg();
CREATE TRIGGER "contact_emails_search_aiud" AFTER INSERT OR UPDATE OR DELETE ON "contact_emails"
  FOR EACH ROW EXECUTE FUNCTION contact_children_search_trg();

-- Audit log is append-only (docs/08 K1). TRUNCATE (tests) is statement-level and unaffected.
CREATE OR REPLACE FUNCTION audit_logs_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only';
END $$;
CREATE TRIGGER "audit_logs_no_update_delete" BEFORE UPDATE OR DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION audit_logs_immutable();
