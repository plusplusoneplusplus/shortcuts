import type { ISDKService } from '@plusplusoneplusplus/forge';
import type { SystemMessageConfig } from '@plusplusoneplusplus/coc-agent-sdk';
import type { ChatProvider, ReasoningEffort } from '../tasks/task-types';
import type { ForEachChildMode, ForEachItem } from './types';
import { assertDraftInitialStatuses, normalizeForEachItems } from './for-each-plan-validation';

const PLAN_TIMEOUT_MS = 60_000;

const SYSTEM_PROMPT = `\
You are planning a CoC For Each run.

Your job is to decompose one user request into a reviewed list of independent item tasks.

STRICT OUTPUT CONTRACT
======================
Respond with ONLY a valid JSON object. No prose, no markdown, no code fences.

Schema:
{
  "items": [
    {
      "id": "item-1",
      "title": "Short task title",
      "prompt": "Self-contained item-specific prompt for the child chat",
      "dependsOn": ["item-0"],
      "metadata": { "optional": "JSON object" },
      "status": "pending"
    }
  ]
}

Rules:
- Produce at least one item.
- Every item id must be stable, unique, and filesystem-safe: letters, numbers, dots, underscores, or dashes only.
- Every item status must be exactly "pending".
- Item prompts must be self-contained for that item.
- Do not include sibling item results, parent progress journals, Ralph session state, timers, wakeups, or DAG workflow concepts.
- Use dependsOn only when an item truly cannot start until another listed item completes.
- Shared instructions are provided separately to child chats later; do not duplicate them verbatim unless required for the item to make sense.
`.trim();

export interface ForEachPlanGenerationContext {
    workspaceId: string;
    prompt: string;
    sharedInstructions?: string;
    childMode: ForEachChildMode;
    provider?: ChatProvider;
    model?: string;
    reasoningEffort?: ReasoningEffort;
}

export type GenerateForEachItemPlanFn = (ctx: ForEachPlanGenerationContext) => Promise<ForEachItem[]>;

export interface ForEachPlanGeneratorOptions {
    aiService: ISDKService;
    resolveAiServiceForProvider?: (provider: ChatProvider) => ISDKService;
}

function stripCodeFences(raw: string): string {
    const trimmed = raw.trim();
    const fenced = trimmed.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```\s*$/);
    return fenced ? fenced[1].trim() : trimmed;
}

export function parseForEachItemPlanResponse(raw: string): ForEachItem[] {
    const jsonText = stripCodeFences(raw);
    let parsed: unknown;
    try {
        parsed = JSON.parse(jsonText);
    } catch {
        throw new Error(`AI returned non-JSON For Each item plan: ${raw.slice(0, 200)}`);
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('AI For Each item plan must be a JSON object');
    }

    const items = normalizeForEachItems((parsed as { items?: unknown }).items);
    assertDraftInitialStatuses(items);
    return items;
}

export function buildForEachPlanPrompt(ctx: ForEachPlanGenerationContext): string {
    const parts: string[] = [
        `Workspace ID: ${ctx.workspaceId}`,
        `Child chat mode for all items: ${ctx.childMode}`,
        `Original user request:\n${ctx.prompt}`,
    ];
    if (ctx.sharedInstructions?.trim()) {
        parts.push(`Optional shared instructions for every child item:\n${ctx.sharedInstructions.trim()}`);
    }
    return parts.join('\n\n');
}

export function createForEachPlanGenerator(options: ForEachPlanGeneratorOptions): {
    generateItemPlan: GenerateForEachItemPlanFn;
} {
    const generateItemPlan: GenerateForEachItemPlanFn = async (ctx) => {
        const aiService = ctx.provider && options.resolveAiServiceForProvider
            ? options.resolveAiServiceForProvider(ctx.provider)
            : options.aiService;
        const systemMessage: SystemMessageConfig = { mode: 'replace', content: SYSTEM_PROMPT };
        const result = await aiService.sendMessage({
            prompt: buildForEachPlanPrompt(ctx),
            ...(ctx.model ? { model: ctx.model } : {}),
            ...(ctx.reasoningEffort ? { reasoningEffort: ctx.reasoningEffort } : {}),
            timeoutMs: PLAN_TIMEOUT_MS,
            systemMessage,
        });
        if (!result.success) {
            throw new Error(result.error ?? 'AI For Each item-plan generation failed');
        }
        return parseForEachItemPlanResponse(result.response ?? '');
    };

    return { generateItemPlan };
}
