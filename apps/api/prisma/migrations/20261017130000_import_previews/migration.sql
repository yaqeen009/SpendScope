-- Database-backed import previews.
--
-- Replaces the in-process preview map. A preview now survives an API restart
-- and is visible to every instance. `status` plus `result` make the commit step
-- idempotent: replaying the same preview id returns the recorded result instead
-- of importing the rows a second time. Rows are deleted once `expiresAt` passes.

-- CreateTable
CREATE TABLE "ImportPreview" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "filename" TEXT NOT NULL,
    "fileSizeBytes" INTEGER NOT NULL,
    "headers" JSONB NOT NULL,
    "records" JSONB NOT NULL,
    "detection" JSONB NOT NULL,
    "mapping" JSONB,
    "warnings" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "result" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "committedAt" TIMESTAMP(3),

    CONSTRAINT "ImportPreview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ImportPreview_expiresAt_idx" ON "ImportPreview"("expiresAt");

-- CreateIndex
CREATE INDEX "ImportPreview_workspaceId_createdAt_idx" ON "ImportPreview"("workspaceId", "createdAt");

-- AddForeignKey
ALTER TABLE "ImportPreview" ADD CONSTRAINT "ImportPreview_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
