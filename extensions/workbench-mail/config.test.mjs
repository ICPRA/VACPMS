import assert from "node:assert/strict";
import { test } from "node:test";
import { resolve } from "node:path";
import { loadMailConfig } from "./config.mjs";

const path = resolve("config-fixture.json");
const tokenPath = resolve("token-fixture.txt");
const config = { endpoint: "http://127.0.0.1:8690", token_file: tokenPath, projects: { "native-id": "spec-project" } };
const reader = (value) => (file) => {
  if (file === path) return JSON.stringify(value);
  assert.equal(file, tokenPath);
  return "fixture-secret\n";
};

test("unconfigured means no filesystem access", () => {
  assert.equal(loadMailConfig(undefined, () => assert.fail("unexpected file read")), undefined);
});

test("local transport resolves packaged relative paths without an endpoint", () => {
  const local = { executable: "bin/specgraph.exe", config: "specgraph.yaml", token_file: "token-fixture.txt", projects: config.projects };
  assert.deepEqual(loadMailConfig(path, reader(local)), { executable: resolve("bin/specgraph.exe"), config: resolve("specgraph.yaml"), token: "fixture-secret", projects: config.projects });
  assert.throws(() => loadMailConfig(path, reader({ ...local, endpoint: config.endpoint })), /Invalid/);
  assert.deepEqual(loadMailConfig(path, reader({ ...local, projects: undefined })).projects, {});
});

test("startup loads explicit project mapping and trims token without environment credentials", () => {
  assert.deepEqual(loadMailConfig(path, reader(config)), {
    endpoint: config.endpoint, token: "fixture-secret", projects: config.projects,
  });
  const exact = { ...config, projects: { "native-id": "Existing_Project.Name" } };
  assert.deepEqual(loadMailConfig(path, reader(exact)).projects, exact.projects);
});

test("configured malformed or unreadable settings fail with redacted errors", () => {
  for (const value of [null, {}, { ...config, endpoint: "https://example.com" },
    { ...config, endpoint: "http://secret@localhost:8690" },
    { ...config, token_file: "" }, { ...config, projects: {} }]) {
    assert.throws(() => loadMailConfig(path, reader(value)), /Invalid T3_WORKBENCH_MAIL_CONFIG/);
  }
  assert.throws(() => loadMailConfig("raw-secret", reader(config)), /Invalid T3_WORKBENCH_MAIL_CONFIG/);
  assert.throws(() => loadMailConfig(path, () => { throw new Error("secret-content"); }),
    (error) => !error.message.includes("secret-content"));
  assert.throws(() => loadMailConfig(path, (file) => file === path ? JSON.stringify(config) : " "),
    /Invalid T3_WORKBENCH_MAIL_CONFIG/);
});
