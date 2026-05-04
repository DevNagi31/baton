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
  .command("remember")
  .description(
    "Save a freeform note to the memory store. Use this whenever something is worth remembering across sessions, terminals, or projects."
  )
  .argument("<note>", "Note text")
  .option(
    "--tags <list>",
    "Comma-separated tags to attach to the memory",
    (v) => v.split(",").map((t) => t.trim()).filter(Boolean)
  )
  .option(
    "--project <name>",
    "Project scope (defaults to the basename of the current directory)"
  )
  .action(
    async (
      note: string,
      opts: { tags?: string[]; project?: string }
    ) => {
      const { rememberNote } = await import("../coordinator/recall.js");
      const m = await rememberNote(process.cwd(), note, {
        tags: opts.tags,
        project: opts.project,
      });
      console.log(`[baton] saved memory id=${m.id} project=${m.project ?? "∅"}`);
    }
  );

program
  .command("recall")
  .description(
    "Browse the memory store. Without a query, lists recent entries; with a query, ranks by semantic similarity."
  )
  .argument("[query]", "Optional search query")
  .option(
    "--project <name>",
    "Restrict results to one project scope (default: across all projects)"
  )
  .option("--limit <n>", "Max results", (v) => parseInt(v, 10), 10)
  .action(
    async (
      query: string | undefined,
      opts: { project?: string; limit: number }
    ) => {
      const { recallMemories } = await import("../coordinator/recall.js");
      const items = await recallMemories(process.cwd(), {
        query,
        project: opts.project,
        limit: opts.limit,
      });
      if (items.length === 0) {
        console.log("[baton] no memories found.");
        return;
      }
      for (const m of items) {
        const proj = m.project ?? "∅";
        const tags = m.tags.length ? ` tags=${m.tags.join(",")}` : "";
        const score =
          "score" in m
            ? ` score=${(m as { score: number }).score.toFixed(3)}`
            : "";
        console.log(
          `\n#${m.id} [${m.createdAt}] ${m.source || "?"} project=${proj}${tags}${score}`
        );
        console.log(m.text);
      }
    }
  );

program
  .command("forget")
  .description("Delete a memory by id. Pair with `baton recall` to find the id first.")
  .argument("<id>", "Memory id (integer, as printed by `baton recall`)")
  .action(async (idStr: string) => {
    const id = parseInt(idStr, 10);
    if (!Number.isInteger(id))
      throw new Error(`baton forget: id must be an integer, got "${idStr}"`);
    const { forgetMemory } = await import("../coordinator/recall.js");
    const removed = await forgetMemory(id);
    console.log(removed ? `[baton] removed memory id=${id}` : `[baton] no memory with id=${id}`);
  });

program
  .command("log")
  .description("Pretty-print the per-step JSONL log from .baton/log.jsonl in the current project.")
  .option("--tail <n>", "Show only the last N entries", (v) => parseInt(v, 10))
  .action(async (opts: { tail?: number }) => {
    const { readLog } = await import("../coordinator/log.js");
    const entries = await readLog(process.cwd(), { tail: opts.tail });
    if (entries.length === 0) {
      console.log("[baton] no log entries (run `baton run …` first)");
      return;
    }
    for (const e of entries) {
      const ok = e.exitCode === 0 ? "✓" : "✗";
      const files = e.filesChanged.length === 0 ? "no files" : e.filesChanged.join(", ");
      console.log(
        `${ok} ${e.ts}  [${e.agent}] ${(e.durationMs / 1000).toFixed(1)}s  ${files}`
      );
      console.log(`   ${e.prompt}`);
      if (e.resultPreview) console.log(`   → ${e.resultPreview.replace(/\s+/g, " ").slice(0, 200)}`);
      console.log("");
    }
  });

program
  .command("continue")
  .description(
    "Generate a continuation primer from recent memories. Print it to stdout (or pipe into `claude --append-system-prompt -` to launch a session pre-loaded with prior context). Solves the 'session doesn't follow me across cwd' problem."
  )
  .option(
    "--from <project>",
    "Restrict to one project scope (default: across all projects)"
  )
  .option("--query <text>", "Search query (default: most recent activity)")
  .option("--limit <n>", "How many memories to include", (v) => parseInt(v, 10), 10)
  .action(
    async (opts: { from?: string; query?: string; limit: number }) => {
      const { buildContinuationPrimer } = await import(
        "../coordinator/recall.js"
      );
      const primer = await buildContinuationPrimer(process.cwd(), {
        fromProject: opts.from,
        query: opts.query,
        limit: opts.limit,
      });
      console.log(primer);
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
    const { getMemoryDbDir } = await import("../memory/location.js");
    const batonDir = opts.batonDir ?? getMemoryDbDir();
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
