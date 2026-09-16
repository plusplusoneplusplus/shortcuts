import type { AIProcess } from '@plusplusoneplusplus/forge';
import type {
    SentinelDisposition,
    SentinelWatchlist,
    SentinelWatchlistEntry,
} from './sentinel-watchlist';
import type { SentinelBucket } from './sentinel-classifier';

const BOARD_ITEM_MARKER = '<!-- sentinel:item:';
const BOARD_ITEM_PATTERN = /^- \[([ xX])\] .* <!-- sentinel:item:([^ ]+) -->$/;
const BUCKETS: Array<{ bucket: SentinelBucket; heading: string }> = [
    { bucket: 'blocked-on-you', heading: 'Blocked on you' },
    { bucket: 'failed', heading: 'Failed' },
    { bucket: 'stuck-in-queue', heading: 'Stuck in queue' },
    { bucket: 'loose-ends', heading: 'Loose ends' },
    { bucket: 'done-unread', heading: 'Done, unread' },
];

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
): string {
    const processById = new Map(processes.map(process => [process.id, process]));
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
        lines.push(...entries.map(entry =>
            renderEntry(workspaceId, entry, processById.get(entry.processId)),
        ));
    }

    return `${lines.join('\n')}\n`;
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
