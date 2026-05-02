import type { Driver, DriverContext, DriverResult } from "./types.js";

// TODO Phase 2: implement. Codex CLI's invocation surface is similar in
// spirit to Claude's; main difference will be the context-injection format
// (Codex reads AGENTS.md, not CLAUDE.md).
export class CodexDriver implements Driver {
  readonly id = "codex" as const;

  async start(_ctx: DriverContext): Promise<void> {
    throw new Error("CodexDriver.start: not implemented");
  }

  async send(_prompt: string): Promise<void> {
    throw new Error("CodexDriver.send: not implemented");
  }

  async awaitDone(): Promise<DriverResult> {
    throw new Error("CodexDriver.awaitDone: not implemented");
  }

  async stop(): Promise<void> {
    throw new Error("CodexDriver.stop: not implemented");
  }
}
