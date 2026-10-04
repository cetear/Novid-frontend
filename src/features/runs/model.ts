import type { TraceGraph, TraceSpan } from '@/shared/api/contracts/backend'

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
