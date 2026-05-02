import type { Driver, DriverContext, DriverResult } from "./types.js";

// TODO Phase 1: implement using `execa` to spawn `claude` with stdin/stdout
// piped. Need to figure out the cleanest way to inject the shared context
// (either via a CLAUDE.md file written before spawn, or via a leading prompt
// segment).
export class ClaudeDriver implements Driver {
  readonly id = "claude" as const;

  async start(_ctx: DriverContext): Promise<void> {
    throw new Error("ClaudeDriver.start: not implemented");
  }

  async send(_prompt: string): Promise<void> {
    throw new Error("ClaudeDriver.send: not implemented");
  }

  async awaitDone(): Promise<DriverResult> {
    throw new Error("ClaudeDriver.awaitDone: not implemented");
  }

  async stop(): Promise<void> {
    throw new Error("ClaudeDriver.stop: not implemented");
  }
}
