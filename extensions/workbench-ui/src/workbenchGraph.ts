import { graphlib, layout } from "@dagrejs/dagre";
import { MarkerType, Position, type Edge, type Node } from "@xyflow/react";
import { dependencyDirection, type CurrentView } from "./workbenchModel";

export type GraphNodeData = CurrentView["graph"]["nodes"][number] & { taskSlug: string | null; inDependencyCycle: boolean; role: CurrentView["specs"][number]["role"]; prerequisiteCount: number; dependentCount: number };

export type DisplayGraph = {
  nodes: CurrentView["graph"]["nodes"];
  edges: Array<CurrentView["graph"]["edges"][number] & {
    mail?: { threads: Array<{ threadId: string; subject: string }>; messageCount: number; pendingAckCount: number };
  }>;
};
export type DisplayEdge = Edge<{ relationship: string; dependency: boolean; mail?: NonNullable<DisplayGraph["edges"][number]["mail"]> }>;

export function compositionView(graph: DisplayGraph, parent: string | null) {
  const labels = new Map(graph.nodes.map((node) => [node.slug, node.label]));
  const children = new Map<string, Set<string>>();
  for (const edge of graph.edges) {
    if (edge.type !== "COMPOSES") continue;
    // Native Slice storage uses child -> Spec; Spec submaps use parent -> child.
    const nativeSlice = labels.get(edge.from) === "Slice" && labels.get(edge.to) === "Spec";
    const owner = nativeSlice ? edge.to : edge.from;
    const child = nativeSlice ? edge.from : edge.to;
    const members = children.get(owner) ?? new Set<string>();
    members.add(child);
    children.set(owner, members);
  }
  if (parent === null) return { graph, children, boundary: new Set<string>(), missingChildren: [] as string[] };
  const members = children.get(parent) ?? new Set<string>();
  const ids = new Set(graph.nodes.map((node) => node.slug));
  const missingChildren = [...members].filter((slug) => !ids.has(slug));
  const boundary = new Set<string>();
  const edges = graph.edges.filter((edge) => {
    if (edge.type === "COMPOSES" || (!members.has(edge.from) && !members.has(edge.to))) return false;
    if (!members.has(edge.from)) boundary.add(edge.from);
    if (!members.has(edge.to)) boundary.add(edge.to);
    return true;
  });
  return { graph: { nodes: graph.nodes.filter((node) => members.has(node.slug) || boundary.has(node.slug)), edges }, children, boundary, missingChildren };
}

function dependencyTopology(graph: CurrentView["graph"]) {
  const dependencies = new graphlib.Graph({ directed: true });
  graph.nodes.forEach((node) => dependencies.setNode(node.slug));
  for (const edge of graph.edges) {
    const direction = dependencyDirection(edge);
    if (direction) dependencies.setEdge(direction.prerequisite, direction.dependent);
  }
  return dependencies;
}

export function dependencyNeighbors(graph: CurrentView["graph"], selected: string | null) {
  const downstream = new Set<string>();
  if (!selected || !graph.nodes.some((node) => node.slug === selected)) {
    return { prerequisites: new Set<string>(), dependents: new Set<string>(), downstream };
  }
  const dependencies = dependencyTopology(graph);
  for (const slug of graphlib.alg.preorder(dependencies, selected)) {
    if (slug !== selected) downstream.add(slug);
  }
  return { prerequisites: new Set(dependencies.predecessors(selected)), dependents: new Set(dependencies.successors(selected)), downstream };
}

export function dependencyImpactRanking(graph: CurrentView["graph"]) {
  const dependencies = dependencyTopology(graph);
  // ponytail: O(V*(V+E)), calculated only for the opened ranking; cache reachability if large graphs require it.
  return graph.nodes.map((node) => ({ slug: node.slug, count: graphlib.alg.preorder(dependencies, node.slug).length - 1 }))
    .sort((a, b) => b.count - a.count || a.slug.localeCompare(b.slug));
}

export function dependencyGraph(graph: DisplayGraph, specs: CurrentView["specs"]) {
  const ids = new Set(graph.nodes.map((node) => node.slug));
  if (ids.size !== graph.nodes.length) {
    return { nodes: [], edges: [], cycleNodeIds: [], error: "Duplicate graph node identifiers" };
  }
  const missing = graph.edges.find((edge) => !ids.has(edge.from) || !ids.has(edge.to));
  if (missing) {
    return {
      nodes: [],
      edges: [],
      cycleNodeIds: [],
      error: `Missing graph endpoint: ${missing.from} -> ${missing.to}`,
    };
  }
  const tasks = new Map(specs.map((spec) => [spec.slug, spec]));
  const dag = new graphlib.Graph({ multigraph: true });
  const dependencies = new graphlib.Graph({ directed: true });
  dag.setGraph({ rankdir: "LR", nodesep: 48, ranksep: 120 });
  dag.setDefaultEdgeLabel(() => ({}));
  graph.nodes.forEach((node) => {
    dag.setNode(node.slug, { width: 264, height: 160 });
    dependencies.setNode(node.slug);
  });
  const edges: DisplayEdge[] = graph.edges.map((edge, index) => {
    const direction = dependencyDirection(edge);
    const source = direction?.prerequisite ?? edge.from;
    const target = direction?.dependent ?? edge.to;
    const id = JSON.stringify([edge.from, edge.to, edge.type, index]);
    dag.setEdge(source, target, {}, id);
    if (direction) dependencies.setEdge(source, target);
    return {
      id,
      source,
      target,
      label: direction ? "prerequisite for" : edge.type,
      data: { relationship: edge.type, dependency: direction !== null, ...(edge.mail ? { mail: edge.mail } : {}) },
      ariaLabel: `${edge.from} ${edge.type} ${edge.to}`,
      markerEnd: { type: MarkerType.ArrowClosed },
      ...(direction ? {} : { style: { strokeDasharray: "5 4" } }),
      selectable: false,
    };
  });
  const cyclic = new Set(graphlib.alg.findCycles(dependencies).flat());
  layout(dag);
  const nodes: Node<GraphNodeData>[] = graph.nodes.map((node) => {
    const position = dag.node(node.slug);
    return {
      id: node.slug,
      type: "workbench",
      position: { x: position.x - 132, y: position.y - 80 },
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      width: 264,
      height: 160,
      data: { ...node, taskSlug: node.label === "Spec" && tasks.has(node.slug) ? node.slug : null, inDependencyCycle: cyclic.has(node.slug), role: node.label === "Spec" ? tasks.get(node.slug)?.role : undefined,
        prerequisiteCount: dependencies.predecessors(node.slug)!.length, dependentCount: dependencies.successors(node.slug)!.length },
    };
  });
  return { nodes, edges, cycleNodeIds: [...cyclic], error: null };
}
