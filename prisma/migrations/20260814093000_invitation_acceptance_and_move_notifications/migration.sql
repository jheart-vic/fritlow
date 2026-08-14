-- Invitations now require the invitee's consent, and moving a project tells
-- the people who lost access.
--
-- Until now, inviting an email that ALREADY had an account created the
-- membership immediately — no acceptance step. That put a stranger's projects
-- in your sidebar on their say-so. Every invite is now a PENDING row that only
-- becomes a membership when the invitee accepts (or registers through the
-- invite link, which is the same consent by another route).

-- 1. New terminal states.
--    DECLINED — the invitee said no. REVOKED already existed and means the
--    INVITER cancelled; keeping them distinct lets the sender tell "they
--    turned me down" from "I changed my mind" in the invitation history.
--    EXPIRED  — nobody acted before expiresAt.
ALTER TYPE "InvitationStatus" ADD VALUE IF NOT EXISTS 'DECLINED';
ALTER TYPE "InvitationStatus" ADD VALUE IF NOT EXISTS 'EXPIRED';

-- 2. Notification for a project leaving a workspace you belong to.
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'PROJECT_MOVED';

-- 3. The emailed accept link, and a shelf life for it.
--    Only the SHA-256 hash is stored, exactly like RefreshToken and
--    EmailVerificationToken: a database leak then exposes no usable links.
--    Both columns are nullable so invitations created before this migration
--    keep working — they have no email link, but they still appear in the
--    invitee's in-app list and can be accepted from there.
ALTER TABLE "WorkspaceInvitation" ADD COLUMN "tokenHash" TEXT;
ALTER TABLE "WorkspaceInvitation" ADD COLUMN "expiresAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "WorkspaceInvitation_tokenHash_key" ON "WorkspaceInvitation"("tokenHash");

-- Deliberately NOT backfilled: existing PENDING invitations keep a null
-- expiresAt, which reads as "never expires". Back-dating them would silently
-- expire invites that were live when this deployed, and expiring someone's
-- pending invite without telling them is a worse failure than one that
-- lingers. New invites all carry an expiry.
