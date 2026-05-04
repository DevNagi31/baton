import { basename } from "node:path";
import { MemoryStore, type Memory, type MemoryHit } from "../memory/store.js";
import { HashEmbedder } from "../memory/embeddings.js";
import { getMemoryDbDir } from "../memory/location.js";

function openMemory(): Promise<MemoryStore> {
  return MemoryStore.open({
    batonDir: getMemoryDbDir(),
    embedder:
      process.env.BATON_TEST_HASH_EMBEDDER === "1"
        ? new HashEmbedder(64)
        : undefined,
  });
}

// Save a freeform checkpoint into the memory store. The intent is for the
// user (or a Claude Code Stop hook) to call this any time something is
// worth remembering across sessions — a decision made, a context switch,
// a bug found.
export async function rememberNote(
  cwd: string,
  text: string,
  opts: { tags?: string[]; project?: string | null } = {}
): Promise<Memory> {
  if (!text.trim()) throw new Error("baton remember: note text is empty");
  const memory = await openMemory();
  try {
    return await memory.add(text, {
      tags: opts.tags ?? ["manual"],
      source: "manual",
      project: opts.project === undefined ? basename(cwd) : opts.project,
    });
  } finally {
    memory.close();
  }
}

// Browse memories. With a query, ranks by semantic similarity. Without a
// query, returns recent entries in reverse-chronological order.
export async function recallMemories(
  cwd: string,
  opts: {
    query?: string;
    project?: string | null;
    limit?: number;
  } = {}
): Promise<MemoryHit[] | Memory[]> {
  const memory = await openMemory();
  try {
    const limit = opts.limit ?? 10;
    if (opts.query?.trim()) {
      return await memory.search(opts.query, {
        limit,
        project: opts.project,
      });
    }
    return memory.list({ limit, project: opts.project });
  } finally {
    memory.close();
  }
}

// Delete a memory by id. Returns true if a row was actually removed.
export async function forgetMemory(id: number): Promise<boolean> {
  const memory = await openMemory();
  try {
    return memory.delete(id);
  } finally {
    memory.close();
  }
}

// Build a primer string suitable for `claude --append-system-prompt`,
// `codex exec`, or just pasting into a fresh session. Pulls the most
// relevant recent memories from one or all projects and formats them as
// context the next agent should use without repeating back.
export async function buildContinuationPrimer(
  cwd: string,
  opts: {
    fromProject?: string;
    query?: string;
    limit?: number;
  } = {}
): Promise<string> {
  const limit = opts.limit ?? 10;
  const memory = await openMemory();
  try {
    let items: (Memory | MemoryHit)[];
    if (opts.query?.trim()) {
      items = await memory.search(opts.query, {
        limit,
        project: opts.fromProject ?? undefined,
      });
    } else {
      items = memory.list({
        limit,
        project: opts.fromProject ?? undefined,
      });
    }

    if (items.length === 0) {
      return [
        "You are resuming work via baton, but the memory store has no",
        opts.fromProject
          ? `entries scoped to project "${opts.fromProject}".`
          : "entries yet.",
        "Ask the user what they were working on.",
      ].join(" ");
    }

    const lines: string[] = [
      "You are resuming work via baton. The following memories were stored",
      "during recent sessions across this user's projects. Use them as",
      "context but do not echo them back verbatim.",
      "",
      opts.fromProject
        ? `## Recent activity in project "${opts.fromProject}"`
        : "## Recent activity (most recent across all projects)",
      "",
    ];
    for (let i = 0; i < items.length; i++) {
      const m = items[i];
      const proj = m.project ? `project=${m.project}` : "project=∅";
      const tags = m.tags.length ? ` tags=${m.tags.join(",")}` : "";
      lines.push(
        `${i + 1}. [${m.createdAt} · ${m.source || "?"} · ${proj}${tags}]`
      );
      // Indent the body so the structure stays readable.
      for (const bodyLine of m.text.split("\n")) {
        lines.push(`   ${bodyLine}`);
      }
      lines.push("");
    }

    return lines.join("\n");
  } finally {
    memory.close();
  }
}
