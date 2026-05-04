import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir } from "node:fs/promises";
import { join, basename } from "node:path";
import { tmpdir } from "node:os";
import {
  rememberNote,
  recallMemories,
  buildContinuationPrimer,
} from "../coordinator/recall.js";

// Force the deterministic embedder for all tests in this file so they
// don't trigger the ONNX model download. Also point BATON_HOME at a
// per-test temp dir so the global memory store is isolated across tests
// and doesn't touch the user's real ~/.baton.
const ORIGINAL_HASH = process.env.BATON_TEST_HASH_EMBEDDER;
const ORIGINAL_HOME = process.env.BATON_HOME;
beforeEach(async () => {
  process.env.BATON_TEST_HASH_EMBEDDER = "1";
  const home = await mkdtemp(join(tmpdir(), "baton-home-"));
  process.env.BATON_HOME = home;
});
afterEach(() => {
  if (ORIGINAL_HASH === undefined) delete process.env.BATON_TEST_HASH_EMBEDDER;
  else process.env.BATON_TEST_HASH_EMBEDDER = ORIGINAL_HASH;
  if (ORIGINAL_HOME === undefined) delete process.env.BATON_HOME;
  else process.env.BATON_HOME = ORIGINAL_HOME;
});

async function fixture(): Promise<string> {
  // The cwd still matters because rememberNote derives the project name
  // from basename(cwd) by default. The .baton/ subdirectory is no longer
  // used for the memory db (it's at BATON_HOME) but other artifacts may
  // still touch it.
  const dir = await mkdtemp(join(tmpdir(), "baton-recall-"));
  await mkdir(join(dir, ".baton"), { recursive: true });
  return dir;
}

describe("rememberNote", () => {
  it("saves a note with default tags and project", async () => {
    const cwd = await fixture();
    const m = await rememberNote(cwd, "decided to use sqlite over postgres");
    expect(m.text).toBe("decided to use sqlite over postgres");
    expect(m.tags).toEqual(["manual"]);
    expect(m.source).toBe("manual");
    expect(m.project).toBe(basename(cwd));
  });

  it("respects custom tags and project", async () => {
    const cwd = await fixture();
    const m = await rememberNote(cwd, "n", {
      tags: ["decision", "architecture"],
      project: "explicit",
    });
    expect(m.tags).toEqual(["decision", "architecture"]);
    expect(m.project).toBe("explicit");
  });

  it("rejects empty notes", async () => {
    const cwd = await fixture();
    await expect(rememberNote(cwd, "   ")).rejects.toThrow();
  });
});

describe("recallMemories", () => {
  it("lists recent entries without a query", async () => {
    const cwd = await fixture();
    await rememberNote(cwd, "first");
    await rememberNote(cwd, "second");
    await rememberNote(cwd, "third");
    const items = await recallMemories(cwd, { limit: 5 });
    expect(items).toHaveLength(3);
    expect(items[0].text).toBe("third");
  });

  it("returns ranked hits when given a query", async () => {
    const cwd = await fixture();
    await rememberNote(cwd, "we use sqlite for storage");
    await rememberNote(cwd, "the project is named baton");
    const items = (await recallMemories(cwd, {
      query: "what database does this use",
      limit: 2,
    })) as Array<{ score?: number }>;
    expect(items.length).toBeGreaterThan(0);
    expect("score" in items[0]).toBe(true);
  });

  it("can scope to one project", async () => {
    const cwd = await fixture();
    await rememberNote(cwd, "alpha note", { project: "alpha" });
    await rememberNote(cwd, "beta note", { project: "beta" });
    const items = await recallMemories(cwd, { project: "alpha", limit: 5 });
    expect(items).toHaveLength(1);
    expect(items[0].project).toBe("alpha");
  });
});

describe("buildContinuationPrimer", () => {
  it("emits a primer with structured memory entries", async () => {
    const cwd = await fixture();
    await rememberNote(cwd, "step 1: inited the repo", { project: "demo" });
    await rememberNote(cwd, "step 2: built the api", { project: "demo" });
    const primer = await buildContinuationPrimer(cwd, {
      fromProject: "demo",
    });
    expect(primer).toContain("baton");
    expect(primer).toContain("demo");
    expect(primer).toContain("step 1");
    expect(primer).toContain("step 2");
  });

  it("returns an instructive fallback when memory is empty", async () => {
    const cwd = await fixture();
    const primer = await buildContinuationPrimer(cwd);
    expect(primer.toLowerCase()).toContain("ask the user");
  });

  it("filters by project when --from is provided", async () => {
    const cwd = await fixture();
    await rememberNote(cwd, "alpha activity", { project: "alpha" });
    await rememberNote(cwd, "beta activity", { project: "beta" });
    const primer = await buildContinuationPrimer(cwd, {
      fromProject: "alpha",
    });
    expect(primer).toContain("alpha activity");
    expect(primer).not.toContain("beta activity");
  });

  it("ranks by query when one is provided", async () => {
    const cwd = await fixture();
    await rememberNote(cwd, "we shipped the predictor feature");
    await rememberNote(cwd, "we shipped the choropleth feature");
    await rememberNote(cwd, "lunch was good");
    const primer = await buildContinuationPrimer(cwd, {
      query: "what feature did we ship recently",
    });
    expect(primer).toContain("predictor");
    expect(primer).toContain("choropleth");
  });
});
