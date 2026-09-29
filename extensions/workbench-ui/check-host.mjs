import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

assert(process.argv[2], "Supply the T3 checkout path; no checkout is inferred.");
const hostRoot = fs.realpathSync(process.argv[2]);
const sourceRoot = fs.realpathSync(fileURLToPath(new URL(".", import.meta.url)));
const relative = path.relative(hostRoot, sourceRoot);
assert(
  relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative),
  "Workbench business source must be outside the upstream checkout.",
);
const webRoot = path.join(hostRoot, "apps", "web");
const host = JSON.parse(fs.readFileSync(path.join(webRoot, "package.json"), "utf8"));
const extension = JSON.parse(fs.readFileSync(path.join(sourceRoot, "package.json"), "utf8"));
assert.equal(host.name, "@t3tools/web", "This is not the expected T3 web package.");
assert.equal(extension.name, "@project-workbench/ui");
assert.equal(host.dependencies[extension.name], "workspace:*");
const installed = fs.realpathSync(path.join(webRoot, "node_modules", "@project-workbench", "ui"));
assert.equal(path.relative(sourceRoot, installed), "", "Host resolves a stale copy instead of this extension.");
// Presence checks catch overwritten integration points, not API compatibility.
const markers = {
  "apps/desktop/src/ipc/DesktopIpcHandlers.ts": ["ipc.handle(workbenchMethods.read)", "ipc.handle(workbenchMethods.command)"],
  "apps/desktop/src/preload.ts": ['ipcRenderer.invoke("vacpms:read-node", input)', 'ipcRenderer.invoke("vacpms:command", input)'],
  "packages/contracts/src/ipc.ts": ["readWorkbench?:", "commandWorkbench?:"],
  "apps/web/src/routes/workbench.tsx": ['createFileRoute("/workbench")'],
  "apps/web/src/components/sidebar/SidebarChrome.tsx": ['to: "/workbench"'],
  "apps/web/src/index.css": ["@project-workbench/ui/styles.css"],
  "scripts/lib/third-party-licenses.ts": ['name === "@project-workbench/ui"', 'name === "@project-workbench/mail"'],
};
for (const [file, expected] of Object.entries(markers)) {
  const content = fs.readFileSync(path.join(hostRoot, file), "utf8");
  for (const marker of expected) assert(content.includes(marker), `Missing host integration marker in ${file}: ${marker}`);
}
console.log(JSON.stringify({
  sourceRoot,
  hostRoot,
  externalSource: true,
  installedWorkspaceLink: true,
  hostIntegrationMarkersPresent: true,
  compatibilityVerified: false,
  remaining: "Run consumer tests, host typecheck, fresh CSS compilation and authorized UI verification.",
}, null, 2));
