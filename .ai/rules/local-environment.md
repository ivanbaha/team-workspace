# Local Environment

This workspace is large: a dozen cloned repos, a vector store, and a local embedding model.
Some commands are slow, and a few reliably break the session. Knowing which is which — and
handing those over rather than working around them — is part of the normal flow.

---

## Never run these

- **`yarn docs:ingest`**, or any other docs re-index command. The index is refreshed by
  `yarn setup` and by the daily guard after a pull that moved documentation. When you have
  edited an indexed file, **say the index is stale for it** and let the operator refresh it.
  See [docs-index.md](./docs-index.md).
- **Dependency installs** — `yarn install`, `yarn add`, `npm install`, `npm ci`, or anything
  that writes `node_modules` or a lockfile. If a task needs a new dependency, edit
  `package.json` and hand the install over.
- **Workspace-wide bootstrap** — `yarn setup` and equivalents. It clones every repo and can
  rebuild the whole index.
- **`yarn qdrant`** start/stop while a search is in flight.

## Hand the command over; do not work around it

When a task needs one of the above, **pause and ask the operator to run it**, then continue
once they confirm. The operator is watching the session, so handing an action over is the
normal flow — not an escalation, and not a blocker.

**Always:**

- State the exact command *and the directory*, copy-pasteable.
- Say in one line why it is needed and what you will do with the result.
- Stop there and wait. Resume from that point after confirmation.

**Do NOT:**

- Invent a work-around — hand-rolled scripts, vendored copies, patched imports, skipped
  verification — to avoid asking.
- Silently drop the step, mark it "can't verify", or call the task complete without it.
- Batch the request into a closing summary after moving on. Ask at the moment it is needed.

---

## Expect these to be slow

Slowness here is normal and is not a hang. Do not re-run, do not assume failure, and do not
narrate the wait as a problem:

- `yarn build:libs`, `yarn test:libs`, a service's `build` / `test` / `start`.
- Anything that walks the workspace, and wide `grep` / `find` sweeps across cloned repos.
- The first `docs_search` after a cold start — the embedding model loads on first use.
- `kubectl kustomize` over an overlay with many services.

**Always:**

- Run one heavy command at a time and let it finish. Parallel heavy commands is what tips
  the machine into thrash.
- Scope narrowly while iterating (a single test file), then run the full suite once at the
  end.
- Prefer the dedicated read/edit/search tools over shell equivalents — they are faster here
  and do not compete for the same resources.
- Set a generous timeout rather than a short one plus a retry.

---

## When the shell degrades, stop and say so

Under load the terminal can degrade and stay degraded. **Treat the first sign as a hard
stop, not as something to retry around.** Any one of these is enough:

- Echoed input is garbled, with characters dropped or duplicated
  (`git -C infra/git-ops` → `git -C inf rra/git-ops`).
- **Arguments go missing from the executed command** — `kubectl kustomize <path> | wc -l`
  running as `kubectl kustomize | wc -l`.
- Exit codes are wrong, or `-1` for everything including `echo`.
- `cwd` is ignored and the command runs in the previous directory.
- Empty output from a command that must produce output, **and a single retry does not fix
  it**.

**The one exception — cold start.** The first command in a freshly spawned shell can return
empty output with a non-zero code. Retry it **once**; it normally succeeds. A cold start
returns nothing from an otherwise healthy shell, whereas real degradation garbles the echo.

**Always:**

- **Stop after the second failed attempt.** A third phrasing, a redirect to a temp file, or
  a background process are the same approach again, and each costs minutes.
- Tell the operator plainly what the terminal is doing, and offer both options: run the
  command themselves, or restart the editor. Their call.
- Fall back to the dedicated tools meanwhile — reading, editing and searching do not go
  through the shell and keep working when it does not.

**Do NOT:**

- Keep issuing commands into a shell that is dropping characters. **This is the dangerous
  case, not merely the slow one:** a mangled argument to `git restore`, `rm` or `git reset`
  acts on the wrong path. Corrupted input plus a destructive verb is how work gets lost.
- Infer that a command succeeded from empty output. Empty output is a symptom, not a result.
- Claim a gate passed on the strength of a command whose output you never saw. Say what you
  could not verify.

---

## Prefer

- The `node_modules` already installed in the target service — scripts can import what is
  there instead of adding a dependency.
- Per-service, narrowly scoped commands over anything that walks the whole workspace.
- One command at a time.
