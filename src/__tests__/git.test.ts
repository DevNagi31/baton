import { describe, it, expect, beforeEach } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execa } from "execa";
import { snapshot, changedSince, isGitRepo } from "../context/git.js";

async function freshRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "baton-git-"));
  await execa("git", ["init", "-b", "main"], { cwd: dir });
  await execa("git", ["config", "user.email", "test@example.com"], { cwd: dir });
  await execa("git", ["config", "user.name", "Test"], { cwd: dir });
  await execa("git", ["config", "commit.gpgsign", "false"], { cwd: dir });
  await writeFile(join(dir, "seed.txt"), "seed\n");
  await execa("git", ["add", "."], { cwd: dir });
  await execa("git", ["commit", "-m", "seed"], { cwd: dir });
  return dir;
}

describe("git helpers", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await freshRepo();
  });

  it("isGitRepo returns true inside a repo", async () => {
    expect(await isGitRepo(dir)).toBe(true);
  });

  it("isGitRepo returns false outside a repo", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "baton-nogit-"));
    expect(await isGitRepo(tmp)).toBe(false);
  });

  it("detects an added file via changedSince", async () => {
    const before = await snapshot(dir);
    await writeFile(join(dir, "new.txt"), "hello\n");
    const changed = await changedSince(dir, before);
    expect(changed.map((c) => c.path)).toEqual(["new.txt"]);
    expect(changed[0].status).toBe("untracked");
  });

  it("detects a modified file via changedSince", async () => {
    const before = await snapshot(dir);
    await writeFile(join(dir, "seed.txt"), "seed-mutated\n");
    const changed = await changedSince(dir, before);
    expect(changed.map((c) => c.path)).toEqual(["seed.txt"]);
    expect(changed[0].status).toBe("modified");
  });

  it("returns empty when nothing changed", async () => {
    const before = await snapshot(dir);
    const changed = await changedSince(dir, before);
    expect(changed).toEqual([]);
  });
});
