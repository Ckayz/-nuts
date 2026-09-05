import { describe, expect, test } from "bun:test";

const local = "postgresql://dummy:dummy@127.0.0.1:54322/local_test";
const remote = "postgresql://dummy:dummy@remote.invalid:5432/remote_test";

/**
 * Every libpq variable `pg` consults. They are cleared for every case so the
 * operator's own shell cannot make a result pass or fail, and so a case that
 * wants one can set exactly one.
 */
const PG_VARIABLES = [
  "PGHOST", "PGHOSTADDR", "PGPORT", "PGDATABASE", "PGUSER", "PGPASSWORD",
  "PGOPTIONS", "PGSERVICE", "PGSERVICEFILE", "PGSSLMODE", "PGCONNECT_TIMEOUT",
  "PGAPPNAME", "PGREQUIRESSL", "PGPASSFILE",
] as const;

// Fresh processes avoid import caching and isolate env loading. Explicit empty
// values prevent developer .env files from supplying either URL or the flag.
function readConfig(databaseUrl: string, directUrl = "", allowRemote = "", pgEnv: Record<string, string> = {}) {
  const cleared: Record<string, undefined> = {};
  for (const name of PG_VARIABLES) cleared[name] = undefined;
  const result = Bun.spawnSync([process.execPath, "--eval", `
    const { default: config } = await import("./drizzle.config.ts");
    const { Client } = await import("pg");
    const { host, port, database } = new Client({ connectionString: config.dbCredentials.url }).connectionParameters;
    console.log(JSON.stringify({ ...config.dbCredentials, destination: "drizzle-kit target: " + host + ":" + port + "/" + database }));
  `], {
    cwd: new URL("..", import.meta.url).pathname,
    env: { ...process.env, ...cleared, DATABASE_URL: databaseUrl, DIRECT_DATABASE_URL: directUrl, DRIZZLE_ALLOW_REMOTE: allowRemote, ...pgEnv },
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode === 0) {
    const { destination } = JSON.parse(result.stdout.toString());
    expect(result.stderr.toString().trim()).toBe(destination);
  }
  return { exitCode: result.exitCode, stdout: result.stdout.toString(), stderr: result.stderr.toString() };
}

describe("drizzle target fence", () => {
  for (const host of ["127.0.0.1", "localhost"]) {
    test(`${host} passes without remote permission`, () => {
      const url = local.replace("127.0.0.1", host);
      const result = readConfig(url);
      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout).url).toBe(url);
      expect(result.stderr.trim()).toBe(`drizzle-kit target: ${host}:54322/local_test`);
      expect(result.stderr).not.toContain("dummy");
    });
  }
  for (const name of ["host", "port", "%68ost", "HOST", "hostaddr", "dbname", "database", "%44aTaBaSe", "options", "OPTIONS", "%6fptions"]) {
    for (const flag of ["", "1"]) test(`query override ${name} rejected with flag=${flag}`, () => {
      const result = readConfig(`${local}?${name}=remote.invalid`, "", flag);
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("destination query overrides");
    });
  }
  test("search_path options are rejected", () => {
    const result = readConfig(`${local}?options=-c%20search_path%3Dother`);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("destination query overrides");
  });
  test("PGOPTIONS in the environment is refused (driver-level options bypass the URL check)", () => {
    // Passed through `readConfig`'s explicit PG* parameter rather than mutated
    // on `process.env`: the helper now CLEARS every libpq variable for each
    // case, so the operator's own shell cannot make this pass or fail.
    const result = readConfig(local, "", "", { PGOPTIONS: "-c search_path=evil,public" });
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("driver options");
  });

  test("driver-decoded database is printed", () => {
    expect(readConfig(local.replace("local_test", "local%5Ftest")).exitCode).toBe(0);
  });
  test("remote URL without flag throws", () => {
    const result = readConfig(remote);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("drizzle-kit target: remote.invalid:5432/remote_test");
    expect(result.stderr).toContain("Remote drizzle-kit targets require DRIZZLE_ALLOW_REMOTE=1");
  });
  test("remote URL with flag passes", () => {
    const result = readConfig(remote, "", "1");
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout).url).toBe(remote);
    expect(result.stderr.trim()).toBe("drizzle-kit target: remote.invalid:5432/remote_test");
  });
  /**
   * Lane A confirming pass: the gaps the fence had never been exercised on.
   *
   * The invariant every case below pins is ONE property, because it is the
   * property the fence exists for: the printed `drizzle-kit target:` line is
   * the DRIVER'S effective destination (not the URL string), and the loopback
   * allowlist is applied to that same effective host. `readConfig` asserts the
   * printed line equals the driver's parse on every success, so a PG* variable
   * that moved the destination without moving the print would fail here.
   *
   * Behaviours below were measured against pg 8.x on 2026-09-05; each case
   * states what was measured rather than what libpq documents.
   */
  describe("libpq environment variables and URL shapes", () => {
    test("an EMPTY PGOPTIONS is not a relocation and is allowed", () => {
      const result = readConfig(local, "", "", { PGOPTIONS: "" });
      expect(result.exitCode).toBe(0);
      expect(result.stderr.trim()).toBe("drizzle-kit target: 127.0.0.1:54322/local_test");
    });

    test("a non-empty PGOPTIONS is still refused (regression fence)", () => {
      const result = readConfig(local, "", "", { PGOPTIONS: "-c search_path=evil,public" });
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("driver options");
    });

    test("PGSERVICE does not move the destination away from the printed target", () => {
      // Measured: pg leaves host/port/database at the URL's own values, so the
      // printed line stays truthful. `readConfig` proves print === parse.
      const result = readConfig(local, "", "", { PGSERVICE: "some-service-name" });
      expect(result.exitCode).toBe(0);
      expect(result.stderr.trim()).toBe("drizzle-kit target: 127.0.0.1:54322/local_test");
    });

    test("PGHOST fills a hostless URL and is fenced as the real destination", () => {
      const result = readConfig("postgresql:///local_test", "", "", { PGHOST: "remote.invalid" });
      expect(result.exitCode).not.toBe(0);
      // The print names the host the driver would actually dial, not "".
      expect(result.stderr).toContain("drizzle-kit target: remote.invalid:5432/local_test");
      expect(result.stderr).toContain("Remote drizzle-kit targets require DRIZZLE_ALLOW_REMOTE=1");
    });

    test("a hostless URL with no PGHOST stays local and passes", () => {
      const result = readConfig("postgresql:///local_test");
      expect(result.exitCode).toBe(0);
      expect(result.stderr.trim()).toBe("drizzle-kit target: localhost:5432/local_test");
    });

    test("PGPORT moves the port and the printed target moves with it", () => {
      const result = readConfig("postgresql://dummy:dummy@127.0.0.1/local_test", "", "", { PGPORT: "9999" });
      expect(result.exitCode).toBe(0);
      expect(result.stderr.trim()).toBe("drizzle-kit target: 127.0.0.1:9999/local_test");
      // A URL port beats PGPORT, so the explicit selection is never overridden.
      expect(readConfig(local, "", "", { PGPORT: "9999" }).stderr.trim())
        .toBe("drizzle-kit target: 127.0.0.1:54322/local_test");
    });

    test("PGDATABASE fills an empty database path and the printed target names it", () => {
      const result = readConfig("postgresql://dummy:dummy@127.0.0.1:54322/", "", "", { PGDATABASE: "other_db" });
      expect(result.exitCode).toBe(0);
      expect(result.stderr.trim()).toBe("drizzle-kit target: 127.0.0.1:54322/other_db");
      // A URL database beats PGDATABASE.
      expect(readConfig(local, "", "", { PGDATABASE: "other_db" }).stderr.trim())
        .toBe("drizzle-kit target: 127.0.0.1:54322/local_test");
    });

    test("PGHOSTADDR does not silently replace the printed host", () => {
      const result = readConfig(local, "", "", { PGHOSTADDR: "203.0.113.9" });
      expect(result.exitCode).toBe(0);
      expect(result.stderr.trim()).toBe("drizzle-kit target: 127.0.0.1:54322/local_test");
    });

    /**
     * The allowlist is the two literals `127.0.0.1` and `localhost`, so the
     * IPv6 loopback is refused. That is fail-CLOSED (a real local target needs
     * DRIZZLE_ALLOW_REMOTE=1), and this test pins it as measured so widening
     * the allowlist is a deliberate, visible change rather than a drift.
     * TODO-OWNER: whether `::1` should join the loopback allowlist.
     */
    test("the IPv6 loopback is refused, not silently allowed", () => {
      const result = readConfig("postgresql://dummy:dummy@[::1]:54322/local_test");
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("drizzle-kit target: [::1]:54322/local_test");
      expect(result.stderr).toContain("Remote drizzle-kit targets require DRIZZLE_ALLOW_REMOTE=1");
      expect(readConfig("postgresql://dummy:dummy@[::1]:54322/local_test", "", "1").exitCode).toBe(0);
    });

    test("the postgres:// scheme is fenced exactly like postgresql://", () => {
      const localAlias = local.replace("postgresql://", "postgres://");
      const pass = readConfig(localAlias);
      expect(pass.exitCode).toBe(0);
      expect(pass.stderr.trim()).toBe("drizzle-kit target: 127.0.0.1:54322/local_test");

      const refused = readConfig(remote.replace("postgresql://", "postgres://"));
      expect(refused.exitCode).not.toBe(0);
      expect(refused.stderr).toContain("Remote drizzle-kit targets require DRIZZLE_ALLOW_REMOTE=1");

      const override = readConfig(`${localAlias}?host=remote.invalid`);
      expect(override.exitCode).not.toBe(0);
      expect(override.stderr).toContain("destination query overrides");
    });

    test("PG* variables never leak credentials into the printed target", () => {
      const result = readConfig(local, "", "", { PGPASSWORD: "hunter2", PGUSER: "someone" });
      expect(result.exitCode).toBe(0);
      expect(result.stderr).not.toContain("hunter2");
      expect(result.stderr).not.toContain("someone");
      expect(result.stderr).not.toContain("dummy");
    });
  });

  test("DIRECT_DATABASE_URL wins and is fenced even when DATABASE_URL is local", () => {
    const refused = readConfig(local, remote);
    expect(refused.exitCode).not.toBe(0);
    expect(refused.stderr).toContain("DRIZZLE_ALLOW_REMOTE=1");
    const allowed = readConfig(local, remote, "1");
    expect(allowed.exitCode).toBe(0);
    expect(JSON.parse(allowed.stdout).url).toBe(remote);
    const directLocal = readConfig(remote, local);
    expect(directLocal.exitCode).toBe(0);
    expect(JSON.parse(directLocal.stdout).url).toBe(local);
  });
});
