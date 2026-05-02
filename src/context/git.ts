import { execa } from "execa";

export type WorkingTreeSnapshot = {
  // Map of relative file path to its sha256 (or "absent" if file did not exist).
  // Keyed by every file under git's tracking PLUS untracked-but-not-ignored.
  status: Map<string, string>;
};

// We use git's own machinery rather than walking the filesystem because git
// already knows what to ignore. `git status --porcelain=v1 -z` plus
// `git ls-files -z` gives us the set we care about.
export async function snapshot(cwd: string): Promise<WorkingTreeSnapshot> {
  const { stdout } = await execa(
    "git",
    ["status", "--porcelain=v1", "-uall", "-z"],
    { cwd, reject: false }
  );
  const status = new Map<string, string>();
  if (!stdout) return { status };
  // -z separates entries with NUL; rename entries take 2 NULs but for v1 here we
  // only care about the path side, not the diff content.
  const entries = stdout.split("\0").filter(Boolean);
  for (const e of entries) {
    // Format: "XY path"
    if (e.length < 4) continue;
    const code = e.slice(0, 2);
    const path = e.slice(3);
    status.set(path, code);
  }
  return { status };
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
  const all = new Set<string>([...before.status.keys(), ...after.status.keys()]);
  const out: ChangedFile[] = [];
  for (const path of all) {
    const a = after.status.get(path);
    const b = before.status.get(path);
    if (a === b) continue; // unchanged status code => no new change since snapshot
    out.push({ path, status: classify(a) });
  }
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

function classify(code: string | undefined): ChangedFile["status"] {
  if (!code) return "other";
  const c = code.trim();
  if (c === "??") return "untracked";
  if (c.includes("A")) return "added";
  if (c.includes("D")) return "deleted";
  if (c.includes("R")) return "renamed";
  if (c.includes("M")) return "modified";
  return "other";
}

export async function isGitRepo(cwd: string): Promise<boolean> {
  const { exitCode } = await execa(
    "git",
    ["rev-parse", "--is-inside-work-tree"],
    { cwd, reject: false }
  );
  return exitCode === 0;
}
