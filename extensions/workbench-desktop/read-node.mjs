import { spawn } from "node:child_process";

// Each bounded read owns its child; EOF closes the Go store without a daemon.
export function readWorkbench(input, signal) {
  return invokeWorkbench(input, signal, "workbench-stdio", true);
}

export function commandWorkbench(input, signal) {
  return invokeWorkbench(input, signal, "workbench-command-stdio", false);
}

function invokeWorkbench({ executable, config, resource, operation, body, project, slug, credential, taskSlug, includeDescendants, threadId, state, cursor, attemptCursor, eventCursor, query, limit }, signal, command, unwrap) {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawn(executable, [command, "--config", config], { windowsHide: true, shell: false, stdio: ["pipe", "pipe", "pipe"] });
    let output = "", bytes = 0, failure;
    const stop = (error) => { failure ??= error; child.kill(); };
    const abort = () => stop(new Error("Node read cancelled"));
    const timer = setTimeout(() => stop(new Error("Workbench read timed out")), 20000);
    signal?.addEventListener("abort", abort, { once: true });
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      bytes += Buffer.byteLength(chunk);
      if (bytes > 1024 * 1024) stop(new Error("Node response exceeds 1 MiB"));
      else output += chunk;
    });
    child.stderr.resume();
    child.stdin.on("error", (error) => stop(error));
    child.on("error", (error) => { failure ??= error; });
    child.once("close", (code) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      if (failure) { reject(failure); return; }
      if (code !== 0) { reject(new Error(`SpecGraph node reader exited with code ${code}`)); return; }
      try {
        const response = JSON.parse(output);
        if (response.id !== "node-read") throw new Error("Unexpected node response identity");
        if (!unwrap) {
          if (!response.data && !response.error) throw new Error("Invalid command response");
          resolve(response); return;
        }
        if (response.error) throw new Error(`${response.error.code}: ${response.error.message}`);
        if (!response.data || typeof response.data !== "object") throw new Error("Unexpected workbench response");
        resolve(response.data);
      } catch (error) { reject(error); }
    });
    child.stdin.end(JSON.stringify({ id: "node-read", resource, operation, body, project, slug, credential, taskSlug, includeDescendants, threadId, state, cursor, attemptCursor, eventCursor, query, limit }) + "\n");
  });
}
