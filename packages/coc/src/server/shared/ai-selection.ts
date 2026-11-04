import { badRequest } from '../errors';
import {
    AiSelectionParseError,
    parseAiSelection as parseSelection,
    parseChatProvider,
    parseReasoningEffort,
} from '../tasks/ai-selection';

function forRequest<T>(parse: () => T, shortErrors = false): T {
    try {
        return parse();
    } catch (error) {
        if (error instanceof AiSelectionParseError) {
            throw badRequest(shortErrors ? error.shortMessage : error.message);
        }
        throw error;
    }
}

export function parseAiSelection(body: Parameters<typeof parseSelection>[0]) {
    return forRequest(() => parseSelection(body));
}

export function parseChatProviderField(value: unknown) {
    return forRequest(() => parseChatProvider(value), true);
}

export function parseReasoningEffortField(value: unknown) {
    return forRequest(() => parseReasoningEffort(value), true);
}
