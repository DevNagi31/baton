# baton

A coordinator that lets Claude Code, Cursor agent, and OpenAI Codex CLI work
together on a single task instead of three separate ones. You give one prompt;
baton routes subtasks to the agent best suited for each, hands off context
between sessions via a local semantic-memory MCP server, and produces a
single cohesive result.

> Working name. May be renamed before v0.1 if `baton` is taken on npm.

---

## The problem

If you use multiple AI coding CLIs (Claude Code, Cursor agent, Codex CLI)
today, you have three separate sessions, three separate context windows, and
you re-explain your task every time you switch. There is no shared memory and
no handoff. Each tool is excellent in isolation; they cannot collaborate.

Existing orchestrators solve a *different* problem — they run many instances
of the same agent in parallel, each in its own git worktree (Composio Agent
Orchestrator, Hive, Claude Squad, Worktrunk). That is parallelism, not
collaboration. baton is about collaboration: one task, multiple agents,
sequential handoff with semantic memory shared across all of them.

## How baton is different from what already exists

| Tool                            | Pattern                          | Vendors      |
| ------------------------------- | -------------------------------- | ------------ |
| Composio Agent Orchestrator     | Parallel, isolated worktrees     | Single       |
| Anthropic Agent Teams           | Parallel, in-process             | Claude only  |
| Hive / Claude Squad / Worktrunk | Worktree managers                | Single       |
| ruflo                           | Multi-vendor, parallel-leaning   | Claude+Codex |
| AutoGen / CrewAI / LangGraph    | Multi-agent frameworks           | API-level    |
| Mem0 / Letta / Zep              | Memory layers                    | API-level, no orchestration |
| **baton**                       | **Sequential, semantic memory across all 3 CLIs** | **Claude + Cursor + Codex** |

The unique combination: **multi-vendor sequential orchestration plus
semantic memory exposed via MCP, so the memory works whether you invoke
through baton or directly through any MCP-aware client.**

## Architecture

```
            ┌──────────────────────────┐
            │   user prompt (single)   │
            └────────────┬─────────────┘
                         │
                         ▼
            ┌──────────────────────────┐
            │       Coordinator        │
            │ - decomposes task        │
            │ - routes by capability   │
            │ - handles handoffs       │
            └────────────┬─────────────┘
                         │
        ┌────────────────┼────────────────┐
        ▼                ▼                ▼
  ┌───────────┐    ┌───────────┐    ┌───────────┐
  │  Claude   │    │  Cursor   │    │  Codex    │
  │  driver   │    │  driver   │    │  driver   │
  └─────┬─────┘    └─────┬─────┘    └─────┬─────┘
        │                │                │
        │   each agent reads/writes via   │
        │   the shared memory MCP server  │
        ▼                ▼                ▼
            ┌──────────────────────────┐
            │   baton-memory MCP       │
            │   (sqlite + embeddings)  │
            └──────────────────────────┘
```

### Components

- **Coordinator**: a Node process that owns the master plan. It calls
  drivers in sequence, watches for completion, and updates the memory store
  after each step.
- **Drivers**: per-CLI shims that know how to spawn that CLI in non-
  interactive mode, inject context, detect when it's done, and capture its
  output. One driver per agent: Claude, Cursor, Codex.
- **baton-memory MCP server**: a local MCP server backed by sqlite + local
  embeddings (transformers.js, all-MiniLM-L6-v2). Exposes `add_memory`,
  `search_memory`, and `list_memories` as tools. Each agent connects to it
  natively via the standard MCP protocol — no per-vendor config glue.
- **CLI**: `baton init`, `baton run "<task>"`, `baton mcp` (run the memory
  server standalone).

### Why sequential, not parallel

Parallel orchestration only makes sense when subtasks are independent. For
collaborative tasks (plan → scaffold → implement → test → review), the steps
are inherently ordered. Parallel orchestrators paper over this by sharding by
file; baton handles it by sharding by stage.

### Why MCP for memory

Two reasons:
1. All three target CLIs already speak MCP natively. No need to write
   vendor-specific context files (`CLAUDE.md`, `AGENTS.md`, `.cursorrules`).
2. The memory server is independently useful. Even users who don't run baton
   can connect their Claude Code or Cursor session to `baton-memory` and get
   persistent semantic memory across sessions. The orchestrator and the
   memory layer are deliberately decoupled.

## Routing strategy

This is the part nobody else has done well. Most orchestrators route by
vibes ("Cursor is best for frontend"). baton starts with a small explicit
rule set, then collects telemetry to refine it empirically.

### v0 routing rules (placeholder, will be empirically refined)

| Stage                    | Default agent | Reason                                       |
| ------------------------ | ------------- | -------------------------------------------- |
| Planning / decomposition | Claude        | Strong long-context reasoning                |
| Implementation           | Codex         | Tight non-interactive workflow, good at scoped edits |
| Inline edits / refactors | Cursor        | IDE-anchored, fast small edits               |
| Code review              | Claude        | Long context, good at finding bugs           |

These will be replaced with empirical routing once benchmarking is in place.

## What works right now (Phase 1 shipped)

- `baton init` — scaffolds a `.baton/` directory with config and context
- `baton run "<task>"` — invokes Claude Code via `claude -p` with the task
  plus accumulated shared context, captures the working-tree diff via git,
  logs results, updates the context store
- `--unattended` flag — passes `--permission-mode bypassPermissions` for
  non-interactive runs
- 11 tests passing across config validation, git diff capture, and the
  context store

The current "shared context" is a markdown file. Phase 2 replaces it with
the MCP memory server while preserving the existing CLI surface.

## Costs and access requirements

baton itself is free and runs entirely locally. The CLIs it drives have
their own access requirements:

| CLI           | Access required                | What baton does                       |
| ------------- | ------------------------------ | ------------------------------------- |
| Claude Code   | Claude Pro or API key          | Spawns `claude -p` non-interactively  |
| Cursor agent  | Free tier works (capped)       | Spawns `agent` non-interactively      |
| Codex CLI     | ChatGPT Plus / Pro or OpenAI API | Spawns `codex exec` non-interactively |

**You can run baton with whatever subset of the three CLIs you have access
to.** The Codex driver is implemented and tested but its end-to-end
integration test is gated behind an `OPENAI_API_KEY` environment variable in
CI — if you don't have one, the unit tests still run.

The memory layer is fully free: sqlite for storage, transformers.js with
all-MiniLM-L6-v2 for embeddings (~22MB, runs locally, no API calls).

## Phases

See [ROADMAP.md](./ROADMAP.md) for full detail. Summary:

- **Phase 1 — Foundation** ✅ shipped: ClaudeDriver, single-agent run flow,
  shared markdown context, working tree diff capture, tests.
- **Phase 2 — Memory + multi-agent**: split into 2a (CodexDriver), 2b
  (memory MCP server with sqlite + transformers.js), 2c (drivers connect to
  the memory server, markdown context retired).
- **Phase 3 — Cursor**: CursorDriver. The unknown unknowns live here.
- **Phase 4 — Empirical routing**: telemetry, benchmark suite, learned
  routing weights, public benchmark dataset.
- **Phase 5 — Polish**: docs, examples, blog post, npm publish.

## Hard problems we already know about

These are the engineering walls. Solving them is most of the work.

1. **Detecting "done"**. Each CLI has its own session lifecycle. Phase 1
   uses non-interactive mode (each invocation exits when the task is
   complete) so this is solved for now. The interactive-session version of
   the problem stays open.
2. **Output extraction**. Stdout is noisy. The actual *result* of a session
   is the modified files, not the chatter. baton diffs the working tree
   before/after each agent runs.
3. **Cost control**. Running three frontier models on every task triples
   token spend. Routing must be cheap; the coordinator itself shouldn't call
   an LLM for routing decisions in v1 (use rules, not LLM judgement).
4. **Memory schema design**. What gets stored? Raw step transcripts? Just
   summaries? Per-task vs. per-project memory? The schema we ship in 2b is
   the one that has to age well.
5. **MCP protocol surface**. The MCP TypeScript SDK is solid but the
   semantic memory tool design (what calls each agent will actually make) is
   open and shapes the whole project.

## Tech stack

- **TypeScript + Node 22** — npm publishable, single language across the
  whole stack
- **execa** — subprocess management
- **commander** — CLI parsing
- **zod** — config validation
- **better-sqlite3** — synchronous sqlite, fast, no ORM
- **@xenova/transformers** (transformers.js) — local embeddings, no
  external API
- **@modelcontextprotocol/sdk** — official MCP TypeScript SDK
- **No external LLM dependency in the coordinator** — routing uses rules,
  not an LLM, to keep baton itself cheap and deterministic

## Future / nice-to-haves

- A2A protocol adapter — wrap each driver to expose Agent2Agent endpoints so
  baton can be driven by other A2A-speaking orchestrators (and vice versa).
  Once a critical mass of CLIs speak A2A, baton's drivers can be replaced
  with native protocol calls.
- Web dashboard — visualize the plan, current step, agent in flight,
  memory store contents.
- Empirical benchmark — run the same task across all three agents in
  parallel, measure quality (tests pass? diff size? human rating?), publish
  the data. The dataset itself is more interesting than the orchestrator.

## Out of scope

- Worktree management (Hive, Worktrunk already do this well; integrate,
  don't rebuild).
- Running agents in parallel (Composio Agent Orchestrator already does this).
- Replacing Claude Code's Agent Teams (use it; don't compete).
- Personal-style fine-tuning, continual learning — different project,
  different stack, different goals.

## Status

Phase 1 shipped — single-agent flow works end-to-end with Claude Code.
Phase 2 (memory + Codex) starts next.

## License

MIT.
