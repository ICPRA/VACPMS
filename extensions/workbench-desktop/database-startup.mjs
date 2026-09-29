import { spawnSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { readWorkbench } from "./read-node.mjs";

export async function ensureDatabaseReady(runtime, { probe = readWorkbench, run = spawnSync, timeoutMs = 60000 } = {}) {
  const request = { executable: runtime.executable, config: runtime.config, resource: "projects" };
  try {
    await probe(request);
    return;
  } catch (error) {
    if (!error.message.startsWith("database_unavailable:")) throw error;
  }

  const database = runtime.database;
  if (!database || !["windows-service", "docker"].includes(database.kind)
      || typeof database.name !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(database.name)) {
    throw new Error("Database unavailable: desktop-runtime.json must identify its managed database kind and name");
  }
  const commands = database.kind === "windows-service"
    ? [["powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
      `$ErrorActionPreference = 'Stop'; $service = Get-Service -Name '${database.name}'; if ($service.Status -eq 'Stopped') { Start-Service -InputObject $service } elseif ($service.Status -ne 'Running' -and $service.Status -ne 'StartPending') { throw \"Database service is $($service.Status)\" }`], 20000]]
    : [["docker", ["desktop", "start", "--timeout", "60"], 65000], ["docker", ["--context", "desktop-linux", "start", database.name], 20000]];
  for (const [executable, args, timeout] of commands) {
    const result = run(executable, args, { windowsHide: true, shell: false, timeout, encoding: "utf8" });
    if (result.error) throw new Error(`Database startup failed: ${result.error.message}`, { cause: result.error });
    if (result.status !== 0) throw new Error(`Database startup failed (${executable}, exit ${result.status}): ${result.stderr?.trim() || result.stdout?.trim() || "no command output"}`);
  }

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await probe(request, AbortSignal.timeout(Math.max(1, deadline - Date.now())));
      return;
    } catch (error) {
      if (Date.now() >= deadline) throw new Error("Database readiness timed out after startup", { cause: error });
      if (!error.message.startsWith("database_unavailable:")) throw error;
    }
    await delay(Math.min(1000, Math.max(0, deadline - Date.now())));
  }
  throw new Error("Database readiness timed out after startup");
}
