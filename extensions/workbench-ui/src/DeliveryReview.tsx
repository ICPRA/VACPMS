import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { ClipboardCheck, RefreshCw } from "lucide-react";
import type { WorkbenchRequest } from "./workbenchModel";

export function DeliveryReview({ project, deliveryId, language, request, onChanged, renderGitRange }: {
  project: string; deliveryId: string; language: "zh" | "en";
  request: WorkbenchRequest; onChanged: () => void;
  renderGitRange?: (snapshot: unknown) => ReactNode;
}) {
  const text = (zh: string, en: string) => language === "zh" ? zh : en;
  const [delivery, setDelivery] = useState<{ id: string; snapshot: unknown } | null>(null);
  const [needsLogin, setNeedsLogin] = useState(false);
  const [key, setKey] = useState("");
  const [verdict, setVerdict] = useState("rejected");
  const [basis, setBasis] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [completion, setCompletion] = useState<{ status: "not_requested" | "completed" | "failed"; code?: string; message?: string } | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const inFlight = useRef(false);
  const endpoint = `/workbench-api/loop/deliveries/${encodeURIComponent(deliveryId)}`;

  useEffect(() => {
    const controller = new AbortController();
    setDelivery(null); setError("");
    void request(endpoint, { headers: { "X-Specgraph-Project": project }, signal: controller.signal })
      .then(async (response) => {
        if (controller.signal.aborted) return;
        if (response.status === 401) { setNeedsLogin(true); return; }
        if (!response.ok) throw new Error(text("无法读取交付：", "Cannot read delivery: ") + response.status);
        const result = await response.json();
        if (controller.signal.aborted) return;
        if (result.id !== deliveryId || !("snapshot" in result)) throw new Error("Invalid delivery response");
        setDelivery(result); setNeedsLogin(false);
      }).catch((cause) => { if (!controller.signal.aborted) setError(String(cause)); });
    return () => controller.abort();
  }, [project, deliveryId, endpoint, request, attempt]);

  async function login(event: FormEvent) {
    event.preventDefault();
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError("");
    try {
      const response = await request("/workbench-api/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key }) });
      if (!response.ok) throw new Error(text("登录失败：", "Sign-in failed: ") + response.status);
      setAttempt((value) => value + 1);
    } catch (cause) { setError(String(cause)); }
    finally { setKey(""); setBusy(false); inFlight.current = false; }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (inFlight.current || !delivery || !basis.trim() || submitted || uncertain) return;
    inFlight.current = true; setBusy(true); setError("");
    try {
      const response = await request(`${endpoint}/accept`, { method: "POST",
        headers: { "Content-Type": "application/json", "X-Specgraph-Project": project }, body: JSON.stringify({ verdict, basis: basis.trim() }) });
      if (!response.ok) {
        if (response.status === 401) { setDelivery(null); setNeedsLogin(true); }
        if (response.status >= 500) setUncertain(true);
        const result = await response.json();
        setError(result.error || text("判定未保存：", "Decision not saved: ") + response.status);
        return;
      }
      const result = await response.json();
      if (result.recorded !== true || result.deliveryId !== deliveryId || result.verdict !== verdict) throw new Error("Invalid review receipt");
      setSubmitted(true); setCompletion(result.completion ?? null); onChanged();
    } catch (cause) { setUncertain(true); setError(text("结果未确认，请刷新判定历史：", "Result unconfirmed; refresh decision history: ") + String(cause)); }
    finally { setBusy(false); inFlight.current = false; }
  }

  return <section className="wb-panel" aria-label={text("交付审核", "Delivery review")}>
    {needsLogin && <form onSubmit={(event) => void login(event)}>
      <label>{text("SpecGraph 操作凭据", "SpecGraph operator credential")}<input type="password" autoComplete="off" required value={key} disabled={busy} onChange={(event) => setKey(event.target.value)} /></label>
      <button className="wb-button" type="submit" disabled={busy}>{text("登录", "Sign in")}</button>
    </form>}
    {delivery && <>
      <h4>{text("交付内容", "Delivery content")}</h4>
      <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words text-xs">{JSON.stringify(delivery.snapshot, null, 2)}</pre>
      {renderGitRange?.(delivery.snapshot)}
      {submitted ? <>
        <p role="status">{text("判定已记录。", "Decision recorded.")}</p>
        {completion?.status === "completed" && <p role="status">{text("原工作流程已推进。", "Original workflow advanced.")}</p>}
        {completion?.status === "not_requested" && <p>{text("未请求推进工作流程。", "Workflow advancement was not requested.")}</p>}
        {completion?.status === "failed" && <p role="alert">{text("判定已保存，但推进工作流程失败：", "Decision saved, but workflow advancement failed: ")}{completion.code} {completion.message}</p>}
      </> : <form onSubmit={(event) => void submit(event)}>
        <label>{text("审核判定", "Verdict")}<select value={verdict} disabled={busy || uncertain} onChange={(event) => setVerdict(event.target.value)}>
          <option value="rejected">{text("退回", "Reject")}</option><option value="accepted">{text("接受", "Accept")}</option>
        </select></label>
        <label>{text("审核依据", "Review basis")}<textarea required maxLength={4000} value={basis} disabled={busy || uncertain} onChange={(event) => setBasis(event.target.value)} /></label>
        <button className="wb-button" type="submit" disabled={busy || uncertain || !basis.trim()}><ClipboardCheck size={14} />{text("记录判定", "Record decision")}</button>
      </form>}
    </>}
    {error && <p role="alert">{error}</p>}
    {(uncertain || (!delivery && !needsLogin && error)) && <button className="wb-button" type="button" onClick={() => { onChanged(); setAttempt((value) => value + 1); }}><RefreshCw size={14} />{text("刷新", "Refresh")}</button>}
  </section>;
}
