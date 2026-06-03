import type { ParsedProgressSection, RalphExitSignal } from './types';

export interface FormatProgressSectionInput {
    iteration: number;
    signal: RalphExitSignal;
    timestamp: string;
    body?: string;
}

const SECTION_HEADER = /^##\s+Iteration\s+(\d+)\s+[—\-]\s+(RALPH_NEXT|RALPH_COMPLETE|NONE)\s+[—\-]\s+(\S+?)\s*$/;

/**
 * Format one Ralph progress.md iteration block using the canonical heading.
 */
export function formatProgressSection(input: FormatProgressSectionInput): string {
    const body = (input.body ?? '').trim();
    const header = `## Iteration ${input.iteration} — ${input.signal} — ${input.timestamp}`;
    return `${header}\n${body}${body.endsWith('\n') ? '' : '\n'}`;
}

/**
 * Parse Ralph iteration sections from a progress.md journal.
 *
 * Accepts both the canonical em dash separator and the legacy ASCII hyphen.
 */
export function parseProgressSections(progressMd: string): ParsedProgressSection[] {
    const lines = progressMd.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    const sections: ParsedProgressSection[] = [];

    let current: ParsedProgressSection | null = null;
    let bodyLines: string[] = [];

    const flush = () => {
        if (!current) {
            return;
        }
        current.body = bodyLines.join('\n').trim();
        sections.push(current);
        current = null;
        bodyLines = [];
    };

    for (const line of lines) {
        const match = SECTION_HEADER.exec(line);
        if (match) {
            flush();
            current = {
                iteration: Number(match[1]),
                signal: match[2] as RalphExitSignal,
                timestamp: match[3],
                body: '',
            };
            continue;
        }

        if (current) {
            bodyLines.push(line);
        }
    }

    flush();
    return sections;
}
