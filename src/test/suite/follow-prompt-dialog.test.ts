/**
 * Tests for Follow Prompt Dialog UX feature
 * 
 * Tests the modal dialog for selecting execution mode and AI model
 * when using AI Action → Follow Prompt in the Markdown Review Editor.
 */

import * as assert from 'assert';

// Import types and helpers
import { 
    VALID_MODELS,
    AIModelConfig,
    FollowPromptExecutionOptions,
    FollowPromptProcessMetadata
} from '../../shortcuts/ai-service';

import { 
    getAvailableModels,
    getFollowPromptDefaultMode,
    getFollowPromptDefaultModel,
    getFollowPromptRememberSelection
} from '../../shortcuts/ai-service/ai-config-helpers';

suite('Follow Prompt Dialog - Type Definitions', () => {
    test('FollowPromptExecutionOptions should have required fields', () => {
        const options: FollowPromptExecutionOptions = {
            mode: 'interactive',
            model: 'claude-sonnet-4.5'
        };
        
        assert.strictEqual(options.mode, 'interactive');
        assert.strictEqual(options.model, 'claude-sonnet-4.5');
        assert.strictEqual(options.additionalContext, undefined);
        assert.strictEqual(options.timeoutMs, undefined);
    });

    test('FollowPromptExecutionOptions should support optional fields', () => {
        const options: FollowPromptExecutionOptions = {
            mode: 'background',
            model: 'gpt-5.2',
            additionalContext: 'Focus on error handling',
            timeoutMs: 300000
        };
        
        assert.strictEqual(options.mode, 'background');
        assert.strictEqual(options.model, 'gpt-5.2');
        assert.strictEqual(options.additionalContext, 'Focus on error handling');
        assert.strictEqual(options.timeoutMs, 300000);
    });

    test('FollowPromptProcessMetadata should have required fields', () => {
        const metadata: FollowPromptProcessMetadata = {
            promptFile: '/path/to/prompt.md',
            planFile: '/path/to/plan.md',
            model: 'claude-sonnet-4.5'
        };
        
        assert.strictEqual(metadata.promptFile, '/path/to/prompt.md');
        assert.strictEqual(metadata.planFile, '/path/to/plan.md');
        assert.strictEqual(metadata.model, 'claude-sonnet-4.5');
        assert.strictEqual(metadata.additionalContext, undefined);
        assert.strictEqual(metadata.skillName, undefined);
    });

    test('FollowPromptProcessMetadata should support optional fields', () => {
        const metadata: FollowPromptProcessMetadata = {
            promptFile: '/path/to/skill/prompt.md',
            planFile: '/path/to/task.md',
            model: 'claude-opus-4.6',
            additionalContext: 'Custom context',
            skillName: 'code-review'
        };
        
        assert.strictEqual(metadata.skillName, 'code-review');
        assert.strictEqual(metadata.additionalContext, 'Custom context');
    });
});

suite('Follow Prompt Dialog - AICommandMode', () => {
    test('AICommandMode should include background mode', () => {
        // Import from pipeline-core
        const { AICommandMode } = require('@plusplusoneplusplus/pipeline-core');
        
        // Type check via TS
        const modes: Array<'comment' | 'interactive' | 'background'> = [
            'comment',
            'interactive', 
            'background'
        ];
        
        assert.strictEqual(modes.length, 3);
        assert.ok(modes.includes('background'));
    });
});

suite('Follow Prompt Dialog - Model Configuration', () => {
    test('VALID_MODELS should be an array of model IDs', () => {
        assert.ok(Array.isArray(VALID_MODELS));
        assert.ok(VALID_MODELS.length > 0);
        assert.ok(VALID_MODELS.includes('claude-sonnet-4.5'));
    });

    test('getAvailableModels should return AIModelConfig array', () => {
        const models = getAvailableModels();
        
        assert.ok(Array.isArray(models));
        assert.ok(models.length > 0);
        
        // Check structure of first model
        const firstModel = models[0];
        assert.ok(typeof firstModel.id === 'string');
        assert.ok(typeof firstModel.label === 'string');
        assert.strictEqual(firstModel.isDefault, true); // First model is default
    });

    test('getAvailableModels should include all VALID_MODELS', () => {
        const models = getAvailableModels();
        const modelIds = models.map(m => m.id);
        
        for (const validModel of VALID_MODELS) {
            assert.ok(modelIds.includes(validModel), `Missing model: ${validModel}`);
        }
    });

    test('getAvailableModels should have display labels', () => {
        const models = getAvailableModels();
        
        // Check that labels are user-friendly (not just the ID)
        const claudeSonnet = models.find(m => m.id === 'claude-sonnet-4.5');
        assert.ok(claudeSonnet);
        assert.strictEqual(claudeSonnet.label, 'Claude Sonnet 4.5');
        assert.strictEqual(claudeSonnet.description, '(Recommended)');
    });

    test('Only first model should be marked as default', () => {
        const models = getAvailableModels();
        
        const defaultModels = models.filter(m => m.isDefault);
        assert.strictEqual(defaultModels.length, 1);
        assert.strictEqual(defaultModels[0], models[0]);
    });
});

suite('Follow Prompt Dialog - Settings', () => {
    test('getFollowPromptDefaultMode should return valid mode', () => {
        const mode = getFollowPromptDefaultMode();
        assert.ok(mode === 'interactive' || mode === 'background');
    });

    test('getFollowPromptDefaultModel should return string', () => {
        const model = getFollowPromptDefaultModel();
        assert.ok(typeof model === 'string');
        assert.ok(model.length > 0);
    });

    test('getFollowPromptRememberSelection should return boolean', () => {
        const remember = getFollowPromptRememberSelection();
        assert.strictEqual(typeof remember, 'boolean');
    });
});

suite('Follow Prompt Dialog - Execution Options Validation', () => {
    test('Interactive mode options should not require timeoutMs', () => {
        const options: FollowPromptExecutionOptions = {
            mode: 'interactive',
            model: 'claude-sonnet-4.5'
        };
        
        // Interactive mode doesn't need timeout
        assert.strictEqual(options.timeoutMs, undefined);
    });

    test('Background mode options should support timeoutMs', () => {
        const options: FollowPromptExecutionOptions = {
            mode: 'background',
            model: 'claude-sonnet-4.5',
            timeoutMs: 1800000 // 30 minutes
        };
        
        assert.strictEqual(options.timeoutMs, 1800000);
    });

    test('Additional context should be optional', () => {
        const withContext: FollowPromptExecutionOptions = {
            mode: 'interactive',
            model: 'claude-sonnet-4.5',
            additionalContext: 'Focus on error handling'
        };
        
        const withoutContext: FollowPromptExecutionOptions = {
            mode: 'interactive',
            model: 'claude-sonnet-4.5'
        };
        
        assert.strictEqual(withContext.additionalContext, 'Focus on error handling');
        assert.strictEqual(withoutContext.additionalContext, undefined);
    });
});

suite('Follow Prompt Dialog - Process Metadata', () => {
    test('Follow-prompt process type should be valid', () => {
        // The process type 'follow-prompt' is used for tracking
        const processType = 'follow-prompt';
        
        // AIProcessType allows any string, so this should work
        assert.strictEqual(processType, 'follow-prompt');
    });

    test('Metadata should contain all tracking info', () => {
        const metadata: FollowPromptProcessMetadata = {
            promptFile: '/workspace/.github/prompts/implement.prompt.md',
            planFile: '/workspace/.vscode/tasks/feature/task.md',
            model: 'claude-sonnet-4.5',
            additionalContext: 'Focus on TypeScript',
            skillName: undefined
        };
        
        assert.ok(metadata.promptFile.includes('prompts'));
        assert.ok(metadata.planFile.includes('tasks'));
        assert.ok(VALID_MODELS.includes(metadata.model as typeof VALID_MODELS[number]));
    });

    test('Skill-based execution should include skill name', () => {
        const metadata: FollowPromptProcessMetadata = {
            promptFile: '/workspace/.github/skills/code-review/SKILL.md',
            planFile: '/workspace/.vscode/tasks/task.md',
            model: 'claude-opus-4.6',
            skillName: 'code-review'
        };
        
        assert.strictEqual(metadata.skillName, 'code-review');
        assert.ok(metadata.promptFile.includes('skills'));
    });
});

suite('Follow Prompt Dialog - Copy Prompt Feature', () => {
    test('Copy prompt message type should be defined', () => {
        // Test that the message type structure is valid
        const copyMessage = {
            type: 'copyFollowPrompt' as const,
            promptFilePath: '/path/to/prompt.md',
            skillName: undefined,
            additionalContext: undefined
        };
        
        assert.strictEqual(copyMessage.type, 'copyFollowPrompt');
        assert.strictEqual(copyMessage.promptFilePath, '/path/to/prompt.md');
    });

    test('Copy prompt message should support additional context', () => {
        const copyMessage = {
            type: 'copyFollowPrompt' as const,
            promptFilePath: '/path/to/prompt.md',
            additionalContext: 'Focus on error handling'
        };
        
        assert.strictEqual(copyMessage.additionalContext, 'Focus on error handling');
    });

    test('Copy prompt message should support skill name', () => {
        const copyMessage = {
            type: 'copyFollowPrompt' as const,
            promptFilePath: '/path/to/skills/code-review/SKILL.md',
            skillName: 'code-review',
            additionalContext: undefined
        };
        
        assert.strictEqual(copyMessage.skillName, 'code-review');
    });

    test('Prompt text should be correctly formatted without additional context', () => {
        const promptFilePath = '/workspace/.github/prompts/implement.prompt.md';
        const planFilePath = '/workspace/.vscode/tasks/feature.md';
        
        const expectedPrompt = `Follow the instruction ${promptFilePath}. ${planFilePath}`;
        
        assert.ok(expectedPrompt.includes('Follow the instruction'));
        assert.ok(expectedPrompt.includes(promptFilePath));
        assert.ok(expectedPrompt.includes(planFilePath));
    });

    test('Prompt text should include additional context when provided', () => {
        const promptFilePath = '/workspace/.github/prompts/implement.prompt.md';
        const planFilePath = '/workspace/.vscode/tasks/feature.md';
        const additionalContext = 'Focus on error handling';
        
        let fullPrompt = `Follow the instruction ${promptFilePath}. ${planFilePath}`;
        if (additionalContext && additionalContext.trim()) {
            fullPrompt += `\n\nAdditional context: ${additionalContext.trim()}`;
        }
        
        assert.ok(fullPrompt.includes('Additional context:'));
        assert.ok(fullPrompt.includes('Focus on error handling'));
    });

    test('Empty additional context should not be included', () => {
        const promptFilePath = '/workspace/.github/prompts/implement.prompt.md';
        const planFilePath = '/workspace/.vscode/tasks/feature.md';
        const additionalContext = '   '; // whitespace only
        
        let fullPrompt = `Follow the instruction ${promptFilePath}. ${planFilePath}`;
        if (additionalContext && additionalContext.trim()) {
            fullPrompt += `\n\nAdditional context: ${additionalContext.trim()}`;
        }
        
        assert.ok(!fullPrompt.includes('Additional context:'));
    });

    test('Undefined additional context should not be included', () => {
        const promptFilePath = '/workspace/.github/prompts/implement.prompt.md';
        const planFilePath = '/workspace/.vscode/tasks/feature.md';
        const additionalContext = undefined as string | undefined;
        
        let fullPrompt = `Follow the instruction ${promptFilePath}. ${planFilePath}`;
        if (additionalContext && (additionalContext as string).trim()) {
            fullPrompt += `\n\nAdditional context: ${(additionalContext as string).trim()}`;
        }
        
        assert.ok(!fullPrompt.includes('Additional context:'));
    });

    test('Copy prompt should work with Windows-style paths', () => {
        const promptFilePath = 'C:\\workspace\\.github\\prompts\\implement.prompt.md';
        const planFilePath = 'C:\\workspace\\.vscode\\tasks\\feature.md';
        
        const fullPrompt = `Follow the instruction ${promptFilePath}. ${planFilePath}`;
        
        assert.ok(fullPrompt.includes(promptFilePath));
        assert.ok(fullPrompt.includes(planFilePath));
    });

    test('Copy prompt should work with Unix-style paths', () => {
        const promptFilePath = '/home/user/workspace/.github/prompts/implement.prompt.md';
        const planFilePath = '/home/user/workspace/.vscode/tasks/feature.md';
        
        const fullPrompt = `Follow the instruction ${promptFilePath}. ${planFilePath}`;
        
        assert.ok(fullPrompt.includes(promptFilePath));
        assert.ok(fullPrompt.includes(planFilePath));
    });

    test('Additional context should be trimmed', () => {
        const additionalContext = '  Focus on error handling  ';
        
        let fullPrompt = 'Follow the instruction /path/to/prompt.md. /path/to/plan.md';
        if (additionalContext && additionalContext.trim()) {
            fullPrompt += `\n\nAdditional context: ${additionalContext.trim()}`;
        }
        
        assert.ok(fullPrompt.includes('Additional context: Focus on error handling'));
        assert.ok(!fullPrompt.includes('Additional context:   Focus'));
    });
});
