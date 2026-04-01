# scripts

Workspace-level automation scripts. These are not application code — they handle developer setup, synchronisation, and maintenance tasks.

---

## Scripts

| File | Command | Description |
| ----------------------- | -------------- | -------------------------------------------------------------------- |
| setup-workspace.mjs | `yarn setup` | First-time setup: installs the git hook and clones missing repos |
| update-workspace.mjs | `yarn update` | Sync: pulls updates in existing repos, clones any that are missing |

---

## setup-workspace.mjs

Run once when joining the project or bootstrapping a fresh clone of the workspace.

Steps it performs:

1. Configures git to use the shared hooks in `.githooks/` (`git config core.hooksPath .githooks`). This activates the `post-merge` hook so nested repos sync automatically after every `git pull` on the workspace.
2. Reads [configs/workspace-repos.json](../configs/workspace-repos.json) and clones any repo that does not already exist on disk. Existing repos are skipped.

```txt
yarn setup

[1/2] Installing git hooks...
      git hooks path set to .githooks (post-merge hook is now active)

[2/2] Cloning missing repos...

[frontends]
  SKIP  users-frontend — already exists
  CLONE products-frontend
        git@github.com:ivanbaha/tw-products-frontend.git
        -> ./frontend/products-frontend
  OK    products-frontend

[libs]
  CLONE tw-common-frontend
        git@github.com:ivanbaha/tw-common-frontend.git
        -> ./libs/tw-common-frontend
  OK    tw-common-frontend

Done. Cloned: 2  Skipped: 3  Failed: 0
```

---

## update-workspace.mjs

Run to pull the latest changes in all nested repos. Intended for day-to-day use and is also triggered automatically by the git hook after every `git pull` on the workspace root.

Behaviour:

- Repo exists on disk → `git pull --ff-only`
- Repo is missing → `git clone` (same as setup)

```txt
yarn update

[frontends]
  PULL  ./frontend/users-frontend
  OK    users-frontend
  PULL  ./frontend/products-frontend
  OK    products-frontend

[backends]
  PULL  ./backend/users-service
  OK    users-service

[libs]
  PULL  ./libs/tw-common-frontend
  OK    tw-common-frontend
  CLONE ./libs/tw-config (cloned)
  OK    tw-config

Done. Pulled: 4  Cloned: 1  Failed: 0
```

---

## .githooks/post-merge

A shared git hook stored in the repository under `.githooks/`. It is activated by `yarn setup` and fires automatically after every `git pull` (or `git merge`) on the workspace root.

What it does: calls `node scripts/update-workspace.mjs`, which pulls all nested repos and clones any that are missing.

To activate it manually (without running `yarn setup`):

```bash
git config core.hooksPath .githooks
```

---

## Adding a New Script

Add the `.mjs` file to this directory and register a corresponding entry in the `"scripts"` section of the root `package.json`.
