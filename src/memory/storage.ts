import Database from "better-sqlite3";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

export type MemoryRow = {
  id: number;
  text: string;
  embedding: Float32Array;
  tags: string[];
  source: string;
  project: string | null;
  createdAt: string;
};

export type AddInput = {
  text: string;
  embedding: Float32Array;
  tags?: string[];
  source?: string;
  project?: string | null;
};

const SCHEMA = `
CREATE TABLE IF NOT EXISTS memories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  text TEXT NOT NULL,
  embedding BLOB NOT NULL,
  tags TEXT NOT NULL DEFAULT '[]',
  source TEXT NOT NULL DEFAULT '',
  project TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_memories_project ON memories(project);
CREATE INDEX IF NOT EXISTS idx_memories_source ON memories(source);
CREATE INDEX IF NOT EXISTS idx_memories_created_at ON memories(created_at);
`;

export class MemoryStorage {
  private db: Database.Database;

  static async open(path: string): Promise<MemoryStorage> {
    await mkdir(dirname(path), { recursive: true });
    return new MemoryStorage(path);
  }

  private constructor(path: string) {
    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(SCHEMA);
  }

  add(input: AddInput): MemoryRow {
    const buf = Buffer.from(
      input.embedding.buffer,
      input.embedding.byteOffset,
      input.embedding.byteLength
    );
    const stmt = this.db.prepare(
      `INSERT INTO memories (text, embedding, tags, source, project)
       VALUES (?, ?, ?, ?, ?)`
    );
    const info = stmt.run(
      input.text,
      buf,
      JSON.stringify(input.tags ?? []),
      input.source ?? "",
      input.project ?? null
    );
    return this.get(Number(info.lastInsertRowid))!;
  }

  get(id: number): MemoryRow | null {
    const row = this.db
      .prepare(
        `SELECT id, text, embedding, tags, source, project, created_at
         FROM memories WHERE id = ?`
      )
      .get(id) as RawRow | undefined;
    return row ? mapRow(row) : null;
  }

  delete(id: number): boolean {
    const info = this.db
      .prepare(`DELETE FROM memories WHERE id = ?`)
      .run(id);
    return info.changes > 0;
  }

  count(filter?: { project?: string | null }): number {
    if (filter?.project !== undefined) {
      const row = this.db
        .prepare(`SELECT COUNT(*) AS c FROM memories WHERE project IS ?`)
        .get(filter.project) as { c: number };
      return row.c;
    }
    const row = this.db
      .prepare(`SELECT COUNT(*) AS c FROM memories`)
      .get() as { c: number };
    return row.c;
  }

  list(filter?: {
    project?: string | null;
    limit?: number;
  }): MemoryRow[] {
    const limit = filter?.limit ?? 50;
    let rows: RawRow[];
    if (filter?.project !== undefined) {
      rows = this.db
        .prepare(
          `SELECT id, text, embedding, tags, source, project, created_at
           FROM memories WHERE project IS ? ORDER BY id DESC LIMIT ?`
        )
        .all(filter.project, limit) as RawRow[];
    } else {
      rows = this.db
        .prepare(
          `SELECT id, text, embedding, tags, source, project, created_at
           FROM memories ORDER BY id DESC LIMIT ?`
        )
        .all(limit) as RawRow[];
    }
    return rows.map(mapRow);
  }

  // Brute-force cosine over all rows. Personal memory tops out at ~10K
  // entries; at 384-dim float32 that's ~15MB scanned per query — well under
  // 50ms in practice. Swap for an index once we have evidence it's needed.
  search(
    queryEmbedding: Float32Array,
    opts: { limit?: number; project?: string | null } = {}
  ): Array<MemoryRow & { score: number }> {
    const k = opts.limit ?? 5;
    let rows: RawRow[];
    if (opts.project !== undefined) {
      rows = this.db
        .prepare(
          `SELECT id, text, embedding, tags, source, project, created_at
           FROM memories WHERE project IS ?`
        )
        .all(opts.project) as RawRow[];
    } else {
      rows = this.db
        .prepare(
          `SELECT id, text, embedding, tags, source, project, created_at
           FROM memories`
        )
        .all() as RawRow[];
    }
    const scored = rows.map((r) => {
      const row = mapRow(r);
      return { ...row, score: cosine(queryEmbedding, row.embedding) };
    });
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, k);
  }

  close(): void {
    this.db.close();
  }
}

type RawRow = {
  id: number;
  text: string;
  embedding: Buffer;
  tags: string;
  source: string;
  project: string | null;
  created_at: string;
};

function mapRow(r: RawRow): MemoryRow {
  return {
    id: r.id,
    text: r.text,
    embedding: new Float32Array(
      r.embedding.buffer,
      r.embedding.byteOffset,
      r.embedding.byteLength / Float32Array.BYTES_PER_ELEMENT
    ).slice(),
    tags: JSON.parse(r.tags) as string[],
    source: r.source,
    project: r.project,
    createdAt: r.created_at,
  };
}

function cosine(a: Float32Array, b: Float32Array): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  if (magA === 0 || magB === 0) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}
