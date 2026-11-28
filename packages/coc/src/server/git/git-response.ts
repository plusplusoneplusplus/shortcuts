import type { DiffContent } from '@plusplusoneplusplus/forge';

const STATUS_CHARS = new Map([
    ['modified', 'M'], ['added', 'A'], ['deleted', 'D'], ['renamed', 'R'],
    ['copied', 'C'], ['conflict', 'U'], ['untracked', '?'], ['ignored', '!'],
]);

export function gitStatusToChar(status: string): string {
    return STATUS_CHARS.get(status) ?? status;
}

const CHAR_STATUSES = new Map([...STATUS_CHARS].map(([status, char]) => [char, status]));

/** The inverse of `gitStatusToChar`, for status rows a client sends back. */
export function gitCharToStatus(char: string): string {
    return CHAR_STATUSES.get(char) ?? char;
}

/** Only truncated patch responses carry line-count metadata on the wire. */
export function patchContentResponse(content: DiffContent) {
    return {
        diff: content.raw,
        ...(content.truncated ? { truncated: true as const, totalLines: content.totalLines } : {}),
    };
}
