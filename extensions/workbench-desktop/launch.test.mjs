import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { EventEmitter } from "node:events";
import { existsSync, readFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import path from "node:path";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { ensureDatabaseReady } from "./database-startup.mjs";

const workbench = fileURLToPath(new URL("../../", import.meta.url));
const runtime = { executable: "configured-reader.exe", config: "configured.yaml", database: { kind: "windows-service", name: "postgresql-x64-17" } };
const unavailable = () => { throw new Error("database_unavailable: database is not accepting connections"); };

test("ready database does not start any owner", async () => {
  await ensureDatabaseReady(runtime, {
    probe: async (request) => assert.deepEqual(request, { executable: runtime.executable, config: runtime.config, resource: "projects" }),
    run: () => assert.fail("must not start a ready database"),
  });
});

for (const message of ["schema_mismatch: required table missing", "authentication_failed: denied", "SpecGraph node reader exited with code 1"]) {
  test(`${message} fails without starting an owner`, async () => {
    await assert.rejects(ensureDatabaseReady(runtime, {
      probe: async () => { throw new Error(message); },
      run: () => assert.fail("must not start for a non-connectivity error"),
    }), { message });
  });
}

test("Docker startup uses only the configured existing local container", async () => {
  const commands = [];
  let reads = 0;
  await ensureDatabaseReady({ ...runtime, database: { kind: "docker", name: "configured-postgres" } }, {
    probe: async () => { if (reads++ === 0) unavailable(); },
    run: (executable, args, options) => {
      assert.equal(options.windowsHide, true);
      assert.equal(options.shell, false);
      assert(options.timeout > 0);
      commands.push([executable, args]);
      return { status: 0 };
    },
  });
  assert.equal(reads, 2);
  assert.deepEqual(commands, [
    ["docker", ["desktop", "start", "--timeout", "60"]],
    ["docker", ["--context", "desktop-linux", "start", "configured-postgres"]],
  ]);
});

test("startup failure and readiness timeout remain explicit failures", async () => {
  await assert.rejects(ensureDatabaseReady(runtime, {
    probe: unavailable, run: () => ({ status: 1, stderr: "Access denied" }),
  }), /Database startup failed.*Access denied/);
  await assert.rejects(ensureDatabaseReady(runtime, {
    probe: unavailable, run: () => ({ status: 0 }), timeoutMs: 5,
  }), /Database readiness timed out/);
});

for (const state of ["ready", "unavailable", "schema_mismatch"]) {
  test(`launch ${state}: readiness gates Electron and scratch is cleaned`, async () => {
    const manifest = JSON.parse(readFileSync(path.join(workbench, "desktop-runtime.json"), "utf8"));
    let scratch;
    let reads = 0;
    const events = [];
    const originalSpawn = childProcess.spawn;
    const originalSpawnSync = childProcess.spawnSync;
    const environment = { ...process.env };
    const originalExitCode = process.exitCode;
    childProcess.spawn = (executable, args, options) => {
      assert.equal(executable, path.resolve(workbench, manifest.executable));
      assert.deepEqual(args, ["workbench-stdio", "--config", path.resolve(workbench, manifest.config)]);
      assert.equal(options.shell, false);
      scratch = process.env.TEMP;
      assert(existsSync(scratch));
      const child = new EventEmitter();
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.stdin = new PassThrough();
      child.kill = () => child.emit("close", 1);
      child.stdin.once("data", (data) => {
        assert.equal(JSON.parse(data).resource, "projects");
        process.nextTick(() => {
          reads++;
          events.push("probe");
          const code = state === "schema_mismatch" ? state : state === "unavailable" && reads === 1 ? "database_unavailable" : null;
          child.stdout.end(JSON.stringify({ id: "node-read", ...(code ? { error: { code, message: "not ready" } } : { data: { projects: [] } }) }));
          child.emit("close", 0);
        });
      });
      return child;
    };
    childProcess.spawnSync = (executable, args, options) => {
      if (executable === "powershell.exe") {
        assert.equal(manifest.database.kind, "windows-service");
        assert(args.at(-1).includes(`Get-Service -Name '${manifest.database.name}'`));
        assert(args.at(-1).includes("if ($service.Status -eq 'Stopped') { Start-Service"));
        assert(args.at(-1).includes("$service.Status -ne 'Running' -and $service.Status -ne 'StartPending'"));
        assert.equal(options.windowsHide, true);
        assert.equal(options.shell, false);
        assert.equal(options.timeout, 20000);
        events.push("service");
        return { status: 0 };
      }
      assert(existsSync(executable));
      assert.equal(options.windowsHide, false);
      assert.equal(args.at(-1), path.resolve(workbench, manifest.desktop, "dist-electron/main.cjs"));
      assert.equal(options.env.T3CODE_HOME, path.join(workbench, "runtime/t3-desktop"));
      assert.equal(options.env.T3CODE_DESKTOP_USER_DATA_DIR, path.join(workbench, "runtime/t3-desktop/electron-user-data"));
      assert.equal(options.env.VACPMS_HOME, workbench);
      assert.equal(options.env.APPDATA, environment.APPDATA);
      assert.equal(options.env.VITE_DEV_SERVER_URL, undefined);
      assert.equal(options.env.T3CODE_PORT, undefined);
      assert.equal(options.env.ELECTRON_RUN_AS_NODE, undefined);
      assert.equal(path.dirname(scratch), options.env.T3CODE_HOME);
      events.push("electron");
      return { status: 0 };
    };
    syncBuiltinESMExports();
    try {
      process.env.VITE_DEV_SERVER_URL = "http://localhost:5733";
      process.env.T3CODE_PORT = "13774";
      process.env.ELECTRON_RUN_AS_NODE = "1";
      const launched = import(`./launch.mjs?state=${state}`);
      if (state === "schema_mismatch") await assert.rejects(launched, /schema_mismatch: not ready/);
      else await launched;
      assert.deepEqual(events, state === "ready" ? ["probe", "electron"] : state === "unavailable" ? ["probe", "service", "probe", "electron"] : ["probe"]);
      assert(scratch);
      assert.equal(existsSync(scratch), false);
    } finally {
      childProcess.spawn = originalSpawn;
      childProcess.spawnSync = originalSpawnSync;
      syncBuiltinESMExports();
      for (const key of Object.keys(process.env)) if (!(key in environment)) delete process.env[key];
      Object.assign(process.env, environment);
      process.exitCode = originalExitCode;
    }
  });
}
