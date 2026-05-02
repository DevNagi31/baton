import type { Driver, DriverContext, DriverResult } from "./types.js";

// TODO Phase 3: this is the hard one. Cursor's `agent` CLI session model is
// the least documented of the three. May require a different driver pattern
// (e.g., file-watch-based coordination instead of stdin/stdout).
export class CursorDriver implements Driver {
  readonly id = "cursor" as const;

  async start(_ctx: DriverContext): Promise<void> {
    throw new Error("CursorDriver.start: not implemented");
  }

  async send(_prompt: string): Promise<void> {
    throw new Error("CursorDriver.send: not implemented");
  }

  async awaitDone(): Promise<DriverResult> {
    throw new Error("CursorDriver.awaitDone: not implemented");
  }

  async stop(): Promise<void> {
    throw new Error("CursorDriver.stop: not implemented");
  }
}
