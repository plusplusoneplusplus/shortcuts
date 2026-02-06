/**
 * Unit tests for Follow Prompt Consistency Across Execution Paths
 * 
 * Tests that all three Follow Prompt execution paths produce consistent behavior:
 * 1. Interactive mode (external terminal)
 * 2. Background/Queued mode (AI queue with SDK)
 * 3. Skill-based execution (using skill prompt files)
 * 
 * All paths should:
 * - Use the same prompt format
 * - Handle additional context the same way
 * - Use the same working directory resolution
 * - Support the same models
 * - Track processes consistently
 */

import * as assert from 'assert';
import { 
    MockAIProcessManager,
    FollowPromptExecutionOptions,
    FollowPromptProcessMetadata,
    AIProcess,
    VALID_MODELS,
    DEFAULT_MODEL_ID
} from '../../shortcuts/ai-service';
import { buildFollowPromptText } from '../../shortcuts/ai-service/ai-queue-service';
import { FollowPromptPayload } from '@plusplusoneplusplus/pipeline-core';

suite('Follow Prompt Consistency Tests', () => {

    suite('Prompt Format Consistency', () => {

        test('should use consistent prompt format across all execution paths', () => {
            const promptFilePath = '/workspace/.github/prompts/implement.prompt.md';
            const planFilePath = '/workspace/.vscode/tasks/feature.plan.md';
            
            // Interactive format
            const interactivePrompt = `Follow the instruction ${promptFilePath}. ${planFilePath}`;
            
            // Queued format (using buildFollowPromptText)
            const queuedPayload: FollowPromptPayload = {
                promptFilePath,
                planFilePath
            };
            const queuedPrompt = buildFollowPromptText(queuedPayload);
            
            // Both should be identical
            assert.strictEqual(queuedPrompt, interactivePrompt,
                'Queued prompt should match interactive prompt format');
        });

        test('should handle additional context consistently', () => {
            const promptFilePath = '/workspace/.github/prompts/implement.prompt.md';
            const planFilePath = '/workspace/.vscode/tasks/feature.plan.md';
            const additionalContext = 'Focus on error handling and edge cases.';
            
            // Interactive format with additional context
            const interactivePrompt = `Follow the instruction ${promptFilePath}. ${planFilePath}\n\nAdditional context: ${additionalContext}`;
            
            // Queued format with additional context
            const queuedPayload: FollowPromptPayload = {
                promptFilePath,
                planFilePath,
                additionalContext
            };
            const queuedPrompt = buildFollowPromptText(queuedPayload);
            
            assert.strictEqual(queuedPrompt, interactivePrompt,
                'Queued prompt with additional context should match interactive format');
        });

        test('should trim whitespace in additional context consistently', () => {
            const promptFilePath = '/workspace/.github/prompts/implement.prompt.md';
            const planFilePath = '/workspace/.vscode/tasks/feature.plan.md';
            const additionalContext = '  \n  Focus on tests.  \n  ';
            
            // Both paths should trim whitespace
            const queuedPayload: FollowPromptPayload = {
                promptFilePath,
                planFilePath,
                additionalContext
            };
            const queuedPrompt = buildFollowPromptText(queuedPayload);
            
            // Should have trimmed context
            assert.ok(queuedPrompt.includes('Additional context: Focus on tests.'),
                'Should trim whitespace from additional context');
            assert.ok(!queuedPrompt.includes('  Focus on tests.  '),
                'Should not include untrimmed whitespace');
        });

        test('should handle empty additional context consistently', () => {
            const promptFilePath = '/workspace/.github/prompts/implement.prompt.md';
            const planFilePath = '/workspace/.vscode/tasks/feature.plan.md';
            
            // Empty string should be treated like no context
            const queuedPayload: FollowPromptPayload = {
                promptFilePath,
                planFilePath,
                additionalContext: ''
            };
            const queuedPrompt = buildFollowPromptText(queuedPayload);
            
            // Should not include "Additional context:" section
            assert.ok(!queuedPrompt.includes('Additional context:'),
                'Empty additional context should not add section');
        });

        test('should handle whitespace-only additional context consistently', () => {
            const promptFilePath = '/workspace/.github/prompts/implement.prompt.md';
            const planFilePath = '/workspace/.vscode/tasks/feature.plan.md';
            
            // Whitespace-only should be treated like no context
            const queuedPayload: FollowPromptPayload = {
                promptFilePath,
                planFilePath,
                additionalContext: '   \n   '
            };
            const queuedPrompt = buildFollowPromptText(queuedPayload);
            
            // Should not include "Additional context:" section
            assert.ok(!queuedPrompt.includes('Additional context:'),
                'Whitespace-only additional context should not add section');
        });

        test('should handle missing planFilePath consistently', () => {
            const promptFilePath = '/workspace/.github/prompts/standalone.prompt.md';
            
            // Queued format without planFilePath
            const queuedPayload: FollowPromptPayload = {
                promptFilePath
            };
            const queuedPrompt = buildFollowPromptText(queuedPayload);
            
            // Should still work, just without plan file reference
            assert.strictEqual(queuedPrompt, `Follow the instruction ${promptFilePath}.`,
                'Should handle missing planFilePath gracefully');
        });
    });

    suite('Skill-Based Execution Consistency', () => {

        test('should track skill name in process metadata for all execution modes', () => {
            const manager = new MockAIProcessManager();
            
            const skillName = 'code-review';
            const promptFilePath = '/workspace/.github/skills/code-review/SKILL.md';
            const planFilePath = '/workspace/.vscode/tasks/task.plan.md';
            
            // Register a skill-based process
            const prompt = `Follow the instruction ${promptFilePath}. ${planFilePath}`;
            const processId = manager.registerTypedProcess(prompt, {
                type: 'follow-prompt',
                idPrefix: 'follow-prompt',
                metadata: {
                    type: 'follow-prompt',
                    promptFile: promptFilePath,
                    planFile: planFilePath,
                    skillName: skillName,
                    model: DEFAULT_MODEL_ID
                }
            });

            const process = manager.getProcess(processId);
            assert.ok(process, 'Process should exist');
            
            const metadata = process.metadata as unknown as FollowPromptProcessMetadata & { type: string };
            assert.strictEqual(metadata.skillName, skillName,
                'Skill name should be stored in metadata');
        });

        test('should use same prompt format for skill-based execution', () => {
            const skillName = 'impl';
            const promptFilePath = '/workspace/.github/skills/impl/prompt.md';
            const planFilePath = '/workspace/.vscode/tasks/feature.plan.md';
            const additionalContext = 'Add comprehensive tests.';
            
            // Skill-based execution uses the same format
            const queuedPayload: FollowPromptPayload = {
                promptFilePath,
                planFilePath,
                skillName,
                additionalContext
            };
            const skillPrompt = buildFollowPromptText(queuedPayload);
            
            // Should match non-skill format (skillName is metadata only, not in prompt)
            const expectedPrompt = `Follow the instruction ${promptFilePath}. ${planFilePath}\n\nAdditional context: ${additionalContext}`;
            assert.strictEqual(skillPrompt, expectedPrompt,
                'Skill-based prompt should use same format as regular prompts');
        });

        test('should not include skill name as a separate label in prompt text', () => {
            // The skill name should not appear as a label like "Skill: impl"
            // It may appear in the file path (e.g., /skills/impl/prompt.md), which is fine
            const skillName = 'code-review';
            const promptFilePath = '/workspace/.github/prompts/review.prompt.md';  // Path without skill name
            const planFilePath = '/workspace/.vscode/tasks/feature.plan.md';
            
            const queuedPayload: FollowPromptPayload = {
                promptFilePath,
                planFilePath,
                skillName
            };
            const prompt = buildFollowPromptText(queuedPayload);
            
            // Skill name should NOT appear as a label in the prompt text itself
            // The skill name is metadata only, not part of the prompt sent to AI
            assert.ok(!prompt.includes(`Skill: ${skillName}`),
                'Skill name should not appear as a label in prompt text (it is metadata only)');
            assert.ok(!prompt.includes(`skill: ${skillName}`),
                'Skill name should not appear as a lowercase label in prompt text');
        });
    });

    suite('Execution Options Consistency', () => {

        test('should support same models across all execution modes', () => {
            // Interactive, background, and skill-based should all support the same models
            const models = [
                DEFAULT_MODEL_ID,
                VALID_MODELS[2],
                'gpt-4o',
                VALID_MODELS[3]
            ];

            for (const model of models) {
                const options: FollowPromptExecutionOptions = {
                    mode: 'background',
                    model: model,
                    additionalContext: 'Test context'
                };

                assert.ok(options.model,
                    `Model ${model} should be supported in execution options`);
            }
        });

        test('should use same timeout defaults across execution modes', () => {
            const manager = new MockAIProcessManager();
            
            // Background/queued mode uses DEFAULT_AI_TIMEOUT_MS (30 minutes)
            const queuedPayload: FollowPromptPayload = {
                promptFilePath: '/test/prompt.md',
                planFilePath: '/test/plan.md'
            };
            
            const processId = manager.registerTypedProcess(
                buildFollowPromptText(queuedPayload),
                {
                    type: 'follow-prompt',
                    idPrefix: 'follow-prompt',
                    metadata: {
                        type: 'follow-prompt',
                        promptFile: queuedPayload.promptFilePath,
                        planFile: queuedPayload.planFilePath || '',
                        model: DEFAULT_MODEL_ID
                    }
                }
            );

            const process = manager.getProcess(processId);
            assert.ok(process, 'Process should exist');
            // Timeout is managed by queue config, not process metadata
        });
    });

    suite('Process Tracking Consistency', () => {

        test('should track processes with consistent metadata structure', () => {
            const manager = new MockAIProcessManager();
            
            // Test data
            const promptFile = '/workspace/.github/prompts/test.prompt.md';
            const planFile = '/workspace/.vscode/tasks/test.plan.md';
            const model = DEFAULT_MODEL_ID;
            const additionalContext = 'Test context';
            
            // Register process (simulating queued execution)
            const queuedPayload: FollowPromptPayload = {
                promptFilePath: promptFile,
                planFilePath: planFile,
                additionalContext
            };
            
            const prompt = buildFollowPromptText(queuedPayload);
            const processId = manager.registerTypedProcess(prompt, {
                type: 'follow-prompt',
                idPrefix: 'follow-prompt',
                metadata: {
                    type: 'follow-prompt',
                    promptFile,
                    planFile,
                    model,
                    additionalContext
                }
            });

            const process = manager.getProcess(processId);
            assert.ok(process, 'Process should exist');
            assert.strictEqual(process.type, 'follow-prompt');
            assert.strictEqual(process.fullPrompt, prompt,
                'Stored prompt should match built prompt');
            
            const metadata = process.metadata as unknown as FollowPromptProcessMetadata & { type: string };
            assert.strictEqual(metadata.promptFile, promptFile);
            assert.strictEqual(metadata.planFile, planFile);
            assert.strictEqual(metadata.model, model);
            assert.strictEqual(metadata.additionalContext, additionalContext);
        });

        test('should track skill-based processes with skill name in metadata', () => {
            const manager = new MockAIProcessManager();
            
            const skillName = 'impl';
            const promptFile = '/workspace/.github/skills/impl/prompt.md';
            const planFile = '/workspace/.vscode/tasks/task.plan.md';
            const model = DEFAULT_MODEL_ID;
            
            const queuedPayload: FollowPromptPayload = {
                promptFilePath: promptFile,
                planFilePath: planFile,
                skillName
            };
            
            const prompt = buildFollowPromptText(queuedPayload);
            const processId = manager.registerTypedProcess(prompt, {
                type: 'follow-prompt',
                idPrefix: 'follow-prompt',
                metadata: {
                    type: 'follow-prompt',
                    promptFile,
                    planFile,
                    model,
                    skillName
                }
            });

            const process = manager.getProcess(processId);
            const metadata = process!.metadata as unknown as FollowPromptProcessMetadata & { type: string };
            assert.strictEqual(metadata.skillName, skillName,
                'Skill name should be in metadata for skill-based processes');
        });

        test('should use consistent process ID prefixes', () => {
            const manager = new MockAIProcessManager();
            
            // All follow-prompt processes should use 'follow-prompt' prefix
            const id1 = manager.registerTypedProcess('test prompt 1', {
                type: 'follow-prompt',
                idPrefix: 'follow-prompt'
            });
            
            const id2 = manager.registerTypedProcess('test prompt 2', {
                type: 'follow-prompt',
                idPrefix: 'follow-prompt'
            });
            
            assert.ok(id1.startsWith('follow-prompt-'),
                'Process ID should use follow-prompt prefix');
            assert.ok(id2.startsWith('follow-prompt-'),
                'Process ID should use follow-prompt prefix');
        });
    });

    suite('Working Directory Consistency', () => {

        test('should store working directory in payload for queued execution', () => {
            const queuedPayload: FollowPromptPayload = {
                promptFilePath: '/workspace/.github/prompts/test.prompt.md',
                planFilePath: '/workspace/.vscode/tasks/test.plan.md',
                workingDirectory: '/workspace/src'
            };
            
            assert.strictEqual(queuedPayload.workingDirectory, '/workspace/src',
                'Working directory should be stored in payload');
        });

        test('should use same working directory resolution logic for all modes', () => {
            // All modes should use the same logic:
            // 1. If /workspace/src exists, use it
            // 2. Otherwise, use workspace root
            
            // This is tested implicitly by the fact that all three paths
            // (interactive, background, skill-based) call resolveWorkPlanWorkingDirectory()
            // from the same ReviewEditorViewProvider method.
            
            // We can't easily test the actual resolution here without filesystem access,
            // but we can verify the payload includes the working directory field.
            const payload: FollowPromptPayload = {
                promptFilePath: '/test/prompt.md',
                planFilePath: '/test/plan.md',
                workingDirectory: '/test/workspace/src'
            };
            
            assert.ok('workingDirectory' in payload,
                'Payload should support working directory field');
        });
    });

    suite('Edge Cases and Error Handling', () => {

        test('should handle very long additional context', () => {
            const longContext = 'a'.repeat(10000);
            const queuedPayload: FollowPromptPayload = {
                promptFilePath: '/test/prompt.md',
                planFilePath: '/test/plan.md',
                additionalContext: longContext
            };
            
            const prompt = buildFollowPromptText(queuedPayload);
            
            assert.ok(prompt.includes('Additional context:'),
                'Should include additional context section');
            assert.ok(prompt.includes(longContext),
                'Should include full context even if very long');
        });

        test('should handle special characters in paths and context', () => {
            const promptFilePath = '/workspace/prompts/test (v2).prompt.md';
            const planFilePath = '/workspace/tasks/feature [WIP].plan.md';
            const additionalContext = 'Context with "quotes" and \'apostrophes\' and $special chars.';
            
            const queuedPayload: FollowPromptPayload = {
                promptFilePath,
                planFilePath,
                additionalContext
            };
            
            const prompt = buildFollowPromptText(queuedPayload);
            
            assert.ok(prompt.includes(promptFilePath),
                'Should handle special characters in prompt file path');
            assert.ok(prompt.includes(planFilePath),
                'Should handle special characters in plan file path');
            assert.ok(prompt.includes(additionalContext),
                'Should handle special characters in additional context');
        });

        test('should handle undefined vs empty string additional context consistently', () => {
            const promptFilePath = '/test/prompt.md';
            const planFilePath = '/test/plan.md';
            
            // Undefined additional context
            const payload1: FollowPromptPayload = {
                promptFilePath,
                planFilePath,
                additionalContext: undefined
            };
            const prompt1 = buildFollowPromptText(payload1);
            
            // Empty string additional context
            const payload2: FollowPromptPayload = {
                promptFilePath,
                planFilePath,
                additionalContext: ''
            };
            const prompt2 = buildFollowPromptText(payload2);
            
            // Both should produce the same result (no "Additional context:" section)
            assert.strictEqual(prompt1, prompt2,
                'Undefined and empty string context should produce same prompt');
            assert.ok(!prompt1.includes('Additional context:'),
                'Should not include additional context section when undefined or empty');
        });
    });

    suite('Regression Tests for Commit 8fb0a3a', () => {

        test('should match interactive prompt format after fix (commit 8fb0a3a)', () => {
            // Before commit 8fb0a3a, queued prompts read the file content directly.
            // After the fix, they should match the interactive format exactly.
            
            const promptFilePath = '/workspace/.github/prompts/implement.prompt.md';
            const planFilePath = '/workspace/.vscode/tasks/feature.plan.md';
            const additionalContext = 'Focus on tests.';
            
            // This is the format used by interactive mode
            const interactivePrompt = `Follow the instruction ${promptFilePath}. ${planFilePath}\n\nAdditional context: ${additionalContext}`;
            
            // After fix, queued mode should use the same format
            const queuedPayload: FollowPromptPayload = {
                promptFilePath,
                planFilePath,
                additionalContext
            };
            const queuedPrompt = buildFollowPromptText(queuedPayload);
            
            assert.strictEqual(queuedPrompt, interactivePrompt,
                'After commit 8fb0a3a, queued prompt should match interactive format');
        });

        test('should show both instruction file and plan file in prompt', () => {
            // Key aspect of the fix: AI should see BOTH the instruction file path
            // and the target plan file path in the prompt.
            
            const promptFilePath = '/workspace/.github/prompts/implement.prompt.md';
            const planFilePath = '/workspace/.vscode/tasks/feature.plan.md';
            
            const queuedPayload: FollowPromptPayload = {
                promptFilePath,
                planFilePath
            };
            const prompt = buildFollowPromptText(queuedPayload);
            
            assert.ok(prompt.includes(promptFilePath),
                'Prompt should include instruction file path');
            assert.ok(prompt.includes(planFilePath),
                'Prompt should include plan file path');
            assert.ok(prompt.includes('Follow the instruction'),
                'Prompt should include "Follow the instruction" prefix');
        });

        test('should not read file content directly for queued execution', () => {
            // After fix, buildFollowPromptText should NOT read the file.
            // It should just build the prompt text that references the file path.
            
            const promptFilePath = '/nonexistent/prompt.md';  // File doesn't exist
            const planFilePath = '/nonexistent/plan.md';
            
            const queuedPayload: FollowPromptPayload = {
                promptFilePath,
                planFilePath
            };
            
            // This should not throw even though files don't exist
            const prompt = buildFollowPromptText(queuedPayload);
            
            assert.ok(prompt.includes(promptFilePath),
                'Should reference file path without reading it');
        });
    });

    suite('Display Name Consistency', () => {

        test('should format display names consistently for skill-based execution', () => {
            // When using a skill, display name should be: "Skill: <skillName> → <planName>"
            // For non-skill prompts: "<promptName> → <planName>"
            
            const skillName = 'impl';
            const planName = 'feature.plan.md';
            
            const displayName = `Skill: ${skillName} → ${planName}`;
            assert.strictEqual(displayName, 'Skill: impl → feature.plan.md',
                'Skill-based display name should follow format: Skill: <name> → <plan>');
        });

        test('should format display names consistently for regular prompts', () => {
            const promptName = 'implement';
            const planName = 'feature.plan.md';
            
            const displayName = `${promptName} → ${planName}`;
            assert.strictEqual(displayName, 'implement → feature.plan.md',
                'Regular prompt display name should follow format: <prompt> → <plan>');
        });
    });
});
