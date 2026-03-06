# Context: AI Tool-Based Comment Resolution

## User Story
When using "Resolve with AI" in the CoC SPA markdown review editor, the client currently marks ALL comments as resolved after AI returns — even if AI didn't actually address some of them (e.g., needed clarification). The user wants the AI to explicitly signal which comments it resolved using Copilot SDK custom tools, so only truly-addressed comments get marked resolved.

## Goal
Wire the `@github/copilot-sdk`'s custom tool support (`defineTool`, `Tool[]`) through the pipeline-core wrapper, then use it to define a `resolve_comment` tool that AI calls per-comment during resolution — enabling partial resolution and accurate status tracking.

## Commit Sequence
1. Add `tools` support to pipeline-core SDK wrapper
2. Wire resolve_comment tool into server comment resolution
3. Update client to handle partial comment resolution

## Key Decisions
- Use the SDK's native `Tool[]` / `defineTool()` support (not MCP servers) for custom tools — simpler, no process spawning
- Tool handler records resolved IDs in a per-invocation Set; server extracts results after AI completes
- Server returns only actually-resolved comment IDs; client resolves only those
- Prompt instructs AI to call `resolve_comment` per addressed comment and still output revised document

## Conventions
- pipeline-core is the only package that imports from `@github/copilot-sdk` — consumers use re-exported types
- `SendMessageOptions` is the primary interface for AI invocation; new fields are optional and additive
- Queue path (`executeResolveComments`) and sync fallback path share the same tool definition
