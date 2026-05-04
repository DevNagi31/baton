import { describe, it, expect } from "vitest";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ContextStore } from "../context/store.js";
import { readLog } from "../coordinator/log.js";

async function fixture(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "baton-log-"));
  await mkdir(join(dir, ".baton"), { recursive: true });
  return dir;
}

describe("readLog", () => {
  it("returns [] when log doesn't exist yet", async () => {
    const cwd = await fixture();
    const entries = await readLog(cwd);
    expect(entries).toEqual([]);
  });

  it("parses JSONL entries written by ContextStore", async () => {
    const cwd = await fixture();
    const store = new ContextStore(join(cwd, ".baton"));
    await store.appendLog({
      ts: "2026-05-04T00:00:00Z",
      agent: "claude",
      stage: "implement",
      prompt: "do thing",
      exitCode: 0,
      durationMs: 100,
      filesChanged: ["a.txt"],
      resultPreview: "ok",
    });
    await store.appendLog({
      ts: "2026-05-04T00:00:01Z",
      agent: "codex",
      stage: "implement",
      prompt: "do other thing",
      exitCode: 0,
      durationMs: 200,
      filesChanged: [],
      resultPreview: "done",
    });
    const entries = await readLog(cwd);
    expect(entries).toHaveLength(2);
    expect(entries[0].agent).toBe("claude");
    expect(entries[1].agent).toBe("codex");
  });

  it("--tail returns only the last N entries", async () => {
    const cwd = await fixture();
    const store = new ContextStore(join(cwd, ".baton"));
    for (let i = 0; i < 5; i++) {
      await store.appendLog({
        ts: `2026-05-04T00:00:0${i}Z`,
        agent: "claude",
        stage: "implement",
        prompt: `task-${i}`,
        exitCode: 0,
        durationMs: 100,
        filesChanged: [],
        resultPreview: "",
      });
    }
    const entries = await readLog(cwd, { tail: 2 });
    expect(entries).toHaveLength(2);
    expect(entries[0].prompt).toBe("task-3");
    expect(entries[1].prompt).toBe("task-4");
  });

  it("skips malformed lines instead of throwing", async () => {
    const cwd = await fixture();
    const path = join(cwd, ".baton", "log.jsonl");
    const good = JSON.stringify({
      ts: "2026-05-04T00:00:00Z",
      agent: "claude",
      stage: "implement",
      prompt: "x",
      exitCode: 0,
      durationMs: 1,
      filesChanged: [],
      resultPreview: "",
    });
    await writeFile(path, `not-json\n${good}\n{also bad\n`);
    const entries = await readLog(cwd);
    expect(entries).toHaveLength(1);
  });
});
