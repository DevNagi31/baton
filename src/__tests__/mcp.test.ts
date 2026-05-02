import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

// Spin up the real MCP server as a subprocess (so the stdio transport is
// exercised), connect with the SDK client, and call each tool. This is the
// integration test for Phase 2b.

describe("baton-memory MCP server", () => {
  let dir: string;
  let client: Client;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "baton-mcp-"));
    // Run via tsx so we don't need a build step in CI.
    const tsx = join(process.cwd(), "node_modules", ".bin", "tsx");
    const transport = new StdioClientTransport({
      command: tsx,
      args: [
        join(process.cwd(), "src", "cli", "index.ts"),
        "mcp",
        "--baton-dir",
        join(dir, ".baton"),
      ],
      env: {
        ...process.env,
        // Force HashEmbedder via env var, so tests don't try to download
        // 22MB of ONNX weights.
        BATON_TEST_HASH_EMBEDDER: "1",
      } as Record<string, string>,
    });
    client = new Client(
      { name: "baton-test-client", version: "0.0.0" },
      { capabilities: {} }
    );
    await client.connect(transport);
  }, 60_000);

  afterAll(async () => {
    await client?.close();
  });

  it("lists the four tools", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([
      "add_memory",
      "delete_memory",
      "list_memories",
      "search_memory",
    ]);
  });

  it("add_memory returns an id and createdAt", async () => {
    const res = await client.callTool({
      name: "add_memory",
      arguments: { text: "user prefers vitest over jest", source: "test" },
    });
    expect(res.isError).toBeFalsy();
    const content = res.content as Array<{ type: string; text: string }>;
    const parsed = JSON.parse(content[0].text);
    expect(parsed.id).toBeGreaterThan(0);
    expect(typeof parsed.createdAt).toBe("string");
  });

  it("search_memory finds the memory we just added", async () => {
    const res = await client.callTool({
      name: "search_memory",
      arguments: { query: "vitest jest preference", limit: 3 },
    });
    expect(res.isError).toBeFalsy();
    const content = res.content as Array<{ type: string; text: string }>;
    const hits = JSON.parse(content[0].text);
    expect(Array.isArray(hits)).toBe(true);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].text).toContain("vitest");
  });

  it("list_memories returns recent entries", async () => {
    const res = await client.callTool({
      name: "list_memories",
      arguments: { limit: 10 },
    });
    expect(res.isError).toBeFalsy();
    const list = JSON.parse(
      (res.content as Array<{ type: string; text: string }>)[0].text
    );
    expect(Array.isArray(list)).toBe(true);
    expect(list.length).toBeGreaterThan(0);
  });

  it("delete_memory removes by id", async () => {
    const add = await client.callTool({
      name: "add_memory",
      arguments: { text: "doomed memory" },
    });
    const { id } = JSON.parse(
      (add.content as Array<{ type: string; text: string }>)[0].text
    );
    const del = await client.callTool({
      name: "delete_memory",
      arguments: { id },
    });
    expect(del.isError).toBeFalsy();
    const result = JSON.parse(
      (del.content as Array<{ type: string; text: string }>)[0].text
    );
    expect(result.deleted).toBe(true);
  });

  it("returns isError for invalid arguments", async () => {
    const res = await client.callTool({
      name: "add_memory",
      arguments: {},
    });
    expect(res.isError).toBe(true);
  });
});
