# Contributing to baton

baton is at v0.0.x. The architecture is settling but the API surface is
still moving. Contributions are welcome — file an issue first for anything
larger than a small bug fix so we can talk through scope.

## Development setup

```bash
git clone https://github.com/DevNagi31/baton
cd baton
npm install
npx tsc --noEmit       # typecheck
npx vitest run         # run all tests
npx vitest watch       # watch mode while iterating
```

Node 22+ is required (we use top-level await and the latest sqlite WASM
fallbacks in better-sqlite3).

## Test budget

There are three kinds of tests:

1. **Unit tests with fake binaries.** All driver tests (`claude.test.ts`,
   `codex.test.ts`, `cursor.test.ts`) use a small bash shim binary that
   echoes argv and writes a fixture output. These cost nothing and run on
   every CI build.
2. **Integration tests with the real MCP SDK.** `mcp.test.ts` spawns the
   actual `baton mcp` process and exercises the real protocol. Cost-free.
3. **Live integration tests.** Gated on env vars to avoid surprise spend:
   - `OPENAI_API_KEY` enables the Codex live test.
   - `CURSOR_AGENT_LIVE=1` enables the Cursor live test (counts against
     the free-tier request cap).
   - Claude live tests aren't part of the suite — Claude Pro usage is
     covered by a flat subscription, but we still don't want CI to burn
     it. Run them locally with the demo scripts.

When adding a new driver feature, prefer extending the fake-binary test
first. Only add a live integration test if the behavior fundamentally
can't be exercised against a fake (rare).

## Style

- TypeScript strict mode. No `any`, no `// @ts-ignore`.
- Imports stay relative-with-`.js`-suffix (Node ESM rules).
- Don't add comments that explain *what* the code does — the code already
  says that. Add a comment only when the *why* is non-obvious (a hidden
  constraint, a workaround for a specific CLI quirk, a perf decision).
- Prefer one focused commit per logical change. Squash if the local
  history got messy.

## Running a benchmark

```bash
# from a git repo
node /path/to/baton/dist/cli/index.js bench \
  --spec /path/to/baton/examples/bench-mini.json \
  --agents claude,cursor \
  --unattended
```

If you're submitting bench results to the project (e.g. via a PR adding
a new spec to `examples/`), include the JSONL output and a one-line
summary in the PR description so we can verify the numbers.
