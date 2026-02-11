/**
 * Queue Job Dialog Service Tests
 * Tests for the Queue Job Dialog Service (queue-job-dialog-service.ts)
 * Verifies service construction, validation, types, and backward compatibility.
 */

import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { QueueJobDialogService } from '../../shortcuts/ai-service/queue-job-dialog-service';
import {
    QueueJobDialogService as ReExportedService,
    QueueJobDialogResult,
    QueueJobOptions,
    QueueJobMode,
    QueueJobPriority,
    getQueueJobDialogHtml
} from '../../shortcuts/ai-service/queue-job-dialog';
import { getLastUsedAIModel, saveLastUsedAIModel } from '../../shortcuts/ai-service/ai-config-helpers';
import { VALID_MODELS, DEFAULT_MODEL_ID } from '../../shortcuts/ai-service';

/**
 * Mock workspace state for testing persistence
 */
class MockWorkspaceState {
    private storage: Map<string, unknown> = new Map();

    get<T>(key: string, defaultValue?: T): T {
        return this.storage.has(key) ? this.storage.get(key) as T : defaultValue as T;
    }

    async update(key: string, value: unknown): Promise<void> {
        this.storage.set(key, value);
    }

    clear(): void {
        this.storage.clear();
    }
}

/**
 * Mock ExtensionContext for testing
 */
class MockExtensionContext {
    workspaceState = new MockWorkspaceState();
    globalState = new MockWorkspaceState();
    extensionUri = vscode.Uri.file('/mock/extension');
}

suite('Queue Job Dialog Service (queue-job-dialog-service.ts)', () => {
    let tempDir: string;
    let dialogService: QueueJobDialogService;
    let mockExtensionUri: vscode.Uri;
    let mockContext: MockExtensionContext;

    setup(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'queue-dialog-service-test-'));
        mockExtensionUri = vscode.Uri.file(tempDir);
        mockContext = new MockExtensionContext();
        dialogService = new QueueJobDialogService(
            mockExtensionUri,
            mockContext as unknown as vscode.ExtensionContext
        );
    });

    teardown(() => {
        if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    suite('Constructor', () => {
        test('should create service with extension URI and context', () => {
            const service = new QueueJobDialogService(
                mockExtensionUri,
                mockContext as unknown as vscode.ExtensionContext
            );
            assert.ok(service, 'Service should be created');
        });

        test('should expose showDialog method', () => {
            assert.ok(typeof dialogService.showDialog === 'function', 'Should have showDialog');
        });

        test('should expose validatePrompt method', () => {
            assert.ok(typeof dialogService.validatePrompt === 'function', 'Should have validatePrompt');
        });

        test('should expose validateSkillSelection method', () => {
            assert.ok(typeof dialogService.validateSkillSelection === 'function', 'Should have validateSkillSelection');
        });

        test('should expose getAvailableSkills method', () => {
            assert.ok(typeof dialogService.getAvailableSkills === 'function', 'Should have getAvailableSkills');
        });
    });

    suite('validatePrompt', () => {
        test('should reject empty string', () => {
            const result = dialogService.validatePrompt('');
            assert.ok(result !== null);
            assert.ok(result!.toLowerCase().includes('empty'));
        });

        test('should reject whitespace-only string', () => {
            const result = dialogService.validatePrompt('   \t\n  ');
            assert.ok(result !== null);
        });

        test('should accept valid prompt', () => {
            assert.strictEqual(dialogService.validatePrompt('Analyze this code'), null);
        });

        test('should accept prompt with leading/trailing whitespace', () => {
            assert.strictEqual(dialogService.validatePrompt('  some prompt  '), null);
        });

        test('should accept multi-line prompt', () => {
            assert.strictEqual(dialogService.validatePrompt('Line 1\nLine 2\nLine 3'), null);
        });

        test('should accept single character prompt', () => {
            assert.strictEqual(dialogService.validatePrompt('x'), null);
        });
    });

    suite('validateSkillSelection', () => {
        test('should reject empty string', () => {
            const result = dialogService.validateSkillSelection('');
            assert.ok(result !== null);
            assert.ok(result!.toLowerCase().includes('skill'));
        });

        test('should reject whitespace-only string', () => {
            const result = dialogService.validateSkillSelection('   ');
            assert.ok(result !== null);
        });

        test('should accept valid skill name', () => {
            assert.strictEqual(dialogService.validateSkillSelection('go-deep'), null);
        });

        test('should accept skill with underscores and dashes', () => {
            assert.strictEqual(dialogService.validateSkillSelection('my-skill_v2'), null);
        });

        test('should accept skill name with dots', () => {
            assert.strictEqual(dialogService.validateSkillSelection('skill.name'), null);
        });
    });

    suite('QueueJobOptions type structure', () => {
        test('prompt mode has correct fields', () => {
            const options: QueueJobOptions = {
                mode: 'prompt',
                prompt: 'Analyze codebase',
                model: DEFAULT_MODEL_ID,
                priority: 'normal'
            };
            assert.strictEqual(options.mode, 'prompt');
            assert.strictEqual(options.prompt, 'Analyze codebase');
            assert.strictEqual(options.skillName, undefined);
            assert.strictEqual(options.additionalContext, undefined);
        });

        test('skill mode has correct fields', () => {
            const options: QueueJobOptions = {
                mode: 'skill',
                skillName: 'impl',
                additionalContext: 'Focus on auth module',
                model: DEFAULT_MODEL_ID,
                priority: 'high'
            };
            assert.strictEqual(options.mode, 'skill');
            assert.strictEqual(options.skillName, 'impl');
            assert.strictEqual(options.additionalContext, 'Focus on auth module');
            assert.strictEqual(options.prompt, undefined);
        });

        test('supports optional working directory', () => {
            const options: QueueJobOptions = {
                mode: 'prompt',
                prompt: 'Test',
                model: DEFAULT_MODEL_ID,
                priority: 'normal',
                workingDirectory: '/workspace/src'
            };
            assert.strictEqual(options.workingDirectory, '/workspace/src');
        });

        test('supports all priority levels', () => {
            const priorities: QueueJobPriority[] = ['high', 'normal', 'low'];
            for (const priority of priorities) {
                const options: QueueJobOptions = {
                    mode: 'prompt',
                    prompt: 'Test',
                    model: DEFAULT_MODEL_ID,
                    priority
                };
                assert.strictEqual(options.priority, priority);
            }
        });
    });

    suite('QueueJobDialogResult type', () => {
        test('cancelled result', () => {
            const result: QueueJobDialogResult = { cancelled: true, options: null };
            assert.strictEqual(result.cancelled, true);
            assert.strictEqual(result.options, null);
        });

        test('successful prompt result', () => {
            const result: QueueJobDialogResult = {
                cancelled: false,
                options: {
                    mode: 'prompt',
                    prompt: 'Do analysis',
                    model: DEFAULT_MODEL_ID,
                    priority: 'normal'
                }
            };
            assert.strictEqual(result.cancelled, false);
            assert.strictEqual(result.options!.mode, 'prompt');
            assert.strictEqual(result.options!.prompt, 'Do analysis');
        });

        test('successful skill result', () => {
            const result: QueueJobDialogResult = {
                cancelled: false,
                options: {
                    mode: 'skill',
                    skillName: 'go-deep',
                    additionalContext: 'Extra info',
                    model: DEFAULT_MODEL_ID,
                    priority: 'high'
                }
            };
            assert.strictEqual(result.cancelled, false);
            assert.strictEqual(result.options!.mode, 'skill');
            assert.strictEqual(result.options!.skillName, 'go-deep');
            assert.strictEqual(result.options!.additionalContext, 'Extra info');
        });
    });

    suite('QueueJobMode type', () => {
        test('supports prompt mode', () => {
            const mode: QueueJobMode = 'prompt';
            assert.strictEqual(mode, 'prompt');
        });

        test('supports skill mode', () => {
            const mode: QueueJobMode = 'skill';
            assert.strictEqual(mode, 'skill');
        });
    });

    suite('Backward compatibility', () => {
        test('QueueJobDialogService is re-exported from queue-job-dialog', () => {
            assert.strictEqual(QueueJobDialogService, ReExportedService,
                'Direct import and re-exported class should be the same');
        });

        test('re-exported service creates functional instance', () => {
            const service = new ReExportedService(
                mockExtensionUri,
                mockContext as unknown as vscode.ExtensionContext
            );
            assert.ok(service);
            assert.ok(typeof service.showDialog === 'function');
            assert.ok(typeof service.validatePrompt === 'function');
            assert.ok(typeof service.validateSkillSelection === 'function');
        });
    });

    suite('getQueueJobDialogHtml', () => {
        test('should be exported as a standalone function', () => {
            assert.ok(typeof getQueueJobDialogHtml === 'function',
                'getQueueJobDialogHtml should be exported');
        });
    });

    suite('Model persistence integration', () => {
        test('should use persisted model as default', () => {
            saveLastUsedAIModel(mockContext as unknown as vscode.ExtensionContext, VALID_MODELS[2]);

            const newService = new QueueJobDialogService(
                mockExtensionUri,
                mockContext as unknown as vscode.ExtensionContext
            );
            assert.ok(newService, 'Dialog service should be created with context');

            const persistedModel = getLastUsedAIModel(mockContext as unknown as vscode.ExtensionContext);
            assert.strictEqual(persistedModel, VALID_MODELS[2]);
        });

        test('persistence should be isolated per context', () => {
            const context1 = new MockExtensionContext();
            const context2 = new MockExtensionContext();

            saveLastUsedAIModel(context1 as unknown as vscode.ExtensionContext, DEFAULT_MODEL_ID);
            saveLastUsedAIModel(context2 as unknown as vscode.ExtensionContext, VALID_MODELS[1]);

            const model1 = getLastUsedAIModel(context1 as unknown as vscode.ExtensionContext);
            const model2 = getLastUsedAIModel(context2 as unknown as vscode.ExtensionContext);

            assert.strictEqual(model1, DEFAULT_MODEL_ID);
            assert.strictEqual(model2, VALID_MODELS[1]);
        });
    });
});
