// Stub functions for SSE broadcasting in proxy service
// The actual SSE implementation is in the dashboard service

export function broadcastConversation(_data: any): void {
  // No-op in proxy service
  // Dashboard service will handle its own SSE
}

export function broadcastMetrics(_data: any): void {
  // No-op in proxy service
  // Dashboard service will handle its own SSE
}
