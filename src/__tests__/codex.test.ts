import { describe, it, expect, beforeEach } from "vitest";
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execa } from "execa";
import { CodexDriver } from "../drivers/codex.js";

// Build a fake `codex` binary as a shell script that:
// 1. Echoes its argv to stderr (so we can assert on flags)
// 2. Writes a fixed assistant message to the path passed via -o
// 3. Optionally writes a file in cwd to simulate a real edit
async function makeFakeCodex(
  binDir: string,
  opts: { writeFile?: { path: string; content: string }; exitCode?: number }
): Promise<string> {
  await mkdir(binDir, { recursive: true });
  const path = join(binDir, "codex");
  const writeFileLine = opts.writeFile
    ? `printf '%s' ${JSON.stringify(opts.writeFile.content)} > "$cwd/${opts.writeFile.path}"`
    : "";
  const exitCode = opts.exitCode ?? 0;
  const script = `#!/bin/bash
set -e
out_file=""
cwd="$PWD"
args=("$@")
i=0
while [ $i -lt \${#args[@]} ]; do
  case "\${args[$i]}" in
    -o) out_file="\${args[$((i+1))]}" ;;
    -C) cwd="\${args[$((i+1))]}" ;;
  esac
  i=$((i+1))
done
echo "FAKE_CODEX_ARGV $@" >&2
if [ -n "$out_file" ]; then
  printf 'fake codex assistant message' > "$out_file"
fi
${writeFileLine}
exit ${exitCode}
`;
  await writeFile(path, script, { mode: 0o755 });
  return path;
}

async function freshRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "baton-codex-it-"));
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

describe("CodexDriver", () => {
  let cwd: string;
  beforeEach(async () => {
    cwd = await freshRepo();
  });

  it("invokes codex exec with correct flags in unattended mode", async () => {
    const fake = await makeFakeCodex(join(cwd, "bin"), {
      writeFile: { path: "from-codex.txt", content: "hello\n" },
    });
    const driver = new CodexDriver({ command: fake, unattended: true });
    await driver.start({ cwd, contextFile: join(cwd, ".baton", "context.md") });
    await driver.send("do the thing");
    const result = await driver.awaitDone();
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("fake codex assistant message");
    expect(result.filesChanged).toContain("from-codex.txt");
    // unattended should pass the bypass flag
    expect(result.stderr).toContain("--dangerously-bypass-approvals-and-sandbox");
  });

  it("uses workspace-write sandbox when not unattended", async () => {
    const fake = await makeFakeCodex(join(cwd, "bin"), {});
    const driver = new CodexDriver({ command: fake, unattended: false });
    await driver.start({ cwd, contextFile: join(cwd, ".baton", "context.md") });
    await driver.send("foo");
    const result = await driver.awaitDone();
    expect(result.stderr).toContain("-s workspace-write");
    expect(result.stderr).not.toContain("--dangerously-bypass");
  });

  it("propagates the model flag", async () => {
    const fake = await makeFakeCodex(join(cwd, "bin"), {});
    const driver = new CodexDriver({
      command: fake,
      unattended: true,
      model: "o3-mini",
    });
    await driver.start({ cwd, contextFile: join(cwd, ".baton", "context.md") });
    await driver.send("foo");
    const result = await driver.awaitDone();
    expect(result.stderr).toContain("-m o3-mini");
  });

  it("returns non-zero exitCode when the subprocess fails", async () => {
    const fake = await makeFakeCodex(join(cwd, "bin"), { exitCode: 2 });
    const driver = new CodexDriver({ command: fake, unattended: true });
    await driver.start({ cwd, contextFile: join(cwd, ".baton", "context.md") });
    await driver.send("foo");
    const result = await driver.awaitDone();
    expect(result.exitCode).toBe(2);
  });

  it("prepends shared context from contextFile when present", async () => {
    const fake = await makeFakeCodex(join(cwd, "bin"), {});
    const ctxPath = join(cwd, ".baton", "context.md");
    await writeFile(ctxPath, "previous step did X");
    const driver = new CodexDriver({ command: fake, unattended: true });
    await driver.start({ cwd, contextFile: ctxPath });
    await driver.send("now do Y");
    const result = await driver.awaitDone();
    // The fake codex echoes argv to stderr; the prompt is the last argument
    expect(result.stderr).toContain("baton-context");
    expect(result.stderr).toContain("previous step did X");
    expect(result.stderr).toContain("now do Y");
  });
});

describe("CodexDriver integration (gated on OPENAI_API_KEY)", () => {
  it.skipIf(!process.env.OPENAI_API_KEY)(
    "runs the real codex CLI end-to-end",
    async () => {
      cwd = await freshRepo();
      const driver = new CodexDriver({ unattended: true });
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
