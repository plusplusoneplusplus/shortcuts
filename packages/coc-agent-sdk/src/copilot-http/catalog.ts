import { CopilotDirectError } from './errors';
import type { CopilotModelBinding } from './types';

export function validateCatalog(data: any, model: string, binding: CopilotModelBinding, options?: { jsonSchema?: unknown; reasoningEffort?: string }): void {
    if (!data || !Array.isArray(data.data) || data.data.some((m: any) => !m || typeof m.id !== 'string'))
        throw new CopilotDirectError('DIRECT_INVALID_RESPONSE', 'Copilot returned an invalid model catalog.');
    const entry = data.data.find((m: any) => m.id === model);
    if (!entry) throw new CopilotDirectError('DIRECT_UNSUPPORTED_MODEL', 'Selected model is absent from the Copilot catalog.');
    if (entry.policy?.state && entry.policy.state !== 'enabled') throw new CopilotDirectError('DIRECT_POLICY_DENIED', 'Selected model is disabled by Copilot policy.');
    const endpoints = entry.supported_endpoints;
    if (endpoints !== undefined && (!Array.isArray(endpoints) || endpoints.some((v: unknown) => typeof v !== 'string')))
        throw new CopilotDirectError('DIRECT_INVALID_RESPONSE', 'Copilot returned invalid endpoint metadata.');
    if (endpoints && !endpoints.includes(binding.api === 'responses' ? '/responses' : '/chat/completions'))
        throw new CopilotDirectError('DIRECT_UNSUPPORTED_MODEL', 'Copilot catalog contradicts the explicit protocol binding.');
    if (options?.jsonSchema && entry.capabilities?.supports?.structured_outputs === false)
        throw new CopilotDirectError('DIRECT_UNSUPPORTED_MODEL', 'Selected model does not advertise schema support.');
    if (options?.reasoningEffort && !entry.capabilities?.supports?.reasoning_effort)
        throw new CopilotDirectError('DIRECT_UNSUPPORTED_MODEL', 'Selected model does not advertise reasoning support.');
}
