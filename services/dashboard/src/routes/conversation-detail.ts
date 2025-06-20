import { Hono } from 'hono'
import { html, raw } from 'hono/html'
import { getErrorMessage } from '@claude-nexus/shared'
import {
  ConversationGraph,
  calculateGraphLayout,
  renderGraphSVG,
  getBranchColor,
} from '../utils/conversation-graph.js'
import { formatNumber, formatDuration, escapeHtml } from '../utils/formatters.js'
import type { ConversationRequest } from '../types/conversation.js'

export const conversationDetailRoutes = new Hono()

/**
 * Detailed conversation view with graph visualization
 */
conversationDetailRoutes.get('/conversation/:id', async c => {
  const conversationId = c.req.param('id')
  const selectedBranch = c.req.query('branch')

  // Get storage service from container
  const { container } = await import('../container.js')
  const storageService = container.getStorageService()

  try {
    // Get all conversations to find the one we want
    const conversations = await storageService.getConversations(undefined, 1000)
    const conversation = conversations.find(conv => conv.conversation_id === conversationId)

    if (!conversation) {
      return c.html(html`
        <div class="error-banner"><strong>Error:</strong> Conversation not found</div>
      `)
    }

    // Fetch sub-tasks for requests that have task invocations
    const subtasksMap = new Map<string, any[]>()
    for (const req of conversation.requests) {
      if (req.task_tool_invocation && Array.isArray(req.task_tool_invocation) && req.task_tool_invocation.length > 0) {
        const subtasks = await storageService.getSubtasksForRequest(req.request_id)
        if (subtasks.length > 0) {
          // Group sub-tasks by their conversation ID
          const subtasksByConversation = subtasks.reduce((acc, subtask) => {
            const convId = subtask.conversation_id || 'unknown'
            if (!acc[convId]) {
              acc[convId] = []
            }
            acc[convId].push(subtask)
            return acc
          }, {} as Record<string, any[]>)
          
          // Link sub-task conversations to task invocations
          const enrichedInvocations = req.task_tool_invocation.map((invocation: any) => {
            // Find matching sub-task conversation by checking first message content
            for (const [convId, convSubtasks] of Object.entries(subtasksByConversation)) {
              // Check if any subtask in this conversation matches the invocation prompt
              const matches = convSubtasks.some(st => {
                // This is a simplified check - you might need more sophisticated matching
                return st.is_subtask && st.parent_task_request_id === req.request_id
              })
              if (matches) {
                return { ...invocation, linked_conversation_id: convId }
              }
            }
            return invocation
          })
          
          subtasksMap.set(req.request_id, enrichedInvocations)
        }
      }
    }

    // Use the actual message count from the database
    const requestDetailsMap = new Map<string, { messageCount: number; messageTypes: string[] }>()

    conversation.requests.forEach((req, index) => {
      // Use the actual message count from the request
      const messageCount = req.message_count || 0

      // Simple type assignment based on position
      const messageTypes: string[] = []
      const isFirst = index === 0
      if (!isFirst) {
        messageTypes.push('user') // Previous user message
      }
      messageTypes.push('assistant') // Current assistant response

      requestDetailsMap.set(req.request_id, {
        messageCount: messageCount,
        messageTypes: messageTypes.slice(-2),
      })
    })

    // Build the graph structure - keep original relationships but display in reverse order
    const graphNodes: ConversationNode[] = []
    const graphEdges: Array<{ source: string; target: string }> = []
    
    // First, add all conversation request nodes
    conversation.requests.forEach((req, index) => {
      const details = requestDetailsMap.get(req.request_id) || {
        messageCount: 0,
        messageTypes: [],
      }
      
      // Get sub-task info
      const enrichedInvocations = subtasksMap.get(req.request_id)
      const hasSubtasks = enrichedInvocations && enrichedInvocations.length > 0
      const subtaskCount = enrichedInvocations?.length || 0
      
      // Also check raw task_tool_invocation if not in subtasksMap
      const hasTaskInvocation = req.task_tool_invocation && Array.isArray(req.task_tool_invocation) && req.task_tool_invocation.length > 0
      const finalHasSubtasks = hasSubtasks || hasTaskInvocation
      const finalSubtaskCount = subtaskCount || (hasTaskInvocation ? req.task_tool_invocation.length : 0)
      
      graphNodes.push({
        id: req.request_id,
        label: `${req.model}`,
        timestamp: new Date(req.timestamp),
        branchId: req.branch_id || 'main',
        parentId: req.parent_message_hash
          ? conversation.requests.find(r => r.current_message_hash === req.parent_message_hash)
              ?.request_id
          : undefined,
        tokens: req.total_tokens,
        model: req.model,
        hasError: !!req.error,
        messageIndex: index + 1,
        messageCount: details.messageCount,
        messageTypes: details.messageTypes,
        isSubtask: req.is_subtask,
        hasSubtasks: finalHasSubtasks,
        subtaskCount: finalSubtaskCount,
      })
    })
    
    // Track sub-task numbers across the conversation
    let subtaskNumber = 0
    
    // Now add sub-task summary nodes for requests that spawned tasks
    for (const req of conversation.requests) {
      // Check if this request has task invocations
      if (req.task_tool_invocation && Array.isArray(req.task_tool_invocation) && req.task_tool_invocation.length > 0) {
        // Get actual sub-task count from database
        const actualSubtaskCount = await storageService.countSubtasksForRequests([req.request_id])
        
        // Even if actualSubtaskCount is 0, show the task invocations if they exist
        const displayCount = actualSubtaskCount || req.task_tool_invocation.length
        
        // Increment sub-task number
        subtaskNumber++
        
        // Try to find the linked conversation ID and prompt from the enriched invocations
        const enrichedInvocations = subtasksMap.get(req.request_id)
        let linkedConversationId = null
        let subtaskPrompt = ''
        
        if (enrichedInvocations && enrichedInvocations.length > 0) {
          // Look for any invocation with a linked conversation
          const linkedInvocation = enrichedInvocations.find((inv: any) => inv.linked_conversation_id)
          if (linkedInvocation) {
            linkedConversationId = linkedInvocation.linked_conversation_id
            // Get the prompt from the first invocation
            if (linkedInvocation.input?.prompt) {
              subtaskPrompt = linkedInvocation.input.prompt
            }
          } else if (enrichedInvocations[0]?.input?.prompt) {
            // If no linked conversation yet, still get the prompt from first invocation
            subtaskPrompt = enrichedInvocations[0].input.prompt
          }
        }
        
        // If we don't have a prompt yet, try from the raw task invocations
        if (!subtaskPrompt && req.task_tool_invocation && req.task_tool_invocation[0]?.input?.prompt) {
          subtaskPrompt = req.task_tool_invocation[0].input.prompt
        }
        
        // If we still don't have a linked conversation, try to find it from sub-tasks
        if (!linkedConversationId) {
          const subtasks = await storageService.getSubtasksForRequest(req.request_id)
          if (subtasks.length > 0 && subtasks[0].conversation_id) {
            linkedConversationId = subtasks[0].conversation_id
          }
        }
        
        // Create a sub-task summary node
        const subtaskNodeId = `${req.request_id}-subtasks`
        graphNodes.push({
          id: subtaskNodeId,
          label: `sub-task ${subtaskNumber} (${displayCount})`,
          timestamp: new Date(req.timestamp),
          branchId: req.branch_id || 'main',
          parentId: req.request_id, // Parent is the request that spawned it
          tokens: 0, // We don't have aggregate token count here
          model: 'sub-tasks',
          hasError: false,
          messageIndex: req.message_count || 0, // Use parent's message count
          messageCount: req.message_count || 0, // Use parent's message count for positioning
          isSubtask: true,
          hasSubtasks: false,
          subtaskCount: displayCount,
          linkedConversationId: linkedConversationId, // Store the linked conversation ID
          subtaskPrompt: subtaskPrompt, // Store the prompt snippet
        })
        
        // Add edge from parent request to sub-task node
        graphEdges.push({
          source: req.request_id,
          target: subtaskNodeId,
        })
      }
    }
    
    const graph: ConversationGraph = {
      nodes: graphNodes,
      edges: graphEdges,
    }

    // Build edges from parent relationships with branch awareness
    conversation.requests.forEach(req => {
      if (req.parent_message_hash) {
        // Find the parent request
        // When multiple requests have the same message hash, prefer:
        // 1. Same branch
        // 2. Most recent before this request
        const potentialParents = conversation.requests.filter(
          r =>
            r.current_message_hash === req.parent_message_hash &&
            new Date(r.timestamp) < new Date(req.timestamp)
        )

        let parentReq
        if (potentialParents.length === 1) {
          parentReq = potentialParents[0]
        } else if (potentialParents.length > 1) {
          // Multiple parents with same hash - prefer same branch
          parentReq =
            potentialParents.find(p => p.branch_id === req.branch_id) ||
            potentialParents.sort(
              (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
            )[0]
        }

        if (parentReq) {
          graphEdges.push({
            source: parentReq.request_id,
            target: req.request_id,
          })
        }
      }
    })

    // Calculate layout with reversed flag to show newest at top
    const graphLayout = await calculateGraphLayout(graph, true)
    const svgGraph = renderGraphSVG(graphLayout, true)

    // Filter requests by branch if selected
    let filteredRequests = conversation.requests
    if (selectedBranch && selectedBranch !== 'main') {
      // Find the first request in the selected branch
      const branchRequests = conversation.requests.filter(r => r.branch_id === selectedBranch)
      if (branchRequests.length > 0) {
        // Sort by timestamp to get the first request in the branch
        branchRequests.sort(
          (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
        )
        const firstBranchRequest = branchRequests[0]

        // Get all requests from main branch that happened before the branch diverged
        const mainRequestsBeforeBranch = conversation.requests.filter(
          r =>
            (r.branch_id === 'main' || !r.branch_id) &&
            new Date(r.timestamp) < new Date(firstBranchRequest.timestamp)
        )

        // Combine main requests before branch + all branch requests
        filteredRequests = [...mainRequestsBeforeBranch, ...branchRequests]
      } else {
        filteredRequests = branchRequests
      }
    } else if (selectedBranch === 'main') {
      // For main branch, show only main branch requests
      filteredRequests = conversation.requests.filter(r => r.branch_id === 'main' || !r.branch_id)
    }

    // Calculate stats
    const totalDuration =
      new Date(conversation.last_message).getTime() - new Date(conversation.first_message).getTime()
    const branchStats = conversation.branches.reduce(
      (acc, branch) => {
        const branchRequests = conversation.requests.filter(r => (r.branch_id || 'main') === branch)
        // Get the max message count from the branch (latest request has the highest count)
        const maxMessageCount = Math.max(...branchRequests.map(r => r.message_count || 0), 0)
        acc[branch] = {
          count: maxMessageCount,
          tokens: branchRequests.reduce((sum, r) => sum + r.total_tokens, 0),
          requests: branchRequests.length,
          firstMessage:
            branchRequests.length > 0
              ? Math.min(...branchRequests.map(r => new Date(r.timestamp).getTime()))
              : 0,
          lastMessage:
            branchRequests.length > 0
              ? Math.max(...branchRequests.map(r => new Date(r.timestamp).getTime()))
              : 0,
        }
        return acc
      },
      {} as Record<
        string,
        {
          count: number
          tokens: number
          requests: number
          firstMessage: number
          lastMessage: number
        }
      >
    )

    // Add main branch if not present
    if (!branchStats.main) {
      const mainRequests = conversation.requests.filter(r => !r.branch_id || r.branch_id === 'main')
      // Get the max message count from the main branch
      const maxMessageCount = Math.max(...mainRequests.map(r => r.message_count || 0), 0)
      branchStats.main = {
        count: maxMessageCount,
        tokens: mainRequests.reduce((sum, r) => sum + r.total_tokens, 0),
        requests: mainRequests.length,
        firstMessage:
          mainRequests.length > 0
            ? Math.min(...mainRequests.map(r => new Date(r.timestamp).getTime()))
            : 0,
        lastMessage:
          mainRequests.length > 0
            ? Math.max(...mainRequests.map(r => new Date(r.timestamp).getTime()))
            : 0,
      }
    }

    // Calculate total sub-tasks spawned by this conversation
    // First, get the actual count of sub-task requests linked to this conversation
    let totalSubtasksSpawned = 0
    let requestsWithSubtasks = 0
    
    // Get request IDs that have task invocations
    const requestIdsWithTasks = conversation.requests
      .filter(req => req.task_tool_invocation && Array.isArray(req.task_tool_invocation) && req.task_tool_invocation.length > 0)
      .map(req => req.request_id)
    
    if (requestIdsWithTasks.length > 0) {
      // Count actual sub-tasks linked to these requests
      totalSubtasksSpawned = await storageService.countSubtasksForRequests(requestIdsWithTasks)
      requestsWithSubtasks = requestIdsWithTasks.length
    }

    // Calculate stats for selected branch or total
    let displayStats
    if (selectedBranch && branchStats[selectedBranch]) {
      // For branch stats, use the filtered requests which include main branch history
      const maxMessageCount = Math.max(...filteredRequests.map(r => r.message_count || 0), 0)
      const totalTokens = filteredRequests.reduce((sum, r) => sum + r.total_tokens, 0)
      const timestamps = filteredRequests.map(r => new Date(r.timestamp).getTime())
      const duration = timestamps.length > 0 ? Math.max(...timestamps) - Math.min(...timestamps) : 0
      
      // Calculate sub-tasks for filtered branch
      let branchSubtasks = 0
      const branchRequestIdsWithTasks = filteredRequests
        .filter(req => req.task_tool_invocation && Array.isArray(req.task_tool_invocation) && req.task_tool_invocation.length > 0)
        .map(req => req.request_id)
      
      if (branchRequestIdsWithTasks.length > 0) {
        branchSubtasks = await storageService.countSubtasksForRequests(branchRequestIdsWithTasks)
      }

      displayStats = {
        messageCount: maxMessageCount,
        totalTokens: totalTokens,
        branchCount: 1,
        duration: duration,
        requestCount: filteredRequests.length,
        totalSubtasks: branchSubtasks,
      }
    } else {
      // Show total stats for all branches
      displayStats = {
        messageCount: conversation.message_count || 0,
        totalTokens: conversation.total_tokens,
        branchCount: Object.keys(branchStats).length,
        duration: totalDuration,
        requestCount: conversation.requests.length,
        totalSubtasks: totalSubtasksSpawned,
      }
    }

    const content = html`
      <div class="mb-6">
        <a href="/dashboard" class="text-blue-600">← Back to Dashboard</a>
      </div>

      <h2 style="margin: 0 0 1.5rem 0;">Conversation Details</h2>

      <!-- Stats Grid -->
      <div class="conversation-stats-grid">
        <div class="conversation-stat-card">
          <div class="conversation-stat-label">${selectedBranch ? 'Branch' : 'Total'} Messages</div>
          <div class="conversation-stat-value">${displayStats.messageCount}</div>
        </div>
        <div class="conversation-stat-card">
          <div class="conversation-stat-label">${selectedBranch ? 'Branch' : 'Total'} Sub-tasks</div>
          <div class="conversation-stat-value">${displayStats.totalSubtasks}</div>
        </div>
        <div class="conversation-stat-card">
          <div class="conversation-stat-label">${selectedBranch ? 'Branch' : 'Total'} Tokens</div>
          <div class="conversation-stat-value">${displayStats.totalTokens.toLocaleString()}</div>
        </div>
        <div class="conversation-stat-card">
          <div class="conversation-stat-label">
            ${selectedBranch ? 'Branch Requests' : 'Branches'}
          </div>
          <div class="conversation-stat-value">
            ${selectedBranch ? displayStats.requestCount : displayStats.branchCount}
          </div>
        </div>
        <div class="conversation-stat-card">
          <div class="conversation-stat-label">Duration</div>
          <div class="conversation-stat-value">${formatDuration(displayStats.duration)}</div>
        </div>
      </div>

      <!-- Branch Filter -->
      <div class="branch-filter" id="branch-filter">
        <span class="text-sm text-gray-600">Filter by branch:</span>
        <a
          href="/dashboard/conversation/${conversationId}"
          class="branch-chip ${!selectedBranch ? 'branch-chip-active' : 'branch-chip-main'}"
          style="${!selectedBranch
            ? 'background: #f3f4f6; color: #1f2937; border-color: #9ca3af;'
            : ''}"
        >
          All Branches
        </a>
        ${raw(
          Object.entries(branchStats)
            .map(([branch, stats]) => {
              const color = getBranchColor(branch)
              const isActive = selectedBranch === branch
              return `
            <a href="/dashboard/conversation/${conversationId}?branch=${branch}"
               class="branch-chip ${isActive ? 'branch-chip-active' : ''}"
               style="${branch !== 'main' ? `background: ${color}20; color: ${color}; border-color: ${color};` : 'background: #f3f4f6; color: #4b5563; border-color: #e5e7eb;'}${isActive ? ' font-weight: 600;' : ''}">
              ${branch} (${stats.count} messages, ${formatNumber(stats.tokens)} tokens)
            </a>
          `
            })
            .join('')
        )}
      </div>

      <!-- Main Content -->
      <div class="conversation-graph-container">
        <!-- Graph Visualization -->
        <div class="conversation-graph">${raw(svgGraph)}</div>

        <!-- Timeline -->
        <div class="conversation-timeline" id="conversation-messages">
          ${raw(renderConversationMessages(filteredRequests, conversation.branches, subtasksMap))}
        </div>
      </div>
      
      <script>
        // Add hover functionality for sub-task tooltips
        document.addEventListener('DOMContentLoaded', function() {
          const subtaskGroups = document.querySelectorAll('.subtask-node-group');
          
          subtaskGroups.forEach(group => {
            const promptHover = group.querySelector('.subtask-prompt-hover');
            if (promptHover) {
              group.addEventListener('mouseenter', function() {
                promptHover.style.display = 'block';
              });
              
              group.addEventListener('mouseleave', function() {
                promptHover.style.display = 'none';
              });
            }
          });
        });
      </script>
    `

    // Use the shared layout from dashboard-api
    const { layout: dashboardLayout } = await import('./dashboard-api.js')
    return c.html(dashboardLayout('Conversation Detail', content))
  } catch (error) {
    console.error('Error loading conversation detail:', error)
    return c.html(html`
      <div class="error-banner">
        <strong>Error:</strong> ${getErrorMessage(error) || 'Failed to load conversation'}
      </div>
    `)
  }
})

/**
 * HTMX endpoint for updating just the messages part
 */
conversationDetailRoutes.get('/conversation/:id/messages', async c => {
  const conversationId = c.req.param('id')
  const selectedBranch = c.req.query('branch')

  // Get storage service from container
  const { container } = await import('../container.js')
  const storageService = container.getStorageService()

  try {
    const conversations = await storageService.getConversations(undefined, 1000)
    const conversation = conversations.find(conv => conv.conversation_id === conversationId)

    if (!conversation) {
      return c.html(html`<div class="error-banner">Conversation not found</div>`)
    }

    let filteredRequests = conversation.requests
    if (selectedBranch && selectedBranch !== 'main') {
      // Find the first request in the selected branch
      const branchRequests = conversation.requests.filter(r => r.branch_id === selectedBranch)
      if (branchRequests.length > 0) {
        // Sort by timestamp to get the first request in the branch
        branchRequests.sort(
          (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
        )
        const firstBranchRequest = branchRequests[0]

        // Get all requests from main branch that happened before the branch diverged
        const mainRequestsBeforeBranch = conversation.requests.filter(
          r =>
            (r.branch_id === 'main' || !r.branch_id) &&
            new Date(r.timestamp) < new Date(firstBranchRequest.timestamp)
        )

        // Combine main requests before branch + all branch requests
        filteredRequests = [...mainRequestsBeforeBranch, ...branchRequests]
      } else {
        filteredRequests = branchRequests
      }
    } else if (selectedBranch === 'main') {
      // For main branch, show only main branch requests
      filteredRequests = conversation.requests.filter(r => r.branch_id === 'main' || !r.branch_id)
    }

    return c.html(renderConversationMessages(filteredRequests, conversation.branches))
  } catch (error) {
    console.error('Error loading conversation messages:', error)
    return c.html(html`<div class="error-banner">Failed to load messages</div>`)
  }
})

/**
 * Helper to render conversation messages
 */
function renderConversationMessages(requests: ConversationRequest[], _branches: string[], subtasksMap?: Map<string, any[]>) {
  // Sort requests by timestamp in descending order (newest first)
  const sortedRequests = [...requests].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  )

  return html`
    <div style="display: grid; gap: 0.25rem;">
      ${raw(
        sortedRequests
          .map(req => {
            const branch = req.branch_id || 'main'
            const branchColor = getBranchColor(branch)

            // Check if this request has sub-tasks based on task_tool_invocation
            const taskInvocations = subtasksMap?.get(req.request_id) || req.task_tool_invocation
            const hasTaskInvocation =
              taskInvocations &&
              Array.isArray(taskInvocations) &&
              taskInvocations.length > 0

            return `
          <div class="section" id="message-${req.request_id}">
            <div class="section-header" style="display: flex; justify-content: space-between; align-items: center; padding: 0.625rem 1rem;">
              <div>
                <span style="font-size: 0.875rem; color: #6b7280;">
                  ${new Date(req.timestamp).toLocaleString()}
                </span>
                ${
                  branch !== 'main'
                    ? `
                  <span style="margin-left: 0.5rem; font-size: 0.7rem; background: ${branchColor}20; color: ${branchColor}; padding: 0.125rem 0.375rem; border-radius: 0.25rem; border: 1px solid ${branchColor};">
                    ${escapeHtml(branch)}
                  </span>
                `
                    : ''
                }
                ${
                  req.is_subtask
                    ? '<span style="margin-left: 0.5rem; font-size: 0.875rem;" title="Sub-task conversation">🔗</span>'
                    : ''
                }
                ${
                  hasTaskInvocation
                    ? `<span style="margin-left: 0.5rem; font-size: 0.875rem;" title="Has sub-tasks">📋 (${taskInvocations.length})</span>`
                    : ''
                }
              </div>
              <div style="display: flex; gap: 0.75rem; align-items: center;">
                <span class="text-sm text-gray-600">${req.message_count || 0} messages</span>
                <span class="text-sm text-gray-600">${formatNumber(req.total_tokens)} tokens</span>
                ${req.error ? '<span style="color: #ef4444; font-size: 0.875rem;">Error</span>' : ''}
              </div>
            </div>
            <div class="section-content" style="padding: 0.75rem 1rem;">
              <div style="display: flex; justify-content: space-between; align-items: center;">
                <div class="text-sm text-gray-500">
                  Request ID: ${req.request_id}
                </div>
                <div style="display: flex; gap: 1rem; align-items: center;">
                  ${
                    req.parent_task_request_id
                      ? `<a href="/dashboard/request/${req.parent_task_request_id}" class="text-sm text-blue-600" title="View parent task">
                          ↑ Parent Task
                        </a>`
                      : ''
                  }
                  ${
                    hasTaskInvocation
                      ? `<button onclick="toggleSubtasks('${req.request_id}')" class="text-sm text-blue-600" style="cursor: pointer; background: none; border: none; padding: 0;">
                          View Sub-tasks ▼
                        </button>`
                      : ''
                  }
                  <a href="/dashboard/request/${req.request_id}" class="text-sm text-blue-600">
                    View details →
                  </a>
                </div>
              </div>
              ${
                hasTaskInvocation
                  ? `<div id="subtasks-${req.request_id}" style="display: none; margin-top: 1rem; padding-top: 1rem; border-top: 1px solid #e5e7eb;">
                      <div class="text-sm text-gray-600" style="margin-bottom: 0.5rem;">Sub-tasks spawned by this request:</div>
                      ${taskInvocations
                        .map(
                          (task: any) => `
                          <div style="margin-bottom: 0.5rem; padding: 0.5rem; background: #f9fafb; border-radius: 0.25rem;">
                            <div style="font-size: 0.875rem; color: #4b5563;">
                              <strong>Task:</strong> ${escapeHtml(task.name || 'Unnamed task')}
                            </div>
                            ${task.input?.prompt ? `<div style="font-size: 0.75rem; color: #6b7280; margin-top: 0.25rem;">${escapeHtml(task.input.prompt.substring(0, 200))}${task.input.prompt.length > 200 ? '...' : ''}</div>` : ''}
                            ${task.input?.description ? `<div style="font-size: 0.75rem; color: #6b7280; margin-top: 0.25rem;">Description: ${escapeHtml(task.input.description)}</div>` : ''}
                            ${
                              task.linked_conversation_id
                                ? `
                              <div style="margin-top: 0.5rem;">
                                <a href="/dashboard/conversation/${task.linked_conversation_id}" class="text-sm text-blue-600">
                                  View sub-task conversation →
                                </a>
                              </div>
                            `
                                : '<div style="margin-top: 0.5rem; font-size: 0.75rem; color: #9ca3af;">Sub-task not yet linked</div>'
                            }
                          </div>
                        `
                        )
                        .join('')}
                    </div>`
                  : ''
              }
            </div>
          </div>
        `
          })
          .join('')
      )}
    </div>

    <script>
      function toggleSubtasks(requestId) {
        const subtasksDiv = document.getElementById('subtasks-' + requestId)
        if (subtasksDiv) {
          subtasksDiv.style.display = subtasksDiv.style.display === 'none' ? 'block' : 'none'
        }
      }
    </script>
  `
}
