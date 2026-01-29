/**
 * AI Task Commands Tests
 * Tests for AI task creation modes (Simple vs Deep)
 */

import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    isDeepModeAvailable,
    buildDeepModePrompt,
    CreationMode,
    ModeSelection,
    SelectedContext,
    sanitizeGeneratedFileName,
    generateFallbackTaskName,
    buildCreateTaskPromptWithNameForTesting,
    buildCreateFromFeaturePromptForTesting,
    buildCreateTaskPromptForTesting
} from '../../shortcuts/tasks-viewer/ai-task-commands';

suite('AI Task Commands Tests', () => {
    let tempDir: string;

    setup(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-task-test-'));
    });

    teardown(() => {
        if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    suite('isDeepModeAvailable', () => {
        test('should return false when go-deep skill does not exist', () => {
            // tempDir has no .github/skills/go-deep directory
            const result = isDeepModeAvailable(tempDir);
            assert.strictEqual(result, false);
        });

        test('should return true when go-deep skill exists', () => {
            // Create the go-deep skill structure
            const skillDir = path.join(tempDir, '.github', 'skills', 'go-deep');
            fs.mkdirSync(skillDir, { recursive: true });
            fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '# Go Deep Skill\n\nResearch methodology...');

            const result = isDeepModeAvailable(tempDir);
            assert.strictEqual(result, true);
        });

        test('should return false when skill directory exists but SKILL.md is missing', () => {
            // Create directory without SKILL.md
            const skillDir = path.join(tempDir, '.github', 'skills', 'go-deep');
            fs.mkdirSync(skillDir, { recursive: true });
            fs.writeFileSync(path.join(skillDir, 'README.md'), '# Readme only');

            const result = isDeepModeAvailable(tempDir);
            assert.strictEqual(result, false);
        });
    });

    suite('buildDeepModePrompt', () => {
        test('should prepend go-deep skill instruction', async () => {
            const context: SelectedContext = {
                description: 'Test feature'
            };
            
            const prompt = await buildDeepModePrompt(
                context,
                'Implement feature',
                '/path/to/target',
                tempDir
            );

            assert.ok(prompt.startsWith('Use go-deep skill when available.'), 'Should start with skill instruction');
        });

        test('should include base prompt content after instruction', async () => {
            const context: SelectedContext = {
                description: 'Test feature description',
                planContent: 'Test plan content'
            };
            
            const prompt = await buildDeepModePrompt(
                context,
                'Implement authentication',
                '/path/to/target',
                tempDir
            );

            assert.ok(prompt.includes('Implement authentication'), 'Should include focus');
            assert.ok(prompt.includes('/path/to/target'), 'Should include target path');
            assert.ok(prompt.includes('Test feature description'), 'Should include description');
        });

        test('should include context in prompt', async () => {
            const context: SelectedContext = {
                description: 'User authentication module',
                planContent: 'Plan: Implement OAuth2 flow',
                specContent: 'Spec: Support Google, GitHub providers',
                relatedFiles: ['src/auth/index.ts', 'src/auth/providers.ts']
            };
            
            const prompt = await buildDeepModePrompt(
                context,
                'Add authentication',
                '/target/path',
                tempDir
            );

            assert.ok(prompt.includes('User authentication module'), 'Should include description');
            assert.ok(prompt.includes('Plan: Implement OAuth2 flow'), 'Should include plan');
            assert.ok(prompt.includes('Spec: Support Google'), 'Should include spec');
            assert.ok(prompt.includes('src/auth/index.ts'), 'Should include related files');
        });

        test('should truncate long plan content', async () => {
            const longContent = 'A'.repeat(3000); // More than 2000 chars
            const context: SelectedContext = {
                planContent: longContent
            };
            
            const prompt = await buildDeepModePrompt(
                context,
                'Test',
                '/path',
                tempDir
            );

            assert.ok(prompt.includes('(truncated)'), 'Should indicate truncation');
            assert.ok(!prompt.includes(longContent), 'Should not include full content');
        });

        test('should handle empty context gracefully', async () => {
            const context: SelectedContext = {};
            
            const prompt = await buildDeepModePrompt(
                context,
                '',
                '/path',
                tempDir
            );

            assert.ok(prompt.startsWith('Use go-deep skill when available.'), 'Should have skill instruction');
            assert.ok(prompt.includes('Create an implementation task'), 'Should have default focus');
        });

        test('should limit related files to 20', async () => {
            const relatedFiles = Array.from({ length: 30 }, (_, i) => `src/file${i}.ts`);
            const context: SelectedContext = {
                relatedFiles
            };
            
            const prompt = await buildDeepModePrompt(
                context,
                'Test',
                '/path',
                tempDir
            );

            assert.ok(prompt.includes('src/file0.ts'), 'Should include first file');
            assert.ok(prompt.includes('src/file19.ts'), 'Should include 20th file');
            assert.ok(!prompt.includes('src/file20.ts'), 'Should not include 21st file');
        });
    });

    suite('CreationMode type', () => {
        test('should accept valid mode values', () => {
            const simple: CreationMode = 'simple';
            const deep: CreationMode = 'deep';
            
            assert.strictEqual(simple, 'simple');
            assert.strictEqual(deep, 'deep');
        });
    });

    suite('ModeSelection interface', () => {
        test('should have correct structure', () => {
            const selection: ModeSelection = {
                id: 'deep',
                label: 'Deep'
            };
            
            assert.strictEqual(selection.id, 'deep');
            assert.strictEqual(selection.label, 'Deep');
        });
    });

    suite('sanitizeGeneratedFileName', () => {
        test('should return null for empty input', () => {
            assert.strictEqual(sanitizeGeneratedFileName(''), null);
            assert.strictEqual(sanitizeGeneratedFileName(null as any), null);
            assert.strictEqual(sanitizeGeneratedFileName(undefined as any), null);
        });

        test('should remove surrounding quotes', () => {
            assert.strictEqual(sanitizeGeneratedFileName('"oauth2-auth"'), 'oauth2-auth');
            assert.strictEqual(sanitizeGeneratedFileName("'oauth2-auth'"), 'oauth2-auth');
            assert.strictEqual(sanitizeGeneratedFileName('`oauth2-auth`'), 'oauth2-auth');
        });

        test('should remove .md extension', () => {
            assert.strictEqual(sanitizeGeneratedFileName('oauth2-auth.md'), 'oauth2-auth');
            assert.strictEqual(sanitizeGeneratedFileName('oauth2-auth.MD'), 'oauth2-auth');
        });

        test('should remove .plan suffix', () => {
            assert.strictEqual(sanitizeGeneratedFileName('oauth2-auth.plan'), 'oauth2-auth');
            assert.strictEqual(sanitizeGeneratedFileName('oauth2-auth.plan.md'), 'oauth2-auth');
        });

        test('should replace invalid characters with hyphens', () => {
            assert.strictEqual(sanitizeGeneratedFileName('task<name>'), 'task-name');
            assert.strictEqual(sanitizeGeneratedFileName('task:name'), 'task-name');
            assert.strictEqual(sanitizeGeneratedFileName('task"name'), 'task-name');
            assert.strictEqual(sanitizeGeneratedFileName('task/name'), 'task-name');
            assert.strictEqual(sanitizeGeneratedFileName('task\\name'), 'task-name');
        });

        test('should replace spaces with hyphens', () => {
            assert.strictEqual(sanitizeGeneratedFileName('my task name'), 'my-task-name');
            assert.strictEqual(sanitizeGeneratedFileName('my  task   name'), 'my-task-name');
        });

        test('should collapse multiple hyphens', () => {
            assert.strictEqual(sanitizeGeneratedFileName('task--name'), 'task-name');
            assert.strictEqual(sanitizeGeneratedFileName('task---name---test'), 'task-name-test');
        });

        test('should remove leading and trailing hyphens', () => {
            assert.strictEqual(sanitizeGeneratedFileName('-task-name-'), 'task-name');
            assert.strictEqual(sanitizeGeneratedFileName('---task---'), 'task');
        });

        test('should convert to lowercase', () => {
            assert.strictEqual(sanitizeGeneratedFileName('OAuth2-Authentication'), 'oauth2-authentication');
            assert.strictEqual(sanitizeGeneratedFileName('MY_TASK'), 'my_task');
        });

        test('should truncate to 50 characters', () => {
            const longName = 'this-is-a-very-long-task-name-that-exceeds-fifty-characters-limit';
            const result = sanitizeGeneratedFileName(longName);
            assert.ok(result!.length <= 50, 'Should be at most 50 characters');
            assert.ok(!result!.endsWith('-'), 'Should not end with hyphen after truncation');
        });

        test('should handle complex AI responses', () => {
            assert.strictEqual(sanitizeGeneratedFileName('  oauth2-authentication  '), 'oauth2-authentication');
            assert.strictEqual(sanitizeGeneratedFileName('`oauth2-authentication.plan.md`'), 'oauth2-authentication');
            assert.strictEqual(sanitizeGeneratedFileName('"My Task Name.md"'), 'my-task-name');
        });

        test('should return null for whitespace-only input', () => {
            assert.strictEqual(sanitizeGeneratedFileName('   '), null);
            assert.strictEqual(sanitizeGeneratedFileName('\n\t'), null);
        });
    });

    suite('generateFallbackTaskName', () => {
        test('should generate timestamp-based name without description', () => {
            const result = generateFallbackTaskName();
            assert.ok(result.startsWith('task-'), 'Should start with "task-"');
            assert.ok(/task-\d+/.test(result), 'Should include timestamp');
        });

        test('should generate name with description prefix', () => {
            const result = generateFallbackTaskName('Implement authentication');
            assert.ok(result.includes('implement'), 'Should include sanitized description');
            assert.ok(/\d+$/.test(result), 'Should end with timestamp');
        });

        test('should handle short descriptions', () => {
            const result = generateFallbackTaskName('ab');
            // Should fall back to generic since prefix is too short
            assert.ok(result.startsWith('task-'), 'Should use generic prefix for short description');
        });

        test('should sanitize description', () => {
            const result = generateFallbackTaskName('Add OAuth2 Auth!');
            assert.ok(!result.includes('!'), 'Should not include special characters');
            assert.ok(result.toLowerCase() === result, 'Should be lowercase');
        });

        test('should truncate long descriptions', () => {
            const longDesc = 'This is a very long description that should be truncated';
            const result = generateFallbackTaskName(longDesc);
            // The prefix should be from the first 20 chars of description
            assert.ok(result.length < 60, 'Should have reasonable length');
        });

        test('should handle empty string description', () => {
            const result = generateFallbackTaskName('');
            assert.ok(result.startsWith('task-'), 'Should use generic prefix for empty description');
        });

        test('should handle special characters only description', () => {
            const result = generateFallbackTaskName('!!!@@@###');
            // After sanitization, this becomes empty, so should fall back
            assert.ok(result.startsWith('task-'), 'Should use generic prefix when sanitization yields empty result');
        });
    });

    suite('buildCreateTaskPromptWithNameForTesting - Output Directory Enforcement', () => {
        test('should include explicit directory requirement when name is provided', () => {
            const targetPath = '/Users/test/.vscode/tasks/TaskPanel';
            const name = 'my-task';
            const description = 'Test description';
            
            const prompt = buildCreateTaskPromptWithNameForTesting(name, description, targetPath);
            
            // Verify output directory enforcement
            assert.ok(prompt.includes('**IMPORTANT: Output Location Requirement**'), 'Should have prominent location requirement header');
            assert.ok(prompt.includes('MUST save the file to this EXACT directory'), 'Should emphasize EXACT directory');
            assert.ok(prompt.includes(targetPath), 'Should include the target path');
            assert.ok(prompt.includes(`${targetPath}/${name}.plan.md`), 'Should include full file path');
            assert.ok(prompt.includes('Do NOT save to any other location'), 'Should explicitly forbid other locations');
            assert.ok(prompt.includes('Do NOT use your session state'), 'Should explicitly forbid session state directory');
        });

        test('should include explicit directory requirement when name is empty', () => {
            const targetPath = '/Users/test/.vscode/tasks/FeatureX';
            const description = 'Test description';
            
            const prompt = buildCreateTaskPromptWithNameForTesting(undefined, description, targetPath);
            
            // Verify output directory enforcement
            assert.ok(prompt.includes('**IMPORTANT: Output Location Requirement**'), 'Should have prominent location requirement header');
            assert.ok(prompt.includes('MUST save the file to this EXACT directory'), 'Should emphasize EXACT directory');
            assert.ok(prompt.includes(targetPath), 'Should include the target path');
            assert.ok(prompt.includes(`${targetPath}/your-generated-name.plan.md`), 'Should include example path');
            assert.ok(prompt.includes('Do NOT save to any other location'), 'Should explicitly forbid other locations');
            assert.ok(prompt.includes('Do NOT use your session state'), 'Should explicitly forbid session state directory');
        });

        test('should include target path multiple times for emphasis', () => {
            const targetPath = '/path/to/tasks/MyFeature';
            const prompt = buildCreateTaskPromptWithNameForTesting('task-name', 'Description', targetPath);
            
            // Count occurrences of target path
            const occurrences = (prompt.match(new RegExp(targetPath.replace(/\//g, '\\/'), 'g')) || []).length;
            assert.ok(occurrences >= 2, `Should include target path multiple times for emphasis (found ${occurrences})`);
        });
    });

    suite('buildCreateFromFeaturePromptForTesting - Output Directory Enforcement', () => {
        test('should include explicit directory requirement', () => {
            const targetPath = '/Users/test/.vscode/tasks/AuthFeature';
            const context: SelectedContext = {
                description: 'Authentication feature'
            };
            
            const prompt = buildCreateFromFeaturePromptForTesting(context, 'Implement OAuth2', targetPath);
            
            // Verify output directory enforcement
            assert.ok(prompt.includes('**IMPORTANT: Output Location Requirement**'), 'Should have prominent location requirement header');
            assert.ok(prompt.includes('MUST save the file to this EXACT directory'), 'Should emphasize EXACT directory');
            assert.ok(prompt.includes(targetPath), 'Should include the target path');
            assert.ok(prompt.includes('Do NOT save to any other location'), 'Should explicitly forbid other locations');
            assert.ok(prompt.includes('Do NOT use your session state'), 'Should explicitly forbid session state directory');
        });

        test('should include example filename format', () => {
            const targetPath = '/path/to/tasks';
            const context: SelectedContext = {};
            
            const prompt = buildCreateFromFeaturePromptForTesting(context, 'Test', targetPath);
            
            assert.ok(prompt.includes('.plan.md'), 'Should mention .plan.md file format');
            assert.ok(prompt.includes('feature-plan.plan.md'), 'Should include example filename');
        });

        test('should include context and still enforce directory', () => {
            const targetPath = '/target/path';
            const context: SelectedContext = {
                description: 'Test description',
                planContent: 'Plan content here',
                specContent: 'Spec content here',
                relatedFiles: ['file1.ts', 'file2.ts']
            };
            
            const prompt = buildCreateFromFeaturePromptForTesting(context, 'Focus', targetPath);
            
            // Should include context
            assert.ok(prompt.includes('Test description'), 'Should include description');
            assert.ok(prompt.includes('Plan content here'), 'Should include plan content');
            assert.ok(prompt.includes('Spec content here'), 'Should include spec content');
            assert.ok(prompt.includes('file1.ts'), 'Should include related files');
            
            // Should still enforce directory
            assert.ok(prompt.includes('**IMPORTANT: Output Location Requirement**'), 'Should have location requirement even with context');
            assert.ok(prompt.includes(targetPath), 'Should include target path');
        });
    });

    suite('buildCreateTaskPromptForTesting - Output Directory Enforcement', () => {
        test('should include explicit directory requirement', () => {
            const targetPath = '/Users/test/.vscode/tasks';
            const description = 'Build a new feature';
            
            const prompt = buildCreateTaskPromptForTesting(description, targetPath);
            
            // Verify output directory enforcement
            assert.ok(prompt.includes('**IMPORTANT: Output Location Requirement**'), 'Should have prominent location requirement header');
            assert.ok(prompt.includes('MUST save the file to this EXACT directory'), 'Should emphasize EXACT directory');
            assert.ok(prompt.includes(targetPath), 'Should include the target path');
            assert.ok(prompt.includes('Do NOT save to any other location'), 'Should explicitly forbid other locations');
            assert.ok(prompt.includes('Do NOT use your session state'), 'Should explicitly forbid session state directory');
        });

        test('should include description in prompt', () => {
            const targetPath = '/path/to/tasks';
            const description = 'Implement user authentication';
            
            const prompt = buildCreateTaskPromptForTesting(description, targetPath);
            
            assert.ok(prompt.includes(description), 'Should include the description');
        });

        test('should require .plan.md file format', () => {
            const targetPath = '/path/to/tasks';
            const prompt = buildCreateTaskPromptForTesting('Test', targetPath);
            
            assert.ok(prompt.includes('.plan.md'), 'Should specify .plan.md file format');
        });
    });
});
