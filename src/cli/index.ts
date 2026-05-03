#!/usr/bin/env node
import { Command } from "commander";
import { join } from "node:path";
import { runTask } from "../coordinator/run.js";
import { initProject } from "../coordinator/init.js";
// MCP server imported lazily inside the `mcp` action — its eager import
// pulls in the @modelcontextprotocol/sdk stdio transport which appears to
// detach the parent process's stdin in a way that breaks downstream
// `execa({ input })` calls. Lazy-loading isolates the side effects to the
// one command that actually needs them.

const program = new Command();

program
  .name("baton")
  .description("Sequential collaboration across Claude, Cursor, and Codex CLIs.")
  .version("0.0.1");

program
  .command("init")
  .description("Initialize a .baton/ directory in the current repo.")
  .action(async () => {
    await initProject(process.cwd());
  });

program
  .command("run")
  .description("Run a task across the configured agents.")
  .argument("<task>", "Plain-English task description")
  .option(
    "--agent <id>",
    "Which driver to dispatch to: claude | codex | cursor (defaults to config.routing.plan)"
  )
  .option(
    "--unattended",
    "Skip permission prompts in the underlying CLIs (bypassPermissions). Required for fully non-interactive runs."
  )
  .option("--model <model>", "Override the model for this run")
  .option(
    "--recall <n>",
    "How many prior memories to surface in the prompt (default 5, set 0 to disable)",
    (v) => parseInt(v, 10)
  )
  .action(
    async (
      task: string,
      opts: {
        agent?: string;
        unattended?: boolean;
        model?: string;
        recall?: number;
      }
    ) => {
      const agent = opts.agent as "claude" | "codex" | "cursor" | undefined;
      if (agent && !["claude", "codex", "cursor"].includes(agent)) {
        throw new Error(`invalid --agent: ${agent}`);
      }
      await runTask(process.cwd(), task, {
        agent,
        unattended: opts.unattended,
        model: opts.model,
        recall: opts.recall,
      });
    }
  );

program
  .command("bench")
  .description(
    "Run a benchmark spec across one or more agents. Each (agent, task) runs in an isolated scratch repo so agents can't pollute each other."
  )
  .requiredOption(
    "--spec <path>",
    "Path to a benchmark spec JSON (see examples/bench-mini.json)"
  )
  .option(
    "--agents <list>",
    "Comma-separated list of agents to run: claude,codex,cursor (default: claude)",
    "claude"
  )
  .option(
    "--out <path>",
    "Where to write the JSONL results (default: .baton/bench/<timestamp>.jsonl)"
  )
  .option(
    "--unattended",
    "Pass unattended mode through to each driver. Required for non-interactive bench runs.",
    false
  )
  .option("--model <model>", "Override the model for every run")
  .action(
    async (opts: {
      spec: string;
      agents: string;
      out?: string;
      unattended: boolean;
      model?: string;
    }) => {
      const { loadSpec } = await import("../bench/spec.js");
      const { runSpec, summarize } = await import("../bench/runner.js");
      const ids = opts.agents
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      for (const id of ids) {
        if (!["claude", "codex", "cursor"].includes(id)) {
          throw new Error(`invalid agent in --agents: ${id}`);
        }
      }
      const spec = await loadSpec(opts.spec);
      const out =
        opts.out ??
        join(
          process.cwd(),
          ".baton",
          "bench",
          `${new Date().toISOString().replace(/[:.]/g, "-")}.jsonl`
        );
      console.log(
        `[baton bench] ${spec.name} · ${spec.tasks.length} tasks × ${ids.length} agents = ${spec.tasks.length * ids.length} runs`
      );
      const results = await runSpec(spec, {
        agents: ids as Array<"claude" | "codex" | "cursor">,
        unattended: opts.unattended,
        outputPath: out,
        model: opts.model,
        onProgress: (s) => console.log(`  ${s}`),
      });
      const summary = summarize(results);
      console.log("");
      console.log("[baton bench] summary:");
      for (const [agent, m] of Object.entries(summary.byAgent)) {
        console.log(
          `  ${agent.padEnd(8)} pass ${m.passes}/${m.runs} (${(m.passRate * 100).toFixed(0)}%)  mean ${(m.meanDurationMs / 1000).toFixed(1)}s  mean ${m.meanFilesChanged.toFixed(1)} files`
        );
      }
      console.log(`[baton bench] results: ${out}`);
    }
  );

program
  .command("mcp")
  .description(
    "Run the baton-memory MCP server on stdio. Connect any MCP-aware client (Claude Code, Cursor, Codex) to this process for shared semantic memory."
  )
  .option(
    "--baton-dir <path>",
    "Directory holding memory.db (defaults to ./.baton)"
  )
  .action(async (opts: { batonDir?: string }) => {
    const batonDir = opts.batonDir ?? join(process.cwd(), ".baton");
    // Note: log to stderr only — stdout is the MCP transport channel.
    console.error(`[baton mcp] starting memory server at ${batonDir}`);
    const { startMemoryMcpServer } = await import(
      "../memory/mcp-server.js"
    );
    await startMemoryMcpServer({ batonDir });
    // Keep the process alive until the transport closes.
    await new Promise<void>(() => {});
  });

program.parseAsync(process.argv).catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
