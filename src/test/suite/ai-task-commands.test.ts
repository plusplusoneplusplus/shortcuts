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
    SelectedContext
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
});
