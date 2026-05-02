import { readFile, writeFile, appendFile } from "node:fs/promises";
import { join } from "node:path";

export type StepLogEntry = {
  ts: string;
  agent: string;
  stage: string;
  prompt: string;
  exitCode: number;
  filesChanged: string[];
};

export class ContextStore {
  constructor(private readonly batonDir: string) {}

  get contextFile(): string {
    return join(this.batonDir, "context.md");
  }

  get logFile(): string {
    return join(this.batonDir, "log.jsonl");
  }

  async readContext(): Promise<string> {
    return readFile(this.contextFile, "utf8");
  }

  async writeContext(content: string): Promise<void> {
    await writeFile(this.contextFile, content);
  }

  async appendLog(entry: StepLogEntry): Promise<void> {
    await appendFile(this.logFile, JSON.stringify(entry) + "\n");
  }
}
