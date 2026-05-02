import { ClaudeDriver } from "../drivers/claude.js";
import { CodexDriver } from "../drivers/codex.js";
import { ContextStore } from "../context/store.js";
import { isGitRepo } from "../context/git.js";
import { loadConfig, type Config } from "./config.js";
import type { Driver, DriverId } from "../drivers/types.js";
import { join } from "node:path";

export type RunOptions = {
  unattended?: boolean;
  model?: string;
  // Override which agent runs this task. Defaults to config.routing.plan.
  agent?: DriverId;
};

export async function runTask(
  cwd: string,
  task: string,
  opts: RunOptions = {}
): Promise<void> {
  if (!(await isGitRepo(cwd))) {
    throw new Error(
      "baton run must be invoked inside a git repository (working tree changes are tracked via git)."
    );
  }

  const config = await loadConfig(cwd);
  const store = new ContextStore(join(cwd, ".baton"));

  const driverId: DriverId = opts.agent ?? config.routing.plan;
  const driver = makeDriver(driverId, config, opts);

  console.log(`[baton] task: ${task}`);
  console.log(`[baton] dispatching to: ${driver.id}`);

  await driver.start({ cwd, contextFile: store.contextFile });
  await driver.send(task);

  const startedAt = Date.now();
  const result = await driver.awaitDone();
  const durationMs = Date.now() - startedAt;

  await driver.stop();

  const snapshotPath = await store.writeSnapshot(
    0,
    driver.id,
    `# ${driver.id} step\n\n## prompt\n${task}\n\n## result\n${result.stdout}\n\n## stderr\n${result.stderr}\n`
  );

  await store.appendLog({
    ts: new Date().toISOString(),
    agent: driver.id,
    stage: "implement",
    prompt: task,
    exitCode: result.exitCode,
    durationMs,
    filesChanged: result.filesChanged,
    resultPreview: result.stdout.slice(0, 240),
  });

  await store.appendContext(
    [
      `## ${new Date().toISOString()} · ${driver.id}`,
      "",
      `**Task:** ${task}`,
      "",
      `**Exit code:** ${result.exitCode}`,
      `**Duration:** ${durationMs}ms`,
      `**Files changed:** ${result.filesChanged.length === 0 ? "none" : result.filesChanged.join(", ")}`,
      "",
      "**Summary:**",
      result.stdout.slice(0, 1200) || "(no output)",
    ].join("\n")
  );

  console.log("");
  console.log(`[baton] done. exit=${result.exitCode} in ${durationMs}ms`);
  if (result.filesChanged.length > 0) {
    console.log(`[baton] changed ${result.filesChanged.length} file(s):`);
    for (const f of result.filesChanged.slice(0, 20)) console.log(`  - ${f}`);
  } else {
    console.log("[baton] no working-tree changes detected.");
  }
  console.log(`[baton] log:      ${store.logFile}`);
  console.log(`[baton] context:  ${store.contextFile}`);
  console.log(`[baton] snapshot: ${snapshotPath}`);
}

function makeDriver(id: DriverId, config: Config, opts: RunOptions): Driver {
  if (id === "claude") {
    const cfg = config.agents.claude;
    if (!cfg.enabled)
      throw new Error("claude is disabled in .baton/config.json");
    return new ClaudeDriver({
      command: cfg.command,
      extraArgs: cfg.extraArgs,
      unattended: opts.unattended ?? false,
      model: opts.model,
    });
  }
  if (id === "codex") {
    const cfg = config.agents.codex;
    if (!cfg.enabled)
      throw new Error("codex is disabled in .baton/config.json");
    return new CodexDriver({
      command: cfg.command,
      extraArgs: cfg.extraArgs,
      unattended: opts.unattended ?? false,
      model: opts.model,
    });
  }
  if (id === "cursor") {
    throw new Error(
      "cursor driver is not implemented yet. Roadmap Phase 3."
    );
  }
  throw new Error(`unknown agent: ${id}`);
}
