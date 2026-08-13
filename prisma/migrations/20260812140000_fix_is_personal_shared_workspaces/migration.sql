-- Correct the isPersonal backfill.
--
-- The previous migration inferred "personal" as the earliest workspace a user
-- owns, which is how the code identified it before the column existed. That
-- rule cannot tell a private workspace from a team workspace someone happened
-- to create first, and on real data it mislabelled two workspaces that already
-- had a second member — which would have blocked their owners from ever
-- inviting anyone else into them.
--
-- A workspace with more than one member is, by definition, not private. Apply
-- that as the correction. (No-op on a fresh database.)
UPDATE "Workspace" w
SET "isPersonal" = false
WHERE w."isPersonal" = true
  AND (SELECT COUNT(*) FROM "WorkspaceMember" m WHERE m."workspaceId" = w."id") > 1;
