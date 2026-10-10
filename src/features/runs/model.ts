import type { TraceGraph, TraceSpan } from '@/shared/api/contracts/backend'

export function nodeHierarchy(nodes: TraceSpan[]) {
  const parents = new Map(nodes.map((node) => [node.spanId, node.parentSpanId]))
  // Missing parents become roots; break corrupt cycles so every node remains reachable.
  for (const [id, parent] of parents) {
    if (parent && !parents.has(parent)) parents.set(id, null)
  }
  for (const node of nodes) {
    const seen = new Set([node.spanId])
    let parent = parents.get(node.spanId)
    while (parent && parents.has(parent) && !seen.has(parent)) {
      seen.add(parent)
      parent = parents.get(parent)
    }
    if (parent) parents.set(node.spanId, null)
  }
  const children = new Map<string, string[]>()
  const roots: string[] = []
  for (const node of nodes) {
    const parent = parents.get(node.spanId)
    if (!parent) roots.push(node.spanId)
    else children.set(parent, [...(children.get(parent) ?? []), node.spanId])
  }
  return { children, roots }
}

export function nodeRows(nodes: TraceSpan[]) {
  const byId = new Map(nodes.map((node) => [node.spanId, node]))
  return [...nodes]
    .sort((a, b) => a.sequence - b.sequence)
    .map((node) => {
      const seen = new Set([node.spanId])
      let parent = node.parentSpanId,
        depth = 0
      while (parent && byId.has(parent) && !seen.has(parent)) {
        seen.add(parent)
        depth++
        parent = byId.get(parent)!.parentSpanId
      }
      return { node, depth: Math.min(depth, 12), brokenParent: !!parent }
    })
}
export function duration(node: TraceSpan) {
  if (!node.endedAt) return null
  const ms = Date.parse(node.endedAt) - Date.parse(node.startedAt)
  return Number.isFinite(ms) && ms >= 0 ? ms : null
}
export function timelineGroups(nodes: TraceSpan[]) {
  const groups = new Map<
    string,
    { category: string; nodes: TraceSpan[]; totalDuration: number | null; unknownCount: number }
  >()
  for (const node of [...nodes].sort((a, b) => a.sequence - b.sequence)) {
    // Workflow agents use names such as read_<sliceId> and extract_<sliceId>_<offset>.
    const category = node.type === 'AGENT' ? node.name.split('_')[0] || node.type : node.type
    let group = groups.get(category)
    if (!group) {
      group = { category, nodes: [], totalDuration: null, unknownCount: 0 }
      groups.set(category, group)
    }
    group.nodes.push(node)
    const ms = duration(node)
    if (ms === null) group.unknownCount++
    else group.totalDuration = (group.totalDuration ?? 0) + ms
  }
  return [...groups.values()]
}
export function knownUsage(graph: TraceGraph) {
  const parents = new Set(graph.nodes.map((node) => node.parentSpanId).filter(Boolean))
  const leaves = graph.nodes.filter(
    (node) => ['MODEL', 'EMBEDDING'].includes(node.type) && !parents.has(node.spanId),
  )
  const provider = leaves.filter((node) => node.usageSource === 'PROVIDER')
  return {
    input: provider.reduce((sum, node) => sum + (node.inputTokens ?? 0), 0),
    output: provider.reduce((sum, node) => sum + (node.outputTokens ?? 0), 0),
    unknown: leaves.filter(
      (node) =>
        node.usageSource !== 'SIMULATED' &&
        (node.usageSource !== 'PROVIDER' ||
          node.inputTokens === null ||
          node.outputTokens === null),
    ).length,
    simulated: leaves.filter((node) => node.usageSource === 'SIMULATED').length,
  }
}
