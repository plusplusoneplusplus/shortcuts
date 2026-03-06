# Context: Natural Language Pipeline Creation

## Goal
Replace the placeholder "AI Generated" template in the CoC dashboard's pipeline creation dialog with a real AI-powered flow — user describes a pipeline in plain English, the system generates valid YAML, previews it with validation, and saves it.

## Commit Sequence
1. Backend — AI pipeline generation endpoint (`POST /generate` + extend create to accept `content`)
2. Frontend — Natural language pipeline creation dialog (three-state dialog: input → generating → preview)

## Key Decisions
- Single free-form textarea (not a multi-step wizard) for the natural language description
- Pipeline schema knowledge embedded as a const string in the source (not loaded from disk at runtime)
- YAML extraction handles markdown code fences, generic code blocks, and raw text
- The `/generate` endpoint uses `denyAllPermissions` (no tool access — pure text generation)
- Preview before save: user reviews YAML, can regenerate or go back
- `createPipeline` extended with optional `content` field (backward-compatible)

## Conventions
- Route registration via `routes.push({ method, pattern, handler })` in `registerPipelineWriteRoutes`
- SPA API calls use `fetch(getApiBase() + path)` pattern from `pipeline-api.ts`
- Dialog uses the shared `<Dialog>` component with `className` override for width
- Tailwind dark mode via `dark:` variants matching existing dashboard styles
- AbortController for cancellation of in-flight AI requests
