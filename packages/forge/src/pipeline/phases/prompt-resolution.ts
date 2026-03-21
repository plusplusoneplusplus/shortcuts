/**
 * Pipeline Prompt Resolution
 *
 * Resolves prompts from inline text, files, or skills.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import path from 'node:path';
import { resolvePromptFile } from '../prompt-resolver';
import { resolveSkill } from '../skill-resolver';
import { PipelineExecutionError, MapReducePipelineConfig, ResolvedPrompts } from './shared';

/**
 * Derive workspace root from pipeline directory if not provided.
 * Assumes standard structure: {workspaceRoot}/.vscode/pipelines/{package}/
 */
export function deriveWorkspaceRoot(pipelineDirectory: string, providedWorkspaceRoot?: string): string {
    if (providedWorkspaceRoot) {
        return providedWorkspaceRoot;
    }
    // Go up from pipeline package directory to workspace root
    // .vscode/pipelines/my-pipeline/ -> workspace root (3 levels up)
    return path.resolve(pipelineDirectory, '..', '..', '..');
}

/**
 * Build a prompt with optional skill context prepended
 * 
 * When a skill is attached, the skill's prompt content is prepended as guidance:
 * ```
 * [Skill Guidance: {skillName}]
 * {skill prompt content}
 * 
 * [Task]
 * {main prompt}
 * ```
 */
export function buildPromptWithSkill(mainPrompt: string, skillContent?: string, skillName?: string): string {
    if (!skillContent || !skillName) {
        return mainPrompt;
    }
    
    return `[Skill Guidance: ${skillName}]
${skillContent}

[Task]
${mainPrompt}`;
}

/**
 * Resolve all prompts from config (either inline or from files, with optional skill context)
 */
export async function resolvePrompts(
    config: MapReducePipelineConfig,
    pipelineDirectory: string,
    workspaceRoot?: string
): Promise<ResolvedPrompts> {
    const effectiveWorkspaceRoot = deriveWorkspaceRoot(pipelineDirectory, workspaceRoot);
    
    let mapPrompt: string;
    try {
        // Resolve main prompt (either inline or from file)
        let mainMapPrompt: string;
        if (config.map.prompt) {
            mainMapPrompt = config.map.prompt;
        } else if (config.map.promptFile) {
            mainMapPrompt = await resolvePromptFile(config.map.promptFile, pipelineDirectory);
        } else {
            throw new PipelineExecutionError('Map phase must have either "prompt" or "promptFile"', 'map');
        }
        
        // Optionally load and attach skill context
        let skillContent: string | undefined;
        if (config.map.skill) {
            try {
                skillContent = await resolveSkill(config.map.skill, effectiveWorkspaceRoot);
            } catch (error) {
                throw new PipelineExecutionError(
                    `Failed to resolve map skill "${config.map.skill}": ${error instanceof Error ? error.message : String(error)}`,
                    'map'
                );
            }
        }
        
        mapPrompt = buildPromptWithSkill(mainMapPrompt, skillContent, config.map.skill);
    } catch (error) {
        if (error instanceof PipelineExecutionError) {
            throw error;
        }
        throw new PipelineExecutionError(
            `Failed to resolve map prompt: ${error instanceof Error ? error.message : String(error)}`,
            'map'
        );
    }

    let reducePrompt: string | undefined;
    if (config.reduce.type === 'ai') {
        try {
            // Resolve main reduce prompt (either inline or from file)
            let mainReducePrompt: string;
            if (config.reduce.prompt) {
                mainReducePrompt = config.reduce.prompt;
            } else if (config.reduce.promptFile) {
                mainReducePrompt = await resolvePromptFile(config.reduce.promptFile, pipelineDirectory);
            } else {
                throw new PipelineExecutionError('AI reduce must have either "prompt" or "promptFile"', 'reduce');
            }
            
            // Optionally load and attach skill context
            let skillContent: string | undefined;
            if (config.reduce.skill) {
                try {
                    skillContent = await resolveSkill(config.reduce.skill, effectiveWorkspaceRoot);
                } catch (error) {
                    throw new PipelineExecutionError(
                        `Failed to resolve reduce skill "${config.reduce.skill}": ${error instanceof Error ? error.message : String(error)}`,
                        'reduce'
                    );
                }
            }
            
            reducePrompt = buildPromptWithSkill(mainReducePrompt, skillContent, config.reduce.skill);
        } catch (error) {
            if (error instanceof PipelineExecutionError) {
                throw error;
            }
            throw new PipelineExecutionError(
                `Failed to resolve reduce prompt: ${error instanceof Error ? error.message : String(error)}`,
                'reduce'
            );
        }
    }

    return { mapPrompt, reducePrompt };
}
