-- Split the two jobs "isPersonal" was doing into two independent facts.
--
-- Until now one boolean meant BOTH "invites are refused here" AND "new projects
-- land here". The second meaning forced the count to exactly one per user:
-- getPersonalWorkspaceId did findFirst(isPersonal), so a user with two personal
-- workspaces would have had new projects land in an arbitrary one, and a user
-- with none fell through to "earliest workspace you own" — possibly a shared
-- one their whole team can read. Both failures are silent.
--
-- After this migration:
--   Workspace.isPrivate       — invites refused here. Any number per user.
--   User.defaultWorkspaceId   — where unrouted projects land. Exactly one.
--
-- That is what lets users choose private-or-shared when creating a workspace
-- without new projects going astray.

-- 1. Rename in place. RENAME COLUMN (not DROP + ADD) so every existing value
--    survives — a drop/add would silently reset every flag to the default and
--    unlock invites into every private workspace on the platform.
ALTER TABLE "Workspace" RENAME COLUMN "isPersonal" TO "isPrivate";

-- 2. The explicit default pointer.
ALTER TABLE "User" ADD COLUMN "defaultWorkspaceId" TEXT;

-- 3. Backfill, in the order the old code resolved it.
--    3a. Preferred: the workspace already flagged private that this user owns.
UPDATE "User" u
SET "defaultWorkspaceId" = (
    SELECT w."id"
    FROM "Workspace" w
    JOIN "WorkspaceMember" m ON m."workspaceId" = w."id"
    WHERE m."userId" = u."id"
      AND m."role" = 'OWNER'::"WorkspaceRole"
      AND w."isPrivate" = true
    ORDER BY w."createdAt" ASC
    LIMIT 1
);

--    3b. Fallback for accounts the isPersonal backfill never reached: the old
--        rule, "the earliest workspace you own". Applied only where 3a found
--        nothing, so it can never override a real private workspace.
UPDATE "User" u
SET "defaultWorkspaceId" = (
    SELECT m."workspaceId"
    FROM "WorkspaceMember" m
    WHERE m."userId" = u."id"
      AND m."role" = 'OWNER'::"WorkspaceRole"
    ORDER BY m."createdAt" ASC
    LIMIT 1
)
WHERE u."defaultWorkspaceId" IS NULL;

-- 4. SetNull, not Cascade: deleting a workspace must never delete its owner.
--    A null pointer is a recoverable state — createProject asks the user to
--    pick a workspace instead of guessing one.
ALTER TABLE "User"
    ADD CONSTRAINT "User_defaultWorkspaceId_fkey"
    FOREIGN KEY ("defaultWorkspaceId") REFERENCES "Workspace"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "User_defaultWorkspaceId_idx" ON "User"("defaultWorkspaceId");

-- 5. One channel name per workspace.
--    Dedupe first — CREATE UNIQUE INDEX fails outright if duplicates exist.
--    Rename the newer collisions rather than delete them: GroupMessage cascades
--    on channel delete, so dropping a duplicate would take real conversation
--    history with it. Renaming is reversible; deleting is not. (No-op on a
--    fresh database.)
WITH ranked AS (
    SELECT "id",
           "name",
           row_number() OVER (
               PARTITION BY "workspaceId", "name"
               ORDER BY "createdAt" ASC, "id" ASC
           ) AS rn
    FROM "GroupChannel"
)
UPDATE "GroupChannel" c
SET "name" = ranked."name" || ' (' || ranked.rn || ')'
FROM ranked
WHERE c."id" = ranked."id"
  AND ranked.rn > 1;

CREATE UNIQUE INDEX "GroupChannel_workspaceId_name_key" ON "GroupChannel"("workspaceId", "name");
