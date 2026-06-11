-- Multi-tenant auth: User + WorkspaceMembership + AdminAuditLog, user-based
-- sessions with impersonation, invite-only access. Hand-edited to backfill
-- existing Workspace owners so nobody is locked out by the invite-only gate.

-- 1. New tables ------------------------------------------------------------

CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

CREATE TABLE "WorkspaceMembership" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkspaceMembership_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WorkspaceMembership_userId_workspaceId_key" ON "WorkspaceMembership"("userId", "workspaceId");
CREATE INDEX "WorkspaceMembership_workspaceId_idx" ON "WorkspaceMembership"("workspaceId");

ALTER TABLE "WorkspaceMembership" ADD CONSTRAINT "WorkspaceMembership_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkspaceMembership" ADD CONSTRAINT "WorkspaceMembership_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "AdminAuditLog" (
    "id" TEXT NOT NULL,
    "adminUserId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "workspaceId" TEXT,
    "detail" TEXT NOT NULL DEFAULT '{}',
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminAuditLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AdminAuditLog_adminUserId_at_idx" ON "AdminAuditLog"("adminUserId", "at");
CREATE INDEX "AdminAuditLog_workspaceId_idx" ON "AdminAuditLog"("workspaceId");

-- 2. Backfill: every existing workspace owner becomes a User with an
--    'owner' membership. gen_random_uuid() is built in on PG >= 13.

INSERT INTO "User" ("id", "email", "createdAt", "updatedAt")
SELECT gen_random_uuid(), w."ownerEmail", w."createdAt", CURRENT_TIMESTAMP
FROM "Workspace" w
ON CONFLICT ("email") DO NOTHING;

INSERT INTO "WorkspaceMembership" ("id", "userId", "workspaceId", "role")
SELECT gen_random_uuid(), u."id", w."id", 'owner'
FROM "Workspace" w
JOIN "User" u ON u."email" = w."ownerEmail";

-- 3. Workspace: disabledAt + ownerEmail becomes display-only (drop unique).

ALTER TABLE "Workspace" ADD COLUMN "disabledAt" TIMESTAMP(3);
DROP INDEX "Workspace_ownerEmail_key";

-- 4. Sessions: wipe and restructure around userId. Existing cookies simply
--    miss the table and fall through to /signin — cookie name is unchanged.

DELETE FROM "WorkspaceSession";

DROP INDEX "WorkspaceSession_workspaceId_idx";
ALTER TABLE "WorkspaceSession" DROP COLUMN "workspaceId";
ALTER TABLE "WorkspaceSession"
    ADD COLUMN "userId" TEXT NOT NULL,
    ADD COLUMN "activeWorkspaceId" TEXT,
    ADD COLUMN "impersonatedWorkspaceId" TEXT,
    ADD COLUMN "impersonationExpiresAt" TIMESTAMP(3);

CREATE INDEX "WorkspaceSession_userId_idx" ON "WorkspaceSession"("userId");

ALTER TABLE "WorkspaceSession" ADD CONSTRAINT "WorkspaceSession_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
