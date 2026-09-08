# Agent Hooks

Five small guards that catch the mistakes which are cheap to make and expensive to undo —
four that prevent something, and one that stops a deliverable being quietly dropped.

They are **agent-neutral Node scripts**: the tool event arrives as JSON on stdin, and the
answer is an exit code. Nothing about them is specific to one assistant — they are wired for
Claude Code in [`.claude/settings.json`](../../.claude/settings.json), and any agent that can
run a command on a tool event can use the same files.

| Exit code | Meaning |
|---|---|
| `0` | Allow, silently |
| `2` | Block the call (`PreToolUse`) or report back to the agent (`PostToolUse`) |
| anything else | Treated as a broken hook and ignored — a failing hook must never wedge a session |

---

## The hooks

### `guard-secrets.mjs` — PreToolUse(Bash) · blocks

Refuses a git command that names a credential file (`.env`, `*.pem`, `id_rsa`, a kubeconfig),
and any command carrying a token-shaped string (`glpat-…`, `ghp_…`, `AKIA…`, a private key
block).

Also refuses `git add -A` / `git add .` **when an untracked `.env` is actually sitting in the
workspace root** — not always, because a bulk add is usually fine and a hook that cries wolf
gets switched off inside a week.

The token patterns are deliberately narrow. A general "looks like base64" rule fires on
lockfile hashes and image digests, which is the fastest way to make a security hook useless.

A committed token is not undone by a later commit: it has to be rotated and the history
rewritten. This is worth a false positive occasionally.

### `guard-protected-branch.mjs` — PreToolUse(Bash) · blocks

Refuses a raw `git push` to `main`/`master`, any `--force` push without `--force-with-lease`,
and a bare `git push` (where the target is implicit, and therefore may well be main).

`gitlab_safe_push` already enforces all of this. The gap this closes is the agent shelling
out instead of using the tool — easy to do, and it produces exactly the outcome the tool
exists to prevent.

### `docs-index-staleness.mjs` — PostToolUse(Edit|Write) · reports

After a markdown edit, checks whether the file is in the `docs_search` corpus and, if it is,
says the index is now stale for it — along with how old the index already was.

**Corpus membership is evaluated against `mcp/src/docs/sources.js` itself**, which exports
`SOURCES` as data. Re-implementing the corpus rules here would create a second copy that
drifts from the first, and the hook would start reporting on files nobody indexes.

It reports rather than fixes, which is the honest shape: the agent is not allowed to run
`yarn docs:ingest` ([`local-environment.md`](../../.ai/rules/local-environment.md)). The
failure it prevents is quiet — the agent edits a doc, searches for that very thing later,
gets the pre-edit version, and proceeds confidently on stale content.

### `docs-delivery-gate.mjs` — PostToolUse(Bash | *safe_push*) · reports

After a push completes, says that the `docs/` deliverable of the task is still outstanding:
read the `## Docs Impact` section of the task artifact, reconcile it against what actually
shipped, and propose the `docs/` edits rather than pushing them.

Documentation is the step that gets skipped universally, because nothing fails when it is
missing — the MR is open, the pipeline is green, the ticket looks done. It also has the
shortest useful window: docs written a week later are written from memory, by which point
the non-obvious decision is exactly the one that has been forgotten. Team docs live in
*this* repo while the code lives in a service repo, so they cannot ride in the service MR,
and that separation is precisely why they get dropped.

It stays silent when the push came from the workspace root, on the reading that the push
*was* the docs delivery — otherwise the reminder would loop. Where the working directory is
unknown it assumes a service push: a redundant reminder costs a sentence, a missed one
costs the documentation.

It reports and never blocks. A push that already happened cannot be un-pushed by refusing
it, and a gate that blocks delivery over documentation is switched off inside a week.

Process: [`docs/sdlc/03-development.md`](../../docs/sdlc/03-development.md#docs-delivery).

### `validate-overlay.mjs` — PostToolUse(Edit|Write) · reports

After an edit under `infra/git-ops/`, builds the affected overlay — all three when the edit
was under `base/`, since that reaches every environment.

Hand-edited kustomize YAML fails in a specific way: the diff looks entirely reasonable and
the build does not work. A config file removed but still referenced by a generator, a patch
naming a resource that no longer exists, one wrong indent level. None of it is visible in
review, and the first symptom is a deployment that will not sync.

Silent when neither `kustomize` nor `kubectl` is installed — that is the operator's
environment, not a finding.

---

## Testing one

Every hook reads stdin, so they are trivial to exercise by hand:

```bash
echo '{"tool_input":{"command":"git push origin main"}}' | node scripts/hooks/guard-protected-branch.mjs
echo "{\"tool_input\":{\"file_path\":\"$PWD/docs/README.md\"}}" | node scripts/hooks/docs-index-staleness.mjs
echo '{"tool_name":"Bash","tool_input":{"command":"git push origin feat/TW-1-x"}}' | node scripts/hooks/docs-delivery-gate.mjs
```

Exit `2` with a message on stderr means it fired.

---

## Wiring them into another agent

Point the agent's own hook mechanism at the same scripts. The contract they need to satisfy:

- Run the command with the event JSON on **stdin**.
- Treat exit `2` as *blocked* for a pre-tool event and *message for the model* for a
  post-tool event.
- Pass `tool_input.command` for shell events and `tool_input.file_path` for edit events —
  the two fields these hooks read. `docs-delivery-gate.mjs` also reads `tool_name` and,
  where the agent supplies one, `tool_input.working_dir`.

If an agent supplies a different payload shape, adapt
[`lib/hook-io.mjs`](./lib/hook-io.mjs) rather than each hook: `commandOf()` and
`filePathOf()` are the only places that touch the event structure.

---

## Adding one

Keep them **small, fast and quiet**. A hook runs on every matching tool call, so anything
slow is felt constantly and anything chatty gets disabled.

- Block only what is genuinely hard to undo. Everything else reports.
- Say what to do instead, not just what was refused — the message goes to the agent, and a
  refusal without an alternative just produces a retry.
- Fail open. An exception in a hook must not stop the session.
