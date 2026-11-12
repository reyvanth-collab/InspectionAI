export type WorkflowNodeType = 'start' | 'individual' | 'group' | 'publish'

export interface WorkflowNode {
  id: string
  type: WorkflowNodeType
  label?: string
  x?: number
  y?: number
  reviewerId?: string | null
  personGroupId?: string | null
  groupRule?: 'any' | 'all'
}

export interface WorkflowGraph {
  nodes: WorkflowNode[]
  edges: Array<{ id?: string; source: string; target: string }>
}

export interface WorkflowIssue {
  nodeId?: string
  edgeId?: string
  message: string
}

export function readWorkflowGraph(value: unknown): WorkflowGraph {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { nodes: [], edges: [] }
  const graph = value as Record<string, unknown>
  return {
    nodes: Array.isArray(graph.nodes) ? (graph.nodes as WorkflowNode[]) : [],
    edges: Array.isArray(graph.edges)
      ? (graph.edges as Array<{ id?: string; source: string; target: string }>)
      : [],
  }
}

export function validateWorkflowGraph(value: unknown): {
  graph: WorkflowGraph
  issues: WorkflowIssue[]
  route: WorkflowNode[]
} {
  const graph = readWorkflowGraph(value)
  const issues: WorkflowIssue[] = []
  const add = (message: string, nodeId?: string, edgeId?: string) => {
    issues.push({ ...(nodeId ? { nodeId } : {}), ...(edgeId ? { edgeId } : {}), message })
  }
  if (!Array.isArray((value as Record<string, unknown> | null)?.nodes))
    add('Add the workflow nodes to the canvas.')
  if (!Array.isArray((value as Record<string, unknown> | null)?.edges))
    add('Connect the workflow nodes on the canvas.')
  if (graph.nodes.length > 80) add('Keep the workflow to 80 nodes or fewer.')
  if (graph.edges.length > 80) add('Keep the workflow to 80 connections or fewer.')

  const ids = new Set<string>()
  const byId = new Map<string, WorkflowNode>()
  for (const node of graph.nodes) {
    if (!node || typeof node !== 'object' || typeof node.id !== 'string' || !node.id.trim()) {
      add('Give this node a valid identifier.')
      continue
    }
    if (ids.has(node.id)) add('Node identifiers must be unique.', node.id)
    ids.add(node.id)
    byId.set(node.id, node)
    if (!['start', 'individual', 'group', 'publish'].includes(node.type))
      add('Choose a supported node type.', node.id)
    if (!Number.isFinite(node.x) || !Number.isFinite(node.y))
      add('Move this node onto the canvas so its position can be saved.', node.id)
    if (['individual', 'group'].includes(node.type) && !String(node.label || '').trim())
      add('Enter a name for this approval stage.', node.id)
    if (node.type === 'group' && !['any', 'all'].includes(String(node.groupRule)))
      add('Choose whether any one or all eligible group members must approve.', node.id)
  }
  const starts = graph.nodes.filter((node) => node?.type === 'start')
  const publishes = graph.nodes.filter((node) => node?.type === 'publish')
  if (starts.length !== 1) add('Add exactly one Start node.')
  if (publishes.length !== 1) add('Add exactly one Publish node.')
  if (!graph.nodes.some((node) => node?.type === 'individual' || node?.type === 'group'))
    add('Add at least one approval stage between Start and Publish.')

  const outgoing = new Map<string, string[]>()
  const incoming = new Map<string, string[]>()
  const edgePairs = new Set<string>()
  for (const edge of graph.edges) {
    if (!edge || typeof edge.source !== 'string' || typeof edge.target !== 'string') {
      add('Connect both ends of this connection.', undefined, edge?.id)
      continue
    }
    const source = byId.get(edge.source)
    const target = byId.get(edge.target)
    if (!source || !target) {
      add('Reconnect this line to nodes on the canvas.', !source ? edge.source : edge.target, edge.id)
      continue
    }
    if (source.id === target.id) add('Connect this node to a different node.', source.id, edge.id)
    const pair = `${edge.source}\u0000${edge.target}`
    if (edgePairs.has(pair)) add('Remove this duplicate connection.', source.id, edge.id)
    edgePairs.add(pair)
    outgoing.set(source.id, [...(outgoing.get(source.id) || []), target.id])
    incoming.set(target.id, [...(incoming.get(target.id) || []), source.id])
  }
  for (const node of graph.nodes) {
    if (!node?.id) continue
    if ((outgoing.get(node.id)?.length || 0) > 1)
      add('Remove extra outgoing connections; this release supports one sequential route.', node.id)
    if ((incoming.get(node.id)?.length || 0) > 1)
      add('Remove extra incoming connections; this release does not support branches or merges.', node.id)
    if (node.type === 'start' && (incoming.get(node.id)?.length || 0) > 0)
      add('Start cannot have an incoming connection.', node.id)
    if (node.type === 'publish' && (outgoing.get(node.id)?.length || 0) > 0)
      add('Publish is the endpoint and cannot have an outgoing connection.', node.id)
  }
  const visitState = new Map<string, number>()
  const loopNodes = new Set<string>()
  const visit = (id: string) => {
    visitState.set(id, 1)
    for (const target of outgoing.get(id) || []) {
      if (visitState.get(target) === 1) loopNodes.add(target)
      else if (!visitState.has(target)) visit(target)
    }
    visitState.set(id, 2)
  }
  for (const node of graph.nodes) if (node?.id && !visitState.has(node.id)) visit(node.id)
  for (const id of loopNodes) add('This connection creates a loop. Remove it and reconnect the route toward Publish.', id)
  const route: WorkflowNode[] = []
  if (starts.length === 1) {
    const visited = new Set<string>()
    let current: WorkflowNode | undefined = starts[0]
    while (current) {
      if (visited.has(current.id)) {
        if (!loopNodes.has(current.id)) add('This connection creates a loop. Reconnect it to continue toward Publish.', current.id)
        break
      }
      visited.add(current.id)
      route.push(current)
      const nextIds = outgoing.get(current.id) || []
      if (nextIds.length !== 1) break
      const next = byId.get(nextIds[0])
      if (!next) break
      current = next
    }
    if (route[route.length - 1]?.type !== 'publish')
      add('Connect the route through every approval stage to Publish.', route.at(-1)?.id)
    for (const node of graph.nodes)
      if (node?.id && !visited.has(node.id))
        add('Connect this node into the Start-to-Publish route or remove it.', node.id)
  }
  return { graph, issues, route }
}
