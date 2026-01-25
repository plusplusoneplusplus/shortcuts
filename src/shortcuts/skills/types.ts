/**
 * Types and interfaces for the Skills module
 */

/**
 * Source type for skill installation
 */
export type SkillSourceType = 'github' | 'local';

/**
 * Represents a discovered skill from a source
 */
export interface DiscoveredSkill {
    /** Skill name (directory name) */
    name: string;
    /** Description extracted from SKILL.md */
    description?: string;
    /** Full path to the skill directory (local) or relative path (GitHub) */
    path: string;
    /** Whether this skill already exists in the target location */
    alreadyExists?: boolean;
}

/**
 * Result of parsing a source input
 */
export interface ParsedSource {
    /** Type of source */
    type: SkillSourceType;
    /** For GitHub: parsed URL components */
    github?: {
        owner: string;
        repo: string;
        branch: string;
        path: string;
    };
    /** For local: resolved absolute path */
    localPath?: string;
}

/**
 * Result of scanning a source for skills
 */
export interface ScanResult {
    /** Whether the scan was successful */
    success: boolean;
    /** Error message if scan failed */
    error?: string;
    /** Discovered skills */
    skills: DiscoveredSkill[];
}

/**
 * Result of installing skills
 */
export interface InstallResult {
    /** Number of skills successfully installed */
    installed: number;
    /** Number of skills skipped (already exist, user declined) */
    skipped: number;
    /** Number of skills that failed to install */
    failed: number;
    /** Details about each skill installation */
    details: InstallDetail[];
}

/**
 * Detail about a single skill installation
 */
export interface InstallDetail {
    /** Skill name */
    name: string;
    /** Whether installation was successful */
    success: boolean;
    /** Reason for failure or skip */
    reason?: string;
    /** Action taken: 'installed', 'replaced', 'skipped', 'failed' */
    action: 'installed' | 'replaced' | 'skipped' | 'failed';
}

/**
 * Settings for skills installation
 */
export interface SkillsSettings {
    /** Path to install skills (relative to workspace root) */
    installPath: string;
}

/**
 * Default settings
 */
export const DEFAULT_SKILLS_SETTINGS: SkillsSettings = {
    installPath: '.github/skills'
};
