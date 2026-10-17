-- Category rules: user-defined substring rules that fill in a missing category.
--
-- Rules are workspace-scoped, never overwrite an existing category, and are
-- ordered deterministically by (priority, pattern length, createdAt, id).

-- CreateEnum
CREATE TYPE "RuleMatchField" AS ENUM ('DESCRIPTION', 'MERCHANT', 'ANY');

-- CreateTable
CREATE TABLE "CategoryRule" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "matchField" "RuleMatchField" NOT NULL,
    "pattern" TEXT NOT NULL,
    "categoryId" UUID NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CategoryRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CategoryRule_workspaceId_matchField_pattern_key" ON "CategoryRule"("workspaceId", "matchField", "pattern");

-- CreateIndex
CREATE INDEX "CategoryRule_workspaceId_priority_idx" ON "CategoryRule"("workspaceId", "priority");

-- AddForeignKey
ALTER TABLE "CategoryRule" ADD CONSTRAINT "CategoryRule_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CategoryRule" ADD CONSTRAINT "CategoryRule_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;
