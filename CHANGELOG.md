# Changelog

All notable changes to baton. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added
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
