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
