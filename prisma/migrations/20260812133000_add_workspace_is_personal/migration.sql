-- AlterTable
ALTER TABLE "Workspace" ADD COLUMN     "isPersonal" BOOLEAN NOT NULL DEFAULT false;

-- Backfill: mark each existing user's personal workspace.
-- Before this column existed, "personal" was inferred as the earliest workspace
-- a user OWNS (see getPersonalWorkspaceId in project.service.ts) — this applies
-- exactly that rule once, so existing accounts keep the same personal workspace
-- they have always had. Without it every workspace would look shared and the
-- invite guard would never fire.
UPDATE "Workspace"
SET "isPersonal" = true
WHERE "id" IN (
    SELECT DISTINCT ON (m."userId") m."workspaceId"
    FROM "WorkspaceMember" m
    WHERE m."role" = 'OWNER'::"WorkspaceRole"
    ORDER BY m."userId", m."createdAt" ASC
);
