import { execa, type ResultPromise } from "execa";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { changedSince, snapshot } from "../context/git.js";
import type { Driver, DriverContext, DriverResult } from "./types.js";

export type CodexDriverOptions = {
  command?: string;
  extraArgs?: string[];
  model?: string;
  // unattended uses --dangerously-bypass-approvals-and-sandbox so codex can
  // write/edit without prompting. Caller must opt in.
  unattended: boolean;
};

export class CodexDriver implements Driver {
  readonly id = "codex" as const;

  private ctx: DriverContext | null = null;
  private inflight: ResultPromise | null = null;
  private lastPrompt: string | null = null;

  constructor(private readonly opts: CodexDriverOptions) {}

  async start(ctx: DriverContext): Promise<void> {
    this.ctx = ctx;
  }

  async send(prompt: string): Promise<void> {
    this.lastPrompt = prompt;
  }

  async awaitDone(): Promise<DriverResult> {
    if (!this.ctx) throw new Error("CodexDriver: start() not called");
    if (this.lastPrompt == null) throw new Error("CodexDriver: send() not called");

    const cwd = this.ctx.cwd;
    const before = await snapshot(cwd);

    const sharedContext = await readContextSafe(this.ctx.contextFile);
    const fullPrompt = buildPrompt(sharedContext, this.lastPrompt);

    // Codex writes the last assistant message to a file when -o is set.
    // Cleaner than parsing JSONL events.
    const tmp = await mkdtemp(join(tmpdir(), "baton-codex-"));
    const outFile = join(tmp, "last.txt");

    const args: string[] = [
      "exec",
      "--skip-git-repo-check",
      "-C",
      cwd,
      "-o",
      outFile,
      ...(this.opts.unattended
        ? ["--dangerously-bypass-approvals-and-sandbox"]
        : ["-s", "workspace-write"]),
      ...(this.opts.model ? ["-m", this.opts.model] : []),
      ...(this.opts.extraArgs ?? []),
      fullPrompt,
    ];

    // Codex reads stdin for an additional prompt block when stdin is a
    // pipe. execa's default of an open pipe with no writes means codex
    // hangs forever waiting for that block. Close stdin immediately by
    // passing input: "" so codex sees EOF and proceeds with just the
    // positional prompt.
    this.inflight = execa(this.opts.command ?? "codex", args, {
      cwd,
      reject: false,
      input: "",
      maxBuffer: 50 * 1024 * 1024,
    });

    let result;
    try {
      result = await this.inflight;
    } finally {
      this.inflight = null;
      this.lastPrompt = null;
    }

    let assistantText = await readFileSafe(outFile);
    if (!assistantText) assistantText = stringify(result.stdout);

    // Synchronously await the tmp-dir cleanup so we don't race the parent
    // process exiting and leak directories into /tmp. Best-effort on
    // failure (a stale dir is preferable to crashing the run).
    await rm(tmp, { recursive: true, force: true }).catch(() => {});

    const changed = await changedSince(cwd, before);

    return {
      exitCode: typeof result.exitCode === "number" ? result.exitCode : 1,
      stdout: assistantText,
      stderr: stringify(result.stderr),
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

async function readFileSafe(path: string): Promise<string> {
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
