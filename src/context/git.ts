import { execa } from "execa";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";

export type WorkingTreeSnapshot = {
  // Map of relative file path → sha256 of its content (or "absent" if the
  // file does not exist). Hashing rather than just recording git status
  // codes is necessary because the same status code (e.g. "M") can hide
  // additional modifications between two snapshots — which was the bug
  // that caused baton run to report "no files changed" after codex
  // appended to an already-dirty trifecta.txt.
  hashes: Map<string, string>;
};

// We enumerate the file set via git so .gitignore is respected, then hash
// each file's content for the actual diff signal.
export async function snapshot(cwd: string): Promise<WorkingTreeSnapshot> {
  const paths = await listFiles(cwd);
  const hashes = new Map<string, string>();
  await Promise.all(
    paths.map(async (rel) => {
      hashes.set(rel, await hashFile(join(cwd, rel)));
    })
  );
  return { hashes };
}

async function listFiles(cwd: string): Promise<string[]> {
  // Tracked files
  const tracked = await execa("git", ["ls-files", "-z"], {
    cwd,
    reject: false,
  });
  // Untracked-not-ignored files
  const untracked = await execa(
    "git",
    ["ls-files", "--others", "--exclude-standard", "-z"],
    { cwd, reject: false }
  );
  const out = new Set<string>();
  for (const part of String(tracked.stdout).split("\0")) {
    if (part) out.add(part);
  }
  for (const part of String(untracked.stdout).split("\0")) {
    if (part) out.add(part);
  }
  return [...out];
}

async function hashFile(path: string): Promise<string> {
  try {
    const buf = await readFile(path);
    return "sha256:" + createHash("sha256").update(buf).digest("hex");
  } catch {
    return "absent";
  }
}

export type ChangedFile = {
  path: string;
  status: "added" | "modified" | "deleted" | "renamed" | "untracked" | "other";
};

export async function changedSince(
  cwd: string,
  before: WorkingTreeSnapshot
): Promise<ChangedFile[]> {
  const after = await snapshot(cwd);
  const all = new Set<string>([
    ...before.hashes.keys(),
    ...after.hashes.keys(),
  ]);
  const out: ChangedFile[] = [];
  for (const path of all) {
    const a = after.hashes.get(path);
    const b = before.hashes.get(path);
    if (a === b) continue;
    out.push({ path, status: classify(a, b) });
  }
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

function classify(
  after: string | undefined,
  before: string | undefined
): ChangedFile["status"] {
  if (!before && after) return "added";
  if (before && !after) return "deleted";
  return "modified";
}

export async function isGitRepo(cwd: string): Promise<boolean> {
  const { exitCode } = await execa(
    "git",
    ["rev-parse", "--is-inside-work-tree"],
    { cwd, reject: false }
  );
  return exitCode === 0;
}
