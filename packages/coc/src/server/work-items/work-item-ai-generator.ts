/**
 * Work Item AI Generator
 *
 * Implements the `GenerateNewItemDraftFn` and `GenerateImproveItemDraftFn`
 * contracts defined in `work-item-ai-routes.ts`.
 *
 * Each function:
 *   1. Builds a structured prompt (system + user) for the AI.
 *   2. Calls the AI via `createCLIAIInvoker` (lazy import, same pattern as
 *      `comments-ai-helpers.ts` — avoids forcing the SDK to load at server
 *      startup and keeps the dependency optional).
 *   3. Parses the JSON response into an `AiDraftResponse`.
 *   4. Returns the parsed response or throws on unrecoverable failure so the
 *      route layer can surface the error correctly.
 *
 * The AI is instructed to return ONLY a JSON object.  The parser strips
 * markdown code fences (```json … ```) that some models wrap around JSON.
 *
 * This module contains NO Express / HTTP concerns — only pure prompt + parse
 * logic so it is easy to unit-test with a mock AI service.
 */

import type {
    AiDraftResponse,
    ClarificationResponse,
    DraftResponse,
    NewItemDraftContext,
    ImproveItemDraftContext,
    GenerateNewItemDraftFn,
    GenerateImproveItemDraftFn,
} from '../routes/work-item-ai-routes';
import { MAX_CLARIFICATION_ROUNDS } from '../routes/work-item-ai-routes';
import type { ISDKService } from '@plusplusoneplusplus/forge';
import type { SystemMessageConfig } from '@plusplusoneplusplus/coc-agent-sdk';

// ============================================================================
// Timeout
// ============================================================================

/** Default timeout for AI draft calls (30 s — lighter than full task execution). */
const DRAFT_TIMEOUT_MS = 30_000;

// ============================================================================
// System prompt
// ============================================================================

const SYSTEM_PROMPT = `\
You are an expert AI product manager helping to author CoC work items.
Your job is to produce structured work items, implementation plans, and child task breakdowns.

STRICT OUTPUT CONTRACT
======================
Respond with ONLY a valid JSON object — no prose, no markdown, no code fences.
Do not include any text before or after the JSON.

RESPONSE SCHEMAS
================

Schema A — clarification (use ONLY when you genuinely need more detail and
  fewer than ${MAX_CLARIFICATION_ROUNDS} clarification rounds have already happened):
{
  "kind": "clarification",
  "questions": ["<concise question 1>", ...],
  "clarificationCount": <integer — current round number>
}
  - Maximum ${MAX_CLARIFICATION_ROUNDS} questions total across all rounds.
  - Questions must be concise and immediately actionable.

Schema B — draft (use when you have enough information, or when instructed
  to generate a draft regardless):
{
  "kind": "draft",
  "workItem": {
    "title": "<short, descriptive title>",
    "description": "<1-3 sentence Markdown description>",
    "priority": "high" | "normal" | "low",
    "tags": ["<tag>", ...],
    "type": "work-item" | "bug" | "goal" | "epic" | "feature" | "pbi",
    "plan": "<Markdown plan using standard template below>"
  },
  "goal": "<optional: full Markdown goal / implementation plan>",
  "childTasks": [
    { "title": "<title>", "description": "<optional>", "type": "work-item" | "bug" }
  ]
}
  - "goal" maps to plan.content on the work item.  Use it when the request asks
    for an implementation plan or goal spec.
  - "childTasks" is ONLY included when hierarchy is supported AND the user
    requested a task breakdown.  When hierarchy is disabled, embed the task
    breakdown as a checklist inside "goal" instead.
  - Omit "childTasks" and "goal" when not applicable.

PLAN TEMPLATE (use inside "plan" and/or "goal"):
## Objective
<state the goal in 1–2 sentences>

## Background
<context and motivation>

## Steps
- [ ] <step 1>

## Acceptance Criteria
- [ ] <criterion 1>

## Notes
<constraints, links, follow-ups>
`.trim();

// ============================================================================
// Response parser
// ============================================================================

/** Strip optional markdown code fences that some models wrap around JSON. */
function stripCodeFences(raw: string): string {
    const trimmed = raw.trim();
    // Match ```json ... ``` or ``` ... ```
    const fenced = trimmed.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```\s*$/);
    return fenced ? fenced[1].trim() : trimmed;
}

/**
 * Parse the raw AI response text into a typed `AiDraftResponse`.
 * Throws a descriptive `Error` when the response cannot be parsed or is invalid.
 */
export function parseAiDraftResponse(raw: string): AiDraftResponse {
    const jsonText = stripCodeFences(raw);

    let parsed: unknown;
    try {
        parsed = JSON.parse(jsonText);
    } catch {
        throw new Error(`AI returned non-JSON response: ${raw.slice(0, 200)}`);
    }

    if (!parsed || typeof parsed !== 'object') {
        throw new Error('AI response is not a JSON object');
    }

    const obj = parsed as Record<string, unknown>;

    if (obj.kind === 'clarification') {
        const questions = Array.isArray(obj.questions)
            ? (obj.questions as unknown[]).filter(q => typeof q === 'string') as string[]
            : [];
        if (questions.length === 0) {
            throw new Error('AI clarification response has no questions');
        }
        const clarificationCount = typeof obj.clarificationCount === 'number'
            ? Math.max(0, obj.clarificationCount)
            : 0;
        const response: ClarificationResponse = { kind: 'clarification', questions, clarificationCount };
        return response;
    }

    if (obj.kind === 'draft') {
        const wi = obj.workItem && typeof obj.workItem === 'object'
            ? obj.workItem as Record<string, unknown>
            : {};
        const workItem: DraftResponse['workItem'] = {
            ...(typeof wi.title === 'string' && wi.title ? { title: wi.title } : {}),
            ...(typeof wi.description === 'string' ? { description: wi.description } : {}),
            ...(wi.priority === 'high' || wi.priority === 'normal' || wi.priority === 'low'
                ? { priority: wi.priority }
                : {}),
            ...(Array.isArray(wi.tags)
                ? { tags: (wi.tags as unknown[]).filter(t => typeof t === 'string') as string[] }
                : {}),
            ...(typeof wi.plan === 'string' && wi.plan ? { plan: wi.plan } : {}),
            ...(typeof wi.type === 'string' ? { type: wi.type as any } : {}),
        };

        const response: DraftResponse = {
            kind: 'draft',
            workItem,
            ...(typeof obj.goal === 'string' && obj.goal ? { goal: obj.goal } : {}),
            ...(Array.isArray(obj.childTasks) ? {
                childTasks: (obj.childTasks as unknown[]).flatMap(task => {
                    if (!task || typeof task !== 'object') return [];
                    const t = task as Record<string, unknown>;
                    if (typeof t.title !== 'string' || !t.title) return [];
                    return [{
                        title: t.title,
                        ...(typeof t.description === 'string' ? { description: t.description } : {}),
                        ...(t.type === 'bug' ? { type: 'bug' as const } : { type: 'work-item' as const }),
                    }];
                }),
            } : {}),
        };
        return response;
    }

    throw new Error(`AI returned unexpected kind: ${String(obj.kind)}`);
}

// ============================================================================
// Prompt builders
// ============================================================================

/** Build the user-facing prompt for a new work item draft request. */
export function buildNewItemPrompt(ctx: NewItemDraftContext): string {
    const parts: string[] = [];

    parts.push(`Task type requested: ${ctx.type}`);
    parts.push(`User request:\n${ctx.prompt}`);

    if (ctx.parentId) {
        parts.push(`Parent work item ID (for hierarchy context): ${ctx.parentId}`);
    }

    if (ctx.clarificationAnswers && ctx.clarificationAnswers.length > 0) {
        parts.push(
            'Answers to your previous clarification questions:\n' +
            ctx.clarificationAnswers.map((a, i) => `  Q${i + 1}: ${a}`).join('\n'),
        );
    }

    if (ctx.hierarchyEnabled) {
        parts.push(
            'Hierarchy is enabled: you MAY include "childTasks" in the draft if a task breakdown is useful.',
        );
    } else {
        parts.push(
            'Hierarchy is disabled: if a task breakdown is useful, embed it as a checklist inside "goal" — do NOT include "childTasks".',
        );
    }

    if (ctx.clarificationCount >= MAX_CLARIFICATION_ROUNDS) {
        parts.push(
            `You have already asked ${MAX_CLARIFICATION_ROUNDS} clarification rounds. ` +
            'You MUST respond with a draft (kind: "draft") — do NOT ask more questions.',
        );
    } else {
        parts.push(
            `Clarification rounds used so far: ${ctx.clarificationCount} of ${MAX_CLARIFICATION_ROUNDS}. ` +
            'Only ask a clarification question if absolutely necessary.',
        );
    }

    return parts.join('\n\n');
}

/** Build the user-facing prompt for an improve-existing-work-item draft request. */
export function buildImproveItemPrompt(ctx: ImproveItemDraftContext): string {
    const parts: string[] = [];

    parts.push(`Existing work item (ID: ${ctx.workItemId}, type: ${ctx.type ?? 'work-item'}):`);
    parts.push(`Title: ${ctx.title}`);
    if (ctx.description) {
        parts.push(`Description:\n${ctx.description}`);
    }
    if (ctx.currentPlan) {
        parts.push(`Current plan:\n${ctx.currentPlan}`);
    }

    parts.push(`Improvement request:\n${ctx.prompt}`);

    const targets = ctx.targets.join(', ');
    parts.push(
        `Generate improvements for these targets: ${targets}\n` +
        '  - "fields": improve title, description, priority, tags\n' +
        '  - "goal": generate or improve the plan/goal markdown\n' +
        '  - "childTasks": produce a child task breakdown (see hierarchy flag below)',
    );

    if (ctx.hierarchyEnabled) {
        parts.push(
            'Hierarchy is enabled: you MAY include "childTasks" when "childTasks" is in targets.',
        );
    } else {
        parts.push(
            'Hierarchy is disabled: if "childTasks" is in targets, embed the breakdown as a checklist inside "goal" instead — do NOT include "childTasks".',
        );
    }

    if (ctx.clarificationAnswers && ctx.clarificationAnswers.length > 0) {
        parts.push(
            'Answers to previous clarification questions:\n' +
            ctx.clarificationAnswers.map((a, i) => `  Q${i + 1}: ${a}`).join('\n'),
        );
    }

    if (ctx.clarificationCount >= MAX_CLARIFICATION_ROUNDS) {
        parts.push(
            `You have already asked ${MAX_CLARIFICATION_ROUNDS} clarification rounds. ` +
            'You MUST respond with a draft (kind: "draft") — do NOT ask more questions.',
        );
    } else {
        parts.push(
            `Clarification rounds used so far: ${ctx.clarificationCount} of ${MAX_CLARIFICATION_ROUNDS}. ` +
            'Only ask a clarification question if absolutely necessary.',
        );
    }

    return parts.join('\n\n');
}

// ============================================================================
// AI caller (lazy import keeps SDK optional at startup)
// ============================================================================

async function callAI(
    userPrompt: string,
    aiService?: ISDKService,
): Promise<string> {
    try {
        const { createCLIAIInvoker } = await import('../../ai-invoker');
        const invoker = createCLIAIInvoker({
            approvePermissions: false,
            timeoutMs: DRAFT_TIMEOUT_MS,
            ...(aiService ? { aiService } : {}),
        });
        const systemMessage: SystemMessageConfig = { mode: 'replace', content: SYSTEM_PROMPT };
        const result = await invoker(userPrompt, {
            timeoutMs: DRAFT_TIMEOUT_MS,
            systemMessage,
        });
        if (!result.success) {
            throw new Error(result.error ?? 'AI request failed');
        }
        return result.response ?? '';
    } catch (err) {
        throw err instanceof Error ? err : new Error(String(err));
    }
}

// ============================================================================
// Public factory
// ============================================================================

export interface WorkItemAiGeneratorOptions {
    /** Optional AI service override (useful in tests). */
    aiService?: ISDKService;
}

/**
 * Create the two generator functions used by `registerWorkItemAiRoutes`.
 *
 * Pass `aiService` to override the default Copilot SDK service (e.g. in tests).
 */
export function createWorkItemAiGenerators(options: WorkItemAiGeneratorOptions = {}): {
    generateNewItemDraft: GenerateNewItemDraftFn;
    generateImproveItemDraft: GenerateImproveItemDraftFn;
} {
    const generateNewItemDraft: GenerateNewItemDraftFn = async (ctx) => {
        const userPrompt = buildNewItemPrompt(ctx);
        const raw = await callAI(userPrompt, options.aiService);
        return parseAiDraftResponse(raw);
    };

    const generateImproveItemDraft: GenerateImproveItemDraftFn = async (ctx) => {
        const userPrompt = buildImproveItemPrompt(ctx);
        const raw = await callAI(userPrompt, options.aiService);
        return parseAiDraftResponse(raw);
    };

    return { generateNewItemDraft, generateImproveItemDraft };
}
