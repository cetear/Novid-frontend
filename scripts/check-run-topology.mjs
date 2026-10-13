import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'

if (existsSync('.env.live.local')) process.loadEnvFile('.env.live.local')
const origin = process.env.API_PROXY_TARGET || 'http://localhost:8080'
const traceId = process.argv.find((arg) => arg.startsWith('--trace-id='))?.slice(11)
const checkLinks = process.argv.includes('--assert-links')
const replay = process.argv.find((arg) => arg.startsWith('--replay='))?.slice(9)
const output =
  process.argv.find((arg) => arg.startsWith('--output='))?.slice(9) ||
  'var/live/run-topology-2026-10-13.json'
let evidence = { checkedAt: new Date().toISOString(), runs: [] }
let token = ''
async function api(path, method = 'GET', data) {
  const response = await fetch(origin + '/api/v1' + path, {
    method,
    signal: AbortSignal.timeout(15000),
    headers: {
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
      ...(data ? { 'Content-Type': 'application/json' } : {}),
    },
    body: data ? JSON.stringify(data) : undefined,
  })
  const body = await response.json().catch(() => null)
  if (!response.ok) throw new Error(path + ': HTTP ' + response.status + ' / ' + body?.code)
  return body
}
function topology(graph) {
  return {
    nodes: graph.nodes.map((node) => ({
      spanId: node.spanId,
      parentSpanId: node.parentSpanId,
      type: node.type,
      name: node.name,
      dependsOn: node.dependsOn,
      sequence: node.sequence,
      callId: node.observation?.callId ?? null,
    })),
    edges: graph.edges,
    incomplete: graph.incomplete,
    missingNodeIds: graph.missingNodeIds,
    declaredNodes: graph.run.nodeCount,
    nodeRuns: graph.nodeRuns ?? {},
  }
}
try {
  if (replay) {
    const { readFile } = await import('node:fs/promises')
    evidence = JSON.parse(await readFile(replay, 'utf8'))
  } else {
    if (!process.env.NOVID_TEST_USERNAME || !process.env.NOVID_TEST_PASSWORD)
      throw new Error('No configured test identity')
    token = (
      await api('/auth/login', 'POST', {
        username: process.env.NOVID_TEST_USERNAME,
        password: process.env.NOVID_TEST_PASSWORD,
      })
    ).token
    const runs = traceId
      ? [await api('/runs/' + encodeURIComponent(traceId))]
      : (await api('/runs?page=0&size=20')).filter((run) => run.taskId).slice(0, 2)
    for (const run of runs) {
      const path = '/runs/' + encodeURIComponent(run.traceId)
      const summary = topology(await api(path + '/graph?view=summary'))
      const full = topology(await api(path + '/graph'))
      const execution = topology(await api(path + '/graph?view=summary&scope=execution'))
      const sampleNodes = summary.nodes
        .filter((node) => ['AGENT', 'MODEL'].includes(node.type))
        .slice(0, 3)
      const nodeDetails = []
      for (const node of sampleNodes) {
        const detail = await api(path + '/nodes/' + encodeURIComponent(node.spanId))
        nodeDetails.push({
          spanId: detail.spanId,
          parentSpanId: detail.parentSpanId,
          type: detail.type,
          name: detail.name,
          dependsOn: detail.dependsOn,
        })
      }
      const calls = (await api(path + '/calls?page=0&size=20')).map(({ call }) => ({
        callId: call.callId,
        spanId: call.spanId,
        parentSpanId: call.parentSpanId,
        businessNodeId: call.context.businessNodeId,
      }))
      const record = {
        traceId: run.traceId,
        taskId: run.taskId,
        status: run.status,
        telemetryDropped: run.telemetryDropped,
        summary,
        full,
        execution,
        nodeDetails,
        calls,
      }
      evidence.runs.push(record)
      console.log(
        JSON.stringify({
          traceId: run.traceId,
          taskId: run.taskId,
          status: run.status,
          nodes: summary.nodes.length,
          types: [...new Set(summary.nodes.map((node) => node.type))],
          parents: summary.nodes.filter((node) => node.parentSpanId).length,
          dependencies: summary.nodes.filter((node) => node.dependsOn.length).length,
          edges: summary.edges.length,
          fullParents: full.nodes.filter((node) => node.parentSpanId).length,
          fullEdges: full.edges.length,
          executionNodes: execution.nodes.length,
          executionParents: execution.nodes.filter((node) => node.parentSpanId).length,
          incomplete: summary.incomplete,
          missingNodes: summary.missingNodeIds.length,
          telemetryDropped: run.telemetryDropped,
          sampleDetailParents: nodeDetails.filter((node) => node.parentSpanId).length,
          callParents: calls.filter((call) => call.parentSpanId).length,
        }),
      )
    }
  }
  if (checkLinks) {
    const workflows = evidence.runs.filter(
      (run) =>
        run.summary.nodes.some((node) => node.type === 'AGENT') &&
        run.summary.nodes.some((node) => node.type === 'MODEL'),
    )
    assert.ok(workflows.length, 'No workflow with AGENT and MODEL nodes available to check')
    for (const run of workflows) {
      assert.ok(
        run.summary.nodes.some((node) => ['TASK', 'ROOT'].includes(node.type)),
        `Workflow ${run.traceId}: no TASK/ROOT node; ${run.summary.nodes.filter((node) => !node.parentSpanId).length}/${run.summary.nodes.length} nodes have no parent`,
      )
      assert.ok(
        run.summary.nodes.some((node) => node.parentSpanId),
        `Workflow ${run.traceId}: every node has parentSpanId=null`,
      )
      assert.ok(run.summary.edges.length, `Workflow ${run.traceId}: edges=[]`)
    }
  }
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
} finally {
  if (token) await api('/auth/logout', 'POST').catch(() => {})
  if (!replay) {
    await mkdir('var/live', { recursive: true })
    await writeFile(output, JSON.stringify(evidence, null, 2) + '\n')
  }
}
