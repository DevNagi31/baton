import { execa, type ResultPromise } from "execa";
import { readFile } from "node:fs/promises";
import { changedSince, snapshot } from "../context/git.js";
import type { Driver, DriverContext, DriverResult } from "./types.js";

type ClaudeJsonResult = {
  type: "result";
  subtype: string;
  is_error: boolean;
  result: string;
  session_id?: string;
  total_cost_usd?: number;
  duration_ms?: number;
};

export type ClaudeDriverOptions = {
  command?: string;
  extraArgs?: string[];
  model?: string;
  // bypassPermissions runs Claude without confirming each tool call. Required
  // for fully non-interactive operation. Caller must opt in.
  unattended: boolean;
};

export class ClaudeDriver implements Driver {
  readonly id = "claude" as const;

  private ctx: DriverContext | null = null;
  private inflight: ResultPromise | null = null;
  private lastPrompt: string | null = null;

  constructor(private readonly opts: ClaudeDriverOptions) {}

  async start(ctx: DriverContext): Promise<void> {
    this.ctx = ctx;
  }

  // For the non-interactive driver, send() doesn't push to a long-lived
  // process; it queues the prompt to be used on the next awaitDone().
  async send(prompt: string): Promise<void> {
    this.lastPrompt = prompt;
  }

  async awaitDone(): Promise<DriverResult> {
    if (!this.ctx) throw new Error("ClaudeDriver: start() not called");
    if (this.lastPrompt == null) throw new Error("ClaudeDriver: send() not called");

    const cwd = this.ctx.cwd;
    const before = await snapshot(cwd);

    const sharedContext = await readContextSafe(this.ctx.contextFile);
    const fullPrompt = buildPrompt(sharedContext, this.lastPrompt);

    const args: string[] = [
      "-p",
      "--output-format",
      "json",
      ...(this.opts.unattended
        ? ["--permission-mode", "bypassPermissions"]
        : []),
      ...(this.opts.model ? ["--model", this.opts.model] : []),
      ...(this.opts.extraArgs ?? []),
    ];

    this.inflight = execa(this.opts.command ?? "claude", args, {
      cwd,
      reject: false,
      input: fullPrompt,
      // Give the subprocess a generous chunk of stdio buffer so json output
      // doesn't get truncated.
      maxBuffer: 50 * 1024 * 1024,
    });

    const result = await this.inflight;
    this.inflight = null;
    this.lastPrompt = null;

    const stdout = stringify(result.stdout);
    const stderr = stringify(result.stderr);

    let assistantText = "";
    try {
      const parsed = JSON.parse(stdout) as ClaudeJsonResult;
      assistantText = parsed.result ?? "";
    } catch {
      assistantText = stdout;
    }

    const changed = await changedSince(cwd, before);

    return {
      exitCode: typeof result.exitCode === "number" ? result.exitCode : 1,
      stdout: assistantText,
      stderr,
      filesChanged: changed.map((c) => c.path),
    };
  }

  async stop(): Promise<void> {
    if (this.inflight) {
      this.inflight.kill("SIGTERM");
      this.inflight = null;
    }
  }
}

function stringify(v: unknown): string {
  if (typeof v === "string") return v;
  if (v == null) return "";
  if (v instanceof Uint8Array) return Buffer.from(v).toString("utf8");
  if (Array.isArray(v)) return v.map((x) => stringify(x)).join("");
  return String(v);
}

async function readContextSafe(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return "";
  }
}

function buildPrompt(sharedContext: string, userPrompt: string): string {
  if (!sharedContext.trim()) return userPrompt;
  return [
    "You are one of several AI agents collaborating on a single task via baton.",
    "The shared running context is below. Use it; do not repeat it back.",
    "",
    "<baton-context>",
    sharedContext.trim(),
    "</baton-context>",
    "",
    "Your turn:",
    userPrompt,
  ].join("\n");
}
