import { readFile } from "node:fs/promises";
import { z } from "zod";

// A benchmark task is a single prompt with one or more evaluators that
// inspect the working tree after the agent runs. v1 keeps the evaluator
// vocabulary deliberately small — every check should be deterministic and
// fast (no LLM-as-judge) so re-running a benchmark is cheap.

const Evaluator = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("file_exists"),
    path: z.string(),
  }),
  z.object({
    type: z.literal("file_contains"),
    path: z.string(),
    text: z.string(),
  }),
  z.object({
    type: z.literal("file_equals"),
    path: z.string(),
    text: z.string(),
  }),
  z.object({
    type: z.literal("exit_zero"),
  }),
  z.object({
    type: z.literal("max_files_changed"),
    n: z.number().int().positive(),
  }),
]);

export type Evaluator = z.infer<typeof Evaluator>;

export const Task = z.object({
  id: z.string(),
  prompt: z.string(),
  // Each task gets evaluated independently against the working tree the
  // agent leaves behind. All evaluators must pass for a task to be a pass.
  evaluators: z.array(Evaluator).min(1),
  // Optional tag string for grouping (e.g. "easy", "edit", "refactor")
  category: z.string().optional(),
});

export type Task = z.infer<typeof Task>;

export const Spec = z.object({
  name: z.string(),
  description: z.string().optional(),
  tasks: z.array(Task).min(1),
});

export type Spec = z.infer<typeof Spec>;

export async function loadSpec(path: string): Promise<Spec> {
  const raw = await readFile(path, "utf8");
  return Spec.parse(JSON.parse(raw));
}
