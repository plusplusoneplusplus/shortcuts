/**
 * Discovered prompt file metadata.
 *
 * Mirrors the extension's PromptFile type (src/shortcuts/shared/prompt-files-utils.ts:9-18)
 * but named PromptFileInfo to avoid ambiguity with pipeline's PromptResolutionResult.
 */
export interface PromptFileInfo {
    /** Absolute path to the .prompt.md file */
    absolutePath: string;
    /** Path relative to the rootDir passed to findPromptFiles() */
    relativePath: string;
    /** File name without .prompt.md suffix (e.g., "fix-bug" from "fix-bug.prompt.md") */
    name: string;
    /** The source folder this file was found in (the location string as passed to the finder) */
    sourceFolder: string;
}

/**
 * Discovered skill metadata.
 *
 * Extends the extension's Skill type (src/shortcuts/shared/skill-files-utils.ts:8-17)
 * with an optional description field parsed from SKILL.md YAML frontmatter.
 */
export interface SkillInfo {
    /** Absolute path to the skill directory (not SKILL.md itself) */
    absolutePath: string;
    /** Path relative to rootDir (e.g., ".github/skills/go-deep") */
    relativePath: string;
    /** Skill name — the directory name (e.g., "go-deep") */
    name: string;
    /** The base folder where skills are stored (e.g., ".github/skills") */
    sourceFolder: string;
    /** Description from SKILL.md YAML frontmatter, if present */
    description?: string;
}
