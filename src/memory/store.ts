import { join } from "node:path";
import { MemoryStorage, type MemoryRow } from "./storage.js";
import { TransformersEmbedder, type Embedder } from "./embeddings.js";

export type Memory = Omit<MemoryRow, "embedding">;

export type MemoryHit = Memory & { score: number };

export type AddOptions = {
  tags?: string[];
  source?: string;
  project?: string | null;
};

export type SearchOptions = {
  limit?: number;
  project?: string | null;
};

export class MemoryStore {
  static async open(opts: {
    batonDir: string;
    embedder?: Embedder;
  }): Promise<MemoryStore> {
    const storage = await MemoryStorage.open(join(opts.batonDir, "memory.db"));
    const embedder = opts.embedder ?? new TransformersEmbedder();
    return new MemoryStore(storage, embedder);
  }

  private constructor(
    private readonly storage: MemoryStorage,
    private readonly embedder: Embedder
  ) {}

  async add(text: string, opts: AddOptions = {}): Promise<Memory> {
    const embedding = await this.embedder.embed(text);
    const row = this.storage.add({
      text,
      embedding,
      tags: opts.tags,
      source: opts.source,
      project: opts.project,
    });
    return stripEmbedding(row);
  }

  async search(query: string, opts: SearchOptions = {}): Promise<MemoryHit[]> {
    const embedding = await this.embedder.embed(query);
    const rows = this.storage.search(embedding, opts);
    return rows.map((r) => ({ ...stripEmbedding(r), score: r.score }));
  }

  list(opts: SearchOptions = {}): Memory[] {
    return this.storage.list(opts).map(stripEmbedding);
  }

  delete(id: number): boolean {
    return this.storage.delete(id);
  }

  count(opts: { project?: string | null } = {}): number {
    return this.storage.count(opts);
  }

  close(): void {
    this.storage.close();
  }

  get embedderModel(): string {
    return this.embedder.model;
  }
}

function stripEmbedding(row: MemoryRow): Memory {
  const { embedding: _e, ...rest } = row;
  return rest;
}
