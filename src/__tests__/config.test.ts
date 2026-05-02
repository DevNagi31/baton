import { describe, it, expect } from "vitest";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadConfig } from "../coordinator/config.js";

async function fixture(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "baton-cfg-"));
  await mkdir(join(dir, ".baton"), { recursive: true });
  return dir;
}

describe("loadConfig", () => {
  it("parses a minimal valid config", async () => {
    const dir = await fixture();
    await writeFile(
      join(dir, ".baton", "config.json"),
      JSON.stringify({
        version: 1,
        agents: {
          claude: { command: "claude" },
          codex: { command: "codex" },
          cursor: { command: "agent", enabled: false },
        },
        routing: { plan: "claude", implement: "codex", review: "claude" },
      })
    );
    const cfg = await loadConfig(dir);
    expect(cfg.routing.plan).toBe("claude");
    expect(cfg.agents.cursor.enabled).toBe(false);
    expect(cfg.limits.maxSteps).toBe(10);
  });

  it("rejects an unknown routing target", async () => {
    const dir = await fixture();
    await writeFile(
      join(dir, ".baton", "config.json"),
      JSON.stringify({
        version: 1,
        agents: {
          claude: { command: "claude" },
          codex: { command: "codex" },
          cursor: { command: "agent" },
        },
        routing: { plan: "gpt-4o", implement: "codex", review: "claude" },
      })
    );
    await expect(loadConfig(dir)).rejects.toThrow();
  });

  it("throws if config file is missing", async () => {
    const dir = await fixture();
    await expect(loadConfig(dir)).rejects.toThrow();
  });
});
