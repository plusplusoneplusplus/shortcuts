import type { AIProcess } from '@plusplusoneplusplus/forge';
import { loadNativeNotesFs, toNotesFsError } from '@plusplusoneplusplus/coc-native';
import * as fs from 'fs';
import * as path from 'path';
import { getRepoDataPath } from '../paths';
import type {
    SentinelDisposition,
    SentinelWatchlist,
    SentinelWatchlistEntry,
} from './sentinel-watchlist';
import type { SentinelBucket } from './sentinel-classifier';
import type { SentinelNudgeDraft } from './sentinel-nudge';

const BOARD_ITEM_MARKER = '<!-- sentinel:item:';
const BOARD_ITEM_PATTERN = /^- \[([ xX])\] .* <!-- sentinel:item:([^ ]+) -->$/;
const BOARD_APPROVAL_PATTERN = /^  - \[([ xX])\] .* <!-- sentinel:approve:([^ ]+) -->$/;
export const SENTINEL_BOARD_WRITE_ATTEMPTS = 3;
export const SENTINEL_CONFIG_TEMPLATE = `# Sentinel

tickInterval: 1h
recencyWindow: 7d
mute: []
maxNudgesPerChat: 3
`;
const BUCKETS: Array<{ bucket: SentinelBucket; heading: string }> = [
    { bucket: 'blocked-on-you', heading: 'Blocked on you' },
    { bucket: 'failed', heading: 'Failed' },
    { bucket: 'stuck-in-queue', heading: 'Stuck in queue' },
    { bucket: 'loose-ends', heading: 'Loose ends' },
    { bucket: 'done-unread', heading: 'Done, unread' },
];

export interface SentinelBoardSnapshot {
    content: string;
    mtimeMs: number;
}

export interface SentinelBoardStorage {
    readBoard(): Promise<SentinelBoardSnapshot | undefined>;
    writeBoard(content: string, expectedMtimeMs?: number): Promise<boolean>;
    ensureConfig(): Promise<void>;
    readConfig(): Promise<string>;
}

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
    return error instanceof Error && 'code' in error && error.code === code;
}

export function createSentinelBoardStorage(
    dataDir: string,
    workspaceId: string,
): SentinelBoardStorage {
    const notesRoot = getRepoDataPath(dataDir, workspaceId, 'notes');
    const sentinelDirectory = path.join(notesRoot, 'Sentinel');
    const boardPath = path.join(sentinelDirectory, 'Board.md');
    const configPath = path.join(sentinelDirectory, 'Sentinel.md');
    const contentOptions = {
        isDefaultRoot: true,
        allowedPrefixes: [path.dirname(notesRoot)],
    };

    return {
        async readBoard() {
            try {
                const note = await loadNativeNotesFs().readNote(
                    notesRoot,
                    'Sentinel/Board.md',
                    contentOptions,
                );
                return { content: note.content, mtimeMs: note.mtimeMs };
            } catch (error) {
                if (toNotesFsError(error).statusCode === 404) {
                    return undefined;
                }
                throw error;
            }
        },
        async writeBoard(content, expectedMtimeMs) {
            await fs.promises.mkdir(sentinelDirectory, { recursive: true });
            if (expectedMtimeMs === undefined) {
                try {
                    await fs.promises.writeFile(boardPath, content, {
                        encoding: 'utf8',
                        flag: 'wx',
                    });
                    return true;
                } catch (error) {
                    if (isNodeError(error, 'EEXIST')) {
                        return false;
                    }
                    throw error;
                }
            }
            const result = await loadNativeNotesFs().writeNote(
                notesRoot,
                'Sentinel/Board.md',
                content,
                expectedMtimeMs,
                contentOptions,
            );
            return result.status === 'written';
        },
        async ensureConfig() {
            await fs.promises.mkdir(sentinelDirectory, { recursive: true });
            try {
                await fs.promises.writeFile(configPath, SENTINEL_CONFIG_TEMPLATE, {
                    encoding: 'utf8',
                    flag: 'wx',
                });
            } catch (error) {
                if (!isNodeError(error, 'EEXIST')) {
                    throw error;
                }
            }
        },
        async readConfig() {
            return fs.promises.readFile(configPath, 'utf8');
        },
    };
}

function oneLine(value: string): string {
    return value.replace(/\s+/g, ' ').trim();
}

function escapeLinkText(value: string): string {
    return oneLine(value).replace(/([\\[\]])/g, '\\$1');
}

function safeText(value: string): string {
    return oneLine(value).replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function processTitle(process: AIProcess | undefined, processId: string): string {
    return process?.customTitle ?? process?.title ?? process?.promptPreview ?? processId;
}

function renderEntry(
    workspaceId: string,
    entry: SentinelWatchlistEntry,
    process: AIProcess | undefined,
): string {
    const href = `#repos/${encodeURIComponent(workspaceId)}/activity/${encodeURIComponent(entry.processId)}`;
    return `- [x] [${escapeLinkText(processTitle(process, entry.processId))}](${href})`
        + ` — ${safeText(entry.reason)} ${BOARD_ITEM_MARKER}${encodeURIComponent(entry.processId)} -->`;
}

export function renderSentinelBoard(
    workspaceId: string,
    watchlist: SentinelWatchlist,
    processes: AIProcess[] = [],
    nudgeDrafts: SentinelNudgeDraft[] = [],
): string {
    const processById = new Map(processes.map(process => [process.id, process]));
    const draftByProcessId = new Map(nudgeDrafts.map(draft => [draft.processId, draft]));
    const activeEntries = watchlist.entries.filter(entry =>
        entry.disposition === 'watching' || entry.disposition === 'nudged',
    );
    const lines = [
        '# Sentinel Board',
        '',
        '> Checked items are being watched. Uncheck an item to resolve it, or delete it to mute it.',
    ];

    for (const { bucket, heading } of BUCKETS) {
        const entries = activeEntries
            .filter(entry => entry.bucket === bucket)
            .sort((left, right) => left.processId.localeCompare(right.processId));
        if (entries.length === 0) {
            continue;
        }
        lines.push('', `## ${heading}`, '');
        for (const entry of entries) {
            lines.push(renderEntry(workspaceId, entry, processById.get(entry.processId)));
            const draft = draftByProcessId.get(entry.processId);
            if (draft) {
                const actionLabel = draft.action === 'fresh-chat'
                    ? 'Approve a fresh chat'
                    : 'Approve nudge';
                lines.push(
                    `  - [ ] **${actionLabel}:** ${safeText(draft.message)}`
                    + ` <!-- sentinel:approve:${encodeURIComponent(entry.processId)} -->`,
                );
            }
        }
    }

    return `${lines.join('\n')}\n`;
}

function parseApprovalStates(board: string): Map<string, boolean> {
    const approvals = new Map<string, boolean>();
    for (const line of board.split(/\r?\n/)) {
        const match = BOARD_APPROVAL_PATTERN.exec(line);
        if (!match) {
            continue;
        }
        try {
            approvals.set(decodeURIComponent(match[2]), match[1].toLowerCase() === 'x');
        } catch (error) {
            if (!(error instanceof URIError)) {
                throw error;
            }
        }
    }
    return approvals;
}

export function findNewlyApprovedSentinelNudges(
    previousBoard: string | undefined,
    currentBoard: string,
): Set<string> {
    if (previousBoard === undefined) {
        return new Set();
    }
    const previous = parseApprovalStates(previousBoard);
    const current = parseApprovalStates(currentBoard);
    return new Set([...current].flatMap(([processId, checked]) =>
        checked && previous.get(processId) === false ? [processId] : [],
    ));
}

interface RenderedBoardItem {
    processId: string;
    checked: boolean;
}

function parseRenderedItems(board: string): Map<string, RenderedBoardItem> {
    const items = new Map<string, RenderedBoardItem>();
    for (const line of board.split(/\r?\n/)) {
        const match = BOARD_ITEM_PATTERN.exec(line);
        if (!match) {
            continue;
        }
        try {
            const processId = decodeURIComponent(match[2]);
            if (processId.length > 0) {
                items.set(processId, {
                    processId,
                    checked: match[1].toLowerCase() === 'x',
                });
            }
        } catch (error) {
            if (!(error instanceof URIError)) {
                throw error;
            }
        }
    }
    return items;
}

export function foldSentinelBoardEdits(
    watchlist: SentinelWatchlist,
    currentBoard: string,
    now: Date,
): SentinelWatchlist {
    if (watchlist.lastRenderedBoard === undefined) {
        return watchlist;
    }

    const previousItems = parseRenderedItems(watchlist.lastRenderedBoard);
    const currentItems = parseRenderedItems(currentBoard);
    let changed = false;
    const entries = watchlist.entries.map(entry => {
        if (!previousItems.has(entry.processId)) {
            return entry;
        }
        const current = currentItems.get(entry.processId);
        const disposition: SentinelDisposition | undefined = current
            ? (current.checked ? undefined : 'resolved')
            : 'muted';
        if (!disposition || entry.disposition === disposition) {
            return entry;
        }
        changed = true;
        return disposition === 'resolved'
            ? { ...entry, disposition, resolvedAt: now.toISOString() }
            : { ...entry, disposition };
    });

    return changed ? { ...watchlist, entries } : watchlist;
}
