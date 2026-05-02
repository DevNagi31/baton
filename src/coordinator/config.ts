import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

const AgentConfig = z.object({
  command: z.string(),
  enabled: z.boolean().default(true),
  extraArgs: z.array(z.string()).default([]),
});

export const Config = z.object({
  version: z.literal(1),
  agents: z.object({
    claude: AgentConfig,
    codex: AgentConfig,
    cursor: AgentConfig,
  }),
  routing: z.object({
    plan: z.enum(["claude", "codex", "cursor"]).default("claude"),
    implement: z.enum(["claude", "codex", "cursor"]).default("codex"),
    review: z.enum(["claude", "codex", "cursor"]).default("claude"),
  }),
  // Hard guardrails on a single `baton run`. Each agent invocation costs
  // tokens; without a cap, a runaway plan could chew through credit fast.
  limits: z
    .object({
      maxSteps: z.number().int().positive().default(10),
      perStepTimeoutMs: z.number().int().positive().default(600_000),
    })
    .default({}),
});

export type Config = z.infer<typeof Config>;

export async function loadConfig(cwd: string): Promise<Config> {
  const path = join(cwd, ".baton", "config.json");
  const raw = await readFile(path, "utf8");
  const parsed = JSON.parse(raw);
  return Config.parse(parsed);
}
