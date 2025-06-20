# Sub-task Linking Tests

This directory contains tests for the sub-task conversation tracking feature.

## Test Files

### subtask-detection.test.ts

Unit tests that verify:

- Task tool invocation detection in response bodies
- Timing relationships between parent tasks and sub-tasks
- Prompt matching between Task invocations and sub-task conversations
- Response body structure validation

### subtask-linking.test.ts (requires database)

Integration tests that verify:

- Task tool invocations are stored in the database
- Sub-task conversations are linked to parent requests
- Timing-based linking logic works correctly

## Test Data

The tests use real request/response samples collected from the proxy:

- `inference_streaming_with_tools_with_system_opus-1750420376296-im7ygz453.json` - Main conversation that spawns a Task
- `inference_streaming_with_tools_with_system_opus-1750420386819-wixegs6ph.json` - Sub-task conversation created by the Task

## How Sub-task Linking Works

1. **Detection**: When a response contains a tool use with `name: "Task"`, it's marked as spawning a sub-task
2. **Storage**: The Task invocation details are stored in the `task_tool_invocation` field
3. **Linking**: Conversations that start within 30 seconds of a Task invocation are linked as sub-tasks
4. **Tracking**: Sub-tasks have `is_subtask: true` and `parent_task_request_id` set to the spawning request

## Running Tests

```bash
# Run unit tests (no database required)
bun test test/unit/subtask-detection.test.ts

# Run integration tests (requires DATABASE_URL)
bun test test/unit/subtask-linking.test.ts
```
