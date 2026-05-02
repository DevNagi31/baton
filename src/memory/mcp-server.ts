import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { MemoryStore } from "./store.js";
import { HashEmbedder } from "./embeddings.js";

// Stdio MCP server that exposes the local memory store as four tools.
// Designed to be invoked as a child process by an MCP-aware client
// (Claude Code, Cursor, Codex), or run standalone via `baton mcp` for
// debugging.

const TOOLS = [
  {
    name: "add_memory",
    description:
      "Persist a piece of context for future recall. Use this when the user shares a fact, decision, or preference worth remembering across sessions.",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "The memory content" },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Optional tags for filtering",
        },
        source: {
          type: "string",
          description: "Origin of the memory (agent name, session id, etc.)",
        },
        project: {
          type: ["string", "null"],
          description: "Optional project scope",
        },
      },
      required: ["text"],
    },
  },
  {
    name: "search_memory",
    description:
      "Retrieve memories most relevant to a query, ranked by semantic similarity. Use this at the start of a task to recover prior context.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        limit: {
          type: "number",
          description: "Max results (default 5)",
        },
        project: {
          type: ["string", "null"],
          description: "Restrict search to one project scope",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "list_memories",
    description:
      "List recent memories in reverse-chronological order. Useful for browsing what's been stored recently without a query.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Max results (default 50)" },
        project: { type: ["string", "null"] },
      },
    },
  },
  {
    name: "delete_memory",
    description: "Delete a memory by id.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "number" } },
      required: ["id"],
    },
  },
] as const;

export async function startMemoryMcpServer(opts: {
  batonDir: string;
}): Promise<{ close: () => Promise<void> }> {
  // BATON_TEST_HASH_EMBEDDER lets the integration tests skip the 22MB
  // ONNX model download and use a deterministic test embedder instead.
  const useHashEmbedder = process.env.BATON_TEST_HASH_EMBEDDER === "1";
  const memory = await MemoryStore.open({
    batonDir: opts.batonDir,
    embedder: useHashEmbedder ? new HashEmbedder(64) : undefined,
  });

  const server = new Server(
    { name: "baton-memory", version: "0.1.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const args = (req.params.arguments ?? {}) as Record<string, unknown>;
    try {
      switch (req.params.name) {
        case "add_memory": {
          const text = String(args.text ?? "");
          if (!text) throw new Error("add_memory: text is required");
          const m = await memory.add(text, {
            tags: Array.isArray(args.tags) ? (args.tags as string[]) : [],
            source: typeof args.source === "string" ? args.source : "",
            project:
              typeof args.project === "string"
                ? args.project
                : args.project === null
                ? null
                : null,
          });
          return ok({ id: m.id, createdAt: m.createdAt });
        }
        case "search_memory": {
          const query = String(args.query ?? "");
          if (!query) throw new Error("search_memory: query is required");
          const limit =
            typeof args.limit === "number" ? args.limit : 5;
          const project =
            typeof args.project === "string" ? args.project : undefined;
          const hits = await memory.search(query, { limit, project });
          return ok(
            hits.map((h) => ({
              id: h.id,
              text: h.text,
              score: round(h.score, 4),
              tags: h.tags,
              source: h.source,
              project: h.project,
              createdAt: h.createdAt,
            }))
          );
        }
        case "list_memories": {
          const limit =
            typeof args.limit === "number" ? args.limit : 50;
          const project =
            typeof args.project === "string" ? args.project : undefined;
          const list = memory.list({ limit, project });
          return ok(list);
        }
        case "delete_memory": {
          const id = Number(args.id);
          if (!Number.isInteger(id))
            throw new Error("delete_memory: id must be an integer");
          return ok({ deleted: memory.delete(id) });
        }
        default:
          throw new Error(`unknown tool: ${req.params.name}`);
      }
    } catch (err) {
      return {
        content: [
          { type: "text", text: (err as Error).message ?? "tool failed" },
        ],
        isError: true,
      };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);

  return {
    close: async () => {
      memory.close();
      await server.close();
    },
  };
}

function ok(payload: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
  };
}

function round(n: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}
