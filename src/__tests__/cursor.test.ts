import { describe, it, expect, beforeEach } from "vitest";
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execa } from "execa";
import { CursorDriver } from "../drivers/cursor.js";

// Build a fake `agent` binary that:
// 1. Echoes its argv to stderr (so we can assert flags)
// 2. Prints a Cursor-shaped JSON success envelope to stdout
// 3. Optionally writes a file to simulate an edit
async function makeFakeAgent(
  binDir: string,
  opts: { writeFile?: { path: string; content: string }; exitCode?: number }
): Promise<string> {
  await mkdir(binDir, { recursive: true });
  const path = join(binDir, "agent");
  const writeFileLine = opts.writeFile
    ? `printf '%s' ${JSON.stringify(opts.writeFile.content)} > "$workspace/${opts.writeFile.path}"`
    : "";
  const exitCode = opts.exitCode ?? 0;
  const script = `#!/bin/bash
set -e
workspace="$PWD"
args=("$@")
i=0
while [ $i -lt \${#args[@]} ]; do
  case "\${args[$i]}" in
    --workspace) workspace="\${args[$((i+1))]}" ;;
  esac
  i=$((i+1))
done
echo "FAKE_AGENT_ARGV $@" >&2
${writeFileLine}
cat <<JSON
{"type":"result","subtype":"success","is_error":false,"duration_ms":1234,"result":"fake cursor agent message","session_id":"test-session","request_id":"test-request","usage":{"inputTokens":100,"outputTokens":50,"cacheReadTokens":0,"cacheWriteTokens":0}}
JSON
exit ${exitCode}
`;
  await writeFile(path, script, { mode: 0o755 });
  return path;
}

async function freshRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "baton-cursor-it-"));
  await execa("git", ["init", "-b", "main"], { cwd: dir });
  await execa("git", ["config", "user.email", "test@example.com"], { cwd: dir });
  await execa("git", ["config", "user.name", "Test"], { cwd: dir });
  await execa("git", ["config", "commit.gpgsign", "false"], { cwd: dir });
  await writeFile(join(dir, "seed.txt"), "seed\n");
  await execa("git", ["add", "."], { cwd: dir });
  await execa("git", ["commit", "-m", "seed"], { cwd: dir });
  await mkdir(join(dir, ".baton"), { recursive: true });
  return dir;
}

describe("CursorDriver", () => {
  let cwd: string;
  beforeEach(async () => {
    cwd = await freshRepo();
  });

  it("invokes agent with --print --output-format json --trust", async () => {
    const fake = await makeFakeAgent(join(cwd, "bin"), {});
    const driver = new CursorDriver({
      command: fake,
      unattended: true,
      model: "auto",
    });
    await driver.start({ cwd, contextFile: join(cwd, ".baton", "context.md") });
    await driver.send("do the thing");
    const result = await driver.awaitDone();
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("fake cursor agent message");
    expect(result.stderr).toContain("--print");
    expect(result.stderr).toContain("--output-format json");
    expect(result.stderr).toContain("--trust");
    expect(result.stderr).toContain(`--workspace ${cwd}`);
  });

  it("passes --force when unattended", async () => {
    const fake = await makeFakeAgent(join(cwd, "bin"), {});
    const driver = new CursorDriver({
      command: fake,
      unattended: true,
      model: "auto",
    });
    await driver.start({ cwd, contextFile: join(cwd, ".baton", "context.md") });
    await driver.send("foo");
    const result = await driver.awaitDone();
    expect(result.stderr).toContain("--force");
  });

  it("omits --force when not unattended", async () => {
    const fake = await makeFakeAgent(join(cwd, "bin"), {});
    const driver = new CursorDriver({
      command: fake,
      unattended: false,
      model: "auto",
    });
    await driver.start({ cwd, contextFile: join(cwd, ".baton", "context.md") });
    await driver.send("foo");
    const result = await driver.awaitDone();
    expect(result.stderr).not.toContain("--force");
  });

  it("propagates the model flag", async () => {
    const fake = await makeFakeAgent(join(cwd, "bin"), {});
    const driver = new CursorDriver({
      command: fake,
      unattended: true,
      model: "sonnet-4",
    });
    await driver.start({ cwd, contextFile: join(cwd, ".baton", "context.md") });
    await driver.send("foo");
    const result = await driver.awaitDone();
    expect(result.stderr).toContain("--model sonnet-4");
  });

  it("captures file changes via git diff", async () => {
    const fake = await makeFakeAgent(join(cwd, "bin"), {
      writeFile: { path: "from-cursor.txt", content: "hello from cursor\n" },
    });
    const driver = new CursorDriver({
      command: fake,
      unattended: true,
      model: "auto",
    });
    await driver.start({ cwd, contextFile: join(cwd, ".baton", "context.md") });
    await driver.send("create the file");
    const result = await driver.awaitDone();
    expect(result.filesChanged).toContain("from-cursor.txt");
  });

  it("returns non-zero exitCode when subprocess fails", async () => {
    const fake = await makeFakeAgent(join(cwd, "bin"), { exitCode: 2 });
    const driver = new CursorDriver({
      command: fake,
      unattended: true,
      model: "auto",
    });
    await driver.start({ cwd, contextFile: join(cwd, ".baton", "context.md") });
    await driver.send("foo");
    const result = await driver.awaitDone();
    expect(result.exitCode).toBe(2);
  });

  it("prepends shared context when present", async () => {
    const fake = await makeFakeAgent(join(cwd, "bin"), {});
    const ctxPath = join(cwd, ".baton", "context.md");
    await writeFile(ctxPath, "previous step did Z");
    const driver = new CursorDriver({
      command: fake,
      unattended: true,
      model: "auto",
    });
    await driver.start({ cwd, contextFile: ctxPath });
    await driver.send("now do W");
    const result = await driver.awaitDone();
    // Cursor takes the prompt as a positional argument, so the prompt
    // (with the baton-context block) shows up in argv echoed to stderr.
    expect(result.stderr).toContain("baton-context");
    expect(result.stderr).toContain("previous step did Z");
    expect(result.stderr).toContain("now do W");
  });
});

describe("CursorDriver integration (gated on CURSOR_AGENT_LIVE)", () => {
  // Cursor's free tier has a request cap; running this test against the
  // real agent CLI counts against that cap. Set CURSOR_AGENT_LIVE=1 only
  // when you want to spend a request on verification.
  it.skipIf(!process.env.CURSOR_AGENT_LIVE)(
    "runs the real cursor agent CLI end-to-end",
    async () => {
      cwd = await freshRepo();
      const driver = new CursorDriver({
        unattended: true,
        model: "auto",
      });
      await driver.start({ cwd, contextFile: join(cwd, ".baton", "context.md") });
      await driver.send(
        "Create a file named hello.txt with exactly the line: hello"
      );
      const result = await driver.awaitDone();
      expect(result.exitCode).toBe(0);
      expect(result.filesChanged).toContain("hello.txt");
    },
    300_000
  );
  let cwd: string;
});
