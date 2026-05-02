import { execa, type ResultPromise } from "execa";
import { readFile } from "node:fs/promises";
import { changedSince, snapshot } from "../context/git.js";
import type { Driver, DriverContext, DriverResult } from "./types.js";

type CursorJsonResult = {
  type: "result";
  subtype: string;
  is_error: boolean;
  result: string;
  session_id?: string;
  request_id?: string;
  duration_ms?: number;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
  };
};

export type CursorDriverOptions = {
  command?: string;
  extraArgs?: string[];
  // Cursor's free tier only allows the "auto" model. Paid tiers support
  // named models. Default to undefined so the CLI uses its config default;
  // callers on free tiers must pass model: "auto" explicitly.
  model?: string;
  // unattended uses --force to auto-approve commands. Caller must opt in.
  unattended: boolean;
};

export class CursorDriver implements Driver {
  readonly id = "cursor" as const;

  private ctx: DriverContext | null = null;
  private inflight: ResultPromise | null = null;
  private lastPrompt: string | null = null;

  constructor(private readonly opts: CursorDriverOptions) {}

  async start(ctx: DriverContext): Promise<void> {
    this.ctx = ctx;
  }

  async send(prompt: string): Promise<void> {
    this.lastPrompt = prompt;
  }

  async awaitDone(): Promise<DriverResult> {
    if (!this.ctx) throw new Error("CursorDriver: start() not called");
    if (this.lastPrompt == null) throw new Error("CursorDriver: send() not called");

    const cwd = this.ctx.cwd;
    const before = await snapshot(cwd);

    const sharedContext = await readContextSafe(this.ctx.contextFile);
    const fullPrompt = buildPrompt(sharedContext, this.lastPrompt);

    // Cursor takes the prompt as a positional argument, not stdin. argv
    // limits on macOS are ~256KB which comfortably fits a baton-sized
    // context-prefixed prompt; if a future scenario blows past that we'll
    // need a temp-file-based escape hatch.
    const args: string[] = [
      "--print",
      "--output-format",
      "json",
      "--trust",
      "--workspace",
      cwd,
      ...(this.opts.unattended ? ["--force"] : []),
      ...(this.opts.model ? ["--model", this.opts.model] : []),
      ...(this.opts.extraArgs ?? []),
      fullPrompt,
    ];

    this.inflight = execa(this.opts.command ?? "agent", args, {
      cwd,
      reject: false,
      maxBuffer: 50 * 1024 * 1024,
    });

    const result = await this.inflight;
    this.inflight = null;
    this.lastPrompt = null;

    const stdout = stringify(result.stdout);
    const stderr = stringify(result.stderr);

    let assistantText = "";
    try {
      const parsed = JSON.parse(stdout) as CursorJsonResult;
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
