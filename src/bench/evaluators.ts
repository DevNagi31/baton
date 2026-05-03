import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type { Evaluator } from "./spec.js";
import type { DriverResult } from "../drivers/types.js";

export type EvalResult = {
  evaluator: Evaluator;
  passed: boolean;
  detail?: string;
};

export async function evaluate(
  evaluators: Evaluator[],
  cwd: string,
  result: DriverResult
): Promise<EvalResult[]> {
  const out: EvalResult[] = [];
  for (const e of evaluators) {
    out.push(await runOne(e, cwd, result));
  }
  return out;
}

async function runOne(
  e: Evaluator,
  cwd: string,
  result: DriverResult
): Promise<EvalResult> {
  switch (e.type) {
    case "file_exists": {
      const exists = await pathExists(join(cwd, e.path));
      return {
        evaluator: e,
        passed: exists,
        detail: exists ? undefined : `${e.path} not found`,
      };
    }
    case "file_contains": {
      const path = join(cwd, e.path);
      const exists = await pathExists(path);
      if (!exists)
        return { evaluator: e, passed: false, detail: `${e.path} not found` };
      const content = await readFile(path, "utf8");
      const ok = content.includes(e.text);
      return {
        evaluator: e,
        passed: ok,
        detail: ok ? undefined : `expected substring not present in ${e.path}`,
      };
    }
    case "file_equals": {
      const path = join(cwd, e.path);
      const exists = await pathExists(path);
      if (!exists)
        return { evaluator: e, passed: false, detail: `${e.path} not found` };
      const content = await readFile(path, "utf8");
      const ok = content === e.text;
      return {
        evaluator: e,
        passed: ok,
        detail: ok
          ? undefined
          : `content mismatch (got ${content.length} bytes, expected ${e.text.length})`,
      };
    }
    case "exit_zero": {
      const ok = result.exitCode === 0;
      return {
        evaluator: e,
        passed: ok,
        detail: ok ? undefined : `exit ${result.exitCode}`,
      };
    }
    case "max_files_changed": {
      const ok = result.filesChanged.length <= e.n;
      return {
        evaluator: e,
        passed: ok,
        detail: ok
          ? undefined
          : `changed ${result.filesChanged.length} files (max ${e.n})`,
      };
    }
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}
