-- Enforce one total monthly expense budget per workspace/month.
--
-- A standard UNIQUE constraint treats NULLs as distinct, so it cannot stop a
-- second row with `categoryId IS NULL` for the same month. A partial unique
-- index expresses the real invariant. Category budgets keep using the regular
-- `Budget_workspaceId_month_categoryId_key` constraint created by Prisma.
CREATE UNIQUE INDEX "Budget_workspaceId_month_total_key"
  ON "Budget" ("workspaceId", "month")
  WHERE "categoryId" IS NULL;
