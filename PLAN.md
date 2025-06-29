# Conversation Linking Simplification Plan

## Overview

This plan simplifies the conversation linking process while maintaining all existing functionality. The core idea is to centralize all linking logic into a dedicated class and implement a clear priority system for parent matching.

## Phase 1: Core Architecture

### 1. Create ConversationLinker Class

```
packages/shared/src/utils/conversation-linker.ts
├── Main linking interface
├── Parent finding strategies
├── Query building logic
└── Special case handlers
```

### 2. Define Linking Interfaces

```typescript
interface LinkingRequest {
  domain: string
  messages: Message[]
  systemPrompt: string
  requestId: string
}

interface LinkingResult {
  conversationId: string
  parentRequestId: string | null
  branchId?: string
}
```

### 3. Core Architecture Benefits

- Single source of truth for linking logic
- Easier testing and maintenance
- Clear separation of concerns

## Phase 2: Linking Logic Implementation

### 4. Hash Computation Strategy

```
Message Hashing:
└── Full conversation hash (all messages)
└── Parent hash (all messages except last 2)
└── System hash (system prompt only)
```

### 5. Parent Request Query Builder

```sql
Criteria Builder:
├── Domain matching (required)
├── Message count (X-2 for parent)
├── Hash matching priorities
└── Exclusion of current request
```

## Phase 3: Special Case Handling

### 6. Conversation Linking Priority System

```
Priority Order:
├── [1] Single Message Cases
│   ├── a. Compact continuation detected → Find parent
│   └── b. Regular single message → Skip (no parent)
│
└── [2] Multiple Message Cases
    ├── i.   Exact match (parent hash + system hash)
    ├── ii.  Summarization (parent hash, ignore system)
    └── iii. Fallback (parent hash only)
```

### 7. Compact Conversation Detection

```
Detection Pattern:
├── Check: "This session is being continued..."
├── Extract: Summary content after marker
└── Match: Against previous response content
```

## Phase 4: Integration & Migration

### 8. StorageAdapter Integration

```
Update Flow:
├── Replace inline logic
├── Call ConversationLinker.linkConversation()
├── Maintain existing API
└── Add error handling
```

### 9. Rebuild Script Migration

```
Migration Steps:
├── Extract special cases to ConversationLinker
├── Update script to use new linker
├── Keep verification logic
└── Test with existing data
```

## Implementation Sequence

```
┌─────────────────────┐
│ 1. ConversationLinker│
└──────────┬──────────┘
           │
           v
┌─────────────────────┐
│ 2. Linking Strategies│
└──────────┬──────────┘
           │
           v
┌─────────────────────┐
│ 3. Query Builder    │
└──────────┬──────────┘
           │
           v
┌─────────────────────┐
│ 4. Special Cases    │
└──────────┬──────────┘
           │
           v
┌─────────────────────┐
│ 5. Integration      │
└─────────────────────┘
```

## Key Implementation Details

### Backward Compatibility

- Maintain existing database schema
- Keep same hash computation logic
- Preserve conversation IDs

### Performance Considerations

- Use existing indexes effectively
- Batch queries where possible
- Cache frequently accessed data

### Testing Strategy

- Unit tests for each linking case
- Integration tests with real data
- Performance benchmarks
- Backward compatibility tests

## Benefits of This Approach

1. **Simplified Logic**: All linking rules in one place
2. **Clear Priorities**: Explicit matching order
3. **Maintainable**: Easy to add new cases
4. **Testable**: Each strategy can be tested independently
5. **Performant**: Optimized queries with proper indexing

## Detailed Implementation Steps

### Step 1: Create ConversationLinker Class

```typescript
// packages/shared/src/utils/conversation-linker.ts
export class ConversationLinker {
  // Core linking logic moved from StorageAdapter
  async linkConversation(request: LinkingRequest): Promise<LinkingResult>

  // Parent finding strategies
  private findParentByHash(domain, parentHash, systemHash)
  private findCompactParent(domain, firstMessage)
  private findSummarizationParent(domain, messageHash)
}
```

### Step 2: Implement Linking Strategies

- Strategy 1: Hash-based (exact system match priority)
- Strategy 2: Compact continuation detection
- Strategy 3: Summarization request handling
- Strategy 4: Single message skip logic

### Step 3: Query Builder Implementation

```typescript
interface ParentQueryCriteria {
  domain: string
  messageCount?: number
  parentMessageHash?: string
  systemHash?: string
  excludeRequestId?: string
}
```

### Step 4: Compact Conversation Detection Logic

```typescript
private detectCompactConversation(message: Message): CompactInfo | null {
  const COMPACT_PREFIX = "This session is being continued from a previous conversation that ran out of context"
  const SUMMARY_MARKER = "The conversation is summarized below:"

  // Check first message content items
  for (const content of message.content) {
    if (typeof content === 'string' && content.includes(COMPACT_PREFIX)) {
      // Extract the summary content after the marker
      const summaryStart = content.indexOf(SUMMARY_MARKER)
      if (summaryStart > -1) {
        return {
          isCompact: true,
          summaryContent: extractSummaryContent(content, summaryStart)
        }
      }
    }
  }
  return null
}

// Match against previous conversation responses
private async findCompactParent(domain: string, summaryContent: string) {
  // Query for requests where response contains matching summary
  // Strip prefixes/suffixes and compare core content
}
```

### Step 5: Priority-Based Parent Matching System

```typescript
async linkConversation(request: LinkingRequest): Promise<LinkingResult> {
  const { domain, messages, systemPrompt, requestId } = request

  // Case 1: Single message handling
  if (messages.length === 1) {
    const compactInfo = detectCompactConversation(messages[0])
    if (compactInfo) {
      // Case a: Compact conversation continuation
      return await handleCompactContinuation(domain, compactInfo)
    }
    // Case b: Skip - no parent
    return { conversationId: generateNewId(), parentRequestId: null }
  }

  // Case 2: Multiple messages - compute parent hash
  const parentHash = computeParentHash(messages) // all except last 2
  const systemHash = hashSystemPrompt(systemPrompt)

  // Priority matching:
  // i. Exact system hash match
  let parent = await findParentByHash(domain, parentHash, systemHash)

  // ii. Summarization request - ignore system hash
  if (!parent && isSummarizationRequest(systemPrompt)) {
    parent = await findParentByHash(domain, parentHash, null)
  }

  // iii. Fallback - match by message hash only
  if (!parent) {
    parent = await findParentByHash(domain, parentHash, null)
  }

  return parent ? linkToParent(parent) : createNewConversation()
}
```

### Step 6: Integration and Migration Plan

1. **Update StorageAdapter**:

   - Replace inline linking logic with ConversationLinker calls
   - Maintain same public API for backward compatibility
   - Add proper error handling and logging

2. **Migration from Rebuild Script**:

   - Extract special case handlers into ConversationLinker
   - Update rebuild script to use new linker for consistency
   - Ensure verification logic still works

3. **Testing Strategy**:

   - Unit tests for each linking strategy
   - Integration tests with real conversation flows
   - Performance benchmarks for large datasets
   - Backward compatibility tests

4. **Rollout Plan**:

   - Feature flag for gradual rollout
   - Monitor conversation linking accuracy
   - Keep old logic as fallback initially

5. **Documentation**:
   - Update CLAUDE.md with new architecture
   - Document priority system clearly
   - Add examples for each special case

## Compact Conversation Logic Details

When a conversation is too big, the AI compacts the messages into a single one. To detect the conversation in that case, you must compare some part of one of the content items of the first message with the content of the last message. But each one has some additional prefix/suffix.

Example of the correct prefix/suffix:

**Original conversation (req 170):**

- System content[1]: "You are a helpful AI assistant tasked with summarizing conversations."
- Response: "<analysis> Let me chronologically analyze the conversation: 1. **Initial User Request**: The user requested to improve conversation using the old indices. </summary>"

**New compacted request (req 1):**

- Messages content[1]: "This session is being continued from a previous conversation that ran out of context. The conversation is summarized below: Analysis: Let me chronologically analyze the conversation: 1. **Initial User Request**: The user requested to improve conversation using the old indices.. Please continue the conversation from where we left it off without asking the user any further questions. Continue with the last task that you were asked to work on."

The matching logic needs to:

1. Extract the core summary content from both sides
2. Strip the prefixes and suffixes
3. Compare the normalized content
4. Link the conversations if they match
