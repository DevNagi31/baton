import { mkdtemp, mkdir, writeFile, appendFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { execa } from "execa";
import { ClaudeDriver } from "../drivers/claude.js";
import { CodexDriver } from "../drivers/codex.js";
import { CursorDriver } from "../drivers/cursor.js";
import type { Driver, DriverId, DriverResult } from "../drivers/types.js";
import type { Spec, Task } from "./spec.js";
import { evaluate, type EvalResult } from "./evaluators.js";

export type BenchResult = {
  ts: string;
  spec: string;
  task: string;
  category?: string;
  agent: DriverId;
  exitCode: number;
  durationMs: number;
  filesChanged: string[];
  passed: boolean;
  failures: { type: string; detail?: string }[];
  // Truncated assistant text (first 240 chars) — full output stays in
  // the snapshot file inside the scratch repo, which baton tears down
  // after each run.
  resultPreview: string;
};

export type RunOptions = {
  agents: DriverId[];
  unattended: boolean;
  outputPath: string;
  // Optional model override applied uniformly. Cursor falls back to "auto"
  // for free-tier accounts when this is undefined.
  model?: string;
  onProgress?: (status: string) => void;
};

export async function runSpec(
  spec: Spec,
  opts: RunOptions
): Promise<BenchResult[]> {
  const all: BenchResult[] = [];
  await mkdir(dirname(opts.outputPath), { recursive: true });
  await writeFile(opts.outputPath, "");

  for (const task of spec.tasks) {
    for (const agentId of opts.agents) {
      opts.onProgress?.(`[${agentId}] ${task.id}…`);
      const result = await runOne(task, agentId, spec.name, opts);
      all.push(result);
      await appendFile(opts.outputPath, JSON.stringify(result) + "\n");
      opts.onProgress?.(
        `[${agentId}] ${task.id} → ${result.passed ? "pass" : "fail"} (${result.durationMs}ms)`
      );
    }
  }
  return all;
}

async function runOne(
  task: Task,
  agentId: DriverId,
  specName: string,
  opts: RunOptions
): Promise<BenchResult> {
  const cwd = await freshScratchRepo();
  const driver = makeDriver(agentId, opts);

  const started = Date.now();
  let result: DriverResult;
  try {
    await driver.start({
      cwd,
      contextFile: join(cwd, ".baton", "context.md"),
    });
    await driver.send(task.prompt);
    result = await driver.awaitDone();
  } catch (err) {
    result = {
      exitCode: 1,
      stdout: "",
      stderr: (err as Error).message ?? "driver threw",
      filesChanged: [],
    };
  } finally {
    await driver.stop().catch(() => {});
  }
  const durationMs = Date.now() - started;

  const evals = await evaluate(task.evaluators, cwd, result);
  const passed = evals.every((e) => e.passed);
  const failures = evals
    .filter((e) => !e.passed)
    .map((e) => ({ type: e.evaluator.type, detail: e.detail }));

  return {
    ts: new Date().toISOString(),
    spec: specName,
    task: task.id,
    category: task.category,
    agent: agentId,
    exitCode: result.exitCode,
    durationMs,
    filesChanged: result.filesChanged,
    passed,
    failures,
    resultPreview: result.stdout.slice(0, 240),
  };
}

async function freshScratchRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "baton-bench-"));
  await execa("git", ["init", "-b", "main"], { cwd: dir });
  await execa("git", ["config", "user.email", "bench@baton.dev"], { cwd: dir });
  await execa("git", ["config", "user.name", "baton-bench"], { cwd: dir });
  await execa("git", ["config", "commit.gpgsign", "false"], { cwd: dir });
  await writeFile(join(dir, "README.md"), "# bench scratch\n");
  await execa("git", ["add", "."], { cwd: dir });
  await execa("git", ["commit", "-m", "seed"], { cwd: dir });
  await mkdir(join(dir, ".baton"), { recursive: true });
  return dir;
}

function makeDriver(id: DriverId, opts: RunOptions): Driver {
  switch (id) {
    case "claude":
      return new ClaudeDriver({
        unattended: opts.unattended,
        model: opts.model,
      });
    case "codex":
      return new CodexDriver({
        unattended: opts.unattended,
        model: opts.model,
      });
    case "cursor":
      return new CursorDriver({
        unattended: opts.unattended,
        model: opts.model ?? "auto",
      });
  }
}

// Aggregate roll-up: pass rate, mean duration, and a stage→agent score
// matrix derived from evaluator passes. Used by `baton bench summary`
// and by the routing weight derivation.
export type Summary = {
  byAgent: Record<
    DriverId,
    {
      runs: number;
      passes: number;
      passRate: number;
      meanDurationMs: number;
      meanFilesChanged: number;
    }
  >;
  byCategoryAgent: Record<string, Record<DriverId, { runs: number; passes: number }>>;
};

export function summarize(results: BenchResult[]): Summary {
  const byAgent: Summary["byAgent"] = {} as Summary["byAgent"];
  const byCat: Summary["byCategoryAgent"] = {};
  for (const r of results) {
    const a = (byAgent[r.agent] ??= {
      runs: 0,
      passes: 0,
      passRate: 0,
      meanDurationMs: 0,
      meanFilesChanged: 0,
    });
    a.runs += 1;
    a.passes += r.passed ? 1 : 0;
    a.meanDurationMs += r.durationMs;
    a.meanFilesChanged += r.filesChanged.length;

    if (r.category) {
      const cat = (byCat[r.category] ??= {} as Record<
        DriverId,
        { runs: number; passes: number }
      >);
      const ca = (cat[r.agent] ??= { runs: 0, passes: 0 });
      ca.runs += 1;
      ca.passes += r.passed ? 1 : 0;
    }
  }
  for (const a of Object.values(byAgent)) {
    a.passRate = a.runs > 0 ? a.passes / a.runs : 0;
    a.meanDurationMs = a.runs > 0 ? a.meanDurationMs / a.runs : 0;
    a.meanFilesChanged = a.runs > 0 ? a.meanFilesChanged / a.runs : 0;
  }
  return { byAgent, byCategoryAgent: byCat };
}
