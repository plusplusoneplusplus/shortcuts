/**
 * Splits composer text into plain runs and backticked file-path runs so the
 * RichTextInput overlay can draw a pill behind each path.
 *
 * This exists because the composer's contentEditable stays plain text: a
 * mention inserts `` `path` `` as ordinary characters (see
 * `buildFilePathInsertion`), and the pill is painted by a transparent-text
 * overlay sitting on top of it. Nothing here changes the input's value.
 */

export interface RichTextSegment {
    /** The raw text of this run, backticks included for a pill. */
    text: string;
    /** True when this run is a backticked path that should render as a pill. */
    pill: boolean;
}

/** A backtick span with no newline and at least one character inside. */
const CODE_SPAN = /`([^`\n]+)`/g;

/** Trailing `.ext`, the same shape `getFileMentionContext` treats as a file. */
const FILE_EXTENSION_SUFFIX = /\.[A-Za-z0-9_]+$/;

/**
 * Whether a code span's contents look like a file path rather than prose or an
 * inline code snippet. Deliberately narrow: only whitespace-free tokens that
 * contain a `/` or end in an extension, mirroring the trigger-less rule in
 * {@link getFileMentionContext}, so ordinary `` `npm test` `` stays unstyled.
 */
export function isFilePathCodeSpan(inner: string): boolean {
    if (!inner || /\s/.test(inner)) return false;
    return inner.includes('/') || FILE_EXTENSION_SUFFIX.test(inner);
}

/**
 * Split `text` into consecutive segments whose concatenation is exactly `text`.
 * Adjacent plain runs are merged, so a pill segment is always surrounded by (at
 * most) one plain segment on each side.
 */
export function splitFilePathPills(text: string): RichTextSegment[] {
    if (!text) return [];
    const segments: RichTextSegment[] = [];
    let cursor = 0;
    const pushPlain = (value: string) => {
        if (!value) return;
        const last = segments[segments.length - 1];
        if (last && !last.pill) last.text += value;
        else segments.push({ text: value, pill: false });
    };
    CODE_SPAN.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = CODE_SPAN.exec(text)) !== null) {
        if (!isFilePathCodeSpan(match[1])) continue;
        pushPlain(text.slice(cursor, match.index));
        segments.push({ text: match[0], pill: true });
        cursor = match.index + match[0].length;
    }
    pushPlain(text.slice(cursor));
    return segments;
}

/** True when `text` contains at least one path pill worth drawing. */
export function hasFilePathPill(text: string): boolean {
    return splitFilePathPills(text).some((s) => s.pill);
}
