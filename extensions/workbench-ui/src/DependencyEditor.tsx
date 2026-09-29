import { useEffect, useRef, useState, type FormEvent } from "react";
import { Check, GitBranch, LogIn, Plus, RefreshCw, X } from "lucide-react";
import type { CurrentView, WorkbenchRequest } from "./workbenchModel";

type Props = {
  project: string;
  slug: string;
  specs: CurrentView["specs"];
  allowRemoval: boolean;
  prerequisiteSlugs: ReadonlySet<string>;
  registeredRuns: CurrentView["runs"];
  acceptedRecords: CurrentView["acceptances"];
  language: "zh" | "en";
  onChanged: () => void;
  request?: WorkbenchRequest;
};
type DependencyState = {
  specVersion: number;
  revision: string;
  operations: Array<{ id: string; actor: string; reason: string; prerequisite: string; revision: string; changed: boolean; createdAt: string; operation?: "add" | "remove" }>;
};
type Command = {
  prerequisite: string;
  expected_version: number;
  expected_prerequisite_version: number;
  expected_revision: string;
  reason: string;
  idempotency_key: string;
};

export function DependencyEditor(props: Props) {
  const [open, setOpen] = useState(false);
  return open ? <DependencyForm key={`${props.project}:${props.slug}`} {...props} onClose={() => setOpen(false)} /> :
    <button type="button" className="wb-button" onClick={() => setOpen(true)}>
      {props.allowRemoval ? <GitBranch size={14} aria-hidden="true" /> : <Plus size={14} aria-hidden="true" />}
      {props.allowRemoval ? (props.language === "zh" ? "编辑前置依赖" : "Edit prerequisites") : (props.language === "zh" ? "添加前置依赖" : "Add prerequisite")}
    </button>;
}

function DependencyForm({ project, slug, specs, allowRemoval, prerequisiteSlugs, registeredRuns, acceptedRecords, language, onChanged, onClose, request = fetch }: Props & { onClose: () => void }) {
  const text = (zh: string, en: string) => language === "zh" ? zh : en;
  const [state, setState] = useState<DependencyState | null>(null);
  const [auth, setAuth] = useState<"checking" | "ready" | "anonymous" | "denied" | "error">("checking");
  const [key, setKey] = useState("");
  const [operation, setOperation] = useState<"add" | "remove">("add");
  const [prerequisite, setPrerequisite] = useState("");
  const [prerequisiteVersion, setPrerequisiteVersion] = useState<number | undefined>();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState("");
  const scope = useRef<AbortController | null>(null);
  const inFlight = useRef(false);
  const attempt = useRef<{ operation: "add" | "remove"; body: Command } | null>(null);
  const endpoint = `/workbench-api/loop/specs/${encodeURIComponent(slug)}/dependencies`;
  const selected = specs.find((spec) => spec.slug === prerequisite);
  const hasVersion = selected && Number.isSafeInteger(prerequisiteVersion) && prerequisiteVersion! > 0;
  const staleTarget = !!selected && prerequisiteVersion !== selected.version;
  const validRemoval = operation !== "remove" || (allowRemoval && prerequisiteSlugs.has(prerequisite));

  async function load(controller: AbortController, login = false) {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError("");
    try {
      if (login) {
        const response = await request("/workbench-api/api/auth/login", {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key }),
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
        });
        if (controller.signal.aborted) return;
        if (response.status === 401) { setAuth("anonymous"); setError(text("凭据无效或已过期。", "Credential invalid or expired.")); return; }
        if (response.status === 403) { setAuth("denied"); setError(text("当前账号没有依赖操作权限。", "Insufficient privilege to manage dependencies.")); return; }
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
      }
      const response = await request(endpoint, {
        headers: { "X-Specgraph-Project": project }, cache: "no-store",
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
      });
      if (controller.signal.aborted) return;
      if (response.status === 401) { setAuth("anonymous"); return; }
      if (response.status === 403) { setAuth("denied"); setError(text("当前账号没有依赖操作权限。", "Insufficient privilege to manage dependencies.")); return; }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = await response.json() as DependencyState;
      if (!Number.isSafeInteger(body.specVersion) || body.specVersion < 1 || typeof body.revision !== "string" || !/^\d+$/.test(body.revision) || !Array.isArray(body.operations) || body.operations.some((entry) =>
        !entry || typeof entry.id !== "string" || typeof entry.actor !== "string" || typeof entry.reason !== "string" || typeof entry.prerequisite !== "string" || typeof entry.revision !== "string" || !/^\d+$/.test(entry.revision) || typeof entry.changed !== "boolean" || typeof entry.createdAt !== "string" || (entry.operation !== undefined && entry.operation !== "add" && entry.operation !== "remove"))) {
        throw new Error("Invalid dependency state");
      }
      if (!controller.signal.aborted) {
        setState(body); setAuth("ready"); setConflict(false);
        if (!attempt.current) { setPrerequisite(""); setPrerequisiteVersion(undefined); }
      }
    } catch (cause) {
      if (!controller.signal.aborted) { setAuth("error"); setError(text("依赖状态读取失败：", "Dependency state unavailable: ") + String(cause)); }
    } finally {
      if (!controller.signal.aborted) { setBusy(false); setKey(""); inFlight.current = false; }
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    scope.current = controller;
    inFlight.current = false;
    void load(controller);
    return () => controller.abort();
  }, [project, slug, request]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (inFlight.current || auth !== "ready" || conflict || !state) return;
    if (!attempt.current && (!hasVersion || staleTarget || !validRemoval || (operation === "add" && prerequisite === slug) || !reason.trim() || reason.length > 4000)) return;
    const controller = scope.current!;
    inFlight.current = true; setBusy(true); setError(""); setReceipt("");
    // An uncertain write retains its complete command, including both versions and the revision.
    attempt.current ??= { operation, body: { prerequisite, expected_version: state.specVersion, expected_prerequisite_version: prerequisiteVersion!, expected_revision: state.revision, reason: reason.trim(), idempotency_key: Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, "0")).join("") } };
    const command = attempt.current;
    let confirmed = false;
    try {
      const response = await request(command.operation === "remove" ? `${endpoint}/remove` : endpoint, {
        method: "POST", headers: { "Content-Type": "application/json", "X-Specgraph-Project": project },
        body: JSON.stringify(command.body), signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
      });
      if (controller.signal.aborted) return;
      if (!response.ok) {
        if (response.status >= 500) throw new Error(`HTTP ${response.status}`);
        // Authentication failures during an exact retry do not resolve the earlier write.
        if (!uncertain) attempt.current = null;
        if (response.status === 401) setAuth("anonymous");
        if (response.status === 403) setAuth("denied");
        if (response.status === 409) { setConflict(true); setUncertain(false); attempt.current = null; }
        setError(response.status === 409 ? text("依赖或节点已变化；请重新加载并核对后再提交。", "Dependency or node changed. Reload and review before submitting again.")
          : response.status === 403 ? text("当前账号没有依赖操作权限。", "Insufficient privilege to manage dependencies.")
          : text("请求被拒绝：", "Request rejected: ") + response.status);
        return;
      }
      const result = await response.json();
      if (result.dependent !== slug || result.prerequisite !== command.body.prerequisite || typeof result.revision !== "string" || !/^\d+$/.test(result.revision) || typeof result.changed !== "boolean" || typeof result.replayed !== "boolean" ||
        (command.operation === "remove" ? result.operation !== "remove" : result.operation !== undefined && result.operation !== "add")) throw new Error("Invalid dependency receipt");
      if (controller.signal.aborted) return;
      attempt.current = null; setUncertain(false); setReason(""); setPrerequisite("");
      setReceipt(result.replayed ? text("已确认原操作回执；当前依赖以刷新结果为准。", "Original operation confirmed; refreshed state determines current dependencies.")
        : command.operation === "remove" ? (result.changed ? text("前置依赖已移除，节点和操作历史保留。", "Prerequisite removed; nodes and operation history retained.") : text("前置依赖原已不存在，未改动。", "Prerequisite already absent; no change made."))
          : result.changed ? text("前置依赖已添加。", "Prerequisite added.") : text("前置依赖已存在，未重复添加。", "Prerequisite already exists; no duplicate added."));
      confirmed = true;
      onChanged();
    } catch (cause) {
      if (!controller.signal.aborted) { setUncertain(true); setError(text("结果尚未确认：", "Result unconfirmed: ") + String(cause)); }
    } finally {
      if (!controller.signal.aborted) {
        inFlight.current = false; setBusy(false);
        if (confirmed) void load(controller);
      }
    }
  }

  return <section className="wb-manual-completion" aria-label={text("依赖编辑", "Dependency editor")}>
    <header className="flex items-center justify-between gap-2">
      <strong>{allowRemoval ? text("编辑前置依赖", "Edit prerequisites") : text("添加前置依赖", "Add prerequisite")}</strong>
      <button type="button" className="wb-button" aria-label={text("关闭依赖编辑", "Close dependency editor")} onClick={onClose}><X size={14} /></button>
    </header>
    {auth === "anonymous" && <form onSubmit={(event) => { event.preventDefault(); void load(scope.current!, true); }}>
      <label>{text("SpecGraph 操作凭据", "SpecGraph operator credential")}<input type="password" autoComplete="off" value={key} required disabled={busy} onChange={(event) => setKey(event.target.value)} /></label>
      <button className="wb-button" type="submit" disabled={busy || !key}><LogIn size={14} />{text("登录", "Sign in")}</button>
    </form>}
    {auth === "checking" && <p role="status">{text("读取依赖状态…", "Loading dependency state...")}</p>}
    {state && <form aria-label={operation === "remove" ? text("移除前置依赖表单", "Remove prerequisite form") : text("添加前置依赖表单", "Add prerequisite form")} onSubmit={(event) => void submit(event)}>
      {allowRemoval && <label>{text("依赖操作", "Dependency operation")}<select aria-label={text("依赖操作", "Dependency operation")} value={operation} disabled={busy || uncertain || conflict || auth !== "ready"} onChange={(event) => {
        if (inFlight.current || uncertain || conflict || auth !== "ready") return;
        setOperation(event.target.value as "add" | "remove"); setPrerequisite(""); setPrerequisiteVersion(undefined);
      }}><option value="add">{text("添加", "Add")}</option><option value="remove">{text("移除", "Remove")}</option></select></label>}
      <p className="break-words">{text("前置节点", "Prerequisite")} {prerequisite || "?"} → {text("当前后续节点", "Current dependent")} {slug}</p>
      <p>{text("当前后续版本", "Dependent version")}: {state.specVersion} · {text("前置版本", "Prerequisite version")}: {prerequisiteVersion ?? "?"}</p>
      <p>{text("当前后续节点的已登记执行记录", "Registered runs for current dependent")}: {registeredRuns.length} · {text("已登记接受记录", "Recorded acceptance entries")}: {acceptedRecords.length}</p>
      <label>{text("前置规格", "Prerequisite spec")}<select aria-label={text("前置规格", "Prerequisite spec")} value={prerequisite} required disabled={busy || uncertain || conflict || auth !== "ready"} onChange={(event) => {
        setPrerequisite(event.target.value); setPrerequisiteVersion(specs.find((spec) => spec.slug === event.target.value)?.version);
      }}>
        <option value="">{text("选择规格", "Select a spec")}</option>
        {specs.filter((spec) => operation === "add" ? spec.slug !== slug : prerequisiteSlugs.has(spec.slug)).map((spec) => <option key={spec.slug} value={spec.slug} disabled={!Number.isSafeInteger(spec.version) || spec.version! < 1}>{spec.title} ({spec.slug}){spec.version === undefined ? text("：版本未提供", ": version unavailable") : ` · v${spec.version}`}</option>)}
      </select></label>
      <label>{text("变更原因", "Reason")}<textarea value={reason} required maxLength={4000} disabled={busy || uncertain || conflict || auth !== "ready"} onChange={(event) => setReason(event.target.value)} /></label>
      <p className="text-muted-foreground">{text("此操作不会停止执行进程，也不会自动接受交付。", "This does not stop running processes or automatically accept deliveries.")}</p>
      {operation === "remove" && <p>{text("仅移除此项前置关系；节点和操作历史保留。", "Only this prerequisite relation is removed; nodes and operation history are retained.")}</p>}
      {staleTarget && !uncertain && <p role="alert">{text("所选前置规格版本已变化；请重新加载并选择后核对。", "Selected prerequisite version changed. Reload and select it again for review.")}</p>}
      <button type="submit" className="wb-button" disabled={busy || conflict || auth !== "ready" || (!uncertain && (!hasVersion || staleTarget || !validRemoval || !reason.trim() || reason.length > 4000))}>
        <Check size={14} />{uncertain ? text("重试同一请求", "Retry same request") : operation === "remove" ? text("确认移除前置依赖", "Confirm remove prerequisite") : text("确认添加前置依赖", "Confirm add prerequisite")}
      </button>
    </form>}
    {uncertain && <p role="status">{text("结果未确认，表单已锁定。刷新不会解除锁定；重试保持原请求。", "Outcome unknown; edits are locked. Refresh does not unlock the command; retry preserves the original request.")}</p>}
    {receipt && <p role="status">{receipt}</p>}
    {error && <p role="alert">{error}</p>}
    <button type="button" className="wb-button" disabled={busy} onClick={() => { onChanged(); void load(scope.current!); }}>
      <RefreshCw size={14} />{text("重新加载并核对", "Reload and review")}
    </button>
    {state && <section aria-label={text("最近 20 条人工依赖操作", "Latest 20 manual dependency operations")}>
      <h3>{text("最近 20 条人工依赖操作（非完整历史）", "Latest 20 manual dependency operations (not full history)")}</h3>
      {auth !== "ready" && <p>{text("当前操作记录尚未重新确认。", "Displayed operations have not been refreshed.")}</p>}
      {state.operations.slice(0, 20).map((entry) => <div key={entry.id} className="break-words border-t py-2">
        <p>{entry.prerequisite} → {slug}</p><p>{entry.actor} · {entry.createdAt} · {entry.revision}</p><p className="whitespace-pre-wrap">{entry.reason}</p>
        <p>{entry.operation === "remove" ? (entry.changed ? text("已移除", "Removed") : text("原已不存在，未改动", "Already absent; unchanged"))
          : entry.changed ? text("已添加", "Added") : text("已存在，未改动", "Already present; unchanged")}</p>
      </div>)}
      {!state.operations.length && <p>{text("未返回人工依赖操作记录。", "No manual dependency operations returned.")}</p>}
    </section>}
  </section>;
}
