import { ClaudeDriver } from "../drivers/claude.js";
import { ContextStore } from "../context/store.js";
import { isGitRepo } from "../context/git.js";
import { loadConfig } from "./config.js";
import { join } from "node:path";

export type RunOptions = {
  unattended?: boolean;
  model?: string;
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

  // Phase 1 ships the single-agent flow: the planning agent (Claude by
  // default) handles the entire task in one invocation. The plan/implement/
  // review split lands in Phase 2 alongside CodexDriver.
  const driverId = config.routing.plan;
  if (driverId !== "claude") {
    throw new Error(
      `Phase 1 only supports the claude driver, got "${driverId}". Phase 2 will introduce the codex driver and routing.`
    );
  }

  const claudeCfg = config.agents.claude;
  if (!claudeCfg.enabled) {
    throw new Error("claude is disabled in config; nothing to run.");
  }

  const driver = new ClaudeDriver({
    command: claudeCfg.command,
    extraArgs: claudeCfg.extraArgs,
    unattended: opts.unattended ?? false,
    model: opts.model,
  });

  console.log(`[baton] task: ${task}`);
  console.log(`[baton] dispatching to: ${driver.id}`);

  await driver.start({ cwd, contextFile: store.contextFile });
  await driver.send(task);

  const startedAt = Date.now();
  const result = await driver.awaitDone();
  const durationMs = Date.now() - startedAt;

  await driver.stop();

  // Persist result.
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
