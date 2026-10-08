import type { CopilotModelBinding } from './types';
import { CopilotDirectError } from './errors';

export const COPILOT_HTTP_BINDINGS: Readonly<Record<string, CopilotModelBinding>> = Object.freeze({
    'gpt-6-luna': Object.freeze({ api: 'responses', outputLimitField: 'max_output_tokens', jsonSchema: true,
        reportedModels: Object.freeze(['gpt-6-luna']) }),
    'gpt-5.4-mini': Object.freeze({ api: 'responses', outputLimitField: 'max_output_tokens', jsonSchema: true,
        reportedModels: Object.freeze(['gpt-5.4-mini', 'gpt-5.4-mini-2026-03-17']) }),
    'gpt-4.1': Object.freeze({ api: 'chat-completions', outputLimitField: 'max_tokens', jsonSchema: false,
        reportedModels: Object.freeze(['gpt-4.1', 'gpt-4.1-2025-04-14']) }),
});
export function validateTransport(value: unknown): asserts value is 'sdk' | 'direct' {
    if (value !== 'sdk' && value !== 'direct') throw new CopilotDirectError('DIRECT_CONFIG_INVALID', 'Copilot transform transport must be sdk or direct.');
}
