import type { ParsedProgressSection } from './types';

export type RalphProgressStagnationClassification =
    | 'continue'
    | 'warn'
    | 'manualVerificationOnly';

export interface ClassifyRalphProgressStagnationInput {
    progress: string;
    recentSections?: Pick<ParsedProgressSection, 'signal' | 'body'>[];
}

const MANUAL_ONLY_PATTERNS: RegExp[] = [
    /\bmanual(?:[-\s]+only)?\s+(?:verification|validation|demo|demos|review|qa|sign[-\s]?off)\b/,
    /\b(?:verification|validation|demo|demos|review|qa|sign[-\s]?off)\s+(?:is|are|remains?|left|needed|pending)?\s*manual(?:[-\s]+only)?\b/,
    /\b(?:user|human|product|stakeholder)[-\s]+(?:verification|validation|review|approval|sign[-\s]?off|demo)\b/,
    /\b(?:requires?|needs?)\s+(?:user|human|manual|external)\s+(?:verification|validation|review|approval|credentials?|access|demo)\b/,
    /\b(?:unavailable|missing|external)\s+(?:credentials?|account|access|environment|service)\b/,
    /\b(?:credentials?|account|access|environment|service)\s+(?:is|are)\s+(?:unavailable|missing|external)\b/,
    /\bno\s+(?:autonomous|automatable)\s+(?:work|tasks?|validation|checks?)\s+(?:remains?|left)\b/,
    /\b(?:final[-\s]?check|final validation)\s+only\b/,
    /\bonly\s+(?:the\s+)?(?:final[-\s]?check|final validation|manual verification|manual validation|manual demo|product review)\s+(?:remains?|left|pending|needed)\b/,
];

const AUTONOMOUS_WORK_PATTERNS: RegExp[] = [
    /\b(?:implement|fix|add|update|create|modify|refactor|debug|investigate|wire|persist|migrate)\b/,
    /\b(?:failing|broken)\s+(?:test|tests|build|lint|type[-\s]?check)\b/,
    /\b(?:run|rerun)\s+(?:unit\s+)?(?:tests?|build|lint|type[-\s]?check|validation)\b/,
    /\b(?:source|production|test|tests|build|lint|type[-\s]?check|validation|docs|documentation)\s+(?:fix|fixes|work|updates?|coverage)\b/,
];

const NEGATED_AUTONOMOUS_WORK_PATTERNS: RegExp[] = [
    /\bno\s+(?:autonomous|automatable|implementation|source|production|code|test|validation)\s+(?:work|tasks?|changes?|fixes?|checks?)\s+(?:remains?|left|needed|pending)\b/,
    /\b(?:implementation|source|production|code|tests?|validation|build|lint|type[-\s]?check)\s+(?:is|are)\s+(?:complete|done|finished|covered|passing)\b/,
    /\b(?:nothing|no\s+more)\s+(?:to\s+)?(?:implement|fix|add|update|change|test|validate)\b/,
];

const FINAL_VALIDATION_PATTERNS: RegExp[] = [
    /\bfinal\s+validation\b/,
    /\bfinal[-\s]?check\b/,
    /\blast\s+(?:verification|validation)\b/,
];

export function classifyRalphProgressStagnation(
    input: string | ClassifyRalphProgressStagnationInput,
): RalphProgressStagnationClassification {
    const progress = typeof input === 'string' ? input : input.progress;
    const current = classifyProgress(progress);
    if (current === 'manualVerificationOnly') {
        return current;
    }

    const recentSections = typeof input === 'string' ? undefined : input.recentSections;
    if (recentSections && shouldWarnForRepeatedFinalValidation(recentSections)) {
        return 'warn';
    }

    return 'continue';
}

function classifyProgress(progress: string): RalphProgressStagnationClassification {
    const remaining = extractRemainingText(progress);
    if (!remaining) {
        return 'continue';
    }

    const normalized = normalizeText(remaining);
    if (isEmptyRemaining(normalized)) {
        return 'continue';
    }

    const manualOnly = MANUAL_ONLY_PATTERNS.some(pattern => pattern.test(normalized));
    if (!manualOnly) {
        return 'continue';
    }

    return hasConcreteAutonomousWork(normalized) ? 'continue' : 'manualVerificationOnly';
}

function extractRemainingText(progress: string): string {
    const lines = progress.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    const remainingLines: string[] = [];
    let capturing = false;

    for (const line of lines) {
        const label = /^\s*([A-Za-z][A-Za-z -]{0,40}):\s*(.*)$/.exec(line);
        if (label) {
            if (label[1].trim().toLowerCase() === 'remaining') {
                capturing = true;
                remainingLines.push(label[2]);
                continue;
            }
            if (capturing) {
                break;
            }
        }

        if (capturing) {
            remainingLines.push(line);
        }
    }

    return remainingLines.join('\n').trim();
}

function hasConcreteAutonomousWork(text: string): boolean {
    if (NEGATED_AUTONOMOUS_WORK_PATTERNS.some(pattern => pattern.test(text))) {
        return false;
    }
    return AUTONOMOUS_WORK_PATTERNS.some(pattern => pattern.test(text));
}

function shouldWarnForRepeatedFinalValidation(
    sections: Pick<ParsedProgressSection, 'signal' | 'body'>[],
): boolean {
    const recentNextRemaining = sections
        .filter(section => section.signal === 'RALPH_NEXT')
        .slice(-3)
        .map(section => normalizeText(extractRemainingText(section.body)))
        .filter(Boolean);

    if (recentNextRemaining.length < 2) {
        return false;
    }

    return recentNextRemaining.every(text =>
        FINAL_VALIDATION_PATTERNS.some(pattern => pattern.test(text))
        && !hasConcreteAutonomousWork(text),
    );
}

function normalizeText(text: string): string {
    return text
        .toLowerCase()
        .replace(/[“”]/g, '"')
        .replace(/[‘’]/g, "'")
        .replace(/\s+/g, ' ')
        .trim();
}

function isEmptyRemaining(text: string): boolean {
    return /^(?:none|nothing|n\/a|no remaining work|no work remains|complete|done|all done)[.!]*$/.test(text);
}
