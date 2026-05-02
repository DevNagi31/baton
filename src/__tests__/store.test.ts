import { describe, it, expect } from "vitest";
import { mkdtemp, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ContextStore } from "../context/store.js";

async function fixture(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "baton-store-"));
  await mkdir(join(dir, ".baton"), { recursive: true });
  return dir;
}

describe("ContextStore", () => {
  it("appendContext adds sections separated by newlines", async () => {
    const dir = await fixture();
    const store = new ContextStore(join(dir, ".baton"));
    await store.appendContext("first");
    await store.appendContext("second");
    const content = await store.readContext();
    expect(content).toContain("first");
    expect(content).toContain("second");
    expect(content.indexOf("first")).toBeLessThan(content.indexOf("second"));
  });

  it("appendLog writes one JSON object per line", async () => {
    const dir = await fixture();
    const store = new ContextStore(join(dir, ".baton"));
    await store.appendLog({
      ts: "2026-05-02T00:00:00Z",
      agent: "claude",
      stage: "implement",
      prompt: "p",
      exitCode: 0,
      durationMs: 100,
      filesChanged: ["a.txt"],
      resultPreview: "ok",
    });
    await store.appendLog({
      ts: "2026-05-02T00:00:01Z",
      agent: "codex",
      stage: "implement",
      prompt: "q",
      exitCode: 0,
      durationMs: 50,
      filesChanged: [],
      resultPreview: "done",
    });
    const raw = await readFile(store.logFile, "utf8");
    const lines = raw.trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).agent).toBe("claude");
    expect(JSON.parse(lines[1]).agent).toBe("codex");
  });

  it("writeSnapshot writes to .baton/snapshots/<i>-<agent>.txt", async () => {
    const dir = await fixture();
    const store = new ContextStore(join(dir, ".baton"));
    const path = await store.writeSnapshot(0, "claude", "hello");
    expect(path).toMatch(/snapshots\/0-claude\.txt$/);
    const content = await readFile(path, "utf8");
    expect(content).toBe("hello");
  });
});
