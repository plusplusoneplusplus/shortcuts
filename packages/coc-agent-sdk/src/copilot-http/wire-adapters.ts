import type { TokenUsage } from '../types';
import { CopilotDirectError } from './errors';
import type { CopilotCompletionInput, CopilotModelBinding, CopilotCompletionDiagnostics } from './types';

const invalid = (message = 'Copilot returned an invalid completion response.') => new CopilotDirectError('DIRECT_INVALID_RESPONSE', message);
const unsupported = () => new CopilotDirectError('DIRECT_UNSUPPORTED_MODEL', 'Selected model binding does not support these completion options.');
export function serializeCompletion(input: CopilotCompletionInput, binding: CopilotModelBinding): Record<string, unknown> {
    const allowed = new Set(['model', 'api', 'messages', 'maxOutputTokens', 'jsonSchema', 'reasoningEffort', 'timeoutMs', 'signal']);
    if (Object.keys(input).some(key => !allowed.has(key)))
        throw new CopilotDirectError('DIRECT_NOT_ELIGIBLE', 'Direct completion accepts only stateless text options.');
    if (!Array.isArray(input.messages) || !input.messages.length || !input.messages.some(m => m.role !== 'system')
        || input.messages.some(m => !m || !['system', 'user', 'assistant'].includes(m.role) || typeof m.content !== 'string'
            || Object.keys(m).some(key => key !== 'role' && key !== 'content')))
        throw new CopilotDirectError('DIRECT_NOT_ELIGIBLE', 'Direct completion requires ordered text messages.');
    if (input.maxOutputTokens !== undefined && (!Number.isSafeInteger(input.maxOutputTokens) || input.maxOutputTokens <= 0)) throw unsupported();
    if (input.reasoningEffort !== undefined && !binding.reasoningEfforts?.includes(input.reasoningEffort)) throw unsupported();
    if (input.jsonSchema !== undefined) {
        if (!input.jsonSchema || Object.keys(input.jsonSchema).some(key => !['name', 'schema', 'strict'].includes(key)) || !binding.jsonSchema || typeof input.jsonSchema.name !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(input.jsonSchema.name)
            || typeof input.jsonSchema.strict !== 'boolean') throw unsupported();
        validateSchema(input.jsonSchema.schema);
    }
    const body: Record<string, unknown> = { model: input.model, stream: false };
    if (input.maxOutputTokens !== undefined) body[binding.outputLimitField] = input.maxOutputTokens;
    if (input.api === 'chat-completions') {
        body.messages = input.messages;
        if (input.jsonSchema) body.response_format = { type: 'json_schema', json_schema: input.jsonSchema };
        if (input.reasoningEffort) body.reasoning_effort = input.reasoningEffort;
    } else {
        const first = input.messages.findIndex(m => m.role !== 'system');
        if (input.messages.slice(first).some(m => m.role === 'system')) throw unsupported();
        body.store = false;
        if (first > 0) body.instructions = input.messages.slice(0, first).map(m => m.content).join('\n\n');
        body.input = input.messages.slice(first);
        if (input.jsonSchema) body.text = { format: { type: 'json_schema', ...input.jsonSchema } };
        if (input.reasoningEffort) body.reasoning = { effort: input.reasoningEffort };
    }
    return body;
}
/** Deliberately small schema subset; unsupported keywords must not be silently ignored. */
function validateSchema(schema: unknown, depth = 0): void {
    if (!schema || typeof schema !== 'object' || Array.isArray(schema) || depth > 32) throw unsupported();
    const s = schema as Record<string, any>;
    const keys = ['type', 'properties', 'required', 'additionalProperties', 'items', 'enum', 'description', 'anyOf'];
    if (Object.keys(s).some(k => !keys.includes(k))) throw unsupported();
    if (s.type !== undefined && ![s.type].flat().every(t => ['object', 'array', 'string', 'number', 'integer', 'boolean', 'null'].includes(t))) throw unsupported();
    if (s.properties !== undefined) {
        if (!s.properties || typeof s.properties !== 'object' || Array.isArray(s.properties)) throw unsupported();
        for (const item of Object.values(s.properties)) validateSchema(item, depth + 1);
    }
    if (s.required !== undefined && (!Array.isArray(s.required) || s.required.some((k: unknown) => typeof k !== 'string' || !Object.prototype.hasOwnProperty.call(s.properties ?? {}, k)))) throw unsupported();
    if (s.additionalProperties !== undefined && s.additionalProperties !== false) throw unsupported();
    if (s.items !== undefined) validateSchema(s.items, depth + 1);
    if (s.anyOf !== undefined) {
        if (!Array.isArray(s.anyOf) || !s.anyOf.length) throw unsupported();
        for (const item of s.anyOf) validateSchema(item, depth + 1);
    }
    if (s.enum !== undefined && (!Array.isArray(s.enum) || !s.enum.length || s.enum.some((value: unknown) => value !== null && !['string', 'number', 'boolean'].includes(typeof value)))) throw unsupported();
    if (s.description !== undefined && typeof s.description !== 'string') throw unsupported();
}
function number(value: unknown): number {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw invalid('Copilot returned invalid token usage.');
    return value;
}
function usage(data: any, api: CopilotCompletionInput['api']): { tokenUsage?: TokenUsage; usageUnavailableReason?: string; tokenCounts?: CopilotCompletionDiagnostics['tokenCounts'] } {
    if (data === undefined || data === null) return { usageUnavailableReason: 'Upstream omitted token usage.' };
    if (typeof data !== 'object' || Array.isArray(data)) throw invalid('Copilot returned invalid token usage.');
    const i = api === 'responses' ? data.input_tokens : data.prompt_tokens;
    const o = api === 'responses' ? data.output_tokens : data.completion_tokens;
    const details = api === 'responses' ? data.input_tokens_details : data.prompt_tokens_details;
    if (details !== undefined && (!details || typeof details !== 'object' || Array.isArray(details))) throw invalid('Copilot returned invalid cache usage.');
    const read = details?.cached_tokens;
    const write = details?.cache_write_tokens;
    const reasoning = (api === 'responses' ? data.output_tokens_details : data.completion_tokens_details)?.reasoning_tokens;
    for (const value of [i, o, data.total_tokens, read, write, reasoning]) if (value !== undefined) number(value);
    if (i !== undefined && o !== undefined && data.total_tokens !== undefined && i + o !== data.total_tokens) throw invalid('Copilot returned contradictory token totals.');
    if (i !== undefined && ((read ?? 0) + (write ?? 0) > i)) throw invalid('Copilot returned contradictory cache usage.');
    if (o !== undefined && reasoning !== undefined && reasoning > o) throw invalid('Copilot returned contradictory reasoning usage.');
    if ([i, o, data.total_tokens].some(v => v === undefined))
        return { usageUnavailableReason: 'Upstream omitted required token counts.' };
    if (read === undefined || write === undefined) return { usageUnavailableReason: 'Upstream omitted cache counts required by shared TokenUsage.', tokenCounts: { inputTokens: i, outputTokens: o, totalTokens: data.total_tokens, turnCount: 1,
        ...(read !== undefined ? { cacheReadTokens: read } : {}), ...(write !== undefined ? { cacheWriteTokens: write } : {}) } };
    return { tokenUsage: { inputTokens: i, outputTokens: o, totalTokens: data.total_tokens, cacheReadTokens: read, cacheWriteTokens: write, turnCount: 1 } };
}
export function parseCompletion(data: any, input: CopilotCompletionInput, binding: CopilotModelBinding) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw invalid();
    if (typeof data.model !== 'string' || !binding.reportedModels.includes(data.model))
        throw new CopilotDirectError('DIRECT_MODEL_MISMATCH', 'Copilot did not report an explicitly accepted model identity.');
    let text = '';
    if (input.api === 'chat-completions') {
        const choice = data.choices?.[0];
        if (!choice || choice.finish_reason !== 'stop' || choice.message?.role !== 'assistant'
            || choice.message.refusal || (choice.message.tool_calls !== undefined && (!Array.isArray(choice.message.tool_calls) || choice.message.tool_calls.length)) || choice.message.function_call
            || typeof choice.message.content !== 'string') throw invalid();
        text = choice.message.content;
    } else {
        if (data.status !== 'completed' || data.error || data.incomplete_details || !Array.isArray(data.output)) throw invalid();
        for (const item of data.output) {
            if (item.type === 'reasoning') continue;
            if (item.type !== 'message' || item.role !== 'assistant' || item.status !== 'completed' || !Array.isArray(item.content)) throw invalid();
            for (const part of item.content) {
                if (part.type !== 'output_text' || typeof part.text !== 'string') throw invalid();
                text += part.text;
            }
        }
    }
    if (!text.trim()) throw invalid('Copilot returned empty completion text.');
    const totalNanoAiu = data.copilot_usage?.total_nano_aiu;
    if (totalNanoAiu !== undefined) number(totalNanoAiu);
    return { text, effectiveModel: input.model, reportedModel: data.model as string, ...usage(data.usage, input.api), totalNanoAiu };
}
