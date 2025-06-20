import { ConversationGraph, GraphLayout, LayoutNode, LayoutEdge } from './conversation-graph.js'

/**
 * Simple layout algorithm for conversation graphs
 * Arranges nodes in a tree-like structure with branches
 */
export function calculateSimpleLayout(graph: ConversationGraph): GraphLayout {
  const nodeWidth = 100
  const nodeHeight = 40
  const horizontalSpacing = 120
  const verticalSpacing = 80

  // Build parent-child relationships
  const childrenMap = new Map<string | undefined, string[]>()
  const nodeMap = new Map<string, (typeof graph.nodes)[0]>()

  graph.nodes.forEach(node => {
    nodeMap.set(node.id, node)
    const children = childrenMap.get(node.parentId) || []
    children.push(node.id)
    childrenMap.set(node.parentId, children)
  })

  // Find root nodes (nodes without parents)
  const roots = graph.nodes.filter(node => !node.parentId).map(n => n.id)

  // Track branch lanes to avoid overlapping
  const branchLanes = new Map<string, number>()
  let nextLane = 0

  // Position nodes
  const layoutNodes: LayoutNode[] = []
  const visitedNodes = new Set<string>()

  function positionNode(nodeId: string, x: number, y: number, _parentBranch?: string): number {
    if (visitedNodes.has(nodeId)) {
      return x
    }
    visitedNodes.add(nodeId)

    const node = nodeMap.get(nodeId)
    if (!node) {
      return x
    }

    // Assign lane to branch
    if (!branchLanes.has(node.branchId)) {
      branchLanes.set(node.branchId, nextLane++)
    }

    // Position the node
    layoutNodes.push({
      id: node.id,
      x,
      y,
      width: nodeWidth,
      height: nodeHeight,
      branchId: node.branchId,
      timestamp: node.timestamp,
      label: node.label,
      tokens: node.tokens,
      model: node.model,
      hasError: node.hasError,
      messageIndex: node.messageIndex,
      messageCount: node.messageCount,
      toolCallCount: node.toolCallCount,
      messageTypes: node.messageTypes,
      isSubtask: node.isSubtask,
      hasSubtasks: node.hasSubtasks,
      subtaskCount: node.subtaskCount,
    })

    // Position children
    const children = childrenMap.get(nodeId) || []
    let childX = x

    children.forEach((childId, _index) => {
      const child = nodeMap.get(childId)
      if (!child) {
        return
      }

      // If branch changes, offset horizontally
      if (child.branchId !== node.branchId) {
        const childLane = branchLanes.get(child.branchId) || 0
        const parentLane = branchLanes.get(node.branchId) || 0
        const laneDiff = childLane - parentLane
        // Always offset branches to the right to keep them visible
        childX = x + Math.abs(laneDiff) * horizontalSpacing
      }

      const nextY = y + verticalSpacing
      childX = positionNode(childId, childX, nextY, node.branchId)
    })

    return Math.max(x, childX)
  }

  // Position all trees
  let currentX = 0
  roots.forEach(rootId => {
    currentX = positionNode(rootId, currentX, 0) + horizontalSpacing
  })

  // Create edges
  const layoutEdges: LayoutEdge[] = []
  graph.edges.forEach((edge, idx) => {
    const sourceNode = layoutNodes.find(n => n.id === edge.source)
    const targetNode = layoutNodes.find(n => n.id === edge.target)

    if (sourceNode && targetNode) {
      // Create a path that goes from bottom of source to top of target
      const startX = sourceNode.x + sourceNode.width / 2
      const startY = sourceNode.y + sourceNode.height
      const endX = targetNode.x + targetNode.width / 2
      const endY = targetNode.y

      layoutEdges.push({
        id: `e${idx}`,
        source: edge.source,
        target: edge.target,
        sections: [
          {
            startPoint: {
              x: startX,
              y: startY,
            },
            endPoint: {
              x: endX,
              y: endY,
            },
          },
        ],
      })
    }
  })

  // Calculate bounds
  const minX = Math.min(...layoutNodes.map(n => n.x))
  const maxX = Math.max(...layoutNodes.map(n => n.x + n.width))
  const minY = Math.min(...layoutNodes.map(n => n.y))
  const maxY = Math.max(...layoutNodes.map(n => n.y + n.height))

  return {
    nodes: layoutNodes,
    edges: layoutEdges,
    width: maxX - minX + 100,
    height: maxY - minY + 100,
  }
}
