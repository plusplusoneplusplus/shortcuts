/** Shared plain-text draft contract for the tool, dashboard and messaging relay. */
export const ASK_USER_TEXTAREA_MAX_BYTES = 32 * 1024;

export function normalizeDraftText(value: string): string {
    return value.replace(/\r\n/g, '\n');
}

export function textareaAnswerError(value: unknown): string | undefined {
    if (typeof value !== 'string' || value.length === 0) {
        return 'Textarea answers must be non-empty strings. Use Skip to discard a draft.';
    }
    if (new TextEncoder().encode(value).byteLength > ASK_USER_TEXTAREA_MAX_BYTES) {
        return 'Textarea answers must be at most 32 KiB of UTF-8 text.';
    }
    return undefined;
}

export function isDraftEdited(answer: string, defaultValue?: string | string[]): boolean {
    return normalizeDraftText(answer) !== normalizeDraftText(typeof defaultValue === 'string' ? defaultValue : '');
}
