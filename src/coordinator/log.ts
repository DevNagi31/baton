import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { StepLogEntry } from "../context/store.js";

export async function readLog(
  cwd: string,
  opts: { tail?: number } = {}
): Promise<StepLogEntry[]> {
  const path = join(cwd, ".baton", "log.jsonl");
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    return [];
  }
  const lines = raw.split("\n").filter((l) => l.trim().length > 0);
  const entries: StepLogEntry[] = [];
  for (const line of lines) {
    try {
      entries.push(JSON.parse(line) as StepLogEntry);
    } catch {
      // skip malformed lines rather than failing the whole read
    }
  }
  if (opts.tail && opts.tail > 0) {
    return entries.slice(-opts.tail);
  }
  return entries;
}
