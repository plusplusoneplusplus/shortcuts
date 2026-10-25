/**
 * Factory that creates a `suggest_follow_ups` custom tool for the Copilot SDK.
 * Ordinary chats request three actions; opted-in Sentinel chats offer one to three
 * actions only when useful. The handler preserves their order and count.
 */

import { defineTool } from '@plusplusoneplusplus/coc-agent-sdk';

const FOLLOW_UP_ACTION_GUIDANCE =
    'Write your full answer as normal visible text before calling this tool — never leave the answer only in your reasoning. ' +
    'The tool shows the suggestions to the user directly, so never mention them in your text: no lead-in such as "Here are some suggestions", ' +
    'no list or recap of them, and no comment after the call such as "I suggested three follow-ups". ' +
    'If the suggestions are all you have to add, call the tool with no filler text. This covers only the suggestions; keep task details the user needs in your answer. ' +
    'Each suggestion is a short imperative action phrase, not a question.';

/** Tool description; also shown read-only in the admin prompt catalog. */
export const SUGGEST_FOLLOW_UPS_DESCRIPTION =
    'At the end of your response, call this to suggest exactly 3 follow-up actions. ' + FOLLOW_UP_ACTION_GUIDANCE;

export const SENTINEL_NEXT_STEPS_GUIDANCE =
    'When useful, call suggest_follow_ups with 1–3 short, specific next actions, best first. No filler or blocking ask_user for suggestions. Suggesting grants no execution authority; clicking requests only the named action under existing limits.';

export interface FollowUpSuggestion {
    suggestions: string[];
}

/**
 * Create a suggest_follow_ups custom tool definition for the Copilot SDK.
 * Pass the returned object in the `tools` array of SendMessageOptions / ISessionOptions.
 */
export function createSuggestFollowUpsTool(sentinelNextSteps = false) {
    return defineTool<FollowUpSuggestion>('suggest_follow_ups', {
        description: sentinelNextSteps
            ? FOLLOW_UP_ACTION_GUIDANCE.replace('short imperative', 'short distinct imperative')
            : SUGGEST_FOLLOW_UPS_DESCRIPTION,
        parameters: {
            type: 'object',
            properties: {
                suggestions: {
                    type: 'array',
                    items: { type: 'string' },
                    minItems: sentinelNextSteps ? 1 : 3,
                    maxItems: 3,
                    description: `${sentinelNextSteps ? '1–3' : '3'} short follow-up action phrases the user might take next (imperative, not questions)`,
                },
            },
            required: ['suggestions'],
        },
        handler: async (args: FollowUpSuggestion) => {
            if (sentinelNextSteps && (!Array.isArray(args.suggestions) || args.suggestions.length < 1
                || args.suggestions.length > 3 || args.suggestions.some(value => typeof value !== 'string'))) {
                throw new Error('Expected 1–3 follow-up action phrases');
            }
            return { suggestions: args.suggestions };
        },
    });
}
