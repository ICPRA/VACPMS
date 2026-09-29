import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ensureDatabaseReady } from "./database-startup.mjs";

const workbench = fileURLToPath(new URL("../../", import.meta.url));
const runtime = JSON.parse(readFileSync(path.join(workbench, "desktop-runtime.json"), "utf8"));
if (typeof runtime.desktop !== "string" || !runtime.desktop.trim()) throw new Error("Desktop component is missing from desktop-runtime.json");
const desktop = path.resolve(workbench, runtime.desktop);
const main = path.join(desktop, "dist-electron/main.cjs");
for (const file of [main, path.resolve(desktop, "../server/dist/client/index.html"), path.resolve(desktop, "../server/dist/bin.mjs"), path.join(workbench, "desktop-runtime.json")]) {
  if (!existsSync(file)) throw new Error(`Required build/config missing: ${file}`);
}

// Keep this source-build profile separate from the installed T3 application.
const home = path.join(workbench, "runtime/t3-desktop");
mkdirSync(home, { recursive: true });
const scratch = mkdtempSync(path.join(home, "run-"));
process.env.TEMP = scratch;
process.env.TMP = scratch;
delete process.env.VITE_DEV_SERVER_URL;
delete process.env.T3CODE_PORT;
delete process.env.ELECTRON_RUN_AS_NODE;
process.env.T3CODE_HOME = home;
process.env.T3CODE_DESKTOP_USER_DATA_DIR = path.join(home, "electron-user-data");
process.env.VACPMS_HOME = workbench;
process.env.T3CODE_DISABLE_AUTO_UPDATE = "true";
const mailConfig = path.join(home, "workbench-mail.json");
if (!process.env.T3_WORKBENCH_MAIL_CONFIG && existsSync(mailConfig)) {
  process.env.T3_WORKBENCH_MAIL_CONFIG = mailConfig;
}

try {
  await ensureDatabaseReady({
    ...runtime,
    executable: path.resolve(workbench, runtime.executable),
    config: path.resolve(workbench, runtime.config),
  });
  const { resolveElectronLaunchCommand } = await import(pathToFileURL(path.join(desktop, "scripts/electron-launcher.mjs")).href);
  const command = resolveElectronLaunchCommand([main]);
  const result = spawnSync(command.electronPath, command.args, {
    cwd: desktop, env: process.env, stdio: "inherit", windowsHide: false,
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally {
  rmSync(scratch, { recursive: true });
}
