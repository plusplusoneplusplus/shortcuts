/**
 * Skill Section Extractor
 *
 * Some bundled skills (e.g. `ultra-ralph`, `dream`) pack multiple named prompt
 * blocks into a single SKILL.md using `## Section: <name>` headers. This helper
 * extracts the body of one such section: the text between its header and the
 * next `## Section:` header (or end of file), trimmed.
 *
 * The match is exact on the (trimmed) section name and is line-anchored so a
 * `## Section:` appearing mid-paragraph is not treated as a header.
 */

/** Error thrown when a requested skill section is not present. */
export class SkillSectionNotFoundError extends Error {
    readonly sectionName: string;

    constructor(sectionName: string) {
        super(`Skill section "${sectionName}" not found`);
        this.name = 'SkillSectionNotFoundError';
        this.sectionName = sectionName;
    }
}

interface SectionHeader {
    name: string;
    /** Offset where the header line begins. */
    headerStart: number;
    /** Offset immediately after the header line (where the section body begins). */
    contentStart: number;
}

const SECTION_HEADER_RE = /^##[ \t]+Section:[ \t]*(.+?)[ \t]*$/gm;

function findSectionHeaders(content: string): SectionHeader[] {
    const headers: SectionHeader[] = [];
    SECTION_HEADER_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = SECTION_HEADER_RE.exec(content)) !== null) {
        headers.push({
            name: match[1].trim(),
            headerStart: match.index,
            contentStart: SECTION_HEADER_RE.lastIndex,
        });
    }
    return headers;
}

/**
 * Extract the body of a `## Section: <name>` block from SKILL.md content.
 *
 * @param content Raw SKILL.md content (frontmatter may or may not be present).
 * @param sectionName The section name to extract (matched exactly after trimming).
 * @returns The trimmed section body.
 * @throws SkillSectionNotFoundError if the section is absent.
 */
export function extractSkillSection(content: string, sectionName: string): string {
    const normalized = content.replace(/\r\n/g, '\n');
    const target = sectionName.trim();
    const headers = findSectionHeaders(normalized);

    for (let i = 0; i < headers.length; i++) {
        if (headers[i].name !== target) {
            continue;
        }
        const start = headers[i].contentStart;
        const end = i + 1 < headers.length ? headers[i + 1].headerStart : normalized.length;
        return normalized.slice(start, end).trim();
    }

    throw new SkillSectionNotFoundError(target);
}
