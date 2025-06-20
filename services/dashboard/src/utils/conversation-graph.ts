import { calculateSimpleLayout } from './simple-graph-layout.js'

/**
 * Escape HTML special characters
 */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export interface ConversationNode {
  id: string
  label: string
  timestamp: Date
  branchId: string
  parentId?: string
  tokens: number
  model: string
  hasError: boolean
  messageIndex?: number
  messageCount?: number
  toolCallCount?: number
  messageTypes?: string[]
  isSubtask?: boolean
  hasSubtasks?: boolean
  subtaskCount?: number
  linkedConversationId?: string
  subtaskPrompt?: string
}

export interface ConversationGraph {
  nodes: ConversationNode[]
  edges: Array<{ source: string; target: string }>
}

export interface LayoutNode {
  id: string
  x: number
  y: number
  width: number
  height: number
  branchId: string
  timestamp: Date
  label: string
  tokens: number
  model: string
  hasError: boolean
  messageIndex?: number
  messageCount?: number
  toolCallCount?: number
  messageTypes?: string[]
  isSubtask?: boolean
  hasSubtasks?: boolean
  subtaskCount?: number
  linkedConversationId?: string
  subtaskPrompt?: string
}

export interface LayoutEdge {
  id: string
  source: string
  target: string
  sections: Array<{
    startPoint: { x: number; y: number }
    endPoint: { x: number; y: number }
    bendPoints?: Array<{ x: number; y: number }>
  }>
}

export interface GraphLayout {
  nodes: LayoutNode[]
  edges: LayoutEdge[]
  width: number
  height: number
}

/**
 * Calculate the layout for a conversation graph
 */
export async function calculateGraphLayout(
  graph: ConversationGraph,
  reversed: boolean = false
): Promise<GraphLayout> {
  if (reversed) {
    // For reversed layout, we need a custom approach
    return calculateReversedLayout(graph)
  }

  // Use the simple layout algorithm
  return calculateSimpleLayout(graph)
}

/**
 * Calculate layout for reversed tree (newest at top)
 */
function calculateReversedLayout(graph: ConversationGraph): GraphLayout {
  const nodeWidth = 100
  const nodeHeight = 40
  const subtaskNodeWidth = 100
  const subtaskNodeHeight = 36
  const horizontalSpacing = 120
  const verticalSpacing = 30
  const subtaskOffset = 150 // How far to the right sub-task nodes should be

  // Build parent-child relationships for branch detection
  const childrenMap = new Map<string | undefined, string[]>()
  const nodeMap = new Map<string, (typeof graph.nodes)[0]>()

  graph.nodes.forEach(node => {
    nodeMap.set(node.id, node)
    const children = childrenMap.get(node.parentId) || []
    children.push(node.id)
    childrenMap.set(node.parentId, children)
  })

  // Track branch lanes
  const branchLanes = new Map<string, number>()
  let nextLane = 0

  // Find max message count to reverse Y positions
  const maxMessageCount = Math.max(...graph.nodes.map(n => n.messageCount || 0))

  // Position nodes based on message count
  const layoutNodes: LayoutNode[] = graph.nodes.map(node => {
    // Check if this is a sub-task summary node
    const isSubtaskSummary = node.id.endsWith('-subtasks')
    
    if (isSubtaskSummary) {
      // For sub-task summary nodes, position them to the right of their parent
      const parentId = node.parentId
      const parentNode = graph.nodes.find(n => n.id === parentId)
      if (parentNode) {
        const parentLane = branchLanes.get(parentNode.branchId) || 0
        const parentMessageCount = parentNode.messageCount || 0
        
        return {
          id: node.id,
          x: parentLane * horizontalSpacing + subtaskOffset,
          y: (maxMessageCount - parentMessageCount) * verticalSpacing,
          width: subtaskNodeWidth,
          height: subtaskNodeHeight,
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
          linkedConversationId: node.linkedConversationId,
          subtaskPrompt: node.subtaskPrompt,
        }
      }
    }
    
    // Regular nodes
    // Assign lane to branch if not already assigned
    if (!branchLanes.has(node.branchId)) {
      branchLanes.set(node.branchId, nextLane++)
    }

    const lane = branchLanes.get(node.branchId) || 0
    const messageCount = node.messageCount || 0

    // Y position is based on reversed message count (newest at top)
    const y = (maxMessageCount - messageCount) * verticalSpacing

    // X position is based on branch lane
    const x = lane * horizontalSpacing

    return {
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
      linkedConversationId: node.linkedConversationId,
      subtaskPrompt: node.subtaskPrompt,
    }
  })

  // Create edges
  const layoutEdges: LayoutEdge[] = []
  graph.edges.forEach((edge, idx) => {
    const sourceNode = layoutNodes.find(n => n.id === edge.source)
    const targetNode = layoutNodes.find(n => n.id === edge.target)

    if (sourceNode && targetNode) {
      // Check if this is an edge to a sub-task summary node
      const isToSubtask = targetNode.id.endsWith('-subtasks')
      
      if (isToSubtask) {
        // For edges to sub-task nodes, draw from the right side of parent to left side of sub-task
        layoutEdges.push({
          id: `e${idx}`,
          source: edge.source,
          target: edge.target,
          sections: [
            {
              startPoint: {
                x: sourceNode.x + sourceNode.width,
                y: sourceNode.y + sourceNode.height / 2,
              },
              endPoint: {
                x: targetNode.x,
                y: targetNode.y + targetNode.height / 2,
              },
            },
          ],
        })
      } else {
        // In reversed layout, newer messages (higher count) are above
        layoutEdges.push({
          id: `e${idx}`,
          source: edge.source,
          target: edge.target,
          sections: [
            {
              startPoint: {
                x: sourceNode.x + sourceNode.width / 2,
                y: sourceNode.y, // Top of source (parent/older)
              },
              endPoint: {
                x: targetNode.x + targetNode.width / 2,
                y: targetNode.y + targetNode.height, // Bottom of target (child/newer)
              },
            },
          ],
        })
      }
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

/**
 * Generate branch colors consistently
 */
export function getBranchColor(branchId: string): string {
  if (branchId === 'main') {
    return '#6b7280' // gray-500
  }

  // Generate a color based on the branch ID hash
  const colors = [
    '#3b82f6', // blue-500
    '#10b981', // green-500
    '#8b5cf6', // purple-500
    '#f59e0b', // amber-500
    '#ef4444', // red-500
    '#06b6d4', // cyan-500
    '#f97316', // orange-500
    '#ec4899', // pink-500
  ]

  let hash = 0
  for (let i = 0; i < branchId.length; i++) {
    hash = (hash << 5) - hash + branchId.charCodeAt(i)
    hash = hash & hash // Convert to 32-bit integer
  }

  return colors[Math.abs(hash) % colors.length]
}

/**
 * Render the conversation graph as SVG
 */
export function renderGraphSVG(layout: GraphLayout, interactive: boolean = true): string {
  const padding = 40
  const nodeRadius = 8
  const width = layout.width + padding * 2
  const height = layout.height + padding * 2

  let svg = `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">\n`

  // Add CSS styles
  svg += `<defs>
    <style>
      .graph-edge { stroke: #e5e7eb; stroke-width: 2; fill: none; }
      .graph-node { stroke-width: 2; }
      .graph-node-main { fill: #6b7280; stroke: #4b5563; }
      .graph-node-branch { stroke: #3b82f6; }
      .graph-node-error { fill: #ef4444; stroke: #dc2626; }
      .graph-node-label { font-size: 10px; font-family: -apple-system, BlinkMacSystemFont, sans-serif; }
      .graph-node-clickable { cursor: pointer; }
      .graph-node-clickable:hover { opacity: 0.8; }
      .subtask-tooltip { display: none; }
      .subtask-group:hover .subtask-tooltip { display: block; }
    </style>
  </defs>\n`

  // Render edges
  svg += '<g class="graph-edges">\n'
  for (const edge of layout.edges) {
    // Find the source and target nodes to check if this is a branch divergence
    const sourceNode = layout.nodes.find(n => n.id === edge.source)
    const targetNode = layout.nodes.find(n => n.id === edge.target)
    const isBranchDiverging =
      sourceNode && targetNode && sourceNode.branchId !== targetNode.branchId

    for (const section of edge.sections) {
      let path = ''
      const startX = section.startPoint.x + padding
      const startY = section.startPoint.y + padding
      const endX = section.endPoint.x + padding
      const endY = section.endPoint.y + padding

      if (isBranchDiverging && Math.abs(startX - endX) > 5) {
        // For diverging branches, create a squared path with right angles
        const midY = startY + (endY - startY) / 2
        path = `M${startX},${startY} L${startX},${midY} L${endX},${midY} L${endX},${endY}`
      } else {
        // For regular edges, use straight line or bend points if available
        path = `M${startX},${startY}`

        if (section.bendPoints && section.bendPoints.length > 0) {
          for (const bend of section.bendPoints) {
            path += ` L${bend.x + padding},${bend.y + padding}`
          }
        }

        path += ` L${endX},${endY}`
      }

      svg += `  <path d="${path}" class="graph-edge" />\n`
    }
  }
  svg += '</g>\n'

  // Render nodes
  svg += '<g class="graph-nodes">\n'
  
  // Collect tooltips to render them last
  let tooltips = ''
  
  for (const node of layout.nodes) {
    const x = node.x + padding
    const y = node.y + padding
    const color = getBranchColor(node.branchId)
    const nodeClass = node.hasError
      ? 'graph-node graph-node-error'
      : `graph-node ${node.branchId === 'main' ? 'graph-node-main' : 'graph-node-branch'}`

    // Check if this is a sub-task summary node
    const isSubtaskSummary = node.id.endsWith('-subtasks')

    if (isSubtaskSummary) {
      // Use foreignObject for better HTML tooltip support
      const tooltipId = `tooltip-${node.id.replace(/[^a-zA-Z0-9]/g, '-')}`
      
      svg += `  <g class="subtask-node-group">\n`
      
      // Render sub-task summary node with hover handler
      const hoverHandlers = node.subtaskPrompt ? ` onmouseover="document.querySelector('.${tooltipId}').style.display='block'" onmouseout="document.querySelector('.${tooltipId}').style.display='none'"` : ''
      
      // Make sub-task nodes clickable if they have a linked conversation
      if (interactive && node.linkedConversationId) {
        svg += `    <a href="/dashboard/conversation/${node.linkedConversationId}" style="cursor: pointer;">\n`
        svg += `      <rect x="${x}" y="${y}" width="${node.width}" height="${node.height}" rx="4" ry="4" class="graph-node graph-node-clickable" style="fill: #f3f4f6; stroke: #9ca3af; stroke-width: 1.5;"${hoverHandlers} />\n`
        svg += `      <text x="${x + node.width / 2}" y="${y + node.height / 2 + 4}" text-anchor="middle" class="graph-node-label" style="font-weight: 600; font-size: 12px; fill: #4b5563; pointer-events: none;">${node.label}</text>\n`
        svg += `    </a>\n`
      } else {
        svg += `      <rect x="${x}" y="${y}" width="${node.width}" height="${node.height}" rx="4" ry="4" class="graph-node" style="fill: #f3f4f6; stroke: #9ca3af; stroke-width: 1.5;"${hoverHandlers} />\n`
        svg += `      <text x="${x + node.width / 2}" y="${y + node.height / 2 + 4}" text-anchor="middle" class="graph-node-label" style="font-weight: 600; font-size: 12px; fill: #4b5563;">${node.label}</text>\n`
      }
      
      // Prepare tooltip to be rendered later
      if (node.subtaskPrompt) {
        const truncatedPrompt = node.subtaskPrompt.length > 250 
          ? node.subtaskPrompt.substring(0, 250) + '...' 
          : node.subtaskPrompt
          
        tooltips += `    <foreignObject x="${x - 75}" y="${y - 140}" width="250" height="130" style="display: none; z-index: 1000; pointer-events: none;" class="${tooltipId}">\n`
        tooltips += `      <div xmlns="http://www.w3.org/1999/xhtml" style="background: linear-gradient(135deg, #374151 0%, #1f2937 100%); border: 2px solid #6b7280; padding: 12px 14px; border-radius: 8px; font-size: 11px; line-height: 1.6; box-shadow: 0 6px 20px rgba(0,0,0,0.4); word-wrap: break-word; position: relative;">\n`
        tooltips += `        <div style="font-size: 10px; color: #9ca3af; margin-bottom: 6px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 1px solid #4b5563; padding-bottom: 4px;">📋 Task Prompt</div>\n`
        tooltips += `        <div style="color: #e5e7eb; font-size: 11px;">${escapeHtml(truncatedPrompt)}</div>\n`
        tooltips += `        <div style="position: absolute; bottom: -8px; left: 50%; transform: translateX(-50%); width: 0; height: 0; border-left: 8px solid transparent; border-right: 8px solid transparent; border-top: 8px solid #6b7280; border-bottom: 8px solid transparent;"></div>\n`
        tooltips += `        <div style="position: absolute; bottom: -6px; left: 50%; transform: translateX(-50%); width: 0; height: 0; border-left: 6px solid transparent; border-right: 6px solid transparent; border-top: 6px solid #1f2937; border-bottom: 6px solid transparent;"></div>\n`
        tooltips += `      </div>\n`
        tooltips += `    </foreignObject>\n`
      }
      
      svg += `  </g>\n`
    } else {
      // Regular node rendering
      if (interactive) {
        svg += `  <a href="/dashboard/request/${node.id}">\n`
      }

      // Draw rectangle with rounded corners
      svg += `    <rect x="${x}" y="${y}" width="${node.width}" height="${node.height}" rx="6" ry="6" class="${nodeClass}${interactive ? ' graph-node-clickable' : ''}" style="fill: white; stroke: ${node.hasError ? '#ef4444' : color}; stroke-width: 2;" />\n`

      // Add message count number on the left
      if (node.messageCount !== undefined && node.messageCount > 0) {
        svg += `    <text x="${x + 12}" y="${y + node.height / 2 + 4}" text-anchor="middle" class="graph-node-label" style="font-weight: 700; font-size: 14px; fill: ${color};">${node.messageCount}</text>\n`
      }

      // Add request ID (first 8 chars) in the center
      const requestIdShort = node.id.substring(0, 8)
      svg += `    <text x="${x + node.width / 2}" y="${y + node.height / 2 - 4}" text-anchor="middle" class="graph-node-label" style="font-weight: 500; font-size: 11px;">${requestIdShort}</text>\n`

      // Add timestamp
      const time = node.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      svg += `    <text x="${x + node.width / 2}" y="${y + node.height / 2 + 10}" text-anchor="middle" class="graph-node-label" style="font-size: 9px; fill: #6b7280;">${time}</text>\n`

      // Add sub-task indicators
      if (node.isSubtask) {
        svg += `    <text x="${x + node.width - 12}" y="${y + 12}" text-anchor="middle" class="graph-node-label" style="font-size: 10px;" title="Sub-task">🔗</text>\n`
      }
      if (node.hasSubtasks && node.subtaskCount) {
        svg += `    <text x="${x + node.width - 12}" y="${y + node.height - 6}" text-anchor="middle" class="graph-node-label" style="font-size: 10px;" title="${node.subtaskCount} sub-tasks">📋</text>\n`
      }

      // Add connection point at the bottom
      svg += `    <circle cx="${x + node.width / 2}" cy="${y + node.height}" r="${nodeRadius - 2}" class="${nodeClass}" style="${node.branchId !== 'main' && !node.hasError ? `fill: ${color};` : ''} stroke: white; stroke-width: 2;" />\n`

      if (interactive) {
        svg += `  </a>\n`
      }
    }
  }
  svg += '</g>\n'
  
  // Render tooltips last so they appear on top
  if (tooltips) {
    svg += '<g class="graph-tooltips">\n'
    svg += tooltips
    svg += '</g>\n'
  }

  svg += '</svg>'

  return svg
}
