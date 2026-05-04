# Changelog

All notable changes to baton. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added
- Cross-cwd / cross-session resume: five new commands.
  - `baton remember "<note>"` — save a checkpoint with optional --tags
    and --project; defaults to source="manual", project=basename(cwd).
  - `baton recall [query] [--project <name>] [--limit <n>]` — browse
    memories; ranks by semantic similarity when a query is given,
    reverse-chronological otherwise.
  - `baton forget <id>` — delete a memory by id.
  - `baton continue [--from <project>] [--query <text>] [--limit <n>]` —
    builds a structured primer from recent memories suitable for pasting
    into a fresh Claude Code or Cursor session, or piping into
    `claude --append-system-prompt`.
  - `baton log [--tail N]` — pretty-print the per-step JSONL log from
    `.baton/log.jsonl` so you can inspect what each agent did and how
    long it took without grepping JSON yourself.
- Memory database is now global at `~/.baton/memory.db` (override via
  the `BATON_HOME` env var) so `recall`, `continue`, and `forget` all
  work from any cwd. Project scoping continues via the `project` column
  on each memory row.
- `baton bench` runs benchmark specs across one or more agents in
  isolated scratch repos. Five evaluator types: file_exists,
  file_contains, file_equals, exit_zero, max_files_changed. Per-run
  results land in `.baton/bench/<timestamp>.jsonl`.
- `baton mcp` starts the local memory server on stdio for direct MCP
  client connections.
- `--agent {claude|codex|cursor}`, `--model`, `--recall <n>` flags on
  `baton run`.
- GitHub Actions CI: typecheck + test + build on every push and PR.
- `examples/bench-mini.json` smoke benchmark.

### Changed
- Memory replaces the markdown context file as the source of truth.
  `.baton/context.md` is now a derived view regenerated on every run.
- `init` now defaults `agents.cursor.enabled` to true.

### Fixed
- Eager import of `@modelcontextprotocol/sdk` was detaching the parent
  process's stdin and causing `claude -p` to spawn with no input. The
  SDK is now lazy-loaded only inside the `mcp` action.
- CodexDriver was hanging forever when run through baton: codex reads
  stdin for an additional `<stdin>` prompt block, and execa's default
  open-pipe-with-no-writes meant codex waited for input that never came.
  CodexDriver now passes `input: ""` so codex sees EOF immediately and
  proceeds with just the positional prompt.
- Working-tree change detection used git status codes, which meant a
  file already in "M" status before a run wasn't reported as changed
  if the agent appended to it (status stayed "M"). git.ts now snapshots
  by sha256 of file contents, so any actual change is detected.

### Verified
- Three-vendor handoff with all three real CLIs: Claude → Codex → Cursor,
  each recalling the prior agent's memory and identifying the target
  file from context alone (no filename in the follow-up prompts). Final
  trifecta.txt contains one line per vendor.

## Phase 3 — CursorDriver

- CursorDriver implementation using `agent --print --output-format json`.
- Free-tier-aware: defaults `--model auto` when not overridden.
- 8 unit tests with a fake agent binary; live integration test gated on
  `CURSOR_AGENT_LIVE=1`.
- End-to-end cross-vendor handoff verified: Claude → memory → Cursor.

## Phase 2 — Memory layer

- `MemoryStorage` (better-sqlite3) with brute-force cosine similarity
  over an in-memory result set. Adequate for personal stores under 10K
  entries.
- `TransformersEmbedder` using all-MiniLM-L6-v2 via @xenova/transformers
  for fully-local embeddings.
- `HashEmbedder` for deterministic test embeddings without ONNX downloads.
- MCP server exposing `add_memory`, `search_memory`, `list_memories`,
  `delete_memory` over stdio.
- CodexDriver added in 2a using `codex exec --output-last-message`.

## Phase 1 — Foundation

- ClaudeDriver using `claude -p --output-format json`.
- Driver interface, config loader (zod), context store, git-diff capture.
- 11 tests passing.
