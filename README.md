# Trellis Visual Console

[简体中文](README_CN.md)

Trellis Visual Console is a local, read-only web console for browsing Trellis data across multiple projects on one computer.

It helps answer practical questions without opening every repository individually:

- Which local projects use Trellis?
- What specifications does each project contain?
- Which tasks are active or archived?
- What do a task's PRD, design, implementation plan, and research files say?
- Which workflow and phase does a project currently use?

The console is not a replacement for the Trellis CLI and does not edit a project's `.trellis/` directory.

## Highlights

- Recursively scan a user-selected directory for Trellis projects.
- Manually register an individual project.
- Browse project summaries, monorepo packages, Specs, Tasks, Workflow information, and diagnostics.
- Read Markdown and task planning artifacts with source-path traceability.
- Separate projects into `focus`, `history`, and `unavailable` states.
- Watch only focus projects and deliver invalidation events to the UI through SSE.
- Keep history projects lightweight by serving their last indexed snapshot without active watchers.
- Fall back to low-frequency polling when native file events are unavailable.
- Store the project registry and rebuildable snapshots outside the inspected repositories.
- Bind the service to `127.0.0.1` and enforce registered-project, allowlist, realpath, and Markdown safety boundaries.

## How it works

```text
Browser UI (React)
  ├─ HTTP: projects, Specs, Tasks, Workflow, diagnostics
  └─ SSE: project-level invalidation events
                  │
                  ▼
Local service (Fastify on 127.0.0.1)
  ├─ project scanner and validator
  ├─ Trellis content indexer
  ├─ local registry and snapshot storage
  └─ focus-project file watchers
                  │
                  ▼
       Registered local .trellis/ directories
```

The source project's `.trellis/` directory remains the only source of truth. The application writes only its own `registry.json` and `snapshots.json` files.

### Focus and history projects

- **Focus**: reindexed when focused, actively watched, and updated in the UI through SSE invalidation events.
- **History**: no active watcher; displays the last successful summary snapshot. A successful explicit refresh temporarily enables document reading for the current server process.
- **Unavailable**: the path is missing, inaccessible, or no longer has a valid Trellis structure; the previous record and snapshot are retained for diagnosis.

Scanning is always user-triggered. The selected scan root is not turned into a permanent watcher.

## Requirements

- Node.js 22.12 or newer
- pnpm 10 or newer

## Development

```bash
pnpm install
pnpm dev
```

Development mode starts:

- the local API server at `http://127.0.0.1:3100`
- the Vite UI at `http://127.0.0.1:5173`

The browser opens automatically. The Vite development server proxies API requests to the local service.

## Production build

```bash
pnpm build
pnpm start
```

In production mode, the Node.js service hosts the built web assets and opens its local address in the browser. The default health endpoint is:

```text
http://127.0.0.1:3100/api/health
```

To use another port:

```bash
PORT=3200 pnpm start
```

## Local application data

By default, application-owned data is stored at:

| Platform | Directory |
| --- | --- |
| macOS | `~/Library/Application Support/Trellis Visual Console` |
| Windows | `%APPDATA%/Trellis Visual Console` |
| Linux | `$XDG_CONFIG_HOME/trellis-visual-console` or `~/.config/trellis-visual-console` |

Override the directory when developing or running isolated checks:

```bash
TRELLIS_VISUAL_CONSOLE_DATA_DIR=/tmp/trellis-visual-console pnpm dev
```

Deleting this application data removes only the console's registry and cached summaries. It does not modify any registered Trellis project.

## Read-only and security boundaries

- The HTTP service listens only on `127.0.0.1`.
- The API addresses projects by registered ID instead of accepting arbitrary absolute paths.
- Document reads are restricted to indexed Trellis files and verified with realpath boundaries.
- Unsafe path traversal and symlink escapes are rejected.
- Rendered Markdown does not execute embedded HTML or scripts.
- The application exposes no API for editing files, changing task state, running agents, or executing commands.
- “Open externally” actions pass only validated project paths to the operating system.

## Project structure

```text
src/server/   local HTTP service, storage, scanning, indexing, and watchers
src/shared/   API schemas and shared contracts
src/web/      React console and read-only content views
docs/         product planning, technical design, and validation evidence
.trellis/     project workflow, specifications, tasks, and developer records
```

## Quality checks

```bash
pnpm lint
pnpm typecheck
pnpm build
git diff --check
```

The current MVP has completed macOS system validation. Windows and Linux have received platform-neutral path and implementation review, but native file events, permissions, external opening, and process signals have not yet been verified on real machines.

See the [Phase 6 validation report](docs/validation/phase-6-report.md) for scenarios, known coverage limits, fixes, and performance baselines.

## Project documentation

- [Product requirements](docs/planning/prd.md)
- [Technical design](docs/planning/design.md)
- [Implementation plan](docs/planning/implement.md)
- [First-principles analysis](docs/planning/fp-analysis.md)
- [Session handoff](docs/planning/session-handoff.md)
- [Phase 6 validation report](docs/validation/phase-6-report.md)

## Current scope

The MVP is intentionally local and read-only. It does not include:

- editing Specs, Tasks, or Workflow state
- team accounts, remote access, or cloud synchronization
- Channel, Worker, Mem, Workspace Journal, or runtime-operation panels
- an Electron or Tauri installer
- a required dependency on `@mindfoldhq/trellis-core`

The Core SDK may be evaluated later if reusing canonical Trellis validation or workflow semantics becomes more valuable than maintaining a small local adapter.
