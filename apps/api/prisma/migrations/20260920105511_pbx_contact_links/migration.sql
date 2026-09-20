-- CreateTable
CREATE TABLE "pbx_contact_links" (
    "contact_id" UUID NOT NULL,
    "pbx_contact_id" INTEGER NOT NULL,
    "fingerprint" TEXT NOT NULL DEFAULT '',
    "synced_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pbx_contact_links_pkey" PRIMARY KEY ("contact_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "pbx_contact_links_pbx_contact_id_key" ON "pbx_contact_links"("pbx_contact_id");

-- AddForeignKey
ALTER TABLE "pbx_contact_links" ADD CONSTRAINT "pbx_contact_links_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
