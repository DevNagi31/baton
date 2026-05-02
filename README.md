# baton

A coordinator that lets Claude Code, Cursor agent, and OpenAI Codex CLI work
together on a single task instead of three separate ones. You give one prompt;
baton routes subtasks to the agent best suited for each, hands off context
between sessions, and produces a single cohesive result.

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
sequential handoff with shared context.

## How baton is different from what already exists

| Tool                           | Pattern                          | Vendors      |
| ------------------------------ | -------------------------------- | ------------ |
| Composio Agent Orchestrator    | Parallel, isolated worktrees     | Single       |
| Anthropic Agent Teams          | Parallel, in-process             | Claude only  |
| Hive / Claude Squad / Worktrunk | Worktree managers                | Single       |
| ruflo                          | Multi-vendor, parallel-leaning   | Claude+Codex |
| AutoGen / CrewAI / LangGraph   | Multi-agent frameworks           | API-level    |
| **baton**                      | **Sequential, shared context**   | **All three CLIs** |

## Architecture

```
            ┌──────────────────────────┐
            │   user prompt (single)   │
            └────────────┬─────────────┘
                         │
                         ▼
            ┌──────────────────────────┐
            │       Coordinator        │
            │ - parses task            │
            │ - decomposes into steps  │
            │ - routes by capability   │
            │ - watches for handoffs   │
            └────────────┬─────────────┘
                         │
        ┌────────────────┼────────────────┐
        ▼                ▼                ▼
  ┌───────────┐    ┌───────────┐    ┌───────────┐
  │  Claude   │    │  Cursor   │    │  Codex    │
  │  driver   │    │  driver   │    │  driver   │
  └─────┬─────┘    └─────┬─────┘    └─────┬─────┘
        │                │                │
        └────────────────┼────────────────┘
                         ▼
            ┌──────────────────────────┐
            │  Shared context store    │
            │  .baton/context.md       │
            │  .baton/log.jsonl        │
            └──────────────────────────┘
```

### Components

- **Coordinator**: a small Node process that owns the master plan and shared
  context. It calls drivers in sequence and updates context after each.
- **Drivers**: per-CLI shims that know how to spawn that CLI, inject context,
  detect when it's done, and capture its output. One driver per agent.
- **Shared context store**: a `.baton/` directory at the repo root containing
  the running plan, context, and a JSONL log of every step.
- **CLI**: the user-facing command. `baton run "build a /users API"`.

### Why sequential, not parallel

Parallel orchestration only makes sense when subtasks are independent. For
collaborative tasks (plan → scaffold → implement → test → review), the steps
are inherently ordered. Parallel orchestrators paper over this by sharding by
file; baton handles it by sharding by stage.

## Routing strategy

This is the part nobody else has done well. Most orchestrators route by
vibes ("Cursor is best for frontend"). baton starts with a small explicit
rule set, then collects telemetry to refine it empirically.

### v0 routing rules (placeholder, will be empirically refined)

| Stage                   | Default agent | Reason                                       |
| ----------------------- | ------------- | -------------------------------------------- |
| Planning / decomposition | Claude        | Strong long-context reasoning                |
| Inline edits / refactors | Cursor        | IDE-anchored, fast small edits               |
| Test generation         | Codex         | Strong on isolated function-level synthesis  |
| Code review             | Claude        | Long context, good at finding bugs           |

These will be replaced with empirical routing once benchmarking is in place.

## MVP scope (what gets built first)

The collaborative version is hard. To de-risk, MVP is intentionally narrow:

1. **Two agents only**: Claude Code + Codex CLI. Cursor comes later because
   it's the hardest to drive programmatically.
2. **One handoff pattern**: plan → implement. Claude makes the plan as a
   structured task list; Codex implements one task at a time.
3. **Manual handoff signal first**: user types `baton next` to advance.
   Automatic handoff detection comes later.
4. **No worktree management**: assume the user is on a clean branch.

If MVP works for one user (you) on one real project, then we expand.

## Phases

See [ROADMAP.md](./ROADMAP.md) for the full timeline. Summary:

- **Phase 1 — Foundation** (week 1-2): repo scaffolding, config loader, shared
  context format, basic Claude driver via stdin/stdout.
- **Phase 2 — Two-agent MVP** (week 3-4): Codex driver, manual handoff,
  end-to-end on a real task.
- **Phase 3 — Three agents** (week 5-6): Cursor driver. This is where the
  hard problems live (Cursor agent's session model is opaque).
- **Phase 4 — Routing** (week 7-8): replace the rule table with telemetry-
  based routing. Build a small benchmark suite.
- **Phase 5 — Polish** (week 9-10): docs, examples, blog post, npm publish.

## Hard problems we already know about

These are the engineering walls. Solving them is most of the work.

1. **Detecting "done"**. Each CLI has its own session lifecycle and there is
   no standard "task complete" signal. Possible answers: sentinel string in
   the prompt, file-modification quiescence, exit code, MCP server bridge.
2. **Context injection**. Each CLI loads context from different files
   (`CLAUDE.md`, `AGENTS.md`, `.cursorrules`). baton needs to write to all
   three or find a single source they all read.
3. **Output extraction**. Stdout is noisy. The actual *result* of a session
   is the modified files, not the chatter. baton has to diff the working tree
   before/after each agent runs.
4. **Cost control**. Running three frontier models on every task triples
   token spend. Routing must be cheap; the coordinator itself shouldn't call
   an LLM for routing decisions in v1 (use rules, not LLM judgement).
5. **Session resumption**. If Claude exits mid-task, can baton hand the same
   state to Codex? This is the fundamental "session as a value" problem the
   industry hasn't solved.

## Tech stack

- **TypeScript + Node 22** — same stack as the user's other projects, npm
  publishable.
- **execa** — subprocess management.
- **chokidar** — file-watching for output detection.
- **commander** — CLI parsing.
- **zod** — config validation.
- **No LLM dependency in v1** — coordinator uses rules, not an LLM, to keep
  v1 cheap and deterministic.

## Future / nice-to-haves

- A2A protocol adapter — wrap each driver to expose Agent2Agent endpoints so
  baton can be driven by other A2A-speaking orchestrators (and vice versa).
  This is the long-term play; once a critical mass of CLIs speak A2A, baton's
  drivers can be replaced with native protocol calls.
- MCP server for shared context — expose `.baton/context.md` as an MCP
  resource so any MCP-aware client (Claude Code, Cursor, etc.) reads it
  natively without baton having to write to vendor-specific config files.
- Web dashboard — visualize the plan, current step, agent in flight.
- Empirical benchmark — run the same task across all three agents in
  parallel, measure quality (tests pass? diff size? human rating?), publish
  the data. The dataset itself is more interesting than the orchestrator.

## Out of scope

- Worktree management (Hive, Worktrunk already do this well; integrate, don't
  rebuild).
- Running agents in parallel (Composio Agent Orchestrator already does this).
- Replacing Claude Code's Agent Teams (use it; don't compete).

## Status

Pre-alpha. Repo just initialized. No code yet beyond skeleton.

## License

MIT.
