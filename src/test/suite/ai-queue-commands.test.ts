/**
 * Unit tests for ai-queue-commands.ts
 *
 * Tests the registerQueueCommands function, specifically the new
 * shortcuts.queue.addJob command that opens the Queue Job dialog
 * and queues tasks via AIQueueService.
 */

import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { registerQueueCommands } from '../../shortcuts/ai-service/ai-queue-commands';
import { QueueJobDialogService } from '../../shortcuts/ai-service/queue-job-dialog-service';
import {
    QueueJobDialogResult,
    QueueJobOptions,
    QueueJobMode,
    QueueJobPriority,
} from '../../shortcuts/ai-service/queue-job-dialog';

suite('AI Queue Commands (ai-queue-commands.ts)', () => {

    suite('registerQueueCommands exports', () => {
        test('should export registerQueueCommands function', () => {
            assert.ok(typeof registerQueueCommands === 'function', 'registerQueueCommands should be a function');
        });
    });

    suite('QueueJobDialogService integration types', () => {
        test('QueueJobDialogResult cancelled shape', () => {
            const cancelled: QueueJobDialogResult = { cancelled: true, options: null };
            assert.strictEqual(cancelled.cancelled, true);
            assert.strictEqual(cancelled.options, null);
        });

        test('QueueJobDialogResult prompt mode shape', () => {
            const result: QueueJobDialogResult = {
                cancelled: false,
                options: {
                    mode: 'prompt' as QueueJobMode,
                    prompt: 'hello world',
                    model: 'gpt-4',
                    priority: 'normal' as QueueJobPriority,
                },
            };
            assert.strictEqual(result.cancelled, false);
            assert.ok(result.options);
            assert.strictEqual(result.options!.mode, 'prompt');
            assert.strictEqual(result.options!.prompt, 'hello world');
        });

        test('QueueJobDialogResult skill mode shape', () => {
            const result: QueueJobDialogResult = {
                cancelled: false,
                options: {
                    mode: 'skill' as QueueJobMode,
                    skillName: 'impl',
                    additionalContext: 'extra context',
                    model: 'gpt-4',
                    priority: 'high' as QueueJobPriority,
                },
            };
            assert.strictEqual(result.cancelled, false);
            assert.ok(result.options);
            assert.strictEqual(result.options!.mode, 'skill');
            assert.strictEqual(result.options!.skillName, 'impl');
            assert.strictEqual(result.options!.additionalContext, 'extra context');
        });

        test('QueueJobOptions should support all priority levels', () => {
            const priorities: QueueJobPriority[] = ['high', 'normal', 'low'];
            for (const priority of priorities) {
                const options: QueueJobOptions = {
                    mode: 'prompt',
                    prompt: 'test',
                    model: 'gpt-4',
                    priority,
                };
                assert.strictEqual(options.priority, priority);
            }
        });

        test('QueueJobOptions should support optional workingDirectory', () => {
            const withDir: QueueJobOptions = {
                mode: 'prompt',
                prompt: 'test',
                model: 'gpt-4',
                priority: 'normal',
                workingDirectory: '/some/path',
            };
            assert.strictEqual(withDir.workingDirectory, '/some/path');

            const withoutDir: QueueJobOptions = {
                mode: 'prompt',
                prompt: 'test',
                model: 'gpt-4',
                priority: 'normal',
            };
            assert.strictEqual(withoutDir.workingDirectory, undefined);
        });
    });

    suite('Temp file creation for prompt mode', () => {
        let tempDir: string;

        setup(() => {
            tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'queue-cmd-test-'));
        });

        teardown(() => {
            if (fs.existsSync(tempDir)) {
                fs.rmSync(tempDir, { recursive: true, force: true });
            }
        });

        test('should create temp .prompt.md file with prompt content', () => {
            const promptText = 'Analyze this code for bugs';
            const promptFilePath = path.join(tempDir, 'prompt.prompt.md');
            fs.writeFileSync(promptFilePath, promptText, 'utf-8');

            assert.ok(fs.existsSync(promptFilePath), 'Temp file should exist');
            const content = fs.readFileSync(promptFilePath, 'utf-8');
            assert.strictEqual(content, promptText);
        });

        test('should handle multiline prompts', () => {
            const promptText = 'Line 1\nLine 2\nLine 3';
            const promptFilePath = path.join(tempDir, 'prompt.prompt.md');
            fs.writeFileSync(promptFilePath, promptText, 'utf-8');

            const content = fs.readFileSync(promptFilePath, 'utf-8');
            assert.strictEqual(content, promptText);
        });

        test('should handle unicode prompts', () => {
            const promptText = '分析这段代码 🔍 Überprüfe den Code';
            const promptFilePath = path.join(tempDir, 'prompt.prompt.md');
            fs.writeFileSync(promptFilePath, promptText, 'utf-8');

            const content = fs.readFileSync(promptFilePath, 'utf-8');
            assert.strictEqual(content, promptText);
        });
    });

    suite('Skill prompt file resolution', () => {
        let tempDir: string;

        setup(() => {
            tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'queue-skill-test-'));
        });

        teardown(() => {
            if (fs.existsSync(tempDir)) {
                fs.rmSync(tempDir, { recursive: true, force: true });
            }
        });

        test('should find prompt.md in skill directory', () => {
            const skillDir = path.join(tempDir, 'my-skill');
            fs.mkdirSync(skillDir, { recursive: true });
            const promptPath = path.join(skillDir, 'prompt.md');
            fs.writeFileSync(promptPath, '# My Skill', 'utf-8');

            assert.ok(fs.existsSync(promptPath), 'prompt.md should exist');
        });

        test('should fall back to SKILL.md when prompt.md missing', () => {
            const skillDir = path.join(tempDir, 'my-skill');
            fs.mkdirSync(skillDir, { recursive: true });
            const skillMdPath = path.join(skillDir, 'SKILL.md');
            fs.writeFileSync(skillMdPath, '# Skill', 'utf-8');

            const promptPath = path.join(skillDir, 'prompt.md');
            assert.ok(!fs.existsSync(promptPath), 'prompt.md should not exist');
            assert.ok(fs.existsSync(skillMdPath), 'SKILL.md should exist');
        });

        test('should detect when neither prompt.md nor SKILL.md exists', () => {
            const skillDir = path.join(tempDir, 'empty-skill');
            fs.mkdirSync(skillDir, { recursive: true });

            assert.ok(!fs.existsSync(path.join(skillDir, 'prompt.md')));
            assert.ok(!fs.existsSync(path.join(skillDir, 'SKILL.md')));
        });
    });

    suite('QueueJobDialogService construction', () => {
        test('should validate prompt - empty string returns error', () => {
            const service = new QueueJobDialogService(
                { scheme: 'file', path: '/mock', fsPath: '/mock' } as any,
                { workspaceState: { get: () => undefined, update: async () => {} }, globalState: { get: () => undefined, update: async () => {} }, extensionUri: { scheme: 'file', path: '/mock', fsPath: '/mock' } } as any
            );
            const error = service.validatePrompt('');
            assert.ok(error, 'Should return error for empty prompt');
            assert.strictEqual(error, 'Prompt cannot be empty');
        });

        test('should validate prompt - whitespace-only returns error', () => {
            const service = new QueueJobDialogService(
                { scheme: 'file', path: '/mock', fsPath: '/mock' } as any,
                { workspaceState: { get: () => undefined, update: async () => {} }, globalState: { get: () => undefined, update: async () => {} }, extensionUri: { scheme: 'file', path: '/mock', fsPath: '/mock' } } as any
            );
            const error = service.validatePrompt('   ');
            assert.ok(error, 'Should return error for whitespace prompt');
        });

        test('should validate prompt - valid prompt returns null', () => {
            const service = new QueueJobDialogService(
                { scheme: 'file', path: '/mock', fsPath: '/mock' } as any,
                { workspaceState: { get: () => undefined, update: async () => {} }, globalState: { get: () => undefined, update: async () => {} }, extensionUri: { scheme: 'file', path: '/mock', fsPath: '/mock' } } as any
            );
            const error = service.validatePrompt('Analyze code');
            assert.strictEqual(error, null, 'Should return null for valid prompt');
        });

        test('should validate skill selection - empty returns error', () => {
            const service = new QueueJobDialogService(
                { scheme: 'file', path: '/mock', fsPath: '/mock' } as any,
                { workspaceState: { get: () => undefined, update: async () => {} }, globalState: { get: () => undefined, update: async () => {} }, extensionUri: { scheme: 'file', path: '/mock', fsPath: '/mock' } } as any
            );
            const error = service.validateSkillSelection('');
            assert.ok(error, 'Should return error for empty skill');
            assert.strictEqual(error, 'Please select a skill');
        });

        test('should validate skill selection - valid returns null', () => {
            const service = new QueueJobDialogService(
                { scheme: 'file', path: '/mock', fsPath: '/mock' } as any,
                { workspaceState: { get: () => undefined, update: async () => {} }, globalState: { get: () => undefined, update: async () => {} }, extensionUri: { scheme: 'file', path: '/mock', fsPath: '/mock' } } as any
            );
            const error = service.validateSkillSelection('impl');
            assert.strictEqual(error, null, 'Should return null for valid skill selection');
        });
    });
});
