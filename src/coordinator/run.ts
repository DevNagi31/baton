import { ClaudeDriver } from "../drivers/claude.js";
import { CodexDriver } from "../drivers/codex.js";
import { ContextStore } from "../context/store.js";
import { isGitRepo } from "../context/git.js";
import { loadConfig, type Config } from "./config.js";
import type { Driver, DriverId } from "../drivers/types.js";
import { MemoryStore } from "../memory/store.js";
import { HashEmbedder } from "../memory/embeddings.js";
import { join, basename } from "node:path";

export type RunOptions = {
  unattended?: boolean;
  model?: string;
  agent?: DriverId;
  // How many prior memories to inject into the prompt as recall context.
  // Set to 0 to skip the memory query entirely (useful for the very first
  // task in a fresh project).
  recall?: number;
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
  const batonDir = join(cwd, ".baton");
  const store = new ContextStore(batonDir);

  // Open the memory store. Coordinator-side reads/writes go through this,
  // so even if the agent CLIs aren't yet wired to the memory MCP they
  // still benefit from prior context surfacing through the prompt.
  const memory = await MemoryStore.open({
    batonDir,
    embedder:
      process.env.BATON_TEST_HASH_EMBEDDER === "1"
        ? new HashEmbedder(64)
        : undefined,
  });

  const project = basename(cwd);
  const driverId: DriverId = opts.agent ?? config.routing.plan;
  const driver = makeDriver(driverId, config, opts);

  // 1. Recall — pull relevant prior memories for this task.
  const recall = opts.recall ?? 5;
  let recallSection = "";
  if (recall > 0 && memory.count({ project }) > 0) {
    const hits = await memory.search(task, { limit: recall, project });
    if (hits.length > 0) {
      recallSection = [
        "Relevant prior context (most-similar memories first):",
        ...hits.map(
          (h, i) =>
            `${i + 1}. [${h.source || "?"} · ${h.createdAt}] ${h.text}`
        ),
      ].join("\n");
    }
  }

  // 2. Materialize the recall section into the markdown context file so
  //    the existing driver-side context-injection pipeline picks it up.
  //    .baton/context.md is now a *derived view* — overwritten on every run
  //    rather than appended.
  const renderedContext = renderContextView({
    task,
    recall: recallSection,
    project,
  });
  await store.writeContext(renderedContext);

  console.log(`[baton] task: ${task}`);
  console.log(`[baton] dispatching to: ${driver.id}`);
  if (recallSection) console.log(`[baton] recalled ${recall} prior memories`);

  await driver.start({ cwd, contextFile: store.contextFile });
  await driver.send(task);

  const startedAt = Date.now();
  const result = await driver.awaitDone();
  const durationMs = Date.now() - startedAt;

  await driver.stop();

  // 3. Store the step as a memory so future runs can recall it.
  const memoryText = renderStepMemory({
    task,
    agent: driver.id,
    summary: result.stdout,
    filesChanged: result.filesChanged,
    exitCode: result.exitCode,
  });
  const persisted = await memory.add(memoryText, {
    tags: ["step", driver.id, result.exitCode === 0 ? "ok" : "error"],
    source: driver.id,
    project,
  });

  // 4. Persist the per-step snapshot and append to the JSONL log. The
  //    markdown context file is now ephemeral, so don't append to it; the
  //    next run will regenerate it from the memory store.
  const snapshotPath = await store.writeSnapshot(
    persisted.id,
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

  memory.close();

  console.log("");
  console.log(`[baton] done. exit=${result.exitCode} in ${durationMs}ms`);
  if (result.filesChanged.length > 0) {
    console.log(`[baton] changed ${result.filesChanged.length} file(s):`);
    for (const f of result.filesChanged.slice(0, 20)) console.log(`  - ${f}`);
  } else {
    console.log("[baton] no working-tree changes detected.");
  }
  console.log(`[baton] memory:   id=${persisted.id} (project=${project})`);
  console.log(`[baton] log:      ${store.logFile}`);
  console.log(`[baton] snapshot: ${snapshotPath}`);
}

function renderContextView(args: {
  task: string;
  recall: string;
  project: string;
}): string {
  return [
    "# baton shared context",
    "",
    "_This file is a derived view, regenerated on every `baton run`. Source of truth is the memory store at .baton/memory.db._",
    "",
    `**Project:** ${args.project}`,
    `**Current task:** ${args.task}`,
    "",
    args.recall ? `## Recall\n\n${args.recall}\n` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function renderStepMemory(args: {
  task: string;
  agent: string;
  summary: string;
  filesChanged: string[];
  exitCode: number;
}): string {
  const files =
    args.filesChanged.length === 0
      ? "no files changed"
      : args.filesChanged.join(", ");
  const summaryLine = args.summary
    ? args.summary.slice(0, 800).trim()
    : "(no agent summary)";
  return [
    `[${args.agent}] ${args.task}`,
    `→ exit ${args.exitCode}, files: ${files}`,
    summaryLine,
  ].join("\n");
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

