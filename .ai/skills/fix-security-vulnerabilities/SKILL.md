---
name: fix-security-vulnerabilities
description: "Plan and apply a fix for security vulnerabilities in a service: pull the container-scan results from a pipeline, cross-check them with a local dependency audit, triage by severity, resolve target versions against the registry, generate an applicable fix plan, apply it, and verify the service is clean. Use when the user says 'fix the vulnerabilities', 'the container scan is failing', 'yarn audit found issues', 'security scan', 'CVE', or pastes a failing security pipeline."
---

# Fix Security Vulnerabilities

You are a security-remediation assistant for one service at a time. The job is to turn a
scanner's output into a **verified** fix: the right versions, applied, with the service still
building and its tests still passing.

Scripts live in `.ai/skills/fix-security-vulnerabilities/scripts/`. Working files go to
`.ai/skills/fix-security-vulnerabilities/output/`, which is git-ignored — never commit it.

---

## Two sources, two jobs

The same vulnerability is described by two different tools. Neither replaces the other.

| | Container scan (Trivy or compatible) | Dependency audit (`yarn audit` / `npm audit`) |
| --- | --- | --- |
| **Covers** | OS packages **and** language packages | Language packages only |
| **Authority** | What the pipeline gate actually saw | Ground truth for the package set |
| **Cost** | Needs the built image and the job log | Runs locally in seconds |
| **Weakness** | The log table can be truncated, losing rows | Blind to the OS layer entirely |

So: **the container scan is the only source for OS findings and for what the gate blocked
on. The audit is the primary source for package findings, and it is the tool that verifies
the fix in Step 7.** When their package findings disagree, prefer the audit and say so.

> **Deduplication, on both sides.** Each tool reports one row per dependency *path*, so raw
> totals are inflated several times over — "40 vulnerabilities" is routinely nine unique
> advisories reached through forty import chains. The scripts deduplicate on (package +
> advisory) and print both numbers. **Always report the unique count.** Quoting the raw
> total makes the problem sound larger than it is and makes the fix look more impressive
> than it was.

---

## Step 1: Resolve the service

Accept a service name (`products-service`), a workspace-relative path
(`backend/products-service`), or a pipeline URL.

Look it up in [`configs/workspace-repos.json`](../../../configs/workspace-repos.json) — every
entry carries `name`, `projectId` and `localPath`. You need all three: `localPath` to run the
audit, `projectId` for any GitLab call.

**Never invent a project ID.** If the service is not in the registry, ask.

Say in one line what you resolved — service, local path, project ID — before doing anything
else.

---

## Step 2: Get the container-scan findings

Skip this step only if the user explicitly asked for a dependency audit alone. The OS half of
the problem exists whether or not anyone looked for it.

1. `gitlab_get_pipelines { project_id, ref: "main" }` — or use the pipeline the user gave.
2. `gitlab_get_pipeline_jobs { project_id, pipeline_id }` and find the security-scanning job
   (commonly `container_scanning`).
   - **Not present** → say so and continue with the audit alone.
   - **Still running or skipped** → say which, and ask whether to proceed on stale data.
3. `gitlab_get_job_log { project_id, job_id, output_file:
   ".ai/skills/fix-security-vulnerabilities/output/scan-raw.log", working_dir: <workspace root> }`

   `working_dir` keeps the file inside the workspace rather than wherever the MCP server
   happens to run. The tool returns metadata only, so the raw log never passes through your
   context — which matters, because these logs are long.

4. Parse it:

```bash
node .ai/skills/fix-security-vulnerabilities/scripts/parse-scan-log.mjs \
  --input=.ai/skills/fix-security-vulnerabilities/output/scan-raw.log \
  --out=.ai/skills/fix-security-vulnerabilities/output/scan.json
```

If the parser reports **0 findings from a log that clearly has a table**, the format has
changed. Say so and read the raw log — do **not** report the service as clean.

---

## Step 3: Audit the dependencies locally

```bash
node .ai/skills/fix-security-vulnerabilities/scripts/scan-dependencies.mjs \
  --service=<name or path> \
  --out=.ai/skills/fix-security-vulnerabilities/output/audit.json
```

It picks `yarn` or `npm` from the lockfile and normalises either into the same shape. A
non-zero exit from the auditor is the *normal* outcome when advisories exist — the script
ignores it and always parses.

Reconcile against the scan's package findings. They should describe the same unique set. If
they do not, prefer the audit for packages, and tell the user which advisories only one tool
saw — a scan-only finding usually means a truncated log; an audit-only finding usually means
the image predates the current lockfile.

---

## Step 4: Triage by severity — stop and ask

Present the counts, then apply these rules:

- **CRITICAL + HIGH** → always in scope. No question needed.
- **LOW** → always skipped. Reported, not fixed.
- **MEDIUM** → **stop and ask:**

  > There are N medium-severity advisories. Include them in this fix?

  Wait for the answer. Bundling mediums into a critical fix widens the blast radius of a
  change that needs to ship quickly; excluding them silently means they never get fixed.
  Neither is yours to decide.

**OS-level findings are a separate conversation.** They are not fixed by package
resolutions — they need a base-image bump. Report them separately:

> ⚠ N OS-level vulnerabilities (base image packages). These need a base image bump, not a
> dependency change.

List each with package, advisory, severity and fixed version, then **ask for the target base
image** (a full `repository:tag`). If the user does not have one, say the plan will be
generated without touching the Dockerfile and the base image is a separate task.

---

## Step 5: Build the fix plan

```bash
node .ai/skills/fix-security-vulnerabilities/scripts/build-fix-plan.mjs \
  --service=<name or path> \
  --audit=.ai/skills/fix-security-vulnerabilities/output/audit.json \
  --scan=.ai/skills/fix-security-vulnerabilities/output/scan.json \
  --severities=CRITICAL,HIGH \
  --base-image=<image:tag>
```

Add `MEDIUM` to `--severities` if the user approved it. Omit `--base-image` if there is none.

The script merges both sources, then decides three things — each of which you should be able
to explain if asked:

- **Target version = the lowest published version that clears every advisory on that
  package**, not the latest. A package with a HIGH fixed in 10.1.1 and a MEDIUM fixed in
  10.1.2 goes to 10.1.2. The smallest bump that actually fixes it is the one least likely to
  break the build.
- **Major bumps are excluded by default** and always reported. A major jump to clear a
  MEDIUM routinely breaks a toolchain, turning a security fix into a week of work. Pass
  `--allow-major` only when the user has seen the list and said yes.
- **Every fixed package gets a `resolutions` entry**, because most findings are transitive.
  A package that is *also* a direct dependency gets bumped there too, so the manifest and
  the lockfile do not disagree.

The script writes `output/fix-plan.json` and `output/fix-report.md`, and prints the report.

---

## Step 6: Present and confirm

Show the report — the fix table, the major bumps, anything with no fix available, the OS
section, and what was skipped. Then ask:

> Does this look right? Apply it to **&lt;service&gt;**?

Wait for confirmation. Two things always deserve a sentence of your own rather than a table
row:

- **A package with no fix available.** It stays vulnerable after this work. Name it, say
  what reaches it, and let the user decide whether that blocks the release.
- **A major bump you are including.** Say what the major changes, from the package's own
  changelog if you can reach it.

---

## Step 7: Apply, then verify — this is the step that matters

```bash
node .ai/skills/fix-security-vulnerabilities/scripts/apply-fix-plan.mjs \
  --plan=.ai/skills/fix-security-vulnerabilities/output/fix-plan.json --dry-run
```

Review the dry run, then run it without `--dry-run`. It edits `package.json` (resolutions and
any direct dependency) and the Dockerfile's first `FROM` line, and nothing else.

**It does not install, and neither do you.** Writing `node_modules` is an operator action
([`local-environment.md`](../../rules/local-environment.md)). Hand it over:

> `package.json` is updated. Please run `yarn install` in `<localPath>` and tell me when it
> is done — then I will re-audit.

Once they confirm, re-run the audit:

```bash
node .ai/skills/fix-security-vulnerabilities/scripts/scan-dependencies.mjs --service=<name>
```

**Expected result: 0 vulnerabilities at the selected severities.**

**New advisories appearing here is normal, not a mistake.** Clearing a stale resolution lets
a previously-pinned transitive dependency float back up to a vulnerable version. Add a
resolution for each using the same rules as Step 5, ask for another install, and re-audit
until clean — then fold the additions back into `fix-plan.json` so the plan stays a complete
record of what was done.

Finally, ask the operator to run the service's own gates:

```bash
yarn typecheck && yarn test
```

A bumped dependency that passes the audit and breaks the build is not a fix. Fix what breaks
— type changes from a bumped shared lib, a config or test-setup change from a TypeScript
major — and re-run until green.

**Do not report the work as done until the audit is clean *and* the gates pass.** If you
could not verify a step, say which one.

---

## Step 8: Deliver

The change is a normal MR: branch `fix/<TASK-CODE>-<service>-vulnerabilities`, commit
`fix(<TASK-CODE>): bumped vulnerable dependencies in <service>`, pushed with
`gitlab_safe_push`. See [`git-workflow.md`](../../rules/git-workflow.md).

**`fix`, not `build` or `chore`, even though the diff is only dependency versions.** The
type decides whether CI cuts a release, and a security fix that does not reach an
environment has not fixed anything. `build`/`chore` would merge green and publish nothing.
If the base image also moved, that rides in the same `fix` commit rather than a separate
`build` one.

The description should say what a reviewer cannot see from the diff:

- Which advisories this clears, by severity count — the **unique** count.
- Any major bump, and what was checked to be confident it is safe.
- Anything left unfixed, and why.
- Whether the base image moved, and what that carries with it (a Node major, usually).

Then delete the working files:

```bash
rm -f .ai/skills/fix-security-vulnerabilities/output/scan-raw.log \
      .ai/skills/fix-security-vulnerabilities/output/scan.json \
      .ai/skills/fix-security-vulnerabilities/output/audit.json
```

Keep `fix-plan.json` only if the same fix is being rolled out to other services — it is a
reasonable starting point for the next one, but each service needs its own run of Steps 3–7,
because the transitive graph differs.

---

## Never

- Report the raw scanner total as the number of vulnerabilities. Report the unique set.
- Run `yarn install` / `npm install` yourself. Hand it to the operator.
- Report the fix as done without a clean re-audit **and** passing gates.
- Include a major version bump the user has not seen and approved.
- Silently drop a package with no fix available — it is the finding most worth saying out loud.
- Try to fix an OS-level finding with a package resolution. It needs a base image.
- Rewrite a Dockerfile's later `FROM base AS …` stages — only the first real image line moves;
  the rest inherit it.
- Work on more than one service at a time. A multi-service rollout is a separate task, one
  run of this skill each.
- Commit anything from `output/`.
