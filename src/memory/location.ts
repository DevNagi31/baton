import { homedir } from "node:os";
import { join } from "node:path";

// Global memory directory. The memory store lives in a single location
// shared across all projects so commands like `baton recall --project foo`
// and `baton continue --from foo` work from any directory.
//
// Per-project artifacts that aren't memory (context.md, log.jsonl,
// snapshots/, bench/) still live inside `<project>/.baton/`. Only the
// memory database is global.
//
// Override with the BATON_HOME environment variable, primarily for tests
// that need an isolated store.
export function getBatonHome(): string {
  return process.env.BATON_HOME ?? join(homedir(), ".baton");
}

export function getMemoryDbDir(): string {
  return getBatonHome();
}
