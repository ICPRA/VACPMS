import { readFileSync } from "node:fs";
import { isAbsolute, dirname, resolve } from "node:path";

/** Startup only. Errors deliberately omit paths, file contents and credentials. */
export function loadMailConfig(path, read = readFileSync) {
  if (path === undefined) return undefined;
  try {
    if (!isAbsolute(path)) throw new Error();
    const config = JSON.parse(read(path, "utf8"));
    if (Object.keys(config).some((key) => !["endpoint", "executable", "config", "token_file", "projects"].includes(key))) throw new Error();
    let transport;
    if (config.executable !== undefined || config.config !== undefined) {
      if (config.endpoint !== undefined || typeof config.executable !== "string" || !config.executable.trim() || typeof config.config !== "string" || !config.config.trim()) throw new Error();
      transport = { executable: resolve(dirname(path), config.executable), config: resolve(dirname(path), config.config) };
    } else {
      const endpoint = new URL(config.endpoint);
      if (endpoint.protocol !== "http:" ||
        !["127.0.0.1", "localhost", "[::1]"].includes(endpoint.hostname) ||
        endpoint.username || endpoint.password || endpoint.search || endpoint.hash ||
        endpoint.pathname !== "/") throw new Error();
      transport = { endpoint: endpoint.origin };
    }
    const projects = config.projects ?? (transport.executable ? {} : undefined);
    if (typeof config.token_file !== "string" || !config.token_file.trim() ||
        projects === null || typeof projects !== "object" ||
        Array.isArray(projects) || (!transport.executable && Object.keys(projects).length === 0) ||
        Object.entries(projects).some(([id, slug]) => !id.trim() ||
          typeof slug !== "string" || !slug.trim() || /[\u0000-\u001f\u007f\u0100-\uffff]/.test(slug))) throw new Error();
    const token = read(resolve(dirname(path), config.token_file), "utf8").trim();
    if (!token || /\s/.test(token)) throw new Error();
    return { ...transport, token, projects: Object.freeze(projects) };
  } catch {
    throw new Error("Invalid T3_WORKBENCH_MAIL_CONFIG: expected local executable/config or loopback endpoint, readable token_file, nonempty token and project mappings");
  }
}
