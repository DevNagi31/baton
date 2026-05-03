# baton

A coordinator that lets Claude Code, Cursor agent, and OpenAI Codex CLI work
together on a single task instead of three separate ones. You give one prompt;
baton routes subtasks to the agent best suited for each, hands off context
between sessions via a local semantic-memory MCP server, and produces a
single cohesive result.

> Working name. May be renamed before v0.1 if `baton` is taken on npm.

---

## Quickstart

```bash
# Install
git clone https://github.com/DevNagi31/baton
cd baton
npm install
npm run build

# Initialize a baton workspace inside a git repo
cd /path/to/your/repo
node /path/to/baton/dist/cli/index.js init

# Run a task with whichever CLI you have access to
node /path/to/baton/dist/cli/index.js run \
  "Add a /health endpoint to the express app" \
  --agent claude --unattended

# Or run a benchmark across multiple agents
node /path/to/baton/dist/cli/index.js bench \
  --spec /path/to/baton/examples/bench-mini.json \
  --agents claude,cursor --unattended
```

The `--unattended` flag passes through `bypassPermissions` (claude),
`workspace-write` sandbox bypass (codex), or `--force` (cursor) so the
underlying CLI doesn't sit on a permission prompt. Use it carefully:
it's the equivalent of telling the agent "you have full edit power."

baton can also run as a standalone MCP server for direct client connections
without the orchestrator:

```bash
node /path/to/baton/dist/cli/index.js mcp --baton-dir /path/to/.baton
```

Wire that command into your Claude Code or Cursor MCP config to share
semantic memory across sessions even outside `baton run`.

### Cross-cwd / cross-session resume

Claude Code and Cursor scope conversation resume to the working directory
you started in. Open a session somewhere else and you can't pick it up.
baton closes that gap with three commands you can call from anywhere:

```bash
# Save a checkpoint at any time. Tags and project are optional.
baton remember "decided to use sqlite over pgvector for the memory layer" \
  --tags decision,architecture --project baton

# Browse what you've saved. With a query, ranks by semantic similarity.
baton recall "what database does this project use"

# Build a primer of recent activity, ready to paste into a fresh session.
baton continue --from baton

# Or pipe directly into a new Claude Code session pre-loaded with the primer:
baton continue --from baton | xargs -0 -I {} claude --append-system-prompt {}
```

Memory is keyed by project (default: basename of the cwd), so `baton recall
--project foo` works from any directory. The same `memory.db` is consulted.

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

## What works right now

Phases 1–4 are shipped. The full pipeline runs end-to-end:

- `baton init` — scaffold a `.baton/` directory with config, context, and
  memory.db
- `baton run "<task>" [--agent claude|codex|cursor] [--unattended]` —
  recall relevant prior memories, dispatch to the chosen agent, capture
  the working-tree diff via git, persist the step as a memory
- `baton mcp` — run the memory MCP server on stdio so any MCP-aware
  client (Claude Code, Cursor, Codex) can read/write the same memory
- `baton bench --spec <path> --agents claude,cursor [--unattended]` —
  run a benchmark spec across multiple agents, capture pass rate, mean
  duration, and mean files-changed per agent into JSONL

50 tests, 48 passing locally; 2 gated on credentials (OPENAI_API_KEY for
the Codex live test, CURSOR_AGENT_LIVE=1 for the Cursor live test).

### Verified live cross-vendor handoff

Run 1: `baton run --agent claude "Create shared.txt with: alpha-from-claude"`
→ Claude creates the file. Step persisted to memory.

Run 2: `baton run --agent cursor "Append: beta-from-cursor to shared.txt
(the file the previous agent created)"`
→ Cursor recalls the prior memory, identifies the file, appends cleanly.

Final `shared.txt`:
```
alpha-from-claude
beta-from-cursor
```

Two different vendors. One shared brain. No restated context.

### First real benchmark numbers

`examples/bench-mini.json` on Claude + Cursor:

| Agent  | Pass rate | Mean duration | Mean files changed |
| ------ | --------- | ------------- | ------------------ |
| claude | 2/2 (100%) | 11.7s        | 1.0                |
| cursor | 2/2 (100%) | 8.8s         | 1.0                |

Both agents pass; Cursor is ~25% faster on these "create file" tasks.
A bigger spec will give a meaningful per-category breakdown for the
empirical routing work.

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
- **Phase 2 — Memory + multi-agent** ✅ shipped: CodexDriver, semantic
  memory MCP server (sqlite + transformers.js), drivers run through memory.
- **Phase 3 — Cursor** ✅ shipped: CursorDriver, three-CLI orchestration
  thesis verified end-to-end with cross-vendor handoff.
- **Phase 4 — Empirical routing** ✅ shipped: `baton bench`, evaluators,
  per-agent telemetry, JSONL output. Routing-weight derivation deferred
  until a larger benchmark exists.
- **Phase 5 — Polish** in progress: install instructions, examples, CI,
  blog post, npm publish.

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
