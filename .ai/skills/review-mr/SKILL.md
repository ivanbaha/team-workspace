---
name: review-mr
description: "Review a GitLab merge request end-to-end: resolve it from a link or repo + MR number, read the existing discussion, gather the surrounding documentation, check the branch out locally, and review the change in the context of the whole system and its neighbouring services. Findings are drafted for explicit per-item approval before anything is posted, and the MR is only approved when asked. Supports multi-turn review (comment → fix → verify). Use when the user says 'review this MR', 'review !123', pastes a merge request link, or asks for a code review of someone's branch."
---

# Review MR

You are the reviewer on someone else's merge request. Your job is to understand the change
well enough to judge it, raise findings that are worth the author's time, and leave the MR
better than you found it — without touching their branch.

Two properties define this skill and override any instinct to be efficient:

- **Nothing is posted, and nothing is approved, without the operator's explicit say-so.**
  Comments and approvals are visible to other people and cannot be un-seen. You draft; the
  operator decides.
- **A finding is never dropped for being out of scope.** Scope decides *where* it goes —
  this MR, or a follow-up ticket — never *whether* it is recorded.

Review is **read-only** on the target repo: check out, read, never commit, never push.

---

## Step 1: Resolve the target MR

Accept any of these:

1. **A merge request URL** — `https://<gitlab-host>/<namespace>/<repo>/-/merge_requests/25`.
   The trailing number is the `iid`; the namespace path identifies the repo.
2. **Repo + number** — `products-service !25`, `users-frontend MR 25`, `host-frontend#12`.
   `!`, `#`, `MR`, `mr` and a bare number all mean the same thing.
3. **Nothing specific** — "review my pending MRs". Call `gitlab_get_pending_mrs` (MRs where
   the operator is a reviewer), list them, and ask which one.

Resolve to a `project_id`, an `mr_iid`, and a **local path** using
[`configs/workspace-repos.json`](../../../configs/workspace-repos.json) — every entry carries
`name`, `projectId`, `localPath` and `git`.

- From a URL, match the repo segment of the remote, not the display name.
- From a repo name, match `name`. On a partial or ambiguous match, list the candidates and
  ask. Never pick for them.

**Never invent a project ID.** If the repo is not in the registry, fall back to
`gitlab_get_projects` with a `search` term, show what you found, and confirm before
continuing. A wrong project ID posts comments on a stranger's MR.

Report the resolution in one line — repo, project ID, MR IID, local path — so a
mis-resolution is caught before any work is done.

---

## Step 2: Fetch the MR and read the whole conversation

`gitlab_get_mr_details { project_id, mr_iid }` returns metadata, the per-file diffs, **and**
the discussions in one payload.

The diffs come back whole, so the response is large on a big MR. Treat the changed-file list
as the useful part and the inline diff as a first read — the real reading happens locally in
Step 6, where you can see the code around the change.

### Read the existing discussion before forming any opinion

Build a ledger of thread state and keep it for the rest of the session:

- **Ignore notes with `system: true`.** Those are GitLab's own events ("added 3 commits"),
  not review content.
- For every remaining discussion record: who raised it, what it says, whether it is
  `resolved`, and — where a `position` is present — which file and line it hangs on.
- Note what the author **promised** ("will move this to the lib", "kept deliberately
  because …"). A promise is something to verify in Step 7, not to re-raise.
- **Never re-raise a point already in the thread**, resolved or not. Add to it, or leave it.

### Decide which turn this is

- **No non-system discussion** → first review. Full pass, Steps 4–6.
- **Discussion present** → follow-up turn. Still do the full pass (the code has moved, and
  the earlier reviewer may have missed things), but Step 7 becomes the priority.

---

## Step 3: Check the state — pause if the MR is not open

Read `state`, `draft`, `merge_status`, `has_conflicts` and `merged_at`.

**If `state` is anything other than `opened`, stop.** Do not review, do not draft, do not
post. Tell the operator:

> This MR is **{state}**. Comments on it will not gate anything, and the author may not be
> watching it. Do you still want the review? If yes, say what it is for — a post-merge
> audit, extracting follow-up tickets, or a re-open is planned.

Wait for an explicit answer. The reason changes the output: an audit wants findings turned
into tickets (Step 10); a planned re-open wants normal comments.

Two states that do **not** warrant a pause but do belong in your report:

- **`draft: true`** — perfectly reviewable, and reviewing early is the point of a draft. Say
  so, and weight "unfinished" findings accordingly.
- **`has_conflicts`** or a non-mergeable `merge_status` — mention it once. It is the
  author's to fix and not a review finding.

---

## Step 4: Gather the surrounding documentation

A diff on its own cannot tell you whether the change is *right*, only whether it is
*coherent*. Find the intent first.

**Extract the task code** — pattern `<letters>-<numbers>` — from the MR title, then the
source branch, then the description. Then collect, in this order:

1. **The ticket.** `jira_issue_get { issue_code }` for the task and, when it has one, its
   parent. You want the acceptance criteria and the stated scope: they are what "does this
   change do what it should" is measured against.
2. **Team docs.** `docs_search` on the subject of the change, then **read the returned files
   at the given lines** — the snippets locate, they do not answer. Nearly always worth a look:
   - `docs/architecture/architecture.md` — where this service sits
   - `docs/architecture/api-contracts.md` — the shared response envelope, error shape, paging
   - `docs/architecture/distributed-tracing.md` — if the change touches logging, the HTTP
     connector, or `DEPLOYMENT_NAME`
   - `docs/business/` — for anything that changes user-visible behaviour
3. **The rules.** [`.ai/rules/code-style.md`](../../rules/code-style.md) and
   [`git-workflow.md`](../../rules/git-workflow.md) for the code the MR touches. These are
   what makes a finding a rule rather than an opinion.

**Say what you did not find.** "No ticket linked; reviewing against the code and the
architecture docs alone" is useful information, and it lowers the confidence of any finding
that rests on intent.

### Whose repo is it

Check [`.ai/rules/environments-and-ownership.md`](../../rules/environments-and-ownership.md).
For a repo we do not own, **our standards do not apply** — review correctness, contracts, and
the impact on our services, and do not push our conventions onto another team's repo. Their
MR, their house style.

---

## Step 5: Check the branch out locally

Work in the repo's `localPath` from Step 1. Heavy commands are slow here — one at a time
([`local-environment.md`](../../rules/local-environment.md)).

1. **Check the tree is clean** (`git status --porcelain`). If it is not, or the operator has
   their own work checked out, **ask before doing anything**. Never stash, reset or discard
   someone's uncommitted work to make room for a review.
2. `git fetch origin`, then check out the MR's `source_branch`. If a stale local copy exists,
   fast-forward it to `origin/<source_branch>` — do not merge, do not rebase.
3. Establish the true diff against the target branch, which is what will actually merge:

   ```bash
   git log --oneline origin/<target>..origin/<source>
   git diff --stat $(git merge-base origin/<target> origin/<source>)..origin/<source>
   ```

   The log also shows whether the commits follow Conventional Commits with the task code as
   the scope — `feat(TW-412): …`. Two things there are **real findings**, not nits, because
   CI derives the version bump from them:

   - **Every commit on the branch is a no-release type** (`refactor`, `docs`, `test`,
     `build`, `ci`, `style`, `chore`) **but the change is meant to ship.** Merging cuts no
     release, so it never gets a version and never reaches an environment. The pipeline goes
     green and nothing is published.
   - **A breaking change with no `!` and no `BREAKING CHANGE:` footer.** It bumps a minor
     instead of a major, so consumers pick it up on a caret range and break. Check this
     whenever the diff changes a response shape, a required field, or a public signature.

**Read-only from here.** No commits, no pushes, no installs, no edits in the reviewed repo.
If you need to change a file to understand something, you do not — read harder instead.

---

## Step 6: Review the change, not the diff

The changed lines are where to *start looking*, not what to look at. A diff is a set of
pointers into the system; the review happens at the level of behaviour.

For each changed area open the **whole file**, then follow it outward — who calls this, what
it calls, what contract it participates in, and what breaks elsewhere if it is wrong. Most
real findings live in code the diff never touched.

Dimensions worth a deliberate pass:

- **Behaviour and correctness.** What the code now does across the paths that reach it,
  including the ones the author was not thinking about: empty and partial input, first run vs
  re-run, concurrent runs, the failure path.
- **Cross-service contracts.** DTOs, response shapes and shared types flow service →
  frontend through `libs/`. A field renamed, made optional, or newly required affects
  consumers in *other repos* — check them. If merge order matters, that belongs in the review.
- **Configuration and deployment.** A new environment variable must exist in every git-ops
  overlay the service runs in (`infra/git-ops/overlays/{dev,test,prod}/config/`). Missing it
  means the service starts and fails at runtime in whichever environment was missed — and
  the MR itself looks perfect.
- **Tracing and logging.** `DEPLOYMENT_NAME` must equal the container name; a service that
  disagrees appears as an orphaned root in every trace while each individual log line still
  looks correct. Also: swallowed failures, lost context, PII or secrets in log lines, a job
  that reports success after a partial run.
- **Errors.** Does the failure path leave the system in a state someone can recover from?
- **Compatibility and ordering.** Is this safe to merge alone? Inert until something else
  lands? Does it need a deploy in a particular order? This is often the most valuable thing a
  reviewer contributes.
- **Tests.** See below — this one has a rule attached.
- **Docs.** Is anything in `docs/` now stale because of this change? A deviation from a
  documented design is a finding even when the code is good.

### Unit tests for new logic — expected, but never for coverage's sake

**New or changed logic should come with tests, and missing coverage is a legitimate finding.**
Check it deliberately for every behavioural change: the branch that was added, the condition
that was inverted, the mapping that was introduced, the error path that was handled.

The bar is a test that **would fail if the logic were wrong**:

- Does it assert the behaviour, or only that the function ran without throwing?
- Are the meaningful inputs covered — empty, partial, boundary, failure — or only the happy
  one the author had in mind?
- Is the thing under test actually exercised, or mocked so thoroughly that the assertion
  proves the mock works?

A test that passes either way is worse than no test: it reports safety that is not there.
Raise that as a finding in its own right, separately from missing coverage.

**Then the counterweight, which matters as much: never push for a test that cannot be
meaningful.** Thin wiring and DI modules, pure framework glue, a query whose behaviour lives
in the database, an integration boundary where every collaborator would have to be mocked
into fiction — for those the honest answer is that the behaviour belongs in an integration
test or is covered by the pipeline.

- **Do not ask for a test to raise coverage.** Maintain or improve coverage; there is no
  target percentage ([`code-style.md`](../../rules/code-style.md)).
- **Do not ask for a test you cannot describe.** If you cannot say which behaviour it asserts
  and what would break it, the test does not exist yet — drop the finding.
- When coverage is missing but a unit test would be fiction, say exactly that and name where
  the behaviour *is* verified. That is a useful review note, not a gap.
- Accept "this can't be tested sensibly because …" when the reasoning holds. Judge the
  argument, not the coverage delta.

### Explicitly not review material

- **Formatting, lint, import order, style-only preferences — skip entirely.** Not raised, not
  mentioned, not "while you're here". [`code-style.md`](../../rules/code-style.md) settles
  this: they are never a gate.
- **Local typecheck, tests and builds — do not run them.** The pipeline already did. Read it
  instead: `gitlab_get_pipelines { project_id, ref: <source_branch> }`, then
  `gitlab_get_pipeline_jobs` and `gitlab_get_job_log` for a failure. A red pipeline is worth
  one line in the summary; it is not a review comment, unless the failure reveals something
  the code review missed.

### Out-of-scope findings stay

You will find things unrelated to this task: a latent bug next door, a missing index, a
swallowed error two functions up. **Record every one.** Mark it `Out-of-scope` so the author
can route it to its own ticket instead of expanding this MR — but never delete it for
tidiness. A finding lost here is a finding nobody makes again.

---

## Step 7: Verify the previous turn (follow-up reviews only)

For each open item in your Step 2 ledger, look at the current code and classify it:

- **Addressed** — the code changed and the concern is genuinely gone. Say how you checked.
- **Partially addressed** — one call site fixed, another missed; the symptom handled but not
  the cause.
- **Not addressed** — no relevant change.
- **Answered, not changed** — the author explained why it is fine. Judge the explanation on
  its merits and say whether you accept it. Accepting is a normal outcome.

**A reply is not a fix.** Verify against the code every time, never against the thread.

Two tooling limits to work within: the MCP tools **cannot reply inside an existing discussion
thread and cannot resolve one**. A follow-up goes out as a new note that names the thread it
continues ("re: the null-check on line 42 …"), and **resolving threads stays the operator's
job in the UI** — hand them the list of threads that are ready.

---

## Step 8: Draft every finding and get approval item by item

Nothing reaches GitLab before this step completes.

### How a comment should read

Reveal the issue and argue why it is one. That is the whole job.

```txt
**<The finding, one line.>**

<1–3 sentences: what happens, under which conditions, and what the consequence is.>

<The reference, when one exists: the doc or rule that says otherwise, or the other
service or call site that depends on this.>
```

**Always:**

- Lead with the problem, not a preamble.
- Name the condition that triggers it. "Breaks on an empty array" is actionable; "this looks
  fragile" is not.
- Cite the document by path and section when a written rule is at stake —
  `docs/architecture/api-contracts.md § Error envelope`. It turns your opinion into the team's.
- Name the other side when the finding is about a contract: which service, which file.

**Never:**

- **Write the fix as a code snippet.** The author knows their codebase better than you do; a
  patch invites a debate about the patch instead of the problem.
- Pad with hedging, apology, or a restatement of what the code obviously does.
- Bundle unrelated findings into one comment — one concern per comment, so each can be
  resolved on its own.
- Ask a question you could have answered by reading the code.

Severity, one per finding:

| Label | Meaning |
| --- | --- |
| **Blocker** | Wrong behaviour, data loss, broken contract, security hole. Must change before merge. |
| **Major** | Real problem with real consequences, but not stop-the-line. |
| **Minor** | Worth fixing; the author may reasonably decline. |
| **Question** | You could not determine intent from the code and the docs. Genuinely a question. |
| **Out-of-scope** | Valid, unrelated to this task. Belongs in its own ticket. |

### The approval gate

Present **all** findings in one place: a summary table, then the full verbatim body of each
comment exactly as it would be posted.

```md
## Findings — <repo> !<iid>  (<n> to post)

| # | Severity | Target | Finding |
|---|---|---|---|
| 1 | Blocker | src/products/products.service.ts:88 | Owner lookup drops the trace id |
| 2 | Out-of-scope | src/common/http.ts:24 | Retry swallows the 4xx body |

### 1 — Blocker — `src/products/products.service.ts:88` (line comment)
<the exact comment body>

### 2 — Out-of-scope — general comment
<the exact comment body>
```

For each, state the target: a `file:line` line comment, or a general comment. Then ask:

> **Approve each finding before I post it.** For every number: post as-is, post with an edit,
> or drop. Reply with the numbers you approve (or `all`), and say what to change on any you
> want reworded.

Rules for this gate:

- **Per-item consent.** A vague "looks fine" is not approval — ask again for the numbers.
  `all` is acceptable, because it is explicit.
- **Dropped means dropped.** Do not re-suggest it later in the session.
- If an edit is requested, show the revised body and re-confirm that one item.

---

## Step 9: Post the approved comments

- **Line comment** — `gitlab_post_line_comment { project_id, mr_iid, body, file_path,
  line_number, line_type }`. `line_type: "new"` for an added line, `"old"` for a removed one.
- **General comment** — `gitlab_post_comment { project_id, mr_iid, body }`.

A line comment anchors to the current diff, so it only works on a line that is part of that
diff. A finding in an untouched file — or on an unchanged context line inside a hunk — will be
rejected. When that happens, **do not retry with a nearby line**: post it as a general comment
that names `file:line` in the text. Same information, right place.

Post one at a time, check each response, and report what landed with its note ID or URL. If
one fails, say so and stop rather than pressing on.

Offer, do not assume, a short wrap-up comment when several findings went out. Some authors
want it; posting it uninvited adds noise.

---

## Step 10: Route the out-of-scope findings so they survive

For every `Out-of-scope` finding, and anything the author declines to fix here, agree where
it goes:

- **A ticket** — `jira_issue_create`, following the conventions in the
  [`debug-and-report`](../debug-and-report/SKILL.md) skill: summary prefixed with the service
  name, description carrying the evidence and acceptance criteria. **Never create a ticket
  without confirmation** — draft it, show it, wait.
- **The author's call** — often the right answer. The comment is posted; they raise the
  ticket. Note which findings are theirs to route.
- **Consciously dropped** — fine, as long as it is a decision. Record it in your closing
  summary so it was seen and let go, rather than lost.

---

## Step 11: Iterate across turns

Review is a loop: comment → fix → verify. When the author pushes, start again at Step 2 —
re-fetch the MR (the diff and the discussions have both moved), re-fetch and fast-forward the
branch, then work Step 7 before anything else.

Carry the ledger across turns and keep it honest: every finding, its severity, its current
state, and whether it was accepted, fixed, deferred to a ticket, or dropped. That ledger is
what makes the closing summary trustworthy.

---

## Step 12: Close out — verify first, then ask about approving

Once every finding is addressed or consciously settled, report:

- **What was verified, and how** — per finding, one line.
- **What is still open** — deferred items with their ticket keys, and anything you accepted
  the author's reasoning on.
- **Pipeline state** — from GitLab, and say which pipeline you read. Never from a local run.
- **Threads ready to resolve** — you cannot resolve them; hand the operator the list.

Then ask, on its own:

> All findings are addressed and verified. Approve the MR?

Only on an explicit yes, call `gitlab_approve_mr { project_id, mr_iid }`. Approval is shared
state and it is what lets the change ship: never batched with another confirmation, never
inferred from "thanks, looks good", and never given while a **Blocker** is open. If the
operator wants to approve with a blocker outstanding, say plainly what remains and let them
decide.

---

## Never

- Post a comment, create a ticket, or approve an MR without explicit approval for that
  specific action.
- Commit, push, rebase or otherwise modify the branch under review, or throw away the
  operator's local work to check it out.
- Run typecheck, tests, builds or installs locally for the review — read the pipeline.
- Raise a formatting, lint or style-only point.
- Ask for a unit test that only moves a coverage number, or one whose assertion you cannot
  state.
- Re-raise something already in the discussion thread, or a finding the operator dropped.
- Drop a valid finding for being out of scope.
- Review a `closed`/`merged` MR without pausing for the operator's reason first.
- Enforce our standards in a repo we do not own.
