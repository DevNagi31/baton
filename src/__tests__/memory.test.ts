import { describe, it, expect } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { MemoryStore } from "../memory/store.js";
import { HashEmbedder } from "../memory/embeddings.js";

async function freshStore(): Promise<MemoryStore> {
  const dir = await mkdtemp(join(tmpdir(), "baton-mem-"));
  return MemoryStore.open({
    batonDir: join(dir, ".baton"),
    embedder: new HashEmbedder(64),
  });
}

describe("MemoryStore", () => {
  it("adds and lists memories in reverse-chronological order", async () => {
    const store = await freshStore();
    await store.add("first memory");
    await store.add("second memory");
    await store.add("third memory");
    const all = store.list();
    expect(all).toHaveLength(3);
    expect(all[0].text).toBe("third memory");
    expect(all[2].text).toBe("first memory");
    store.close();
  });

  it("counts memories", async () => {
    const store = await freshStore();
    expect(store.count()).toBe(0);
    await store.add("a");
    await store.add("b");
    expect(store.count()).toBe(2);
    store.close();
  });

  it("deletes a memory by id", async () => {
    const store = await freshStore();
    const m = await store.add("doomed");
    expect(store.delete(m.id)).toBe(true);
    expect(store.delete(m.id)).toBe(false);
    expect(store.count()).toBe(0);
    store.close();
  });

  it("search returns the most similar memory first when queried with the same text", async () => {
    const store = await freshStore();
    await store.add("apples are red");
    await store.add("bananas are yellow");
    await store.add("the sky is blue");
    const hits = await store.search("apples are red", { limit: 3 });
    expect(hits).toHaveLength(3);
    expect(hits[0].text).toBe("apples are red");
    expect(hits[0].score).toBeCloseTo(1.0, 5);
  });

  it("limits search results to the requested count", async () => {
    const store = await freshStore();
    for (let i = 0; i < 10; i++) await store.add(`memory ${i}`);
    const hits = await store.search("memory 5", { limit: 3 });
    expect(hits).toHaveLength(3);
  });

  it("scopes list and search by project", async () => {
    const store = await freshStore();
    await store.add("alpha note", { project: "alpha" });
    await store.add("beta note", { project: "beta" });
    await store.add("alpha second", { project: "alpha" });

    const alphaList = store.list({ project: "alpha" });
    expect(alphaList).toHaveLength(2);
    expect(alphaList.every((m) => m.project === "alpha")).toBe(true);

    const alphaHits = await store.search("note", { project: "alpha", limit: 5 });
    expect(alphaHits.every((m) => m.project === "alpha")).toBe(true);
  });

  it("preserves tags and source on add", async () => {
    const store = await freshStore();
    const m = await store.add("tagged note", {
      tags: ["plan", "phase-2"],
      source: "claude",
    });
    expect(m.tags).toEqual(["plan", "phase-2"]);
    expect(m.source).toBe("claude");
  });

  it("persists across reopens", async () => {
    const dir = await mkdtemp(join(tmpdir(), "baton-mem-persist-"));
    const batonDir = join(dir, ".baton");
    const a = await MemoryStore.open({
      batonDir,
      embedder: new HashEmbedder(64),
    });
    await a.add("durable note");
    a.close();
    const b = await MemoryStore.open({
      batonDir,
      embedder: new HashEmbedder(64),
    });
    const all = b.list();
    expect(all).toHaveLength(1);
    expect(all[0].text).toBe("durable note");
    b.close();
  });
});
