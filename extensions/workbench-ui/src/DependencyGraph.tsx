import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, CornerDownRight, RefreshCw } from "lucide-react";
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import { compositionView, dependencyGraph, dependencyImpactRanking, dependencyNeighbors, type DisplayEdge, type DisplayGraph, type GraphNodeData } from "./workbenchGraph";
import type { MailReader, MailThreadSummary } from "./MailWorkspace";
import { DeliveryHooksPanel } from "./DeliveryHooksPanel";
import { dependencyDirection, taskRejectionCounts, type CurrentView, type DeliveryTestHook, type WorkbenchRequest } from "./workbenchModel";

type CanvasEdge = DisplayEdge & { data?: NonNullable<DisplayEdge["data"]> & { hooks?: DeliveryTestHook[] } };

type DisplayNode = Node<
  GraphNodeData & {
    select: () => void;
    relation: string;
    stageText: string;
    claimableText: string;
    runText: string;
    cycleText: string;
    boundaryText: string;
    connectionsText: string;
    rejectionText: string;
    markText: string;
    eventText: string;
    ownerText: string;
    eventTone: "none" | "amber" | "red";
  }
>;

function WorkbenchNode({ data, selected }: NodeProps<DisplayNode>) {
  return (
    <>
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <button
        type="button"
        className="wb-graph-node nodrag nopan nowheel"
        aria-pressed={selected}
        data-stage={data.role === "summary" ? "summary" : data.stage}
        onClick={(event) => {
          event.stopPropagation();
          data.select();
        }}
      >
        <strong title={data.title || data.slug}>{data.title || data.slug}</strong>
        <span className="wb-graph-kind">
          <span className="wb-badge">{data.stageText || data.label}</span>
          <span>{data.priority}</span>
          {data.connectionsText && <span className="inline-flex items-center gap-1" title={data.connectionsText} aria-label={data.connectionsText}>
            <ArrowLeft size={12} aria-hidden="true" />{data.prerequisiteCount}
            <ArrowRight size={12} aria-hidden="true" />{data.dependentCount}
          </span>}
          {data.inDependencyCycle && <span className="wb-cycle-marker">{data.cycleText}</span>}
          {data.markText && <span>{data.markText}</span>}
        </span>
        {data.claimableText && <span className="wb-ready-label">{data.claimableText}</span>}
        {data.boundaryText && <span className="wb-graph-relation">{data.boundaryText}</span>}
        {data.relation && <span className="wb-graph-relation">{data.relation}</span>}
        {data.runText && <span className="wb-graph-slug">{data.runText}</span>}
        {data.rejectionText && <span className="wb-cycle-marker">{data.rejectionText}</span>}
        {data.eventText && <span className="wb-event-history" data-tone={data.eventTone}>{data.eventText}</span>}
        {data.ownerText && <span className="wb-graph-relation">{data.ownerText}</span>}
      </button>
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </>
  );
}

const nodeTypes = { workbench: WorkbenchNode };

export function DependencyGraph({
  data,
  selected,
  onSelect,
  language,
  stageLabel,
  readMail,
  onOpenMail,
  onOpenHook,
  onOpenDelivery,
  requestOperation,
  onChanged,
}: {
  data: CurrentView;
  selected: string | null;
  onSelect: (slug: string | null) => void;
  language: "zh" | "en";
  stageLabel: (stage: string) => string;
  readMail?: MailReader;
  onOpenMail: (threadId?: string) => void;
  onOpenHook?: (hookId: string) => void;
  onOpenDelivery?: (id: string, task: string) => void;
  requestOperation?: WorkbenchRequest;
  onChanged?: () => void;
}) {
  const text = (zh: string, en: string) => (language === "zh" ? zh : en);
  const [showOtherRelations, setShowOtherRelations] = useState(false);
  const [showDownstream, setShowDownstream] = useState(false);
  const [showImpactRanking, setShowImpactRanking] = useState(false);
  const impactRanking = useMemo(() => {
    if (!showImpactRanking) return [];
    const nodesBySlug = new Map(data.graph.nodes.map((node) => [node.slug, node]));
    return dependencyImpactRanking(data.graph).filter((entry) => entry.count > 0)
      .map((entry) => ({ node: nodesBySlug.get(entry.slug)!, count: entry.count }));
  }, [showImpactRanking, data.graph]);
  const [showMail, setShowMail] = useState(false);
  const [showHooks, setShowHooks] = useState(false);
  const [hookPair, setHookPair] = useState<{ from: string; to: string } | null>(null);
  const [hookId, setHookId] = useState<string | null>(null);
  const [mailState, setMailState] = useState("open");
  const [mailCursor, setMailCursor] = useState("");
  const [mailRefresh, setMailRefresh] = useState(0);
  const [mailThreads, setMailThreads] = useState<MailThreadSummary[]>([]);
  const [nextMailCursor, setNextMailCursor] = useState("");
  const [mailLoading, setMailLoading] = useState(false);
  const [mailError, setMailError] = useState("");
  const [mailPair, setMailPair] = useState<{ from: string; to: string } | null>(null);
  useEffect(() => {
    if (!showMail) return;
    const controller = new AbortController();
    setMailLoading(true); setMailError("");
    void (async () => {
      try {
        let body;
        if (readMail) {
          body = await readMail({ resource: "mail-threads", project: data.project, state: mailState, cursor: mailCursor }, controller.signal);
        } else {
          const query = new URLSearchParams({ state: mailState, cursor: mailCursor, limit: "50" });
          const response = await fetch(`/workbench-api/loop/mail/threads?${query}`, {
            headers: { "X-Specgraph-Project": data.project }, signal: controller.signal, cache: "no-store",
          });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          body = await response.json();
        }
        const page = body as { threads: MailThreadSummary[]; next_cursor: string };
        if (!Array.isArray(page.threads) || typeof page.next_cursor !== "string" || page.threads.some((thread) => !Array.isArray(thread.node_links))) {
          throw new Error("Mailbox response is missing node links");
        }
        if (controller.signal.aborted) return;
        setMailThreads((previous) => mailCursor ? [...previous, ...page.threads.filter((thread) => !previous.some((item) => item.id === thread.id))] : page.threads);
        setNextMailCursor(page.next_cursor);
      } catch (error) {
        if (!controller.signal.aborted) setMailError(String(error));
      } finally { if (!controller.signal.aborted) setMailLoading(false); }
    })();
    return () => controller.abort();
  }, [showMail, data.project, mailState, mailCursor, mailRefresh, readMail]);
  const mailRelations = useMemo(() => {
    const pairs = new Map<string, DisplayGraph["edges"][number]>();
    if (showMail) for (const thread of mailThreads) for (const link of thread.node_links) {
      const key = JSON.stringify([link.sender_task_slug, link.recipient_task_slug]);
      const edge = pairs.get(key) ?? { from: link.sender_task_slug, to: link.recipient_task_slug, type: "MAIL",
        mail: { threads: [], messageCount: 0, pendingAckCount: 0 } };
      edge.mail!.threads.push({ threadId: thread.id, subject: thread.subject });
      edge.mail!.messageCount += link.message_count;
      edge.mail!.pendingAckCount += link.pending_ack_count;
      pairs.set(key, edge);
    }
    return [...pairs.values()];
  }, [showMail, mailThreads]);
  const selectedMail = mailRelations.find((edge) => edge.from === mailPair?.from && edge.to === mailPair.to)?.mail;
  const augmentedGraph: DisplayGraph = useMemo(() => ({ ...data.graph, edges: [...data.graph.edges, ...mailRelations.filter((edge) => edge.from !== edge.to)] }), [data.graph, mailRelations]);
  const [mapPath, setMapPath] = useState<string[]>([]);
  const parent = mapPath.at(-1) ?? null;
  const composition = useMemo(() => compositionView(augmentedGraph, parent), [augmentedGraph, parent]);
  const displayGraph = useMemo(() => {
    if (showOtherRelations) return composition.graph;
    const edges = composition.graph.edges.filter((edge) => dependencyDirection(edge) !== null || edge.mail);
    const endpoints = new Set(edges.flatMap((edge) => [edge.from, edge.to]));
    return { nodes: composition.graph.nodes.filter((node) => !composition.boundary.has(node.slug) || endpoints.has(node.slug)), edges };
  }, [composition, showOtherRelations]);
  const dependencyCount = composition.graph.edges.filter((edge) => dependencyDirection(edge) !== null).length;
  const graph = useMemo(() => dependencyGraph(displayGraph, data.specs), [displayGraph, data.specs]);
  // Hook relations are a canvas overlay, never input to layout or dependency calculations.
  const hookEdges = useMemo(() => {
    const pairs = new Map<string, CanvasEdge>();
    const visible = new Set(graph.nodes.filter((node) => node.data.taskSlug).map((node) => node.id));
    if (showHooks && data.capabilities.deliveryHooks) for (const hook of data.deliveryHooks ?? []) {
      if (!visible.has(hook.sourceTaskSlug) || !visible.has(hook.targetTaskSlug)) continue;
      const id = JSON.stringify(["DELIVERY_TEST_HOOK", hook.sourceTaskSlug, hook.targetTaskSlug]);
      const edge: CanvasEdge = pairs.get(id) ?? { id, source: hook.sourceTaskSlug, target: hook.targetTaskSlug,
        data: { relationship: "DELIVERY_TEST_HOOK", dependency: false, hooks: [] }, type: "smoothstep", focusable: true,
        markerEnd: { type: MarkerType.ArrowClosed }, style: { strokeDasharray: "7 3", stroke: "var(--foreground)" } };
      edge.data!.hooks!.push(hook); pairs.set(id, edge);
    }
    return [...pairs.values()];
  }, [showHooks, data.capabilities.deliveryHooks, data.deliveryHooks, graph.nodes]);
  const selectedHooks = hookEdges.find((edge) => edge.source === hookPair?.from && edge.target === hookPair.to)?.data?.hooks;
  const selectedHook = selectedHooks?.find((hook) => hook.id === hookId);
  const rejections = useMemo(() => taskRejectionCounts(data), [data.runs, data.deliveries, data.acceptances]);
  const eventCounts = useMemo(() => new Map(data.nodeEventCounts?.map((entry) => [entry.taskSlug, entry])), [data.nodeEventCounts]);
  const nodeOwners = useMemo(() => new Map(data.nodeOwners?.map((entry) => [entry.taskSlug, entry])), [data.nodeOwners]);
  const nodeMarks = useMemo(() => {
    const labels = new Map<string, string[]>();
    for (const mark of data.nodeMarks ?? []) {
      const label = mark.kind === "risk" && mark.value === "watch" ? text("风险：关注", "Risk: Watch")
        : mark.kind === "risk" && mark.value === "high" ? text("风险：高", "Risk: High")
        : mark.kind === "critical" && mark.value === "marked" ? text("关键标记", "Marked critical") : "";
      if (!label) continue;
      const values = labels.get(mark.taskSlug) ?? [];
      values.push(label); labels.set(mark.taskSlug, values);
    }
    return labels;
  }, [data.nodeMarks, language]);
  const [otherNode, setOtherNode] = useState<string | null>(null);
  const [renderError, setRenderError] = useState<{
    graph: CurrentView["graph"];
    message: string;
  } | null>(null);
  const inspected = !selected ? graph.nodes.find((node) => node.id === otherNode)?.data : null;
  const active = selected ?? otherNode;
  const communicationPeers = new Set(mailRelations.flatMap((edge) => edge.from === active ? [edge.to] : edge.to === active ? [edge.from] : []));
  const hookPeers = new Set(hookEdges.flatMap((edge) => edge.source === active ? [edge.target] : edge.target === active ? [edge.source] : []));
  const neighbors = useMemo(() => dependencyNeighbors(data.graph, active), [data.graph, active]);
  const nodes: DisplayNode[] = graph.nodes.map((node) => ({
    ...node,
    selected: node.id === (selected ?? otherNode),
    className:
      active &&
      node.id !== active &&
      !neighbors.prerequisites.has(node.id) &&
      !neighbors.dependents.has(node.id) &&
      !(showDownstream && neighbors.downstream.has(node.id)) &&
      !communicationPeers.has(node.id) &&
      !hookPeers.has(node.id)
        ? "wb-node-unrelated"
        : "",
    data: {
      ...node.data,
      markText: nodeMarks.get(node.id)?.join(" / ") ?? "",
      ownerText: nodeOwners.get(node.id)?.pendingOperationId ? `${text("待人工接手", "Human takeover pending")}: ${nodeOwners.get(node.id)!.pendingOperationId}`
        : nodeOwners.get(node.id)?.humanOwnerUserId ? `${text("人工负责人", "Human owner")}: ${nodeOwners.get(node.id)!.humanOwnerUserId}` : "",
      eventText: node.data.taskSlug && data.nodeEventCounts !== undefined
        ? `${text("历史提示：重试", "History signal: retries")} ${eventCounts.get(node.id)?.retries ?? 0} / ${text("退回", "reworks")} ${eventCounts.get(node.id)?.reworks ?? 0} / ${eventCounts.get(node.id)?.gitUndos === undefined
          ? text("Git撤销引用计数不可用", "Git undo history count unavailable") : `${text("Git撤销引用", "Git undo references")} ${eventCounts.get(node.id)!.gitUndos}`}` : "",
      eventTone: (eventCounts.get(node.id)?.retries ?? 0) + (eventCounts.get(node.id)?.reworks ?? 0) >= 3 ? "red"
        : (eventCounts.get(node.id)?.retries ?? 0) + (eventCounts.get(node.id)?.reworks ?? 0) > 0 ? "amber" : "none",
      rejectionText: node.data.taskSlug && rejections.has(node.data.taskSlug)
        ? `${text("历史审核拒绝", "Historical rejections")} ${rejections.get(node.data.taskSlug)}` : "",
      stageText: node.data.taskSlug ? stageLabel(node.data.role === "summary" ? "summary" : node.data.stage) : node.data.label,
      cycleText: text("依赖环", "Dependency cycle"),
      connectionsText: node.data.prerequisiteCount || node.data.dependentCount
        ? `${text("本图前置", "Prerequisites here")} ${node.data.prerequisiteCount} · ${text("后续", "Dependents")} ${node.data.dependentCount}` : "",
      boundaryText: composition.boundary.has(node.id) ? text("范围外关联节点", "Outside this submap") : "",
      claimableText:
        node.data.taskSlug && data.readySpecSlugs?.includes(node.id)
          ? text("可领取规格", "Claimable spec")
          : "",
      runText: node.data.taskSlug
        ? `${data.runs.filter((run) => run.taskSlug === node.id).length} ${text("已登记执行", "registered runs")}`
        : "",
      relation:
        node.id === active
          ? ""
          : [
              neighbors.prerequisites.has(node.id) ? text("直接前置", "Direct prerequisite") : "",
              neighbors.dependents.has(node.id) ? text("直接后续", "Direct dependent") : "",
              showDownstream && neighbors.downstream.has(node.id) && !neighbors.dependents.has(node.id)
                ? text("间接后续", "Indirect dependent") : "",
              communicationPeers.has(node.id) ? text("邮件协作", "Mail collaboration") : "",
              hookPeers.has(node.id) ? text("交付测试 hook", "Delivery test hook") : "",
            ]
              .filter(Boolean)
              .join(" / "),
      select: () => {
        setOtherNode(node.data.taskSlug ? null : node.id);
        onSelect(node.data.taskSlug);
      },
    },
  }));

  return (
    <section
      className="wb-graph-region"
      aria-label={text("项目依赖图", "Project dependency graph")}
    >
      <nav aria-label={text("子图路径", "Submap path")}>
        <button type="button" className="wb-button" onClick={() => { setMapPath([]); setOtherNode(null); onSelect(null); }}>{text("项目全图", "Project graph")}</button>
        {mapPath.map((slug, index) => <button type="button" className="wb-button" key={slug} aria-current={index === mapPath.length - 1 ? "page" : undefined}
          onClick={() => { setMapPath(mapPath.slice(0, index + 1)); setOtherNode(null); onSelect(null); }}>
          / {data.graph.nodes.find((node) => node.slug === slug)?.title || slug}
        </button>)}
        {active && composition.children.get(active)?.size && (parent === null || composition.children.get(parent)?.has(active)) ? <button type="button" className="wb-button"
          disabled={mapPath.includes(active)} title={mapPath.includes(active) ? text("包含关系形成环，需要修正", "Containment cycle requires correction") : undefined} onClick={() => { setMapPath([...mapPath, active]); setOtherNode(null); onSelect(null); }}>
          <CornerDownRight size={14} />{text("进入子图", "Open submap")} ({composition.children.get(active)!.size})
        </button> : null}
      </nav>
      {parent && !data.graph.nodes.some((node) => node.slug === parent) && <p role="alert">{text("当前子图节点已不在最新快照中", "This submap node is absent from the latest snapshot")}</p>}
      {mapPath.some((slug, index) => index > 0 && !composition.children.get(mapPath[index - 1]!)?.has(slug)) && <p role="alert">{text("子图路径的包含关系已改变", "The containment relationships in this path have changed")}</p>}
      {composition.missingChildren.length > 0 && <p role="alert">{text("子图缺少节点记录", "Submap node records missing")}: {composition.missingChildren.join(", ")}</p>}
      <p className="wb-graph-summary">
        {displayGraph.nodes.length} {text("节点", "nodes")} · {dependencyCount}{" "}
        {text("依赖边", "dependency edges")} · {composition.graph.edges.filter((edge) => !edge.mail).length - dependencyCount}{" "}
        {text("其他关系", "other relationships")} · {text("前置 → 依赖方", "Prerequisite → dependent")}
        {data.capabilities.nodeMarks && data.nodeMarks === undefined && ` · ${text("节点标记数据不可用", "Node mark data unavailable")}`}
        {data.capabilities.nodeEvents && data.nodeEventCounts === undefined && ` · ${text("重试/退回历史计数不可用", "Retry/rework history counts unavailable")}`}
        {active && (
          <>
            {" "}
            · {text("直接前置", "Direct prerequisites")} {neighbors.prerequisites.size}
            {" · "}
            {text("直接后续", "Direct dependents")} {neighbors.dependents.size}
          </>
        )}
      </p>
      <div className="wb-graph-controls">
      <details className="wb-graph-insight" open={showImpactRanking} onToggle={(event) => setShowImpactRanking(event.currentTarget.open)}>
        <summary>{text("结构影响排序", "Structural impact ranking")}</summary>
        {showImpactRanking && <>
          <p className="wb-meta">{text("当前快照 · 下游依赖可达数", "Current snapshot · Downstream reachability")}</p>
          {impactRanking.length === 0 ? <p>{text("当前快照中没有存在下游依赖的节点。", "No nodes have downstream dependencies in the current snapshot.")}</p> : <ol>
            {impactRanking.map(({ node, count }) => <li key={node.slug}>
              <button type="button" className="text-left" onClick={() => {
                const taskSlug = node.label === "Spec" && data.specs.some((spec) => spec.slug === node.slug) ? node.slug : null;
                setMapPath([]);
                setOtherNode(taskSlug ? null : node.slug);
                onSelect(taskSlug);
              }}>{node.title || node.slug} · {node.label} · {node.slug} · {count} {text("下游节点", "downstream nodes")}</button>
            </li>)}
          </ol>}
        </>}
      </details>
      {active && <details className="wb-graph-insight">
        <summary>{text("下游影响", "Downstream impact")} ({neighbors.downstream.size})</summary>
        <p className="wb-meta">{text("当前快照 · 直接与间接后续", "Current snapshot · Direct and indirect dependents")}</p>
        <label className="wb-graph-layer">
          <input type="checkbox" checked={showDownstream} onChange={(event) => setShowDownstream(event.target.checked)} />
          {text("突出显示下游节点", "Highlight downstream nodes")}
        </label>
        {neighbors.downstream.size === 0 ? <p>{text("当前快照中没有下游依赖节点。", "No downstream dependencies in the current snapshot.")}</p> : <ul>
          {data.graph.nodes.filter((node) => neighbors.downstream.has(node.slug)).map((node) => <li key={node.slug}>
            <button type="button" className="text-left" onClick={() => {
              const taskSlug = node.label === "Spec" && data.specs.some((spec) => spec.slug === node.slug) ? node.slug : null;
              setMapPath([]);
              setOtherNode(taskSlug ? null : node.slug);
              onSelect(taskSlug);
            }}>{node.title || node.slug} · {node.label} · {node.slug}</button>
          </li>)}
        </ul>}
      </details>}
      <label className="wb-graph-layer">
        <input type="checkbox" checked={showOtherRelations} onChange={(event) => {
          setShowOtherRelations(event.target.checked);
          setRenderError(null);
        }} />
        {text("显示其他关系", "Show other relationships")}
      </label>
      {data.capabilities.mailInspection && <label className="wb-graph-layer">
        <input type="checkbox" checked={showMail} onChange={(event) => {
          setShowMail(event.target.checked); setMailThreads([]); setMailCursor(""); setNextMailCursor("");
        }} />{text("邮件协作", "Mail collaboration")}
      </label>}
      <label className="wb-graph-layer"><input type="checkbox" checked={showHooks} onChange={(event) => {
        setShowHooks(event.target.checked); setHookPair(null); setHookId(null);
      }} />{text("Hook 关系", "Hook relations")}</label>
      </div>
      {showHooks && <div className="wb-mail-toolbar">
        {!data.capabilities.deliveryHooks || data.deliveryHooks === undefined ? <p>{text("Hook 数据不可用。", "Hook data unavailable.")}</p> : <span>{data.deliveryHooks.length} {text("条 hook 记录", "hook records")}</span>}
        {selectedHooks && <section aria-label={text("所选 hook 关系", "Selected hook relation")}>
          <strong>{hookPair!.from} → {hookPair!.to}</strong>
          {selectedHooks.map((hook) => <button type="button" className="wb-button" key={hook.id} onClick={() => { setHookId(hook.id); onOpenHook?.(hook.id); }}>{hook.id}</button>)}
          {selectedHook && <DeliveryHooksPanel key={`${data.project}:${selectedHook.id}`} hooks={[selectedHook]} available data={data} language={language} onOpenNode={onSelect} {...(onOpenDelivery ? { onOpenDelivery } : {})}
            {...(requestOperation ? { request: requestOperation } : {})} {...(onChanged ? { onChanged } : {})} />}
        </section>}
      </div>}
      {showMail && <div className="wb-mail-toolbar">
        <select aria-label={text("协作状态", "Collaboration state")} value={mailState} onChange={(event) => {
          setMailState(event.target.value); setMailCursor(""); setMailThreads([]); setNextMailCursor("");
        }}><option value="open">{text("未关闭", "Open")}</option><option value="closed">{text("已关闭", "Closed")}</option><option value="all">{text("全部", "All")}</option></select>
        <button className="wb-button" disabled={mailLoading} aria-label={text("刷新协作", "Refresh collaboration")} onClick={() => {
          setMailCursor(""); setMailThreads([]); setNextMailCursor(""); setMailRefresh((value) => value + 1);
        }}><RefreshCw size={14} /></button>
        <span>{mailThreads.length} {text("已载入线程", "loaded threads")}{nextMailCursor && ` · ${text("还有更多，当前并非全量", "More available; partial view")}`}</span>
        {mailRelations.some((edge) => edge.from === edge.to) && <span>{text("节点内投递", "Within-node deliveries")}: {mailRelations.filter((edge) => edge.from === edge.to).reduce((sum, edge) => sum + edge.mail!.messageCount, 0)}</span>}
        {nextMailCursor && <button className="wb-button" disabled={mailLoading} onClick={() => setMailCursor(nextMailCursor)}>{text("加载更多", "Load more")}</button>}
        {mailLoading && <span role="status">{text("读取协作…", "Loading collaboration…")}</span>}
        {mailError && <p role="alert">{text("协作读取失败，已载入内容可能陈旧：", "Mail read failed; loaded data may be stale: ")}{mailError} <button className="wb-button" onClick={() => onOpenMail()}>{text("打开协作与登录", "Open collaboration and sign in")}</button></p>}
        <details><summary>{text("协作线程", "Collaboration threads")}</summary>
          {mailThreads.map((thread) => <button className="wb-button" key={thread.id} onClick={() => onOpenMail(thread.id)}>{thread.subject}</button>)}
        </details>
        {selectedMail && <section aria-label={text("所选通信关系", "Selected communication link")}>
          <strong>{mailPair!.from} → {mailPair!.to}</strong>
          {selectedMail.threads.map((thread) => <button className="wb-button" key={thread.threadId} onClick={() => onOpenMail(thread.threadId)}>{thread.subject}</button>)}
        </section>}
      </div>}
      {graph.cycleNodeIds.length > 0 && <p className="wb-cycle-warning" role="alert">
        {text("循环依赖涉及节点", "Nodes in dependency cycles")}: {graph.cycleNodeIds.length}
      </p>}
      {renderError?.graph === displayGraph && (
        <p role="alert">
          {text("依赖图渲染错误", "Dependency graph rendering error")}: {renderError.message}
        </p>
      )}
      {graph.error ? <p role="alert" className="wb-graph-empty">
        {text("依赖图数据错误", "Dependency graph data error")}: {graph.error}
      </p> : !nodes.length ? <p className="wb-graph-empty">
        {text("后端未返回图节点。", "No graph nodes returned by the backend.")}
      </p> : <div className="wb-dependency-graph">
        <ReactFlow<DisplayNode, CanvasEdge>
          key={JSON.stringify([mapPath, showOtherRelations, showMail])}
          nodes={nodes}
          edges={[...graph.edges, ...hookEdges].map((edge: CanvasEdge) => ({
            ...edge,
            label: edge.data?.hooks ? `${text("交付测试 hook", "Delivery test hook")} · ${edge.data.hooks.length}` : edge.data?.mail
              ? `${text("投递", "Deliveries")} ${edge.data.mail.messageCount} · ${text("待确认", "pending")} ${edge.data.mail.pendingAckCount}`
              : edge.data?.dependency ? text("前置于", "prerequisite for") : edge.label,
            ...(edge.data?.mail ? { ariaLabel: edge.data.mail.threads.map((thread) => thread.subject).join(", "), focusable: true, type: "smoothstep", style: { strokeDasharray: "3 5", stroke: "var(--primary)" } } : {}),
            ...(edge.data?.hooks ? { ariaLabel: edge.data.hooks.map((hook) => hook.id).join(", ") } : {}),
            ...(edge.data?.dependency && (edge.source === active || edge.target === active)
              ? { style: { ...edge.style, stroke: "var(--primary)", strokeWidth: 3 } }
              : {}),
          }))}
          nodeTypes={nodeTypes}
          onNodeClick={(_event, node) => node.data.select()}
          onEdgeClick={(_event, edge) => {
            if (edge.data?.hooks) {
              setOtherNode(null); onSelect(edge.target); setHookPair({ from: edge.source, to: edge.target });
              const selectedId = edge.data.hooks.length === 1 ? edge.data.hooks[0]!.id : null;
              setHookId(selectedId); if (selectedId) onOpenHook?.(selectedId);
              return;
            }
            if (!edge.data?.mail) return;
            if (edge.data.mail.threads.length === 1) onOpenMail(edge.data.mail.threads[0]!.threadId);
            else setMailPair({ from: edge.source, to: edge.target });
          }}
          defaultMarkerColor={null}
          nodesDraggable={false}
          nodesConnectable={false}
          edgesReconnectable={false}
          nodesFocusable={false}
          edgesFocusable={false}
          elementsSelectable={false}
          deleteKeyCode={null}
          fitView
          minZoom={0.1}
          maxZoom={2}
          fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
          onPaneClick={() => {
            setOtherNode(null);
            onSelect(null);
          }}
          onError={(_code, message) =>
            setRenderError((previous) =>
              previous?.graph === displayGraph && previous.message === message
                ? previous
                : { graph: displayGraph, message },
            )
          }
          ariaLabelConfig={{
            "controls.zoomIn.ariaLabel": text("放大", "Zoom in"),
            "controls.zoomOut.ariaLabel": text("缩小", "Zoom out"),
            "controls.fitView.ariaLabel": text("适合全图", "Fit graph"),
          }}
        >
          <Background />
          <Controls
            showInteractive={false}
            aria-label={text("图视角控制", "Graph viewport controls")}
          />
        </ReactFlow>
      </div>}
      {inspected && (
        <dl className="wb-panel wb-inspected">
          <dt className="wb-meta">{inspected.label}</dt>
          <dd>{inspected.title || inspected.slug}</dd>
          <dd className="wb-meta">
            {inspected.slug} · {inspected.stage} · {inspected.priority}
          </dd>
        </dl>
      )}
    </section>
  );
}
