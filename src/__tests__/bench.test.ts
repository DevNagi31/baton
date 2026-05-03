import { describe, it, expect } from "vitest";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execa } from "execa";
import { Spec, loadSpec } from "../bench/spec.js";
import { evaluate } from "../bench/evaluators.js";
import { summarize, type BenchResult } from "../bench/runner.js";

describe("bench/spec", () => {
  it("rejects an unknown evaluator type", () => {
    expect(() =>
      Spec.parse({
        name: "x",
        tasks: [
          { id: "t", prompt: "do", evaluators: [{ type: "magic_one" }] },
        ],
      })
    ).toThrow();
  });

  it("loadSpec parses a real file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bench-spec-"));
    const path = join(dir, "spec.json");
    await writeFile(
      path,
      JSON.stringify({
        name: "test",
        tasks: [
          {
            id: "t1",
            prompt: "do",
            evaluators: [{ type: "exit_zero" }],
          },
        ],
      })
    );
    const spec = await loadSpec(path);
    expect(spec.name).toBe("test");
    expect(spec.tasks).toHaveLength(1);
  });

  it("requires at least one evaluator", () => {
    expect(() =>
      Spec.parse({
        name: "x",
        tasks: [{ id: "t", prompt: "do", evaluators: [] }],
      })
    ).toThrow();
  });
});

describe("bench/evaluators", () => {
  it("file_exists passes when the file exists", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ev-"));
    await writeFile(join(dir, "a.txt"), "x");
    const out = await evaluate([{ type: "file_exists", path: "a.txt" }], dir, {
      exitCode: 0,
      stdout: "",
      stderr: "",
      filesChanged: ["a.txt"],
    });
    expect(out[0].passed).toBe(true);
  });

  it("file_exists fails when the file is absent", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ev-"));
    const out = await evaluate(
      [{ type: "file_exists", path: "missing.txt" }],
      dir,
      { exitCode: 0, stdout: "", stderr: "", filesChanged: [] }
    );
    expect(out[0].passed).toBe(false);
    expect(out[0].detail).toContain("not found");
  });

  it("file_contains checks substring", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ev-"));
    await writeFile(join(dir, "a.txt"), "hello world");
    const ok = await evaluate(
      [{ type: "file_contains", path: "a.txt", text: "world" }],
      dir,
      { exitCode: 0, stdout: "", stderr: "", filesChanged: [] }
    );
    const fail = await evaluate(
      [{ type: "file_contains", path: "a.txt", text: "missing" }],
      dir,
      { exitCode: 0, stdout: "", stderr: "", filesChanged: [] }
    );
    expect(ok[0].passed).toBe(true);
    expect(fail[0].passed).toBe(false);
  });

  it("exit_zero reflects the driver result", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ev-"));
    const ok = await evaluate([{ type: "exit_zero" }], dir, {
      exitCode: 0,
      stdout: "",
      stderr: "",
      filesChanged: [],
    });
    const fail = await evaluate([{ type: "exit_zero" }], dir, {
      exitCode: 2,
      stdout: "",
      stderr: "",
      filesChanged: [],
    });
    expect(ok[0].passed).toBe(true);
    expect(fail[0].passed).toBe(false);
  });

  it("max_files_changed enforces a cap", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ev-"));
    const out = await evaluate(
      [{ type: "max_files_changed", n: 1 }],
      dir,
      { exitCode: 0, stdout: "", stderr: "", filesChanged: ["a", "b"] }
    );
    expect(out[0].passed).toBe(false);
  });
});

describe("bench/summarize", () => {
  const r = (overrides: Partial<BenchResult> = {}): BenchResult => ({
    ts: "2026-05-03T00:00:00Z",
    spec: "mini",
    task: "t",
    agent: "claude",
    exitCode: 0,
    durationMs: 1000,
    filesChanged: [],
    passed: true,
    failures: [],
    resultPreview: "",
    ...overrides,
  });

  it("aggregates pass rate and mean duration per agent", () => {
    const summary = summarize([
      r({ agent: "claude", passed: true, durationMs: 1000 }),
      r({ agent: "claude", passed: false, durationMs: 3000 }),
      r({ agent: "cursor", passed: true, durationMs: 2000 }),
    ]);
    expect(summary.byAgent.claude.runs).toBe(2);
    expect(summary.byAgent.claude.passes).toBe(1);
    expect(summary.byAgent.claude.passRate).toBe(0.5);
    expect(summary.byAgent.claude.meanDurationMs).toBe(2000);
    expect(summary.byAgent.cursor.passes).toBe(1);
    expect(summary.byAgent.cursor.passRate).toBe(1);
  });

  it("aggregates by category × agent", () => {
    const summary = summarize([
      r({ agent: "claude", category: "edit", passed: true }),
      r({ agent: "claude", category: "edit", passed: false }),
      r({ agent: "claude", category: "plan", passed: true }),
    ]);
    expect(summary.byCategoryAgent.edit.claude.runs).toBe(2);
    expect(summary.byCategoryAgent.edit.claude.passes).toBe(1);
    expect(summary.byCategoryAgent.plan.claude.passes).toBe(1);
  });
});

// Runner integration test using a fake claude binary so we exercise the
// full runSpec → fresh repo → drive → evaluate → write JSONL pipeline
// without spending API tokens.
describe("bench/runSpec (integration with fake binary)", () => {
  it("runs a 2-task spec end-to-end and writes JSONL output", async () => {
    const work = await mkdtemp(join(tmpdir(), "bench-int-"));
    const binDir = join(work, "bin");
    await mkdir(binDir, { recursive: true });
    const fake = join(binDir, "claude");
    // Fake claude that creates whichever file the prompt asks for. We
    // cheat by reading the prompt off stdin, scanning for "named X", and
    // writing X with a fixed content.
    await writeFile(
      fake,
      `#!/bin/bash
set -e
prompt=$(cat)
file=$(echo "$prompt" | grep -oE 'named [a-zA-Z0-9._-]+' | head -1 | awk '{print $2}')
if [ -n "$file" ]; then
  if echo "$prompt" | grep -q "hello-from-baton"; then
    printf 'hello-from-baton\\n' > "$file"
  else
    printf 'one\\ntwo\\nthree\\n' > "$file"
  fi
fi
echo '{"type":"result","is_error":false,"result":"done"}'
exit 0
`,
      { mode: 0o755 }
    );

    const spec: Spec = {
      name: "fake",
      tasks: [
        {
          id: "create-hello",
          prompt: "Create a file named hello.txt with: hello-from-baton",
          evaluators: [
            { type: "exit_zero" },
            { type: "file_exists", path: "hello.txt" },
            {
              type: "file_contains",
              path: "hello.txt",
              text: "hello-from-baton",
            },
          ],
        },
        {
          id: "create-numbers",
          prompt: "Create a file named numbers.txt with three lines",
          evaluators: [
            { type: "exit_zero" },
            { type: "file_contains", path: "numbers.txt", text: "two" },
          ],
        },
      ],
    };

    // Inject the fake claude path via PATH so the driver's `claude`
    // command resolves to it.
    const oldPath = process.env.PATH;
    process.env.PATH = `${binDir}:${oldPath}`;
    try {
      const { runSpec, summarize } = await import("../bench/runner.js");
      const out = join(work, "bench.jsonl");
      const results = await runSpec(spec, {
        agents: ["claude"],
        unattended: true,
        outputPath: out,
      });
      expect(results).toHaveLength(2);
      expect(results.every((r) => r.passed)).toBe(true);
      const summary = summarize(results);
      expect(summary.byAgent.claude.passes).toBe(2);

      // Verify JSONL was written
      const fs = await import("node:fs/promises");
      const written = await fs.readFile(out, "utf8");
      const lines = written.trim().split("\n");
      expect(lines).toHaveLength(2);
    } finally {
      if (oldPath !== undefined) process.env.PATH = oldPath;
    }
  }, 30_000);
});
