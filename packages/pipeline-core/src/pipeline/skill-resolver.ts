/**
 * Skill Resolver
 *
 * Resolves and loads skill prompts from the .github/skills/ directory.
 * Skills are organized as directories containing a SKILL.md file.
 *
 * Skill Structure:
 * .github/skills/
 * ├── go-deep/
 * │   └── SKILL.md              # THE prompt/skill definition (required)
 * ├── summarizer/
 * │   └── SKILL.md
 *
 * Resolution: skill: "go-deep" → .github/skills/go-deep/SKILL.md
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as fs from 'fs';
import * as path from 'path';
import { extractPromptContent } from './prompt-resolver';
import { DEFAULT_SKILLS_DIRECTORY as SKILLS_DIR_DEFAULT } from '../config/defaults';
import { PipelineCoreError, ErrorCode } from '../errors';

// Re-export for backward compatibility
export const DEFAULT_SKILLS_DIRECTORY = SKILLS_DIR_DEFAULT;

/**
 * Standard skill filename within a skill directory (required)
 */
export const SKILL_PROMPT_FILENAME = 'SKILL.md';

/**
 * Error thrown for skill resolution issues
 */
export class SkillResolverError extends PipelineCoreError {
    /** Name of the skill that failed to resolve */
    readonly skillName: string;
    /** Path that was searched */
    readonly searchedPath?: string;

    constructor(
        message: string,
        skillName: string,
        searchedPath?: string
    ) {
        super(message, {
            code: ErrorCode.SKILL_RESOLUTION_FAILED,
            meta: {
                skillName,
                ...(searchedPath && { searchedPath }),
            },
        });
        this.name = 'SkillResolverError';
        this.skillName = skillName;
        this.searchedPath = searchedPath;
    }
}

/**
 * Result of skill resolution
 */
export interface SkillResolutionResult {
    /** The resolved prompt content (frontmatter stripped) */
    content: string;
    /** The absolute path to the skill's SKILL.md */
    resolvedPath: string;
    /** The skill directory path */
    skillDirectory: string;
    /** Whether frontmatter was stripped from the prompt */
    hadFrontmatter: boolean;
    /** Skill metadata from SKILL.md frontmatter */
    metadata?: SkillMetadata;
}

/**
 * Skill metadata parsed from SKILL.md frontmatter
 */
export interface SkillMetadata {
    /** Skill name (from frontmatter or directory name) */
    name?: string;
    /** Skill description */
    description?: string;
    /** Skill version */
    version?: string;
    /** Expected input variables */
    variables?: string[];
    /** Expected output fields */
    output?: string[];
    /** Raw metadata content */
    raw?: string;
}

/**
 * Get the skills directory path
 * 
 * @param workspaceRoot The workspace root directory
 * @param customPath Optional custom skills directory path (relative or absolute)
 * @returns Absolute path to the skills directory
 */
export function getSkillsDirectory(workspaceRoot: string, customPath?: string): string {
    if (customPath) {
        if (path.isAbsolute(customPath)) {
            return customPath;
        }
        return path.resolve(workspaceRoot, customPath);
    }
    return path.resolve(workspaceRoot, DEFAULT_SKILLS_DIRECTORY);
}

/**
 * Get the path to a specific skill's directory
 * 
 * @param skillName Name of the skill
 * @param workspaceRoot The workspace root directory
 * @param customSkillsPath Optional custom skills directory path
 * @returns Absolute path to the skill directory
 */
export function getSkillDirectory(
    skillName: string,
    workspaceRoot: string,
    customSkillsPath?: string
): string {
    const skillsDir = getSkillsDirectory(workspaceRoot, customSkillsPath);
    return path.join(skillsDir, skillName);
}

/**
 * Get the path to a skill's SKILL.md file
 * 
 * @param skillName Name of the skill
 * @param workspaceRoot The workspace root directory
 * @param customSkillsPath Optional custom skills directory path
 * @returns Absolute path to the skill's SKILL.md file
 */
export function getSkillPromptPath(
    skillName: string,
    workspaceRoot: string,
    customSkillsPath?: string
): string {
    const skillDir = getSkillDirectory(skillName, workspaceRoot, customSkillsPath);
    return path.join(skillDir, SKILL_PROMPT_FILENAME);
}

/**
 * Check if a skill exists
 * 
 * @param skillName Name of the skill
 * @param workspaceRoot The workspace root directory
 * @param customSkillsPath Optional custom skills directory path
 * @returns True if the skill's SKILL.md exists
 */
export function skillExists(
    skillName: string,
    workspaceRoot: string,
    customSkillsPath?: string
): boolean {
    const promptPath = getSkillPromptPath(skillName, workspaceRoot, customSkillsPath);
    return fs.existsSync(promptPath);
}

/**
 * List all available skills
 * 
 * @param workspaceRoot The workspace root directory
 * @param customSkillsPath Optional custom skills directory path
 * @returns Array of skill names
 */
export function listSkills(
    workspaceRoot: string,
    customSkillsPath?: string
): string[] {
    const skillsDir = getSkillsDirectory(workspaceRoot, customSkillsPath);
    
    if (!fs.existsSync(skillsDir)) {
        return [];
    }

    try {
        const entries = fs.readdirSync(skillsDir, { withFileTypes: true });
        return entries
            .filter(entry => {
                if (!entry.isDirectory()) {
                    return false;
                }
                // Check if the directory contains a SKILL.md file
                const promptPath = path.join(skillsDir, entry.name, SKILL_PROMPT_FILENAME);
                return fs.existsSync(promptPath);
            })
            .map(entry => entry.name)
            .sort();
    } catch {
        return [];
    }
}

/**
 * Parse skill metadata from SKILL.md content
 * 
 * @param content Raw SKILL.md content
 * @returns Parsed metadata
 */
function parseSkillMetadata(content: string): SkillMetadata {
    const metadata: SkillMetadata = { raw: content };
    
    // Try to extract YAML frontmatter
    const frontmatterMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (frontmatterMatch) {
        const frontmatter = frontmatterMatch[1];
        
        // Simple YAML parsing for common fields
        const nameMatch = frontmatter.match(/^name:\s*["']?(.+?)["']?\s*$/m);
        if (nameMatch) metadata.name = nameMatch[1];
        
        const descMatch = frontmatter.match(/^description:\s*["']?(.+?)["']?\s*$/m);
        if (descMatch) metadata.description = descMatch[1];
        
        const versionMatch = frontmatter.match(/^version:\s*["']?(.+?)["']?\s*$/m);
        if (versionMatch) metadata.version = versionMatch[1];
        
        // Parse variables array
        const variablesMatch = frontmatter.match(/^variables:\s*\[([^\]]+)\]/m);
        if (variablesMatch) {
            metadata.variables = variablesMatch[1]
                .split(',')
                .map(v => v.trim().replace(/["']/g, ''))
                .filter(v => v.length > 0);
        }
        
        // Parse output array
        const outputMatch = frontmatter.match(/^output:\s*\[([^\]]+)\]/m);
        if (outputMatch) {
            metadata.output = outputMatch[1]
                .split(',')
                .map(v => v.trim().replace(/["']/g, ''))
                .filter(v => v.length > 0);
        }
    }
    
    return metadata;
}

/**
 * Load skill metadata from SKILL.md file content
 * 
 * @param fileContent The content of the SKILL.md file
 * @returns Skill metadata parsed from frontmatter
 */
function loadSkillMetadataFromContent(fileContent: string): SkillMetadata | undefined {
    if (!fileContent) {
        return undefined;
    }
    
    try {
        return parseSkillMetadata(fileContent);
    } catch {
        return undefined;
    }
}

/**
 * Resolve and load a skill's prompt
 * 
 * This is the main API for loading skill prompts.
 * 
 * @param skillName Name of the skill (e.g., "go-deep")
 * @param workspaceRoot The workspace root directory
 * @param customSkillsPath Optional custom skills directory path
 * @returns Prompt content string (frontmatter stripped)
 * @throws SkillResolverError if skill not found or empty
 * 
 * @example
 * // Load a skill prompt
 * const prompt = await resolveSkill('go-deep', '/path/to/workspace');
 */
export async function resolveSkill(
    skillName: string,
    workspaceRoot: string,
    customSkillsPath?: string
): Promise<string> {
    const result = await resolveSkillWithDetails(skillName, workspaceRoot, customSkillsPath);
    return result.content;
}

/**
 * Resolve and load a skill's prompt synchronously
 * 
 * @param skillName Name of the skill
 * @param workspaceRoot The workspace root directory
 * @param customSkillsPath Optional custom skills directory path
 * @returns Prompt content string (frontmatter stripped)
 * @throws SkillResolverError if skill not found or empty
 */
export function resolveSkillSync(
    skillName: string,
    workspaceRoot: string,
    customSkillsPath?: string
): string {
    const result = resolveSkillWithDetailsSync(skillName, workspaceRoot, customSkillsPath);
    return result.content;
}

/**
 * Resolve and load a skill with full details
 * 
 * @param skillName Name of the skill
 * @param workspaceRoot The workspace root directory
 * @param customSkillsPath Optional custom skills directory path
 * @returns Full resolution result with content, paths, and metadata
 * @throws SkillResolverError if skill not found or empty
 */
export async function resolveSkillWithDetails(
    skillName: string,
    workspaceRoot: string,
    customSkillsPath?: string
): Promise<SkillResolutionResult> {
    // Validate skill name
    if (!skillName || typeof skillName !== 'string') {
        throw new SkillResolverError('Skill name must be a non-empty string', skillName || '');
    }
    
    // Sanitize skill name (prevent path traversal)
    if (skillName.includes('/') || skillName.includes('\\') || skillName.includes('..')) {
        throw new SkillResolverError(
            `Invalid skill name "${skillName}": skill names cannot contain path separators or ".."`,
            skillName
        );
    }
    
    const skillDirectory = getSkillDirectory(skillName, workspaceRoot, customSkillsPath);
    const promptPath = path.join(skillDirectory, SKILL_PROMPT_FILENAME);
    
    // Check if skill directory exists
    if (!fs.existsSync(skillDirectory)) {
        const skillsDir = getSkillsDirectory(workspaceRoot, customSkillsPath);
        throw new SkillResolverError(
            `Skill "${skillName}" not found. Expected directory: ${skillDirectory}\n` +
            `Skills should be located in: ${skillsDir}`,
            skillName,
            skillDirectory
        );
    }
    
    // Check if SKILL.md exists
    if (!fs.existsSync(promptPath)) {
        throw new SkillResolverError(
            `Skill "${skillName}" is missing SKILL.md. Expected: ${promptPath}`,
            skillName,
            promptPath
        );
    }
    
    try {
        const fileContent = await fs.promises.readFile(promptPath, 'utf-8');
        const { content, hadFrontmatter } = extractPromptContent(fileContent);
        
        if (!content) {
            throw new SkillResolverError(
                `Skill "${skillName}" has empty SKILL.md after stripping frontmatter`,
                skillName,
                promptPath
            );
        }
        
        // Extract metadata from the same SKILL.md file content
        const metadata = loadSkillMetadataFromContent(fileContent);
        
        return {
            content,
            resolvedPath: promptPath,
            skillDirectory,
            hadFrontmatter,
            metadata
        };
    } catch (error) {
        if (error instanceof SkillResolverError) {
            throw error;
        }
        throw new SkillResolverError(
            `Failed to read skill "${skillName}": ${error instanceof Error ? error.message : String(error)}`,
            skillName,
            promptPath
        );
    }
}

/**
 * Resolve and load a skill with full details synchronously
 */
export function resolveSkillWithDetailsSync(
    skillName: string,
    workspaceRoot: string,
    customSkillsPath?: string
): SkillResolutionResult {
    // Validate skill name
    if (!skillName || typeof skillName !== 'string') {
        throw new SkillResolverError('Skill name must be a non-empty string', skillName || '');
    }
    
    // Sanitize skill name (prevent path traversal)
    if (skillName.includes('/') || skillName.includes('\\') || skillName.includes('..')) {
        throw new SkillResolverError(
            `Invalid skill name "${skillName}": skill names cannot contain path separators or ".."`,
            skillName
        );
    }
    
    const skillDirectory = getSkillDirectory(skillName, workspaceRoot, customSkillsPath);
    const promptPath = path.join(skillDirectory, SKILL_PROMPT_FILENAME);
    
    // Check if skill directory exists
    if (!fs.existsSync(skillDirectory)) {
        const skillsDir = getSkillsDirectory(workspaceRoot, customSkillsPath);
        throw new SkillResolverError(
            `Skill "${skillName}" not found. Expected directory: ${skillDirectory}\n` +
            `Skills should be located in: ${skillsDir}`,
            skillName,
            skillDirectory
        );
    }
    
    // Check if SKILL.md exists
    if (!fs.existsSync(promptPath)) {
        throw new SkillResolverError(
            `Skill "${skillName}" is missing SKILL.md. Expected: ${promptPath}`,
            skillName,
            promptPath
        );
    }
    
    try {
        const fileContent = fs.readFileSync(promptPath, 'utf-8');
        const { content, hadFrontmatter } = extractPromptContent(fileContent);
        
        if (!content) {
            throw new SkillResolverError(
                `Skill "${skillName}" has empty SKILL.md after stripping frontmatter`,
                skillName,
                promptPath
            );
        }
        
        // Extract metadata from the same SKILL.md file content
        const metadata = loadSkillMetadataFromContent(fileContent);
        
        return {
            content,
            resolvedPath: promptPath,
            skillDirectory,
            hadFrontmatter,
            metadata
        };
    } catch (error) {
        if (error instanceof SkillResolverError) {
            throw error;
        }
        throw new SkillResolverError(
            `Failed to read skill "${skillName}": ${error instanceof Error ? error.message : String(error)}`,
            skillName,
            promptPath
        );
    }
}

/**
 * Validate that a skill can be resolved (for config validation)
 * 
 * @param skillName Name of the skill
 * @param workspaceRoot The workspace root directory
 * @param customSkillsPath Optional custom skills directory path
 * @returns Validation result with error message if invalid
 */
export function validateSkill(
    skillName: string,
    workspaceRoot: string,
    customSkillsPath?: string
): { valid: boolean; error?: string; skillPath?: string } {
    try {
        const promptPath = getSkillPromptPath(skillName, workspaceRoot, customSkillsPath);
        
        // Validate skill name
        if (!skillName || typeof skillName !== 'string') {
            return { valid: false, error: 'Skill name must be a non-empty string' };
        }
        
        // Sanitize skill name
        if (skillName.includes('/') || skillName.includes('\\') || skillName.includes('..')) {
            return {
                valid: false,
                error: `Invalid skill name "${skillName}": skill names cannot contain path separators or ".."`
            };
        }
        
        if (!fs.existsSync(promptPath)) {
            const skillsDir = getSkillsDirectory(workspaceRoot, customSkillsPath);
            return {
                valid: false,
                error: `Skill "${skillName}" not found at ${promptPath}. Skills should be in ${skillsDir}`,
                skillPath: promptPath
            };
        }
        
        return { valid: true, skillPath: promptPath };
    } catch (error) {
        return {
            valid: false,
            error: error instanceof Error ? error.message : String(error)
        };
    }
}
