import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { validateWorkflowGraph } = require('../dist/lib/approvalWorkflow.js')

const node = (id, type, extra = {}) => ({ id, type, label: id, x: 100, y: 100, ...extra })
const sequential = () => ({
  nodes: [
    node('start', 'start'),
    node('group', 'group', { personGroupId: 'group-id', groupRule: 'any' }),
    node('manager', 'individual', { reviewerId: 'reviewer-id' }),
    node('publish', 'publish'),
  ],
  edges: [
    { id: 'e1', source: 'start', target: 'group' },
    { id: 'e2', source: 'group', target: 'manager' },
    { id: 'e3', source: 'manager', target: 'publish' },
  ],
})

test('accepts the sequential group then named reviewer route', () => {
  const result = validateWorkflowGraph(sequential())
  assert.deepEqual(result.issues, [])
  assert.deepEqual(result.route.map((item) => item.id), ['start', 'group', 'manager', 'publish'])
})

test('flags disconnected nodes and disconnected loops by their node identifiers', () => {
  const graph = sequential()
  graph.nodes.push(node('orphan-a', 'individual'), node('orphan-b', 'individual'))
  graph.edges.push({ id: 'loop-a', source: 'orphan-a', target: 'orphan-b' }, { id: 'loop-b', source: 'orphan-b', target: 'orphan-a' })
  const result = validateWorkflowGraph(graph)
  assert(result.issues.some((item) => item.nodeId === 'orphan-a' && /loop/i.test(item.message)))
  assert(result.issues.some((item) => item.nodeId === 'orphan-a' && /connect this node/i.test(item.message)))
})

test('flags branches and merges on the affected nodes', () => {
  const graph = sequential()
  graph.nodes.push(node('branch', 'individual'))
  graph.edges.push({ id: 'branch-1', source: 'group', target: 'branch' }, { id: 'merge', source: 'branch', target: 'manager' })
  const result = validateWorkflowGraph(graph)
  assert(result.issues.some((item) => item.nodeId === 'group' && /extra outgoing/i.test(item.message)))
  assert(result.issues.some((item) => item.nodeId === 'manager' && /extra incoming/i.test(item.message)))
})

test('requires one Start, an approval stage, and one Publish endpoint', () => {
  const result = validateWorkflowGraph({ nodes: [node('start', 'start'), node('start-2', 'start')], edges: [] })
  assert(result.issues.some((item) => /exactly one Start/i.test(item.message)))
  assert(result.issues.some((item) => /approval stage/i.test(item.message)))
  assert(result.issues.some((item) => /exactly one Publish/i.test(item.message)))
})

test('flags missing stage names, invalid group rules and unsaved positions', () => {
  const graph = {
    nodes: [node('start', 'start'), node('group', 'group', { label: '', x: Number.NaN, groupRule: 'many' }), node('manager', 'individual', { reviewerId: null }), node('publish', 'publish')],
    edges: [{ source: 'start', target: 'group' }, { source: 'group', target: 'manager' }, { source: 'manager', target: 'publish' }],
  }
  const result = validateWorkflowGraph(graph)
  assert(result.issues.some((item) => item.nodeId === 'group' && /name for this approval stage/i.test(item.message)))
  assert(result.issues.some((item) => item.nodeId === 'group' && /position/i.test(item.message)))
  assert(result.issues.some((item) => item.nodeId === 'group' && /eligible group members/i.test(item.message)))
})
