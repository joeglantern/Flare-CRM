-- Maps object keys to a provider's own identifier for backends that cannot address by key
-- (Google Drive). The local S3 store keeps working without rows here.
CREATE TABLE "storage_objects" (
    "key" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "size_bytes" BIGINT NOT NULL,
    "content_type" TEXT NOT NULL,
    "sha256" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "storage_objects_pkey" PRIMARY KEY ("key")
);

CREATE INDEX "storage_objects_provider_provider_id_idx" ON "storage_objects"("provider", "provider_id");
