/**
 * Utilities for extracting skill versions from SKILL.md frontmatter.
 */

export const SKILL_FRONTMATTER_REGEX = /^---\r?\n([\s\S]*?)\r?\n---/;
export const TOP_LEVEL_VERSION_REGEX = /^version:\s*["']?(.+?)["']?\s*$/m;
export const METADATA_BLOCK_REGEX = /^metadata:\s*\r?\n((?:[ \t]+[^\r\n]+\r?\n?)*)/m;
export const METADATA_VERSION_REGEX = /^[ \t]+version:\s*["']?(.+?)["']?\s*$/m;

/**
 * Parse a version from a SKILL.md content string.
 *
 * Supports both top-level `version:` and nested `metadata:\n  version:`.
 * Top-level `version:` takes precedence when both are present.
 */
export function parseVersionFromFrontmatter(content: string): string | undefined {
    const fmMatch = content.match(SKILL_FRONTMATTER_REGEX);
    if (!fmMatch) return undefined;

    const frontmatter = fmMatch[1];

    const topLevel = frontmatter.match(TOP_LEVEL_VERSION_REGEX);
    if (topLevel) return topLevel[1];

    const metadataBlock = frontmatter.match(METADATA_BLOCK_REGEX);
    if (metadataBlock) {
        const versionInBlock = metadataBlock[1].match(METADATA_VERSION_REGEX);
        if (versionInBlock) return versionInBlock[1];
    }

    return undefined;
}
