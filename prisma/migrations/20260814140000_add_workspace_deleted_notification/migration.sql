-- Deleting a workspace destroys every project inside it (Project.workspaceId
-- cascades, and everything hangs off the project in turn). For anyone else who
-- was a member, that work simply stops existing — and unlike a move there is
-- nothing left to link to afterwards, so this notification is the only record
-- they get.
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'WORKSPACE_DELETED';
