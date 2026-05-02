// Lazy-loaded text embedding service backed by transformers.js.
// On first call, the model (~22MB) downloads to the user's cache and stays
// resident in memory for the lifetime of the process. Subsequent calls
// take ~5–20ms per text on Apple Silicon.

export interface Embedder {
  embed(text: string): Promise<Float32Array>;
  // Stable identifier for the model — useful if we ever migrate the schema
  // and need to re-embed everything.
  readonly model: string;
  readonly dimensions: number;
}

const DEFAULT_MODEL = "Xenova/all-MiniLM-L6-v2";
const DEFAULT_DIM = 384;

let cachedPipeline: unknown = null;
let cachedPromise: Promise<unknown> | null = null;

async function loadPipeline(model: string): Promise<unknown> {
  if (cachedPipeline) return cachedPipeline;
  if (cachedPromise) return cachedPromise;
  cachedPromise = (async () => {
    // Dynamic import so the (heavy) ONNX runtime doesn't load when callers
    // import the module without needing embeddings (e.g. unit tests).
    const { pipeline, env } = await import("@xenova/transformers");
    // Allow the cache to live alongside the user's npm cache, not inside
    // node_modules where it would be wiped on reinstall.
    env.allowLocalModels = false;
    env.useBrowserCache = false;
    const p = await pipeline("feature-extraction", model);
    cachedPipeline = p;
    return p;
  })();
  return cachedPromise;
}

export class TransformersEmbedder implements Embedder {
  readonly model: string;
  readonly dimensions: number;

  constructor(opts: { model?: string; dimensions?: number } = {}) {
    this.model = opts.model ?? DEFAULT_MODEL;
    this.dimensions = opts.dimensions ?? DEFAULT_DIM;
  }

  async embed(text: string): Promise<Float32Array> {
    const pipe = (await loadPipeline(this.model)) as (
      input: string,
      options: { pooling: "mean"; normalize: boolean }
    ) => Promise<{ data: Float32Array }>;
    const out = await pipe(text, { pooling: "mean", normalize: true });
    return new Float32Array(out.data);
  }
}

// Test-friendly embedder that skips ML entirely. Hashes the text to a
// deterministic float vector so unit tests can run without downloading
// 22MB of ONNX weights or holding the runtime in memory.
export class HashEmbedder implements Embedder {
  readonly model = "test:hash";
  readonly dimensions: number;

  constructor(dim = 32) {
    this.dimensions = dim;
  }

  async embed(text: string): Promise<Float32Array> {
    const out = new Float32Array(this.dimensions);
    let h = 2166136261;
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    // Spread the hash deterministically across dimensions so different
    // strings produce different vectors but identical strings collide.
    for (let i = 0; i < this.dimensions; i++) {
      h ^= h << 13;
      h ^= h >>> 17;
      h ^= h << 5;
      out[i] = ((h >>> 0) / 0xffffffff) * 2 - 1;
    }
    // L2 normalize so cosine works as expected.
    let mag = 0;
    for (let i = 0; i < this.dimensions; i++) mag += out[i] * out[i];
    mag = Math.sqrt(mag);
    if (mag > 0) for (let i = 0; i < this.dimensions; i++) out[i] /= mag;
    return out;
  }
}
