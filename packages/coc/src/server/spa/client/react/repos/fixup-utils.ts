/**
 * Fixup/squash/amend commit detection and visual grouping utilities.
 *
 * Parses commit subjects to detect `fixup!`, `squash!`, and `amend!` prefixes,
 * matches fixups to their nearest earlier target commit, and assigns rotating
 * color slots so the UI can render color-coded group indicators.
 */

/** Minimal commit shape needed by the fixup grouping logic. */
export interface FixupCommitInput {
    hash: string;
    subject: string;
}

/** Matches a leading fixup/squash/amend prefix (possibly nested). */
const FIXUP_RE = /^(fixup|squash|amend)! (.+)$/;

export type FixupType = 'fixup' | 'squash' | 'amend';

export interface ParsedFixup {
    type: FixupType;
    /** The subject after stripping the outermost prefix. */
    innerSubject: string;
    /** The fully-unwrapped target subject (all prefixes stripped). */
    targetSubject: string;
    /** Short display label for the pill badge. */
    pillLabel: string;
}

export interface FixupGroupTarget {
    colorSlot: number;
    fixupHashes: string[];
}

export interface FixupEntry {
    targetHash: string;
    type: FixupType;
    /** Subject with prefix stripped for display. */
    displaySubject: string;
    colorSlot: number;
    pillLabel: string;
}

export interface FixupGroupMap {
    /** targetHash → group info (color slot + list of fixup hashes). */
    targetGroups: Map<string, FixupGroupTarget>;
    /** fixupHash → entry info (target, type, display subject, color). */
    fixupEntries: Map<string, FixupEntry>;
}

// ── Color palette ──────────────────────────────────────────────────────────

export const FIXUP_GROUP_COLORS_LIGHT = [
    '#e65100', // warm orange
    '#7b1fa2', // purple
    '#00695c', // teal
    '#c62828', // red
    '#1565c0', // blue
    '#f9a825', // yellow
];

export const FIXUP_GROUP_COLORS_DARK = [
    '#ffb74d', // warm orange
    '#ce93d8', // purple
    '#80cbc4', // teal
    '#ef9a9a', // red
    '#90caf9', // blue
    '#fff176', // yellow
];

const PILL_LABELS: Record<FixupType, string> = {
    fixup: 'FIX',
    squash: 'SQU',
    amend: 'AMD',
};

// ── Parsing ────────────────────────────────────────────────────────────────

/**
 * Attempt to parse a commit subject as a fixup/squash/amend commit.
 * Returns `null` if the subject is not a fixup-style commit.
 *
 * Handles nested prefixes: "fixup! fixup! X" → targetSubject = "X", type = "fixup".
 */
export function parseFixupSubject(subject: string): ParsedFixup | null {
    const match = FIXUP_RE.exec(subject);
    if (!match) return null;

    const type = match[1] as FixupType;
    const innerSubject = match[2];

    // Unwrap nested prefixes to find the ultimate target subject
    let targetSubject = innerSubject;
    let nested = FIXUP_RE.exec(targetSubject);
    while (nested) {
        targetSubject = nested[2];
        nested = FIXUP_RE.exec(targetSubject);
    }

    return {
        type,
        innerSubject,
        targetSubject,
        pillLabel: PILL_LABELS[type],
    };
}

// ── Group builder ──────────────────────────────────────────────────────────

/**
 * Build fixup group mappings from a list of commits.
 *
 * For each fixup commit, finds the **nearest earlier** commit whose subject
 * exactly matches the unwrapped target subject. Color slots are assigned
 * incrementally and wrap around after 6.
 *
 * Commits with no matching target in the list are silently skipped (they
 * render normally without any fixup treatment).
 */
export function buildFixupGroups(commits: readonly FixupCommitInput[]): FixupGroupMap {
    const targetGroups = new Map<string, FixupGroupTarget>();
    const fixupEntries = new Map<string, FixupEntry>();

    // Build a subject → hash[] index for quick lookup.
    // Multiple commits may share the same subject; we keep all to find nearest.
    const subjectToHashes = new Map<string, string[]>();
    const hashToIndex = new Map<string, number>();
    for (let i = 0; i < commits.length; i++) {
        const c = commits[i];
        hashToIndex.set(c.hash, i);
        const existing = subjectToHashes.get(c.subject);
        if (existing) {
            existing.push(c.hash);
        } else {
            subjectToHashes.set(c.subject, [c.hash]);
        }
    }

    let nextColorSlot = 0;

    for (let i = 0; i < commits.length; i++) {
        const commit = commits[i];
        const parsed = parseFixupSubject(commit.subject);
        if (!parsed) continue;

        // Find nearest earlier commit whose subject matches the target subject.
        // "Earlier" in the list means higher index (commits are newest-first).
        const candidates = subjectToHashes.get(parsed.targetSubject);
        if (!candidates) continue;

        let bestHash: string | null = null;
        let bestIdx = -1;
        for (const h of candidates) {
            const idx = hashToIndex.get(h)!;
            // Must be later in the list (= earlier in time) and not a fixup itself
            if (idx > i && (bestIdx === -1 || idx < bestIdx)) {
                bestHash = h;
                bestIdx = idx;
            }
        }

        if (!bestHash) continue;

        // Assign or reuse color slot for this target
        let group = targetGroups.get(bestHash);
        if (!group) {
            group = { colorSlot: nextColorSlot++ % FIXUP_GROUP_COLORS_LIGHT.length, fixupHashes: [] };
            targetGroups.set(bestHash, group);
        }
        group.fixupHashes.push(commit.hash);

        fixupEntries.set(commit.hash, {
            targetHash: bestHash,
            type: parsed.type,
            displaySubject: parsed.targetSubject,
            colorSlot: group.colorSlot,
            pillLabel: parsed.pillLabel,
        });
    }

    return { targetGroups, fixupEntries };
}
