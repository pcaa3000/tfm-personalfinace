-- Backfill (T19): every existing workspace gets editable copies of the
-- active global catalog so seed categories can be revised and archived
-- per workspace. The `uncategorized` system fallback is never copied —
-- it stays a protected global entry. Keys the workspace already owns
-- (active or archived) are skipped so @@unique([key, workspaceId]) is
-- never violated.

INSERT INTO "categorization_categories" ("id", "key", "label", "nature", "workspaceId", "archivedAt")
SELECT gen_random_uuid()::text, g."key", g."label", g."nature", w."id", NULL
FROM "identity_workspace_workspaces" w
CROSS JOIN "categorization_categories" g
WHERE g."workspaceId" IS NULL
  AND g."archivedAt" IS NULL
  AND g."key" <> 'uncategorized'
  AND g."nature" <> 'uncategorized'
  AND NOT EXISTS (
    SELECT 1
    FROM "categorization_categories" c
    WHERE c."workspaceId" = w."id"
      AND c."key" = g."key"
  );

-- Repoint historical transactions from the global row to the workspace
-- copy matching on (workspaceId, key), so they resolve to the editable
-- category the user now manages.
UPDATE "ledger_transactions" t
SET "categoryId" = c."id"
FROM "categorization_categories" g, "categorization_categories" c
WHERE t."categoryId" = g."id"
  AND g."workspaceId" IS NULL
  AND c."workspaceId" = t."workspaceId"
  AND c."key" = g."key"
  AND g."key" <> 'uncategorized'
  AND g."nature" <> 'uncategorized';
