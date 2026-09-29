import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { commandWorkbench, readWorkbench } from "./read-node.mjs";
import { loadMailConfig } from "../workbench-mail/config.mjs";

// One installation credential, not one credential per project or conversation.
export async function setupMail({ home, runtime, credential }, signal) {
  const configPath = path.join(home, "workbench-mail.json");
  if (existsSync(configPath)) {
    const saved = loadMailConfig(configPath);
    const result = await readWorkbench({ ...runtime, resource: "operator-identity", credential: saved.token }, signal);
    if (result.identity?.role !== "reader") throw new Error("Existing mailbox credential is not reader scoped");
    return { configured: true, reused: true };
  }
  const secrets = path.join(home, "mail-secrets");
  mkdirSync(secrets, { recursive: true, mode: 0o700 });
  if (process.platform === "win32") {
    execFileSync(path.join(process.env.SystemRoot, "System32/WindowsPowerShell/v1.0/powershell.exe"), ["-NoProfile", "-NonInteractive", "-Command", `
$ErrorActionPreference='Stop'
$acl=New-Object System.Security.AccessControl.DirectorySecurity
$owner=[System.Security.Principal.WindowsIdentity]::GetCurrent().User
$acl.SetOwner($owner)
$acl.SetAccessRuleProtection($true,$false)
foreach($sid in @($owner.Value,'S-1-5-18','S-1-5-32-544')) {
  $identity=New-Object System.Security.Principal.SecurityIdentifier($sid)
  $rule=New-Object System.Security.AccessControl.FileSystemAccessRule($identity,'FullControl','ContainerInherit,ObjectInherit','None','Allow')
  $acl.AddAccessRule($rule)
}
[System.IO.Directory]::SetAccessControl($env:VACPMS_CREDENTIAL_DIR,$acl)
`], { windowsHide: true, timeout: 15000, stdio: "pipe", env: { ...process.env, VACPMS_CREDENTIAL_DIR: secrets } });
  }
  const tokenPath = path.join(secrets, "mail.token");
  let token;
  if (existsSync(tokenPath)) {
    token = readFileSync(tokenPath, "utf8").trim();
    const result = await readWorkbench({ ...runtime, resource: "operator-identity", credential: token }, signal);
    if (result.identity?.role !== "reader") throw new Error("Saved mailbox credential is not reader scoped");
  } else {
    const result = await commandWorkbench({ ...runtime, operation: "mail-initialize", credential, body: {} }, signal);
    if (result.error) throw new Error(`Mailbox initialization rejected (${result.error.code})`);
    token = result.data?.token;
    if (typeof token !== "string" || !token.startsWith("spgr_sk_")) throw new Error("Invalid mailbox initialization response");
    writeFileSync(tokenPath, token, { encoding: "utf8", flag: "wx", mode: 0o600 });
  }
  writeFileSync(configPath, JSON.stringify({
    executable: path.relative(home, runtime.executable), config: path.relative(home, runtime.config),
    token_file: path.relative(home, tokenPath),
  }, null, 2), { encoding: "utf8", flag: "wx", mode: 0o600 });
  return { configured: true, reused: false };
}
