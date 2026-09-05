import { describe, expect, test } from "bun:test";

const local = "postgresql://dummy:dummy@127.0.0.1:54322/local_test";
const remote = "postgresql://dummy:dummy@remote.invalid:5432/remote_test";

// Fresh processes avoid import caching and isolate env loading. Explicit empty
// values prevent developer .env files from supplying either URL or the flag.
function readConfig(databaseUrl: string, directUrl = "", allowRemote = "") {
  const result = Bun.spawnSync([process.execPath, "--eval", `
    const { default: config } = await import("./drizzle.config.ts");
    console.log(JSON.stringify(config.dbCredentials));
  `], {
    cwd: new URL("..", import.meta.url).pathname,
    env: { ...process.env, DATABASE_URL: databaseUrl, DIRECT_DATABASE_URL: directUrl, DRIZZLE_ALLOW_REMOTE: allowRemote },
    stdout: "pipe",
    stderr: "pipe",
  });
  return { exitCode: result.exitCode, stdout: result.stdout.toString(), stderr: result.stderr.toString() };
}

describe("drizzle target fence", () => {
  for (const host of ["127.0.0.1", "localhost"]) {
    test(`${host} passes without remote permission`, () => {
      const url = local.replace("127.0.0.1", host);
      const result = readConfig(url);
      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual({ url });
      expect(result.stderr.trim()).toBe(`drizzle-kit target: ${host}:54322/local_test`);
      expect(result.stderr).not.toContain("dummy");
    });
  }
  test("remote URL without flag throws", () => {
    const result = readConfig(remote);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("drizzle-kit target: remote.invalid:5432/remote_test");
    expect(result.stderr).toContain("Remote drizzle-kit targets require DRIZZLE_ALLOW_REMOTE=1");
  });
  test("remote URL with flag passes", () => {
    const result = readConfig(remote, "", "1");
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ url: remote });
    expect(result.stderr.trim()).toBe("drizzle-kit target: remote.invalid:5432/remote_test");
  });
  test("DIRECT_DATABASE_URL wins and is fenced even when DATABASE_URL is local", () => {
    const refused = readConfig(local, remote);
    expect(refused.exitCode).not.toBe(0);
    expect(refused.stderr).toContain("DRIZZLE_ALLOW_REMOTE=1");
    const allowed = readConfig(local, remote, "1");
    expect(allowed.exitCode).toBe(0);
    expect(JSON.parse(allowed.stdout)).toEqual({ url: remote });
    const directLocal = readConfig(remote, local);
    expect(directLocal.exitCode).toBe(0);
    expect(JSON.parse(directLocal.stdout)).toEqual({ url: local });
  });
});
