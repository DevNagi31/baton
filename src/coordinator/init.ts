import { mkdir, writeFile, access } from "node:fs/promises";
import { join } from "node:path";

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
  const dir = join(cwd, ".baton");
  await mkdir(dir, { recursive: true });
  await mkdir(join(dir, "snapshots"), { recursive: true });

  const configPath = join(dir, "config.json");
  if (!(await exists(configPath))) {
    await writeFile(configPath, JSON.stringify(DEFAULT_CONFIG, null, 2) + "\n");
  }

  const contextPath = join(dir, "context.md");
  if (!(await exists(contextPath))) {
    await writeFile(
      contextPath,
      "# baton shared context\n\n_Generated and rewritten by baton on each step._\n"
    );
  }

  console.log(`initialized .baton/ at ${dir}`);
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
