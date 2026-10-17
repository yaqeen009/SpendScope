-- Dismissed recurring series.
--
-- Detection is a heuristic, so a user can permanently hide a false positive.
-- A dismissal is workspace-scoped and only affects presentation.

-- CreateTable
CREATE TABLE "RecurringDismissal" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "seriesKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecurringDismissal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RecurringDismissal_workspaceId_seriesKey_key" ON "RecurringDismissal"("workspaceId", "seriesKey");

-- AddForeignKey
ALTER TABLE "RecurringDismissal" ADD CONSTRAINT "RecurringDismissal_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
