# Roadmap

Living document. Dates are aspirational; phases ship when they're ready.

## Phase 1 — Foundation (week 1-2)

Goal: a working harness that can spawn one CLI and capture its work.

- [ ] Project scaffolding (TypeScript, eslint, vitest)
- [ ] Config schema and loader (`.baton/config.json`)
- [ ] Shared context format and reader/writer (`.baton/context.md`)
- [ ] Step log format (`.baton/log.jsonl`)
- [ ] `Driver` interface — `start()`, `send(prompt)`, `awaitDone()`, `stop()`
- [ ] First driver: ClaudeDriver, spawning `claude` via `execa` with stdin
- [ ] CLI: `baton init` (creates `.baton/`), `baton run "<task>"`
- [ ] One end-to-end demo: `baton run "add a hello endpoint to a tiny express app"` runs Claude and produces a diff

Exit criterion: I can run `baton run "<task>"`, Claude does the work, baton
writes a clean log, and I can re-read what happened.

## Phase 2 — Two-agent MVP (week 3-4)

Goal: prove the handoff actually works.

- [ ] CodexDriver
- [ ] Routing rule table (planning → Claude, implementation → Codex)
- [ ] Plan format: structured task list Claude emits in a parseable form
- [ ] Manual handoff: `baton next` advances to the next step
- [ ] Diff capture between handoffs (so each agent sees what the previous one did)
- [ ] Working-tree snapshot before each step so we can rollback

Exit criterion: `baton run "build a /users CRUD API with tests"` produces a
plan from Claude, then Codex implements each step, with shared context
flowing between them.

## Phase 3 — Three agents (week 5-6)

Goal: bring Cursor in. This is where the unknown unknowns live.

- [ ] Investigate Cursor agent's session model and supported invocation modes
- [ ] CursorDriver — at minimum, can be sent a prompt and produces edits
- [ ] Handoff between any two of the three agents in either direction
- [ ] Routing extended to include Cursor's strengths

Risk: Cursor agent may not expose enough surface to be driven cleanly. Fallback
is to ship with 2-agent support and treat Cursor as opt-in.

## Phase 4 — Routing (week 7-8)

Goal: replace vibes-based routing with measurements.

- [ ] Telemetry: per-step timing, success/failure, diff size, test result
- [ ] Tiny benchmark suite (5-10 representative tasks)
- [ ] `baton bench` command — runs the same task on each agent, records results
- [ ] Routing rule table becomes a learned weight per (stage, agent) pair
- [ ] Public dashboard / blog post with the data

This is the part that's most differentiated from existing orchestrators.

## Phase 5 — Polish (week 9-10)

- [ ] README real install instructions
- [ ] Example projects
- [ ] Blog post with benchmark data
- [ ] Publish to npm
- [ ] Submit to awesome-agent-orchestrators list

## Open questions

- Should baton ship with a default plan format or let each driver define its own?
- How aggressive should the coordinator be about restarting a stuck driver?
- Should the routing rules eventually be ML-driven, or does a hand-tuned table
  always win for a single user?
- Worth integrating with an existing worktree manager (Hive, Worktrunk) so
  baton can drive parallel collaborative sessions later?
