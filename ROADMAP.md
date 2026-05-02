# Roadmap

Living document. Dates are aspirational; phases ship when they're ready.

## Phase 1 — Foundation ✅ shipped

Goal: a working harness that can spawn one CLI and capture its work.

- [x] Project scaffolding (TypeScript, vitest)
- [x] Config schema and loader (`.baton/config.json`) with zod validation
- [x] Shared context format and reader/writer (`.baton/context.md`)
- [x] Step log format (`.baton/log.jsonl`)
- [x] `Driver` interface — `start()`, `send(prompt)`, `awaitDone()`, `stop()`
- [x] First driver: ClaudeDriver, spawning `claude -p` via `execa` with stdin
- [x] CLI: `baton init` (creates `.baton/`), `baton run "<task>"`
- [x] One end-to-end demo against the live `claude` CLI: file creation
      task, working-tree diff captured, log + context written

Exit criterion met: `baton run "<task>"` directs Claude to do work, baton
detects the change, logs the result, and updates the context store.

## Phase 2 — Memory + multi-agent

The biggest phase. Original goal: prove the multi-agent collaboration
thesis with all three CLIs sharing context. Splits into three sub-phases
because trying to do it as one push is the surest way to ship none of it.

### Phase 2a — CodexDriver (one weekend)

Goal: bring the second agent online. Same pattern as Claude.

- [ ] CodexDriver implementation using `codex exec` non-interactively
- [ ] Driver-level integration: `baton run` can dispatch to codex
- [ ] Working-tree diff capture (already shared with Claude path)
- [ ] Unit tests with mocked subprocess output
- [ ] Integration test gated on `OPENAI_API_KEY` env var (CI runs it only
      when the secret is configured; local devs without an OpenAI account
      can still develop and run unit tests)
- [ ] README documents the auth requirement

Exit criterion: `baton run --agent codex "<task>"` works end-to-end for
anyone with a working `codex` CLI. Markdown shared context still in use.

### Phase 2b — Memory MCP server (two weekends)

Goal: replace the markdown context layer with a semantic-memory MCP server.

- [ ] sqlite schema for memories: id, text, embedding (BLOB), tags,
      source, created_at
- [ ] Local embedding pipeline using `@xenova/transformers` with the
      all-MiniLM-L6-v2 model (~22MB)
- [ ] Brute-force cosine similarity for retrieval (under 10K memories,
      no need for a real vector index)
- [ ] MCP server exposing `add_memory`, `search_memory`, `list_memories`,
      `delete_memory` tools using the official MCP TypeScript SDK
- [ ] `baton mcp` command — runs the memory server standalone for direct
      MCP client connection (Claude Code, Cursor, etc.)
- [ ] Migration tool that ports existing `.baton/context.md` content into
      the memory store

Exit criterion: any MCP-aware client can connect to `baton mcp` and read/
write memory. Memory persists across sessions and processes.

### Phase 2c — Drivers connect through memory (one weekend)

Goal: make the orchestrator use the new memory layer instead of the markdown
context file.

- [ ] Each driver registers `baton-memory` as an MCP server in the agent's
      session before invocation (Claude has `--mcp-config`, Codex has
      `codex mcp`, Cursor TBD)
- [ ] Coordinator writes step results into memory after each driver run
      instead of appending to context.md
- [ ] Coordinator surfaces relevant memories in the next step's prompt
      (agents query memory themselves once connected, but the prompt
      should also nudge them with a recent-step summary)
- [ ] `.baton/context.md` becomes a *derived view* of memory, regenerated
      on demand for human reading. Not the source of truth anymore.

Exit criterion: `baton run "build a /users CRUD API with tests"` produces
a plan from Claude, has Codex implement each step, with both reading and
writing the same memory store via MCP. No markdown context file in the
hot path.

## Phase 3 — Cursor

Goal: bring Cursor in. This is where the unknown unknowns live.

- [ ] Investigate Cursor agent's session model and supported invocation
      modes (it is the least documented of the three)
- [ ] CursorDriver — at minimum, can be sent a prompt and produces edits
- [ ] Cursor connected to `baton-memory` via MCP (Cursor MCP support is
      newer; verify the protocol surface works as documented)
- [ ] Routing extended to include Cursor's strengths
- [ ] Handoff between any two of the three agents in either direction

Risk: Cursor agent may not expose enough surface to be driven cleanly in
unattended mode. Fallback is to ship with 2-agent support and treat
Cursor as opt-in / interactive-only.

## Phase 4 — Empirical routing

Goal: replace vibes-based routing with measurements.

- [ ] Telemetry: per-step timing, success/failure, diff size, test result
- [ ] Tiny benchmark suite (5-10 representative tasks)
- [ ] `baton bench` command — runs the same task on each agent, records
      results, populates the routing weight table
- [ ] Routing rule table becomes a learned weight per (stage, agent) pair
- [ ] Public dashboard / blog post with the data

This is the part that's most differentiated from existing orchestrators.

## Phase 5 — Polish

- [ ] README real install instructions
- [ ] Example projects walkthrough
- [ ] Blog post with benchmark data
- [ ] Publish to npm
- [ ] Submit to awesome-agent-orchestrators list

## Open questions

- What's the right granularity for memories? One per step? One per task?
  Summarized rollups? This shapes the schema heavily.
- Should the MCP server expose project-scoped memories vs. global? Probably
  yes (a `project_id` column in the schema), but TBD.
- How aggressive should the coordinator be about restarting a stuck driver?
- Should the routing rules eventually be ML-driven, or does a hand-tuned
  table always win for a single user?
- Worth integrating with an existing worktree manager (Hive, Worktrunk) so
  baton can drive parallel collaborative sessions later?
