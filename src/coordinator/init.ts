import { mkdir, writeFile, access } from "node:fs/promises";
import { join } from "node:path";
import { isGitRepo } from "../context/git.js";

const DEFAULT_CONFIG = {
  version: 1,
  agents: {
    claude: { command: "claude", enabled: true },
    codex: { command: "codex", enabled: true },
    cursor: { command: "agent", enabled: true },
  },
  routing: {
    plan: "claude",
    implement: "codex",
    review: "claude",
  },
};

export async function initProject(cwd: string): Promise<void> {
  if (!(await isGitRepo(cwd))) {
    console.warn(
      `[baton init] warning: ${cwd} is not a git repository. baton run uses git for change detection — initialize one with \`git init\` before running tasks.`
    );
  }

  const dir = join(cwd, ".baton");
  const created: string[] = [];
  const skipped: string[] = [];

  await mkdir(dir, { recursive: true });
  await mkdir(join(dir, "snapshots"), { recursive: true });

  const configPath = join(dir, "config.json");
  if (!(await exists(configPath))) {
    await writeFile(configPath, JSON.stringify(DEFAULT_CONFIG, null, 2) + "\n");
    created.push("config.json");
  } else {
    skipped.push("config.json");
  }

  const contextPath = join(dir, "context.md");
  if (!(await exists(contextPath))) {
    await writeFile(
      contextPath,
      "# baton shared context\n\n_Generated and rewritten by baton on each step._\n"
    );
    created.push("context.md");
  } else {
    skipped.push("context.md");
  }

  if (created.length === 0) {
    console.log(`[baton init] .baton/ already initialized at ${dir} (nothing to do)`);
  } else {
    console.log(`[baton init] initialized .baton/ at ${dir}`);
    console.log(`[baton init] created: ${created.join(", ")}`);
    if (skipped.length > 0) {
      console.log(`[baton init] kept: ${skipped.join(", ")}`);
    }
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
