import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowLeft, ArrowRight, Check, GitBranch, LogOut, RefreshCw, Settings2 } from "lucide-react";
import type { WorkbenchRequest, WorkbenchRun } from "./workbenchModel";

export type MailThreadSummary = {
  id: string; task_slug: string; subject: string; opened_by_run: string; owner_run: string;
  created_at: string; closed_at: string | null; closure_note: string | null;
  message_count: number; pending_ack_count: number; last_message_at: string | null;
  node_links: Array<{ sender_task_slug: string; recipient_task_slug: string; message_count: number; pending_ack_count: number }>;
};
type Message = {
  id: string; sender_run: string; handoff_to_run: string | null; body: string; created_at: string;
  references: Array<{ message_id: string; kind: string; thread_id: string; task_slug: string;
    sender_run_id: string; subject: string; body: string; created_at: string }>;
};
type Item = { message: Message; receipts: Array<{ recipient_run_id: string; read_at: string | null; acknowledged_at: string | null }> };
type Detail = { thread: MailThreadSummary; items: Item[]; next_cursor: string };
type Contact = { run_id: string; task_slug: string; assignment_role: string };
type OwnerEvent = { id: string; thread_id: string; from_run: string; to_run: string; actor_kind: "human" | "agent";
  actor_user_id: string; actor_run_id: string | null; reason: string; created_at: string };
export type MailReader = (request: { resource: "mail-identity" | "mail-threads" | "mail-thread" | "mail-signout" | "mail-directory" | "mail-owner-history"; credential?: string; project?: string; taskSlug?: string; includeDescendants?: boolean; threadId?: string; state?: string; cursor?: string; limit?: number }, signal: AbortSignal) => Promise<unknown>;

export function MailWorkspace({ project, task, language, revision, runs, initialThread, onOpenNode, onOpenPendingThread, onClearTask, readMail, request }: {
  project: string; task: string | null; language: "zh" | "en";
  revision: string;
  runs: WorkbenchRun[];
  initialThread?: string;
  onOpenNode: (slug: string) => void; onClearTask: () => void;
  onOpenPendingThread?: (threadId: string) => void;
  readMail?: MailReader;
  request?: WorkbenchRequest;
}) {
  const text = (zh: string, en: string) => language === "zh" ? zh : en;
  const nodeByRun = new Map(runs.map((run) => [run.id, run.taskSlug]));
  const [identity, setIdentity] = useState<string | null | undefined>(undefined);
  const lifetime = useRef<AbortController | null>(null);
  const [key, setKey] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState("");
  const [state, setState] = useState("open");
  const [includeDescendants, setIncludeDescendants] = useState(false);
  const [cursors, setCursors] = useState([""]);
  const [list, setList] = useState<{ threads: MailThreadSummary[]; next_cursor: string } | null>(null);
  const [listError, setListError] = useState("");
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<string | null>(initialThread ?? null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [detailError, setDetailError] = useState("");
  const [messageCursors, setMessageCursors] = useState([""]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [setupBusy, setSetupBusy] = useState(false);
  const [setupNotice, setSetupNotice] = useState("");
  const [setupError, setSetupError] = useState("");
  const [ownerHistory, setOwnerHistory] = useState<{ events: OwnerEvent[]; next_cursor: string } | null>(null);
  const [ownerCursors, setOwnerCursors] = useState([""]);
  const [ownerLoading, setOwnerLoading] = useState(false);
  const [ownerError, setOwnerError] = useState("");
  const [takeoverOpen, setTakeoverOpen] = useState(false);
  const [directory, setDirectory] = useState<{ contacts: Contact[]; next_cursor: string } | null>(null);
  const [directoryCursors, setDirectoryCursors] = useState([""]);
  const [directoryLoading, setDirectoryLoading] = useState(false);
  const [directoryError, setDirectoryError] = useState("");
  const [recipient, setRecipient] = useState("");
  const [takeoverReason, setTakeoverReason] = useState("");
  const [takeoverBusy, setTakeoverBusy] = useState(false);
  const [takeoverUncertain, setTakeoverUncertain] = useState(false);
  const [takeoverError, setTakeoverError] = useState("");
  const [takeoverNotice, setTakeoverNotice] = useState("");
  const takeoverLifetime = useRef<AbortController | null>(null);
  const takeoverInFlight = useRef(false);
  const takeoverAttempt = useRef<{ mail_thread_id: string; recipient_run_id: string; body: string; idempotency_key: string } | null>(null);
  async function initializeMail() {
    if (!request || setupBusy) return;
    setSetupBusy(true); setSetupError(""); setSetupNotice("");
    try {
      const response = await request("/workbench-api/wb/mail/setup", { method: "POST", headers: { "X-Specgraph-Project": project }, body: "{}" });
      const result = await response.json();
      if (!response.ok || result.configured !== true) throw new Error(result.error || "Mailbox setup failed");
      setSetupNotice(result.reused ? text("已有本机邮箱配置有效，无需重新创建。", "Existing local mailbox configuration is valid.")
        : text("本机邮箱已配置，重新打开应用后生效。", "Local mailbox configured. Reopen the app to activate."));
    } catch (error) { setSetupError(String(error)); }
    finally { setSetupBusy(false); }
  }
  const cursor = cursors.at(-1)!;
  const messageCursor = messageCursors.at(-1)!;
  const ownerCursor = ownerCursors.at(-1)!;
  const directoryCursor = directoryCursors.at(-1)!;

  useEffect(() => {
    const controller = new AbortController();
    takeoverLifetime.current = controller;
    takeoverInFlight.current = false; takeoverAttempt.current = null;
    setOwnerHistory(null); setOwnerCursors([""]); setOwnerError("");
    setTakeoverOpen(false); setDirectory(null); setDirectoryCursors([""]); setDirectoryError("");
    setRecipient(""); setTakeoverReason(""); setTakeoverBusy(false); setTakeoverUncertain(false);
    setTakeoverError(""); setTakeoverNotice("");
    return () => controller.abort();
  }, [project, selected, identity]);

  useEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    if (readMail) {
      void readMail({ resource: "mail-identity" }, controller.signal).then((result) => {
        const body = result as { identity: { subject: string; display_name: string } };
        if (controller.signal.aborted) return;
        if (typeof body.identity?.subject !== "string") throw new Error("Invalid identity response");
        setIdentity(body.identity.display_name || body.identity.subject);
      }).catch((cause) => {
        if (!controller.signal.aborted) {
          setIdentity(null);
          if (!String(cause).includes("unauthorized:")) setAuthError(String(cause));
        }
      });
      return () => controller.abort();
    }
    void (async () => {
      try {
        const response = await fetch("/workbench-api/api/auth/whoami", { signal: controller.signal, cache: "no-store" });
        if (controller.signal.aborted) return;
        if (response.status === 401) { setIdentity(null); return; }
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const body = await response.json();
        if (typeof body.identity?.subject !== "string") throw new Error("Invalid identity response");
        if (!controller.signal.aborted) setIdentity(body.identity.display_name || body.identity.subject);
      } catch (cause) { if (!controller.signal.aborted) { setIdentity(null); setAuthError(String(cause)); } }
    })();
    return () => controller.abort();
  }, [readMail]);

  async function authenticate(event?: FormEvent) {
    event?.preventDefault();
    if (authBusy) return;
    setAuthBusy(true); setAuthError("");
    try {
      if (readMail) {
        if (event) {
          const body = await readMail({ resource: "mail-identity", credential: key }, lifetime.current!.signal) as { identity: { subject: string; display_name: string } };
          lifetime.current!.signal.throwIfAborted();
          if (typeof body.identity?.subject !== "string") throw new Error("Invalid identity response");
          setIdentity(body.identity.display_name || body.identity.subject);
        } else {
          await readMail({ resource: "mail-signout" }, lifetime.current!.signal);
          lifetime.current!.signal.throwIfAborted();
          setIdentity(null); setList(null); setDetail(null); setSelected(null);
        }
        return;
      }
      const response = await fetch(`/workbench-api/api/auth/${event ? "login" : "logout"}`, {
        method: "POST", ...(event ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key }) } : {}),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      if (event) {
        const body = await response.json();
        if (typeof body.identity?.subject !== "string") throw new Error("Invalid identity response");
        setIdentity(body.identity.display_name || body.identity.subject);
      } else { setIdentity(null); setList(null); setDetail(null); setSelected(null); }
    } catch (cause) { setAuthError(String(cause)); }
    finally { setKey(""); setAuthBusy(false); }
  }

  useEffect(() => {
    if (!identity) return;
    const controller = new AbortController();
    setLoading(true); setListError("");
    const query = new URLSearchParams({ state, limit: "50", cursor });
    if (task) query.set("task_slug", task);
    if (task && includeDescendants) query.set("include_descendants", "true");
    void (async () => {
      try {
        let body;
        if (readMail) {
          body = await readMail({ resource: "mail-threads", project, state, cursor, ...(task ? { taskSlug: task } : {}), ...(task && includeDescendants ? { includeDescendants: true } : {}) }, controller.signal) as { threads: MailThreadSummary[]; next_cursor: string };
        } else {
        const response = await fetch(`/workbench-api/loop/mail/threads?${query}`, {
          headers: { "X-Specgraph-Project": project }, signal: controller.signal, cache: "no-store",
        });
        if (controller.signal.aborted) return;
        if (response.status === 401) { setIdentity(null); setList(null); setDetail(null); return; }
        if (!response.ok) throw new Error(response.status === 403 ? text("当前账号无协作监督权限。", "This account cannot inspect project mail.") : `HTTP ${response.status}`);
        body = await response.json();
        }
        if (!Array.isArray(body.threads) || typeof body.next_cursor !== "string") throw new Error("Invalid mailbox list");
        if (!controller.signal.aborted) setList(body);
      } catch (cause) { if (!controller.signal.aborted) setListError(String(cause)); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    })();
    return () => controller.abort();
  }, [project, task, includeDescendants, identity, state, cursor, refresh, language, revision, readMail]);

  useEffect(() => {
    if (!identity || !selected) return;
    const controller = new AbortController();
    setDetailLoading(true); setDetailError("");
    void (async () => {
      try {
        const query = new URLSearchParams({ limit: "50", cursor: messageCursor });
        let body;
        if (readMail) {
          body = await readMail({ resource: "mail-thread", project, threadId: selected, cursor: messageCursor }, controller.signal) as Detail;
        } else {
        const response = await fetch(`/workbench-api/loop/mail/threads/${encodeURIComponent(selected)}?${query}`, {
          headers: { "X-Specgraph-Project": project }, signal: controller.signal, cache: "no-store",
        });
        if (controller.signal.aborted) return;
        if (response.status === 401) { setIdentity(null); setList(null); setDetail(null); return; }
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        body = await response.json();
        }
        if (body.thread?.id !== selected || !Array.isArray(body.items) || typeof body.next_cursor !== "string") throw new Error("Invalid mailbox thread");
        if (!controller.signal.aborted) setDetail(body);
      } catch (cause) { if (!controller.signal.aborted) setDetailError(String(cause)); }
      finally { if (!controller.signal.aborted) setDetailLoading(false); }
    })();
    return () => controller.abort();
  }, [project, identity, selected, messageCursor, refresh, revision, readMail]);

  useEffect(() => {
    if (!identity || !selected || !readMail || onOpenPendingThread) return;
    const controller = new AbortController();
    setOwnerLoading(true); setOwnerError("");
    void readMail({ resource: "mail-owner-history", project, threadId: selected, cursor: ownerCursor, limit: 50 }, controller.signal).then((result) => {
      const body = result as { events: OwnerEvent[]; next_cursor: string };
      if (!Array.isArray(body.events) || typeof body.next_cursor !== "string" || body.events.some((event) =>
        event.thread_id !== selected || typeof event.id !== "string" || typeof event.from_run !== "string" || typeof event.to_run !== "string" ||
        (event.actor_kind !== "human" && event.actor_kind !== "agent") || typeof event.actor_user_id !== "string" || !event.actor_user_id ||
        (event.actor_run_id !== null && typeof event.actor_run_id !== "string") || typeof event.reason !== "string" || typeof event.created_at !== "string")) throw new Error("Invalid owner history");
      if (!controller.signal.aborted) setOwnerHistory(body);
    }).catch((cause) => { if (!controller.signal.aborted) setOwnerError(String(cause)); })
      .finally(() => { if (!controller.signal.aborted) setOwnerLoading(false); });
    return () => controller.abort();
  }, [project, identity, selected, ownerCursor, refresh, revision, readMail, onOpenPendingThread]);

  useEffect(() => {
    if (!identity || !selected || !takeoverOpen || !readMail || !request) return;
    const controller = new AbortController();
    setDirectoryLoading(true); setDirectoryError("");
    void readMail({ resource: "mail-directory", project, cursor: directoryCursor, limit: 50 }, controller.signal).then((result) => {
      const body = result as { contacts: Contact[]; next_cursor: string };
      if (!Array.isArray(body.contacts) || typeof body.next_cursor !== "string" || body.contacts.some((contact) =>
        typeof contact.run_id !== "string" || typeof contact.task_slug !== "string" || typeof contact.assignment_role !== "string")) throw new Error("Invalid mail directory");
      if (!controller.signal.aborted) setDirectory(body);
    }).catch((cause) => { if (!controller.signal.aborted) setDirectoryError(String(cause)); })
      .finally(() => { if (!controller.signal.aborted) setDirectoryLoading(false); });
    return () => controller.abort();
  }, [project, identity, selected, takeoverOpen, directoryCursor, revision, readMail, request]);

  async function takeOver(event: FormEvent) {
    event.preventDefault();
    if (!readMail || !request || !detail || !identity || takeoverInFlight.current ||
      (!takeoverAttempt.current && (!directory?.contacts.some((contact) => contact.run_id === recipient) || !takeoverReason.trim()))) return;
    const controller = takeoverLifetime.current!;
    takeoverAttempt.current ??= { mail_thread_id: detail.thread.id, recipient_run_id: recipient, body: takeoverReason.trim(),
      idempotency_key: Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, "0")).join("") };
    const command = takeoverAttempt.current;
    takeoverInFlight.current = true; setTakeoverBusy(true); setTakeoverError(""); setTakeoverNotice("");
    try {
      const response = await request("/workbench-api/wb/mail/takeover", { method: "POST", signal: controller.signal,
        headers: { "Content-Type": "application/json", "X-Specgraph-Project": project }, body: JSON.stringify(command) });
      controller.signal.throwIfAborted();
      if (!response.ok) {
        if (response.status >= 500) throw new Error(`HTTP ${response.status}`);
        const result = await response.json() as { error?: string };
        controller.signal.throwIfAborted();
        takeoverAttempt.current = null; setTakeoverUncertain(false);
        setTakeoverError(result.error || `HTTP ${response.status}`);
        return;
      }
      const result = await response.json() as { thread: MailThreadSummary; event: OwnerEvent };
      controller.signal.throwIfAborted();
      if (result.thread?.id !== command.mail_thread_id || typeof result.thread.owner_run !== "string" ||
        result.thread.opened_by_run !== detail.thread.opened_by_run || typeof result.event?.id !== "string" ||
        result.event.thread_id !== command.mail_thread_id || result.event.to_run !== command.recipient_run_id ||
        result.event.actor_kind !== "human" || typeof result.event.actor_user_id !== "string" || !result.event.actor_user_id || result.event.actor_run_id !== null ||
        result.event.reason !== command.body || typeof result.event.from_run !== "string" || typeof result.event.created_at !== "string") throw new Error("Invalid takeover receipt");
      takeoverAttempt.current = null; setTakeoverUncertain(false); setTakeoverOpen(false);
      setTakeoverNotice(text("已记录人工接管操作。", "Human takeover recorded."));
      setDetail((current) => current && { ...current, thread: result.thread });
      setList((current) => current && { ...current, threads: current.threads.map((thread) => thread.id === result.thread.id ? result.thread : thread) });
      setOwnerCursors([""]); setOwnerHistory(null); setRefresh((value) => value + 1);
    } catch (cause) {
      if (!controller.signal.aborted) {
        setTakeoverUncertain(true);
        setTakeoverError(text("结果尚未确认，重试会使用同一请求：", "Outcome unconfirmed; retry uses the same request: ") + String(cause));
      }
    } finally {
      if (!controller.signal.aborted) { takeoverInFlight.current = false; setTakeoverBusy(false); }
    }
  }

  if (identity === undefined) return <p role="status">{text("正在确认身份…", "Checking identity…")}</p>;
  if (identity === null) return <form className="wb-mail-login" onSubmit={(event) => void authenticate(event)}>
    <label>{text("SpecGraph 操作凭据", "SpecGraph operator credential")}<input type="password" autoComplete="off"
      value={key} onChange={(event) => setKey(event.target.value)} disabled={authBusy} required /></label>
    <button type="submit" className="wb-button" disabled={authBusy || !key}>{text("登录", "Sign in")}</button>
    {authError && <p role="alert">{authError}</p>}
  </form>;
  return <section className="wb-mail" aria-label={text("项目协作", "Project collaboration")}>
    <header className="wb-mail-toolbar">
      {!onOpenPendingThread && <label>{text("状态", "State")} <select value={state} onChange={(event) => {
        setState(event.target.value); setCursors([""]); setList(null); setSelected(null); setDetail(null);
      }}><option value="open">{text("未关闭", "Open")}</option><option value="closed">{text("已关闭", "Closed")}</option><option value="all">{text("全部", "All")}</option></select></label>}
      {task && <button className="wb-button" onClick={onClearTask}>{text("节点", "Node")}: {task} ×</button>}
      {task && <label><input type="checkbox" aria-label={text("包含子节点", "Include child nodes")} checked={includeDescendants} disabled={takeoverBusy || takeoverUncertain} onChange={(event) => {
        if (takeoverInFlight.current || takeoverUncertain) return;
        setIncludeDescendants(event.target.checked); setCursors([""]); setList(null); setSelected(null); setDetail(null);
        setMessageCursors([""]); setDetailError(""); setDetailLoading(false);
        setOwnerHistory(null); setOwnerCursors([""]); setOwnerError(""); setOwnerLoading(false);
      }} />{text("包含子节点", "Include child nodes")}</label>}
      <span>{identity}</span>
      {request && <button className="wb-button" disabled={setupBusy} onClick={() => void initializeMail()}><Settings2 size={14} />{text("设置本机邮箱", "Set up local mail")}</button>}
      <button className="wb-button" disabled={loading || detailLoading} onClick={() => setRefresh((value) => value + 1)}><RefreshCw size={14} />{text("刷新邮件", "Refresh mail")}</button>
      <button className="wb-button" disabled={authBusy} onClick={() => void authenticate()}><LogOut size={14} />{text("退出", "Sign out")}</button>
    </header>
    {authError && <p role="alert">{authError}</p>}
    {setupNotice && <p role="status">{setupNotice}</p>}
    {setupError && <p role="alert">{setupError}</p>}
    <div className={onOpenPendingThread ? undefined : "wb-mail-columns"}>
      <section aria-label={text("协作线程", "Collaboration threads")}>
        {listError && <p role="alert">{list && text("列表已陈旧：", "List is stale: ")}{listError}</p>}
        {loading && <p role="status">{text("读取邮件…", "Loading mail…")}</p>}
        {list && <><ul className="wb-mail-list">{list.threads.map((thread) => <li key={thread.id}>
          <button className="wb-mail-thread" aria-pressed={selected === thread.id} onClick={() => {
            if (onOpenPendingThread) { onOpenPendingThread(thread.id); return; }
            setSelected(thread.id); setDetail(null); setMessageCursors([""]); setOwnerHistory(null); setOwnerCursors([""]);
          }}><strong>{thread.subject}</strong><span>{thread.task_slug}</span>
            <span>{text("发起者", "Opened by")}: {thread.opened_by_run}{nodeByRun.has(thread.opened_by_run) && ` (${nodeByRun.get(thread.opened_by_run)})`}</span>
            <span>{text("当前负责人", "Current owner")}: {thread.owner_run ?? text("未知", "Unknown")}{nodeByRun.has(thread.owner_run) && ` (${nodeByRun.get(thread.owner_run)})`}</span>
            <span>{thread.message_count} {text("封消息", "messages")} · {thread.pending_ack_count} {text("项收件确认待处理", "pending recipient confirmations")}</span>
            {onOpenPendingThread && thread.pending_ack_count === 0 && <span>{text("收件已全部确认，线程尚未关闭", "All receipts acknowledged; thread remains open")}</span>}
            <time>{thread.last_message_at || thread.created_at}</time>
          </button></li>)}</ul>
          {!list.threads.length && <p>{text("当前筛选没有协作线程。", "No threads match this filter.")}</p>}
          <nav className="wb-mail-toolbar" aria-label={text("线程分页", "Thread pages")}>
            <button className="wb-button" disabled={loading || cursors.length < 2} onClick={() => { setList(null); setCursors((value) => value.slice(0, -1)); }}><ArrowLeft size={14} />{text("上一页", "Previous")}</button>
            <button className="wb-button" disabled={loading || !list.next_cursor} onClick={() => { setCursors((value) => [...value, list.next_cursor]); setList(null); }}><ArrowRight size={14} />{text("下一页", "Next")}</button>
          </nav></>}
      </section>
      {!onOpenPendingThread && <section className="wb-mail-detail" aria-label={text("邮件详情", "Mail details")}>
        {!selected && <p>{text("未选择协作线程。", "No thread selected.")}</p>}
        {detailLoading && <p role="status">{text("读取线程…", "Loading thread…")}</p>}
        {detailError && <p role="alert">{detail && text("详情已陈旧：", "Details are stale: ")}{detailError}</p>}
        {detail && <><header className="wb-mail-toolbar"><h2>{detail.thread.subject}</h2>
          <button className="wb-button" onClick={() => onOpenNode(detail.thread.task_slug)}><GitBranch size={14} />{detail.thread.task_slug}</button>
          <span>{detail.thread.closed_at ? text("已关闭", "Closed") : text("未关闭", "Open")}</span></header>
          <p>{text("发起者", "Opened by")}: {detail.thread.opened_by_run} {nodeByRun.has(detail.thread.opened_by_run) && <button className="wb-button" onClick={() => onOpenNode(nodeByRun.get(detail.thread.opened_by_run)!)}>
            <GitBranch size={14} />{nodeByRun.get(detail.thread.opened_by_run)}
          </button>}</p>
          <p>{text("当前负责人", "Current owner")}: {detail.thread.owner_run ?? text("未知", "Unknown")} {nodeByRun.has(detail.thread.owner_run) && <button className="wb-button" onClick={() => onOpenNode(nodeByRun.get(detail.thread.owner_run)!)}>
            <GitBranch size={14} />{nodeByRun.get(detail.thread.owner_run)}
          </button>}</p>
          {readMail && request && !detailLoading && !detailError && detail.thread.id === selected && <>
            {!takeoverOpen && <button type="button" className="wb-button" onClick={() => {
              setTakeoverOpen(true); setDirectory(null); setDirectoryCursors([""]); setRecipient(""); setTakeoverReason(""); setTakeoverError("");
            }}><Check size={14} />{text("指定接管者", "Assign successor")}</button>}
            {takeoverOpen && <form aria-label={text("人工接管", "Human takeover")} onSubmit={(event) => void takeOver(event)}>
              {directoryLoading && <p role="status">{text("读取通讯录…", "Loading directory…")}</p>}
              {directoryError && <p role="alert">{directoryError}</p>}
              <label>{text("接管者", "Successor")}<select aria-label={text("接管者", "Successor")} value={recipient} required disabled={takeoverBusy || takeoverUncertain || directoryLoading || !!directoryError}
                onChange={(event) => setRecipient(event.target.value)}>
                <option value="">{text("选择已登记的运行", "Select an enrolled run")}</option>
                {directory?.contacts.map((contact) => <option key={contact.run_id} value={contact.run_id}>{contact.run_id} · {contact.task_slug} · {contact.assignment_role}</option>)}
              </select></label>
              {directory && <nav className="wb-mail-toolbar" aria-label={text("通讯录分页", "Directory pages")}>
                <button type="button" className="wb-button" disabled={takeoverBusy || takeoverUncertain || directoryLoading || directoryCursors.length < 2} onClick={() => { setDirectory(null); setRecipient(""); setDirectoryCursors((value) => value.slice(0, -1)); }}><ArrowLeft size={14} />{text("上一页", "Previous")}</button>
                <button type="button" className="wb-button" disabled={takeoverBusy || takeoverUncertain || directoryLoading || !directory.next_cursor} onClick={() => { setDirectoryCursors((value) => [...value, directory.next_cursor]); setDirectory(null); setRecipient(""); }}><ArrowRight size={14} />{text("下一页", "Next")}</button>
              </nav>}
              <label>{text("接管原因", "Takeover reason")}<textarea aria-label={text("接管原因", "Takeover reason")} value={takeoverReason} required disabled={takeoverBusy || takeoverUncertain} onChange={(event) => setTakeoverReason(event.target.value)} /></label>
              <button type="submit" className="wb-button" disabled={takeoverBusy || (!takeoverUncertain && (directoryLoading || !!directoryError || !recipient || !takeoverReason.trim()))}><Check size={14} />{takeoverUncertain ? text("重试同一请求", "Retry same request") : text("确认人工接管", "Confirm human takeover")}</button>
              {!takeoverUncertain && <button type="button" className="wb-button" disabled={takeoverBusy} onClick={() => { setTakeoverOpen(false); setDirectory(null); setTakeoverError(""); }}>{text("取消", "Cancel")}</button>}
            </form>}
          </>}
          {takeoverError && <p role="alert">{takeoverError}</p>}
          {takeoverNotice && <p role="status">{takeoverNotice}</p>}
          {detail.thread.closure_note && <p>{detail.thread.closure_note}</p>}
          {detail.items.map(({ message, receipts }) => <article className="wb-mail-message" key={message.id}>
            <header><strong>{message.sender_run}</strong> · <time>{message.created_at}</time></header>
            {nodeByRun.has(message.sender_run) && <button className="wb-button" onClick={() => onOpenNode(nodeByRun.get(message.sender_run)!)}>
              <GitBranch size={14} />{nodeByRun.get(message.sender_run)}
            </button>}
            <p className="wb-mail-body">{message.body}</p>
            {message.handoff_to_run && <p>{text("移交给", "Transferred to")}: {message.handoff_to_run} {nodeByRun.has(message.handoff_to_run) && <button className="wb-button" onClick={() => onOpenNode(nodeByRun.get(message.handoff_to_run!)!)}>
              <GitBranch size={14} />{nodeByRun.get(message.handoff_to_run)}
            </button>}</p>}
            {message.references.map((source) => <details className="wb-mail-quote" key={source.message_id}>
              <summary>{source.kind === "reply" ? text("回复", "Reply to") : source.kind === "forward" ? text("转发", "Forwarded") : text("上下文", "Context")} · {source.subject}</summary>
              <p>{source.sender_run_id} · {source.created_at}</p><p className="wb-mail-body">{source.body}</p>
              <button className="wb-button" onClick={() => onOpenNode(source.task_slug)}><GitBranch size={14} />{source.task_slug}</button>
            </details>)}
            <ul className="wb-mail-receipts">{receipts.map((receipt) => <li key={receipt.recipient_run_id}>
              <span>{receipt.recipient_run_id}</span>
              {nodeByRun.has(receipt.recipient_run_id) && <button className="wb-button" onClick={() => onOpenNode(nodeByRun.get(receipt.recipient_run_id)!)}>
                <GitBranch size={14} />{nodeByRun.get(receipt.recipient_run_id)}
              </button>}
              <span>{receipt.read_at ? `${text("已读", "Read")}: ${receipt.read_at}` : text("无已读回执", "No read receipt")}</span>
              <span>{receipt.acknowledged_at ? `${text("已确认", "Acknowledged")}: ${receipt.acknowledged_at}` : text("待确认", "Pending acknowledgment")}</span>
            </li>)}</ul>
          </article>)}
          <nav className="wb-mail-toolbar" aria-label={text("消息分页", "Message pages")}>
            <button className="wb-button" disabled={detailLoading || messageCursors.length < 2} onClick={() => { setDetail(null); setMessageCursors((value) => value.slice(0, -1)); }}><ArrowLeft size={14} />{text("较早消息", "Earlier")}</button>
            <button className="wb-button" disabled={detailLoading || !detail.next_cursor} onClick={() => { setMessageCursors((value) => [...value, detail.next_cursor]); setDetail(null); }}><ArrowRight size={14} />{text("较新消息", "Later")}</button>
          </nav>
          {readMail && <section aria-label={text("接管记录", "Takeover history")}>
            <h3>{text("接管记录", "Takeover history")}</h3>
            {ownerLoading && <p role="status">{text("读取接管记录…", "Loading takeover history…")}</p>}
            {ownerError && <p role="alert">{ownerHistory && text("记录已陈旧：", "History is stale: ")}{ownerError}</p>}
            {ownerHistory && <><ul>{ownerHistory.events.map((event) => <li key={event.id}>
              <p>{event.actor_kind === "human" ? text("人工", "Human") : "PM"}: {event.actor_user_id}{event.actor_run_id && ` · ${event.actor_run_id}`}
                {event.actor_run_id && nodeByRun.has(event.actor_run_id) && <button className="wb-button" onClick={() => onOpenNode(nodeByRun.get(event.actor_run_id!)!)}><GitBranch size={14} />{nodeByRun.get(event.actor_run_id)}</button>}
                {" · "}<time>{event.created_at}</time></p>
              {[[text("原负责人", "Previous owner"), event.from_run], [text("接管者", "Successor"), event.to_run]].map(([label, runId]) => <p key={label}>{label}: {runId}
                {nodeByRun.has(runId!) && <button className="wb-button" onClick={() => onOpenNode(nodeByRun.get(runId!)!)}><GitBranch size={14} />{nodeByRun.get(runId!)}</button>}
              </p>)}
              <p className="wb-mail-body">{event.reason}</p>
            </li>)}</ul>
              {!ownerHistory.events.length && <p>{text("没有接管记录。", "No takeover records.")}</p>}
              <nav className="wb-mail-toolbar" aria-label={text("接管记录分页", "Takeover history pages")}>
                <button className="wb-button" disabled={ownerLoading || ownerCursors.length < 2} onClick={() => { setOwnerHistory(null); setOwnerCursors((value) => value.slice(0, -1)); }}><ArrowLeft size={14} />{text("上一页", "Previous")}</button>
                <button className="wb-button" disabled={ownerLoading || !ownerHistory.next_cursor} onClick={() => { setOwnerCursors((value) => [...value, ownerHistory.next_cursor]); setOwnerHistory(null); }}><ArrowRight size={14} />{text("下一页", "Next")}</button>
              </nav></>}
          </section>}</>}
      </section>}
    </div>
  </section>;
}
