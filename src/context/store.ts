import { readFile, writeFile, appendFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";

export type StepLogEntry = {
  ts: string;
  agent: string;
  stage: string;
  prompt: string;
  exitCode: number;
  durationMs: number;
  filesChanged: string[];
  // Truncated assistant text. Full output is captured into the per-step
  // snapshot file so the log stays grep-friendly.
  resultPreview: string;
};

export class ContextStore {
  constructor(private readonly batonDir: string) {}

  get contextFile(): string {
    return join(this.batonDir, "context.md");
  }

  get logFile(): string {
    return join(this.batonDir, "log.jsonl");
  }

  snapshotPath(stepIndex: number, agent: string): string {
    return join(this.batonDir, "snapshots", `${stepIndex}-${agent}.txt`);
  }

  async readContext(): Promise<string> {
    try {
      return await readFile(this.contextFile, "utf8");
    } catch {
      return "";
    }
  }

  async writeContext(content: string): Promise<void> {
    await mkdir(dirname(this.contextFile), { recursive: true });
    await writeFile(this.contextFile, content);
  }

  async appendContext(section: string): Promise<void> {
    const current = await this.readContext();
    const sep = current.endsWith("\n") || current === "" ? "" : "\n";
    await this.writeContext(current + sep + section + "\n");
  }

  async appendLog(entry: StepLogEntry): Promise<void> {
    await mkdir(dirname(this.logFile), { recursive: true });
    await appendFile(this.logFile, JSON.stringify(entry) + "\n");
  }

  async writeSnapshot(
    stepIndex: number,
    agent: string,
    content: string
  ): Promise<string> {
    const path = this.snapshotPath(stepIndex, agent);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content);
    return path;
  }
}
