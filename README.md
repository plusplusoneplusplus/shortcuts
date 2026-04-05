<p align="center">
  <img src="packages/coc/assets/icons/coc-icon-256x256.png" alt="CoC Logo" width="128" />
</p>

<h1 align="center">CoC (Copilot of Copilot)</h1>

<p align="center">
  A cockpit built for AI — asynchronous multi-tasking, task orchestration, and collaborative code review for AI-assisted engineering.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@plusplusoneplusplus/coc"><img src="https://img.shields.io/npm/v/@plusplusoneplusplus/coc.svg" alt="npm version" /></a>
  <a href="https://www.npmjs.com/package/@plusplusoneplusplus/forge"><img src="https://img.shields.io/npm/v/@plusplusoneplusplus/forge.svg?label=forge" alt="forge version" /></a>
  <a href="https://www.npmjs.com/package/@plusplusoneplusplus/deep-wiki"><img src="https://img.shields.io/npm/v/@plusplusoneplusplus/deep-wiki.svg?label=deep-wiki" alt="deep-wiki version" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License" /></a>
</p>

---

## Why CoC?

Traditional AI coding interfaces trap you in a linear, back-and-forth loop — one conversation, one thread, one task at a time. CoC throws that model out and is built around **true asynchronous multi-tasking** that matches how engineers actually think and work.

> Read the full story: [From Cursor to Claude Code to CoC](https://plusplusoneplusplus.github.io/website/from-cursor-to-claude-code-to-coc.html)

The only truly limited resource in software engineering is **human attention**. CoC is designed around three principles:

- **Minimize context switching** — structured task queues and compact per-task summaries so switching tasks feels like glancing at a dashboard, not excavating a conversation thread.
- **Alignment through code review, not chat** — instead of reading long chat logs, the AI submits proposals as Git diffs or Markdown specs, and you review them with inline comments, just like a standard code review.
- **Maximize execution time** — separate the "thinking" from the "doing." Queue up plans during working hours, hand them off to the AI to execute asynchronously, and come back to results ready for review.

## Key Features

### Task Orchestration & Queues

Tasks run in Ask or Plan mode (read-only) or Autopilot and Script mode (read-write). Read-only tasks run in parallel with configurable concurrency; read-write tasks run sequentially to prevent conflicts. Queue up a batch of work, step away, and come back to results.

<p align="center">
  <img src="https://plusplusoneplusplus.github.io/website/assets/coc/coc-001.png" alt="Task dashboard" width="700" />
  <br/>
  <em>Task dashboard with running and queued tasks, each in its own isolated conversation.</em>
</p>

### Asynchronous Alignment

The AI submits proposals as Git diffs or Markdown specs; you review them with inline comments. A single "Resolve All with AI" button batches all comments and sends them back in one shot — one focused review replaces a dozen interruptions.

<p align="center">
  <img src="https://plusplusoneplusplus.github.io/website/assets/coc/coc-002.png" alt="Spec review" width="700" />
  <br/>
  <em>Spec review with root cause analysis and proposed fix, reviewed via inline comments.</em>
</p>

<p align="center">
  <img src="https://plusplusoneplusplus.github.io/website/assets/coc/coc-005.png" alt="Diff review" width="700" />
  <br/>
  <em>Diff review with inline comment thread for asynchronous code feedback.</em>
</p>

### Scheduling

Jobs can trigger on a recurring schedule — nightly, weekly, or at any specific time — enabling automated code health checks, periodic syncs, or any recurring workflow.

<p align="center">
  <img src="https://plusplusoneplusplus.github.io/website/assets/coc/coc-004.png" alt="Schedules view" width="700" />
  <br/>
  <em>Schedules view with recurring jobs configured to run automatically.</em>
</p>

### Skills as a First-Class Feature

Skills are natively supported by the copilot-sdk. The platform handles orchestration, context, and execution; skills define what the AI knows how to do. As your skill library grows across projects, so does the AI's capability.

<p align="center">
  <img src="https://plusplusoneplusplus.github.io/website/assets/coc/coc-006.png" alt="Agent Skills" width="700" />
  <br/>
  <em>Agent Skills management, showing global and repo-scoped skills available across projects.</em>
</p>

### Multi-Repository Support

Multiple repositories and multiple clones of a single remote — without Git worktrees. Everything stays on the main branch with fixes committed as fixups.

### Decoupled Architecture

Zero dependency on an editor. CoC runs as a standalone server with a mobile-responsive dashboard. Monitor queues, review diffs, and orchestrate agents from anywhere.

## Prerequisites & Setup

### Requirements

- **Node.js ≥ 24** — [download](https://nodejs.org/)
- **GitHub Copilot subscription** — [sign up](https://github.com/features/copilot)

### How it works

CoC uses `@github/copilot-sdk` (which wraps the `@github/copilot` CLI package)
for all AI features. When you `npm install -g @plusplusoneplusplus/coc`, the SDK
and CLI are pulled as transitive npm dependencies — no separate binary install is
needed.

### Quick setup

1. Install CoC:
   ```bash
   npm install -g @plusplusoneplusplus/coc
   ```

2. Authenticate with the Copilot CLI:
   ```bash
   copilot        # launches the Copilot CLI REPL
   /login         # type this inside the REPL, then follow the prompts
   ```

3. Start the dashboard:
   ```bash
   coc serve
   ```

**Configuration:** `~/.coc/config.yaml` — CLI flags override config file values.

> **Troubleshooting:** If you see exit code 3 ("AI unavailable"), run `copilot`
> and use `/login` to verify your authentication.

## Monorepo Packages

| Package | Description | npm |
|---------|-------------|-----|
| [`coc`](packages/coc/) | CLI + dashboard for YAML AI workflows | [`@plusplusoneplusplus/coc`](https://www.npmjs.com/package/@plusplusoneplusplus/coc) |
| [`forge`](packages/forge/) | Core AI engine: SDK wrapper, DAG workflow engine, task queue, process store, git CLI, utilities | [`@plusplusoneplusplus/forge`](https://www.npmjs.com/package/@plusplusoneplusplus/forge) |
| [`deep-wiki`](packages/deep-wiki/) | Auto-generates comprehensive wikis for any codebase | [`@plusplusoneplusplus/deep-wiki`](https://www.npmjs.com/package/@plusplusoneplusplus/deep-wiki) |

## Links

- [Blog: From Cursor to Claude Code to CoC](https://plusplusoneplusplus.github.io/website/from-cursor-to-claude-code-to-coc.html)
- [GitHub Repository](https://github.com/plusplusoneplusplus/shortcuts)
- [Report Issues](https://github.com/plusplusoneplusplus/shortcuts/issues)
- [MIT License](LICENSE)
