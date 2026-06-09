/**
 * localStorage-backed draft persistence for active ask_user batches.
 *
 * Drafts are scoped by process id and batch id so different chats/repos cannot
 * leak answers into one another.
 */

export type AskUserDraftValue = string | string[] | boolean | null;
export type AskUserQuestionDisposition = 'answer' | 'skip' | 'needs-context';

export interface AskUserQuestionDraft {
    value: AskUserDraftValue;
    customText: string;
    disposition: AskUserQuestionDisposition;
    note: string;
}

export interface AskUserBatchDraft {
    answers: Record<string, AskUserQuestionDraft>;
    updatedAt: number;
}

type AskUserDraftMap = Record<string, Record<string, AskUserBatchDraft>>;

const STORAGE_KEY = 'coc-ask-user-drafts';
const TTL_MS = 7 * 24 * 60 * 60 * 1000;

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
    return Array.isArray(value) && value.every(item => typeof item === 'string');
}

function normalizeDraftValue(value: unknown): AskUserDraftValue | null {
    if (value === null) return null;
    if (typeof value === 'string' || typeof value === 'boolean') return value;
    if (isStringArray(value)) return value;
    return null;
}

function normalizeDisposition(value: unknown): AskUserQuestionDisposition | null {
    return value === 'answer' || value === 'skip' || value === 'needs-context' ? value : null;
}

function normalizeQuestionDraft(value: unknown): AskUserQuestionDraft | null {
    if (!isRecord(value)) return null;
    const disposition = normalizeDisposition(value.disposition);
    if (!disposition) return null;
    return {
        value: normalizeDraftValue(value.value),
        customText: typeof value.customText === 'string' ? value.customText : '',
        disposition,
        note: typeof value.note === 'string' ? value.note : '',
    };
}

function normalizeBatchDraft(value: unknown): AskUserBatchDraft | null {
    if (!isRecord(value) || !isRecord(value.answers) || typeof value.updatedAt !== 'number') {
        return null;
    }
    const answers: Record<string, AskUserQuestionDraft> = {};
    for (const [questionId, answer] of Object.entries(value.answers)) {
        const normalized = normalizeQuestionDraft(answer);
        if (normalized) answers[questionId] = normalized;
    }
    return { answers, updatedAt: value.updatedAt };
}

function readMap(): AskUserDraftMap {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return {};
        const parsed = JSON.parse(raw) as unknown;
        if (!isRecord(parsed)) return {};
        const map: AskUserDraftMap = {};
        for (const [processId, batches] of Object.entries(parsed)) {
            if (!isRecord(batches)) continue;
            const normalizedBatches: Record<string, AskUserBatchDraft> = {};
            for (const [batchId, draft] of Object.entries(batches)) {
                const normalized = normalizeBatchDraft(draft);
                if (normalized) normalizedBatches[batchId] = normalized;
            }
            if (Object.keys(normalizedBatches).length > 0) {
                map[processId] = normalizedBatches;
            }
        }
        return map;
    } catch {
        return {};
    }
}

function writeMap(map: AskUserDraftMap): void {
    try {
        const processIds = Object.keys(map).filter(processId => Object.keys(map[processId]).length > 0);
        if (processIds.length === 0) {
            localStorage.removeItem(STORAGE_KEY);
            return;
        }
        const compacted = Object.fromEntries(processIds.map(processId => [processId, map[processId]]));
        localStorage.setItem(STORAGE_KEY, JSON.stringify(compacted));
    } catch {
        // Quota exceeded or storage disabled — match the existing chat draft behavior.
    }
}

export function getAskUserDraft(processId: string, batchId: string): AskUserBatchDraft | null {
    return readMap()[processId]?.[batchId] ?? null;
}

export function setAskUserDraft(
    processId: string,
    batchId: string,
    answers: Record<string, AskUserQuestionDraft>,
): void {
    const map = readMap();
    map[processId] = {
        ...(map[processId] ?? {}),
        [batchId]: {
            answers: { ...answers },
            updatedAt: Date.now(),
        },
    };
    writeMap(map);
}

export function clearAskUserDraft(processId: string, batchId: string): void {
    const map = readMap();
    if (!map[processId]?.[batchId]) return;
    delete map[processId][batchId];
    if (Object.keys(map[processId]).length === 0) {
        delete map[processId];
    }
    writeMap(map);
}

export function clearAskUserDraftsForProcess(processId: string): void {
    const map = readMap();
    if (!map[processId]) return;
    delete map[processId];
    writeMap(map);
}

export function clearOtherAskUserDraftsForProcess(processId: string, activeBatchId: string): void {
    const map = readMap();
    const batches = map[processId];
    if (!batches) return;
    let changed = false;
    for (const batchId of Object.keys(batches)) {
        if (batchId !== activeBatchId) {
            delete batches[batchId];
            changed = true;
        }
    }
    if (Object.keys(batches).length === 0) {
        delete map[processId];
        changed = true;
    }
    if (changed) writeMap(map);
}

export function pruneExpiredAskUserDrafts(): void {
    const map = readMap();
    const now = Date.now();
    let changed = false;
    for (const [processId, batches] of Object.entries(map)) {
        for (const [batchId, draft] of Object.entries(batches)) {
            if (now - draft.updatedAt > TTL_MS) {
                delete batches[batchId];
                changed = true;
            }
        }
        if (Object.keys(batches).length === 0) {
            delete map[processId];
            changed = true;
        }
    }
    if (changed) writeMap(map);
}
