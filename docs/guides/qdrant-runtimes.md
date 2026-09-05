# Running Qdrant — Choosing a Container Runtime

`docs_search` needs a Qdrant instance. This workspace does not care how you get
one, and deliberately supports several runtimes: which one you can use is
decided by your OS, your employer's licensing position, and preference — none of
which a documentation-search feature should have an opinion about.

Set your choice once in `.env`:

```env
QDRANT_ENGINE='docker'   # docker | podman | nerdctl | wslc | container | external
```

Everything else is engine-agnostic:

```bash
cd mcp
yarn qdrant up       # create + start (pulls the image on first use)
yarn qdrant start    # start an existing, stopped container
yarn qdrant stop     # stop, keeping the bind-mounted volume
yarn qdrant rm       # remove the container (the volume survives)
yarn qdrant logs     # the container's own logs
yarn qdrant status   # engine, container state, endpoint health
```

Normal operation needs none of these — the MCP server starts Qdrant on startup.

---

## Which one should we use?

| Runtime | `QDRANT_ENGINE` | Platform | Choose it when |
|---|---|---|---|
| **Docker Desktop / Engine** | `docker` | all | The default. Already installed, and the team has a licence (or is small enough not to need one). |
| **Podman** | `podman` | all | Docker Desktop is not licensed for your org. Daemonless and rootless. |
| **Colima / Rancher Desktop / Lima** | `docker` or `nerdctl` | macOS, Linux | You want a free Docker Desktop replacement that still provides the `docker` CLI. Use `nerdctl` if you drive containerd directly. |
| **WSL containers** | `wslc` | Windows | Windows without Docker Desktop. Built into WSL ≥ 2.9.3, no extra install, no licence question. |
| **Apple `container`** | `container` | macOS 26+ (Apple silicon) | You want Apple's native tool with no third-party VM. |
| **Anything else / shared** | `external` | all | Qdrant runs as a bare binary, in a VM you manage, or as a shared remote instance. The workspace never tries to start or stop it. |

The rest of this page is the setup detail for each.

---

## Docker Desktop / Docker Engine

The default, and the least surprising choice if it is already on the machine.

```env
QDRANT_ENGINE='docker'
```

Nothing to install beyond Docker itself. Start Docker Desktop (or ensure
`dockerd` is running) and the MCP server does the rest.

> **Licensing.** Docker Desktop requires a paid subscription for larger
> organisations. Docker *Engine* on Linux is free and unaffected. If your
> employer has not bought Desktop licences, use Podman, Colima, Rancher Desktop,
> or `wslc` — all of which work with this workspace unchanged.

> **A macOS gotcha worth knowing.** Docker Desktop's credential helper can hang
> on the first pull, with `docker run` sitting silently for minutes. It looks
> like a slow download; it is not. `pkill -f docker-credential-desktop` clears
> it and the pull proceeds.

---

## Podman

Daemonless and rootless — often the straightforward answer when Docker Desktop
is off the table.

```bash
# macOS
brew install podman && podman machine init && podman machine start
# Linux
sudo apt install podman        # or dnf/pacman equivalent
```

```env
QDRANT_ENGINE='podman'
```

Two behaviours to know:

- **Rootless port binding.** Ports below 1024 need extra configuration. Qdrant
  uses 6333/6334, so this does not affect us — but it is why a rootless runtime
  is fine here and awkward for something on port 80.
- **SELinux volume labels.** On RHEL/Fedora a bind mount may need a `:z` suffix.
  If Qdrant starts but cannot write to storage, that is the cause.

Podman also ships `podman-docker`, which provides a `docker` shim. If you use
that, either engine value works — prefer `podman` so logs say what is really
running.

---

## Colima / Rancher Desktop / Lima (macOS, Linux)

These provide a Linux VM plus a `docker`-compatible CLI, so keep
`QDRANT_ENGINE='docker'`:

```bash
brew install colima docker && colima start
```

If you drive containerd directly instead (Rancher Desktop's default), use
`QDRANT_ENGINE='nerdctl'`.

> **Bind mounts need the VM to see the path.** These runtimes mount only certain
> host directories into their VM by default. If the workspace lives outside the
> shared set, `mcp/.qdrant-storage/` will silently be a directory *inside the
> VM* rather than in your repo — the index still works, but it disappears when
> the VM is reset. `colima start --mount $HOME:w` (or Rancher Desktop's
> Preferences → Virtual Machine → Volumes) fixes it.

---

## Windows: WSL containers (`wslc`)

WSL ≥ 2.9.3 includes a container engine. No Docker Desktop, no Ubuntu shell, no
licensing question.

One-time setup, from an **elevated PowerShell**:

```powershell
wsl --update --pre-release   # the build that includes the container engine
wsl --shutdown               # restart WSL so it takes effect
wslc version                 # verify in a NEW terminal
```

```env
QDRANT_ENGINE='wslc'
```

Two Windows-specific notes:

- **Bind mounts use a relative path here**, unlike every other engine. The path
  is resolved inside WSL, and passing a Windows absolute path produces a mount
  that appears to work and silently stores nothing useful. The workspace handles
  this for you — it is documented because it is surprising if you run the
  commands by hand.
- **Port forwarding resets keep-alive sockets.** WSL forwards the container's
  ports to the Windows host, so `127.0.0.1:6333` works — but a long ingest can
  see a bare `fetch failed` mid-stream. Every Qdrant call retries transient
  errors specifically for this.

> **The stale-directory leak.** On a Windows-bind-mounted volume, Qdrant can
> delete a collection at the API level while leaving its directory on disk —
> the filesystem bridge refuses to unlink memory-mapped segment files. The
> orphan sweeper enumerates via the API, so it cannot see these. Correctness is
> unaffected; the cost is disk. `yarn docs:reset --yes` clears them.

---

## macOS 26+: Apple `container`

Apple's native container tool runs each container in its own lightweight VM. No
third-party runtime, no daemon to license.

```bash
container system start
```

```env
QDRANT_ENGINE='container'
```

Requires Apple silicon and a recent macOS. It is the newest option here — if
something behaves unexpectedly, `QDRANT_ENGINE='docker'` or `'podman'` are the
better-trodden paths, and the workspace works identically with either.

---

## `external` — Qdrant managed elsewhere

Use this when the workspace must **not** manage the lifecycle:

- a shared team instance (see [Scaling the index](../architecture/docs-rag.md#scaling-when-to-move-the-index-off-developer-machines));
- Qdrant as a bare binary or a system service;
- a VM or remote host you administer yourself.

```env
QDRANT_ENGINE='external'
QDRANT_URL='http://qdrant.internal:6333'
```

In this mode nothing is started or stopped, and an unreachable endpoint is
reported as a clear error rather than something a laptop tries to repair —
which is the correct behaviour when the instance is shared. `yarn qdrant status`
still works and reports reachability.

---

## Running Qdrant without any container

Qdrant ships prebuilt binaries and can run directly:

```bash
./qdrant --config-path config/config.yaml
```

Set `QDRANT_ENGINE='external'` so the workspace leaves it alone. This is a
reasonable choice on a locked-down machine where no container runtime is
permitted, and it changes nothing else — the index, the pipeline and the tools
are identical.

---

## Verifying, whichever you chose

```bash
cd mcp
yarn qdrant status     # engine, container state, endpoint reachability
yarn docs:health       # the index itself: alias, points, BM25, freshness, orphans
```

If `qdrant status` says reachable and `docs:health` is green, the runtime choice
is behind you — nothing downstream depends on it.

## Resource cost

Qdrant is small at documentation scale: roughly 100–150 MB RSS and ~0% CPU when
idle. The notable CPU is HNSW construction during an ingest, which is brief at a
few thousand chunks.

VM-backed runtimes (Colima, Rancher Desktop, Apple `container`, WSL) add their
own baseline on top — typically a few hundred MB for the VM itself. If a machine
is genuinely constrained, the honest answer is not a different runtime but
`DOCS_SEARCH_ENABLED=false`: `docs_map` keeps working at zero cost, with no
container at all.
