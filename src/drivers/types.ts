export type DriverId = "claude" | "codex" | "cursor";

export interface DriverContext {
  cwd: string;
  contextFile: string;
}

export interface Driver {
  readonly id: DriverId;
  start(ctx: DriverContext): Promise<void>;
  send(prompt: string): Promise<void>;
  awaitDone(): Promise<DriverResult>;
  stop(): Promise<void>;
}

export type DriverResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
  filesChanged: string[];
};
