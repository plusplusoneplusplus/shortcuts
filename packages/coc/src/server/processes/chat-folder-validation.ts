/**
 * Chat folder validation — the shared, dependency-free rules for a folder's
 * name and color.
 *
 * This module is imported by BOTH the REST handler (`chat-folder-handler.ts`)
 * and the SPA's inline create/rename row, so there is exactly one place that
 * decides what a legal folder name is. The spec requires the same validation
 * client-side and server-side; two copies would drift the first time the limit
 * changes.
 *
 * Keep this file free of node built-ins and server imports — it is bundled into
 * the browser.
 */

/** The six preset folder colors, stored by name so theming stays possible. */
export const CHAT_FOLDER_COLORS = ['purple', 'green', 'amber', 'blue', 'red', 'pink'] as const;

export type ChatFolderColor = (typeof CHAT_FOLDER_COLORS)[number];

export const DEFAULT_CHAT_FOLDER_COLOR: ChatFolderColor = 'blue';

/** Folder names are a label, not a document — long ones just truncate in the tree. */
export const MAX_CHAT_FOLDER_NAME_LENGTH = 60;

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * Trim, strip newlines (paste), and length-check a folder name. An empty name
 * is a client-side cancel, so the server rejects it rather than storing it.
 */
export function normalizeChatFolderName(raw: unknown): ValidationResult<string> {
    if (typeof raw !== 'string') {
        return { ok: false, error: 'Body must contain name: string' };
    }
    const name = raw.replace(/[\r\n]+/g, ' ').trim();
    if (name.length === 0) {
        return { ok: false, error: 'Folder name must not be empty' };
    }
    if (name.length > MAX_CHAT_FOLDER_NAME_LENGTH) {
        return { ok: false, error: `Folder name must be at most ${MAX_CHAT_FOLDER_NAME_LENGTH} characters` };
    }
    return { ok: true, value: name };
}

export function normalizeChatFolderColor(raw: unknown): ValidationResult<ChatFolderColor> {
    if (typeof raw !== 'string' || !(CHAT_FOLDER_COLORS as readonly string[]).includes(raw)) {
        return { ok: false, error: `Folder color must be one of: ${CHAT_FOLDER_COLORS.join(', ')}` };
    }
    return { ok: true, value: raw as ChatFolderColor };
}

/**
 * Sanitize keystroke-by-keystroke input for the inline name field: newlines
 * become spaces (so a multi-line paste stays one line) and the value is capped
 * at the stored maximum. Deliberately does NOT trim — trimming while typing
 * would eat the space the user just pressed.
 */
export function clampChatFolderNameInput(raw: string): string {
    return raw.replace(/[\r\n]+/g, ' ').slice(0, MAX_CHAT_FOLDER_NAME_LENGTH);
}
