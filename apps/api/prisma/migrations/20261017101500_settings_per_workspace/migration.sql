-- Per-workspace settings.
--
-- The original `Settings` table used a singleton primary key (`id`, default 1)
-- alongside a unique `workspaceId`. That allows exactly one settings row for
-- the whole installation, which is incompatible with per-user workspaces:
-- creating settings for a second workspace violated `Settings_pkey`.
--
-- `workspaceId` becomes the primary key, so each workspace owns exactly one
-- settings row and the redundant unique index is dropped.

-- DropForeignKey (none existed on `id`; the workspace FK is unchanged)

-- AlterTable
ALTER TABLE "Settings" DROP CONSTRAINT "Settings_pkey";

-- DropIndex
DROP INDEX "Settings_workspaceId_key";

-- AlterTable
ALTER TABLE "Settings" DROP COLUMN "id";

-- AddPrimaryKey
ALTER TABLE "Settings" ADD CONSTRAINT "Settings_pkey" PRIMARY KEY ("workspaceId");
