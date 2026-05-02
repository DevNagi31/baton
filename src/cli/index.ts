#!/usr/bin/env node
import { Command } from "commander";
import { runTask } from "../coordinator/run.js";
import { initProject } from "../coordinator/init.js";

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
  .action(async (task: string) => {
    await runTask(process.cwd(), task);
  });

program.parseAsync(process.argv).catch((err) => {
  console.error(err);
  process.exit(1);
});
