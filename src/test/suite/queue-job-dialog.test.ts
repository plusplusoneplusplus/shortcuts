/**
 * Queue Job Dialog Service Tests
 * Tests for the Queue Job dialog flow
 */

import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import {
    QueueJobDialogService,
    QueueJobDialogResult,
    QueueJobOptions,
    QueueJobMode,
    QueueJobPriority,
    getQueueJobDialogHtml
} from '../../shortcuts/ai-service/queue-job-dialog';
import { getLastUsedAIModel, saveLastUsedAIModel, getFollowPromptDefaultModel } from '../../shortcuts/ai-service/ai-config-helpers';
import { VALID_MODELS, DEFAULT_MODEL_ID } from '../../shortcuts/ai-service';
import { getSharedDialogCSS } from '../../shortcuts/shared/webview/dialog-styles';

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

    getStoredValue(key: string): unknown {
        return this.storage.get(key);
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

suite('Queue Job Dialog Service Tests', () => {
    let tempDir: string;
    let dialogService: QueueJobDialogService;
    let mockExtensionUri: vscode.Uri;
    let mockContext: MockExtensionContext;

    setup(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'queue-job-dialog-test-'));
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

    suite('QueueJobDialogService constructor', () => {
        test('should create dialog service with extension URI and context', () => {
            const service = new QueueJobDialogService(
                mockExtensionUri,
                mockContext as unknown as vscode.ExtensionContext
            );
            assert.ok(service, 'Service should be created');
        });
    });

    suite('validatePrompt', () => {
        test('should reject empty prompt', () => {
            const result = dialogService.validatePrompt('');
            assert.ok(result !== null, 'Should return error for empty prompt');
            assert.ok(result!.includes('empty'), 'Error should mention empty');
        });

        test('should reject whitespace-only prompt', () => {
            const result = dialogService.validatePrompt('   ');
            assert.ok(result !== null, 'Should return error for whitespace-only prompt');
        });

        test('should accept non-empty prompt', () => {
            const result = dialogService.validatePrompt('Analyze this code');
            assert.strictEqual(result, null, 'Should accept valid prompt');
        });

        test('should accept prompt with leading/trailing whitespace', () => {
            const result = dialogService.validatePrompt('  some prompt  ');
            assert.strictEqual(result, null, 'Should accept prompt with whitespace');
        });

        test('should accept multi-line prompt', () => {
            const result = dialogService.validatePrompt('Line 1\nLine 2\nLine 3');
            assert.strictEqual(result, null, 'Should accept multi-line prompt');
        });
    });

    suite('validateSkillSelection', () => {
        test('should reject empty skill selection', () => {
            const result = dialogService.validateSkillSelection('');
            assert.ok(result !== null, 'Should return error for empty skill');
            assert.ok(result!.includes('skill'), 'Error should mention skill');
        });

        test('should reject whitespace-only skill selection', () => {
            const result = dialogService.validateSkillSelection('   ');
            assert.ok(result !== null, 'Should return error for whitespace-only skill');
        });

        test('should accept valid skill name', () => {
            const result = dialogService.validateSkillSelection('go-deep');
            assert.strictEqual(result, null, 'Should accept valid skill name');
        });

        test('should accept skill name with special characters', () => {
            const result = dialogService.validateSkillSelection('my-skill_v2');
            assert.strictEqual(result, null, 'Should accept skill with dashes and underscores');
        });
    });

    suite('QueueJobOptions type (prompt mode)', () => {
        test('should have correct structure for prompt mode', () => {
            const options: QueueJobOptions = {
                mode: 'prompt',
                prompt: 'Analyze the codebase',
                model: DEFAULT_MODEL_ID,
                priority: 'normal'
            };

            assert.strictEqual(options.mode, 'prompt');
            assert.strictEqual(options.prompt, 'Analyze the codebase');
            assert.strictEqual(options.model, DEFAULT_MODEL_ID);
            assert.strictEqual(options.priority, 'normal');
            assert.strictEqual(options.skillName, undefined);
        });

        test('should support working directory', () => {
            const options: QueueJobOptions = {
                mode: 'prompt',
                prompt: 'Test prompt',
                model: DEFAULT_MODEL_ID,
                priority: 'high',
                workingDirectory: '/path/to/dir'
            };

            assert.strictEqual(options.workingDirectory, '/path/to/dir');
        });

        test('should support all priority levels', () => {
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

    suite('QueueJobOptions type (skill mode)', () => {
        test('should have correct structure for skill mode', () => {
            const options: QueueJobOptions = {
                mode: 'skill',
                skillName: 'go-deep',
                model: DEFAULT_MODEL_ID,
                priority: 'normal'
            };

            assert.strictEqual(options.mode, 'skill');
            assert.strictEqual(options.skillName, 'go-deep');
            assert.strictEqual(options.prompt, undefined);
        });

        test('should support additional context', () => {
            const options: QueueJobOptions = {
                mode: 'skill',
                skillName: 'impl',
                additionalContext: 'Focus on the authentication module',
                model: DEFAULT_MODEL_ID,
                priority: 'normal'
            };

            assert.strictEqual(options.additionalContext, 'Focus on the authentication module');
        });

        test('should allow undefined additional context', () => {
            const options: QueueJobOptions = {
                mode: 'skill',
                skillName: 'impl',
                model: DEFAULT_MODEL_ID,
                priority: 'low'
            };

            assert.strictEqual(options.additionalContext, undefined);
        });
    });

    suite('QueueJobDialogResult type', () => {
        test('should represent cancelled result', () => {
            const result: QueueJobDialogResult = {
                cancelled: true,
                options: null
            };

            assert.strictEqual(result.cancelled, true);
            assert.strictEqual(result.options, null);
        });

        test('should represent successful prompt mode result', () => {
            const result: QueueJobDialogResult = {
                cancelled: false,
                options: {
                    mode: 'prompt',
                    prompt: 'Analyze code',
                    model: DEFAULT_MODEL_ID,
                    priority: 'normal'
                }
            };

            assert.strictEqual(result.cancelled, false);
            assert.ok(result.options !== null);
            assert.strictEqual(result.options!.mode, 'prompt');
            assert.strictEqual(result.options!.prompt, 'Analyze code');
        });

        test('should represent successful skill mode result', () => {
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
            assert.ok(result.options !== null);
            assert.strictEqual(result.options!.mode, 'skill');
            assert.strictEqual(result.options!.skillName, 'go-deep');
            assert.strictEqual(result.options!.additionalContext, 'Extra info');
        });

        test('should represent result with working directory', () => {
            const result: QueueJobDialogResult = {
                cancelled: false,
                options: {
                    mode: 'prompt',
                    prompt: 'Test',
                    model: DEFAULT_MODEL_ID,
                    priority: 'normal',
                    workingDirectory: '/workspace/src'
                }
            };

            assert.strictEqual(result.options!.workingDirectory, '/workspace/src');
        });
    });

    suite('Webview dialog functionality', () => {
        test('dialog service should have showDialog method', () => {
            assert.ok(typeof dialogService.showDialog === 'function', 'Should have showDialog method');
        });

        test('dialog service should have validation methods', () => {
            assert.ok(typeof dialogService.validatePrompt === 'function', 'Should have validatePrompt');
            assert.ok(typeof dialogService.validateSkillSelection === 'function', 'Should have validateSkillSelection');
        });

        test('dialog service should have getAvailableSkills method', () => {
            assert.ok(typeof dialogService.getAvailableSkills === 'function', 'Should have getAvailableSkills');
        });
    });

    suite('QueueJobMode type', () => {
        test('should support prompt mode', () => {
            const mode: QueueJobMode = 'prompt';
            assert.strictEqual(mode, 'prompt');
        });

        test('should support skill mode', () => {
            const mode: QueueJobMode = 'skill';
            assert.strictEqual(mode, 'skill');
        });
    });

    suite('QueueJobPriority type', () => {
        test('should support all three priority levels', () => {
            const high: QueueJobPriority = 'high';
            const normal: QueueJobPriority = 'normal';
            const low: QueueJobPriority = 'low';

            assert.strictEqual(high, 'high');
            assert.strictEqual(normal, 'normal');
            assert.strictEqual(low, 'low');
        });
    });

    suite('Shared Dialog CSS', () => {
        test('getSharedDialogCSS should return non-empty string', () => {
            const css = getSharedDialogCSS();
            assert.ok(typeof css === 'string', 'Should return a string');
            assert.ok(css.length > 0, 'CSS should not be empty');
        });

        test('getSharedDialogCSS should contain dialog-container class', () => {
            const css = getSharedDialogCSS();
            assert.ok(css.includes('.dialog-container'), 'Should include dialog-container class');
        });

        test('getSharedDialogCSS should contain dialog-header class', () => {
            const css = getSharedDialogCSS();
            assert.ok(css.includes('.dialog-header'), 'Should include dialog-header class');
        });

        test('getSharedDialogCSS should contain mode-tabs class', () => {
            const css = getSharedDialogCSS();
            assert.ok(css.includes('.mode-tabs'), 'Should include mode-tabs class');
        });

        test('getSharedDialogCSS should contain form-group class', () => {
            const css = getSharedDialogCSS();
            assert.ok(css.includes('.form-group'), 'Should include form-group class');
        });

        test('getSharedDialogCSS should contain button classes', () => {
            const css = getSharedDialogCSS();
            assert.ok(css.includes('.btn-primary'), 'Should include btn-primary class');
            assert.ok(css.includes('.btn-secondary'), 'Should include btn-secondary class');
        });

        test('getSharedDialogCSS should contain dialog-footer class', () => {
            const css = getSharedDialogCSS();
            assert.ok(css.includes('.dialog-footer'), 'Should include dialog-footer class');
        });

        test('getSharedDialogCSS should contain mode-content class', () => {
            const css = getSharedDialogCSS();
            assert.ok(css.includes('.mode-content'), 'Should include mode-content class');
        });

        test('getSharedDialogCSS should use VSCode CSS variables', () => {
            const css = getSharedDialogCSS();
            assert.ok(css.includes('var(--vscode-'), 'Should use VSCode CSS variables');
        });

        test('getSharedDialogCSS should contain radio-option class', () => {
            const css = getSharedDialogCSS();
            assert.ok(css.includes('.radio-option'), 'Should include radio-option class');
        });

        test('getSharedDialogCSS should contain .required and .optional label classes', () => {
            const css = getSharedDialogCSS();
            assert.ok(css.includes('.required'), 'Should include .required class');
            assert.ok(css.includes('.optional'), 'Should include .optional class');
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
            assert.strictEqual(persistedModel, VALID_MODELS[2],
                'Dialog service context should have persisted model');
        });

        test('persistence should be isolated per context', () => {
            const context1 = new MockExtensionContext();
            const context2 = new MockExtensionContext();

            saveLastUsedAIModel(context1 as unknown as vscode.ExtensionContext, DEFAULT_MODEL_ID);
            saveLastUsedAIModel(context2 as unknown as vscode.ExtensionContext, VALID_MODELS[1]);

            const model1 = getLastUsedAIModel(context1 as unknown as vscode.ExtensionContext);
            const model2 = getLastUsedAIModel(context2 as unknown as vscode.ExtensionContext);

            assert.strictEqual(model1, DEFAULT_MODEL_ID, 'Context 1 should have its own model');
            assert.strictEqual(model2, VALID_MODELS[1], 'Context 2 should have its own model');
        });
    });

    // ========================================================================
    // HTML Content Tests for getQueueJobDialogHtml
    // ========================================================================

    suite('getQueueJobDialogHtml - HTML structure', () => {
        // Helper to create a minimal mock webview
        function createMockWebview(): any {
            return {
                asWebviewUri: (uri: vscode.Uri) => uri,
                cspSource: 'mock-csp-source',
            };
        }

        const defaultModels = [
            { id: 'gpt-4', label: 'GPT-4', description: '(Recommended)' },
            { id: 'claude-sonnet', label: 'Claude Sonnet' }
        ];

        const defaultSkills = ['impl', 'go-deep', 'review'];

        function generateHtml(options?: {
            models?: typeof defaultModels;
            defaultModel?: string;
            skills?: string[];
            workspaceRoot?: string;
            initialMode?: QueueJobMode;
        }): string {
            return getQueueJobDialogHtml(
                createMockWebview(),
                vscode.Uri.file('/mock/extension'),
                options?.models || defaultModels,
                options?.defaultModel || 'gpt-4',
                options?.skills !== undefined ? options.skills : defaultSkills,
                options?.workspaceRoot || '/workspace',
                options?.initialMode
            );
        }

        test('should return valid HTML document', () => {
            const html = generateHtml();
            assert.ok(html.startsWith('<!DOCTYPE html>'), 'Should start with DOCTYPE');
            assert.ok(html.includes('<html lang="en">'), 'Should have html element with lang');
            assert.ok(html.includes('</html>'), 'Should close html element');
            assert.ok(html.includes('<head>'), 'Should have head element');
            assert.ok(html.includes('<body>'), 'Should have body element');
        });

        test('should include meta charset and viewport', () => {
            const html = generateHtml();
            assert.ok(html.includes('charset="UTF-8"'), 'Should have charset meta');
            assert.ok(html.includes('viewport'), 'Should have viewport meta');
            assert.ok(html.includes('width=device-width'), 'Should set viewport width');
        });

        test('should have dialog title', () => {
            const html = generateHtml();
            assert.ok(html.includes('<title>Queue AI Job</title>'), 'Should have Queue AI Job title');
        });

        test('should include dialog header with icon and title', () => {
            const html = generateHtml();
            assert.ok(html.includes('Queue AI Job'), 'Should contain dialog title text');
            assert.ok(html.includes('dialog-header'), 'Should have dialog-header class');
            assert.ok(html.includes('dialog-close-btn'), 'Should have close button');
        });
    });

    suite('getQueueJobDialogHtml - Tab switching UI', () => {
        function createMockWebview(): any {
            return {
                asWebviewUri: (uri: vscode.Uri) => uri,
                cspSource: 'mock-csp-source',
            };
        }

        function generateHtml(skills: string[] = ['impl', 'go-deep'], initialMode?: QueueJobMode): string {
            return getQueueJobDialogHtml(
                createMockWebview(),
                vscode.Uri.file('/mock/extension'),
                [{ id: 'gpt-4', label: 'GPT-4' }],
                'gpt-4',
                skills,
                '/workspace',
                initialMode
            );
        }

        test('should have Prompt and Skill tabs', () => {
            const html = generateHtml();
            assert.ok(html.includes('id="tabPrompt"'), 'Should have Prompt tab');
            assert.ok(html.includes('id="tabSkill"'), 'Should have Skill tab');
            assert.ok(html.includes('data-mode="prompt"'), 'Prompt tab should have data-mode');
            assert.ok(html.includes('data-mode="skill"'), 'Skill tab should have data-mode');
        });

        test('should have Prompt tab active by default', () => {
            const html = generateHtml();
            // Prompt tab has "active" class in the HTML template
            assert.ok(html.includes('class="mode-tab active" id="tabPrompt"'), 'Prompt tab should be active');
            assert.ok(html.includes('class="mode-content active" id="promptContent"'), 'Prompt content should be visible');
        });

        test('should have tab icons', () => {
            const html = generateHtml();
            // Tab icons are emojis
            assert.ok(html.includes('tab-icon'), 'Should have tab-icon class');
        });

        test('should have mode-content sections for both tabs', () => {
            const html = generateHtml();
            assert.ok(html.includes('id="promptContent"'), 'Should have prompt content section');
            assert.ok(html.includes('id="skillContent"'), 'Should have skill content section');
        });

        test('should disable Skill tab when no skills available', () => {
            const html = generateHtml([]);
            assert.ok(html.includes('disabled'), 'Skill tab should be disabled');
            assert.ok(html.includes('No skills found'), 'Should show no-skills message');
        });

        test('should enable Skill tab when skills are available', () => {
            const html = generateHtml(['impl', 'review']);
            // The skill tab should not have disabled attribute when skills exist
            assert.ok(html.includes('id="skillSelect"'), 'Should have skill select dropdown');
        });
    });

    suite('getQueueJobDialogHtml - Form fields', () => {
        function createMockWebview(): any {
            return {
                asWebviewUri: (uri: vscode.Uri) => uri,
                cspSource: 'mock-csp-source',
            };
        }

        function generateHtml(skills: string[] = ['impl', 'go-deep']): string {
            return getQueueJobDialogHtml(
                createMockWebview(),
                vscode.Uri.file('/mock/extension'),
                [
                    { id: 'gpt-4', label: 'GPT-4', description: '(Recommended)' },
                    { id: 'claude-sonnet', label: 'Claude Sonnet' }
                ],
                'gpt-4',
                skills,
                '/workspace'
            );
        }

        test('should have prompt textarea (Prompt tab)', () => {
            const html = generateHtml();
            assert.ok(html.includes('id="jobPrompt"'), 'Should have prompt textarea');
            assert.ok(html.includes('<textarea'), 'Should use textarea element');
            assert.ok(html.includes('rows="5"'), 'Prompt textarea should have 5 rows');
        });

        test('should mark prompt as required', () => {
            const html = generateHtml();
            // The label for Prompt contains <span class="required">*</span>
            assert.ok(html.includes('Prompt'), 'Should have Prompt label');
            assert.ok(html.includes('class="required"'), 'Should mark prompt as required');
        });

        test('should have prompt error placeholder', () => {
            const html = generateHtml();
            assert.ok(html.includes('id="promptError"'), 'Should have prompt error div');
        });

        test('should have skill dropdown (Skill tab)', () => {
            const html = generateHtml();
            assert.ok(html.includes('id="skillSelect"'), 'Should have skill select');
            assert.ok(html.includes('<select'), 'Should use select element for skill');
            assert.ok(html.includes('-- Select a skill --'), 'Should have placeholder option');
        });

        test('should mark skill as required', () => {
            const html = generateHtml();
            // Skill label has <span class="required">*</span>
            const skillSectionIndex = html.indexOf('id="skillSelect"');
            assert.ok(skillSectionIndex > -1, 'Should have skill select');
            // The label before skillSelect should have required marker
            const beforeSkill = html.substring(0, skillSectionIndex);
            assert.ok(beforeSkill.includes('Skill'), 'Should have Skill label');
        });

        test('should have skill error placeholder', () => {
            const html = generateHtml();
            assert.ok(html.includes('id="skillError"'), 'Should have skill error div');
        });

        test('should have additional context textarea (Skill tab)', () => {
            const html = generateHtml();
            assert.ok(html.includes('id="skillContext"'), 'Should have skill context textarea');
            assert.ok(html.includes('Additional Context'), 'Should have Additional Context label');
            // Marked as optional
            assert.ok(html.includes('(Optional)'), 'Should mark additional context as optional');
        });

        test('should have model dropdown (shared)', () => {
            const html = generateHtml();
            assert.ok(html.includes('id="aiModel"'), 'Should have AI model select');
            assert.ok(html.includes('AI Model'), 'Should have AI Model label');
        });

        test('should have priority radio group (shared)', () => {
            const html = generateHtml();
            assert.ok(html.includes('name="priority"'), 'Should have priority radio inputs');
            assert.ok(html.includes('value="high"'), 'Should have high priority option');
            assert.ok(html.includes('value="normal"'), 'Should have normal priority option');
            assert.ok(html.includes('value="low"'), 'Should have low priority option');
        });

        test('should have normal priority checked by default', () => {
            const html = generateHtml();
            // The normal priority radio should be checked and its label selected
            assert.ok(html.includes('id="priorityNormal"'), 'Should have priorityNormal element');
            // Check the pattern: value="normal" checked
            const normalRadioIndex = html.indexOf('value="normal"');
            assert.ok(normalRadioIndex > -1, 'Should find normal radio');
            const afterNormal = html.substring(normalRadioIndex, normalRadioIndex + 40);
            assert.ok(afterNormal.includes('checked'), 'Normal priority should be checked');
        });

        test('should have priority labels with descriptions', () => {
            const html = generateHtml();
            assert.ok(html.includes('High'), 'Should have High priority label');
            assert.ok(html.includes('Normal'), 'Should have Normal priority label');
            assert.ok(html.includes('Low'), 'Should have Low priority label');
            assert.ok(html.includes('radio-option-desc'), 'Should have priority descriptions');
        });

        test('should have working directory input (shared)', () => {
            const html = generateHtml();
            assert.ok(html.includes('id="workingDir"'), 'Should have working directory input');
            assert.ok(html.includes('Working Directory'), 'Should have Working Directory label');
            // Marked as optional
            const wdLabelIndex = html.indexOf('Working Directory');
            assert.ok(wdLabelIndex > -1);
            const afterLabel = html.substring(wdLabelIndex, wdLabelIndex + 100);
            assert.ok(afterLabel.includes('Optional'), 'Working directory should be optional');
        });

        test('should show workspace root as placeholder for working directory', () => {
            const html = generateHtml();
            // The placeholder should contain the workspace root path
            assert.ok(html.includes('/workspace'), 'Should show workspace root in placeholder');
        });

        test('should show no-skills warning when skills array is empty', () => {
            const html = generateHtml([]);
            assert.ok(html.includes('No skills found'), 'Should show no-skills warning');
            assert.ok(html.includes('.github/skills/'), 'Should mention skills directory');
        });
    });

    suite('getQueueJobDialogHtml - Submit and Cancel buttons', () => {
        function createMockWebview(): any {
            return {
                asWebviewUri: (uri: vscode.Uri) => uri,
                cspSource: 'mock-csp-source',
            };
        }

        function generateHtml(): string {
            return getQueueJobDialogHtml(
                createMockWebview(),
                vscode.Uri.file('/mock/extension'),
                [{ id: 'gpt-4', label: 'GPT-4' }],
                'gpt-4',
                ['impl'],
                '/workspace'
            );
        }

        test('should have Submit button with correct text', () => {
            const html = generateHtml();
            assert.ok(html.includes('id="submitBtn"'), 'Should have submit button');
            assert.ok(html.includes('Queue Job'), 'Submit button should say Queue Job');
            assert.ok(html.includes('btn-primary'), 'Submit should be primary button');
        });

        test('should have Cancel button', () => {
            const html = generateHtml();
            assert.ok(html.includes('id="cancelBtn"'), 'Should have cancel button');
            assert.ok(html.includes('Cancel'), 'Cancel button should say Cancel');
            assert.ok(html.includes('btn-secondary'), 'Cancel should be secondary button');
        });

        test('should have close button in header', () => {
            const html = generateHtml();
            assert.ok(html.includes('id="closeBtn"'), 'Should have close button');
            assert.ok(html.includes('dialog-close-btn'), 'Close button should have correct class');
        });

        test('should have dialog footer', () => {
            const html = generateHtml();
            assert.ok(html.includes('dialog-footer'), 'Should have dialog footer');
        });
    });

    suite('getQueueJobDialogHtml - Security (CSP nonce)', () => {
        function createMockWebview(): any {
            return {
                asWebviewUri: (uri: vscode.Uri) => uri,
                cspSource: 'mock-csp-source',
            };
        }

        function generateHtml(): string {
            return getQueueJobDialogHtml(
                createMockWebview(),
                vscode.Uri.file('/mock/extension'),
                [{ id: 'gpt-4', label: 'GPT-4' }],
                'gpt-4',
                ['impl'],
                '/workspace'
            );
        }

        test('should include Content Security Policy meta tag', () => {
            const html = generateHtml();
            assert.ok(html.includes('Content-Security-Policy'), 'Should have CSP meta tag');
        });

        test('should reference cspSource in CSP', () => {
            const html = generateHtml();
            assert.ok(html.includes('mock-csp-source'), 'Should reference webview cspSource');
        });

        test('should include nonce in CSP script-src', () => {
            const html = generateHtml();
            // CSP should contain script-src 'nonce-...'
            assert.ok(html.includes("script-src 'nonce-"), 'Should have nonce in script-src');
        });

        test('should apply nonce to style element', () => {
            const html = generateHtml();
            // The <style> tag should have nonce attribute
            const styleNonceMatch = html.match(/<style\s+nonce="([^"]+)">/);
            assert.ok(styleNonceMatch, 'Style element should have nonce attribute');
        });

        test('should apply nonce to script element', () => {
            const html = generateHtml();
            // The <script> tag should have nonce attribute
            const scriptNonceMatch = html.match(/<script\s+nonce="([^"]+)">/);
            assert.ok(scriptNonceMatch, 'Script element should have nonce attribute');
        });

        test('nonce in CSP should match nonce on elements', () => {
            const html = generateHtml();

            // Extract nonce from CSP
            const cspNonceMatch = html.match(/nonce-([A-Za-z0-9]+)/);
            assert.ok(cspNonceMatch, 'Should find nonce in CSP');
            const cspNonce = cspNonceMatch![1];

            // Extract nonce from <style>
            const styleNonceMatch = html.match(/<style\s+nonce="([^"]+)">/);
            assert.ok(styleNonceMatch, 'Should find nonce on style');
            assert.strictEqual(styleNonceMatch![1], cspNonce, 'Style nonce should match CSP nonce');

            // Extract nonce from <script>
            const scriptNonceMatch = html.match(/<script\s+nonce="([^"]+)">/);
            assert.ok(scriptNonceMatch, 'Should find nonce on script');
            assert.strictEqual(scriptNonceMatch![1], cspNonce, 'Script nonce should match CSP nonce');
        });

        test('nonce should be unique across invocations', () => {
            const html1 = generateHtml();
            const html2 = generateHtml();

            const nonce1 = html1.match(/nonce-([A-Za-z0-9]+)/)![1];
            const nonce2 = html2.match(/nonce-([A-Za-z0-9]+)/)![1];

            // Extremely high probability of different nonces
            assert.notStrictEqual(nonce1, nonce2, 'Nonces should be unique per invocation');
        });

        test('CSP should restrict default-src to none', () => {
            const html = generateHtml();
            assert.ok(html.includes("default-src 'none'"), 'Should restrict default-src to none');
        });
    });

    suite('getQueueJobDialogHtml - VSCode theming', () => {
        function createMockWebview(): any {
            return {
                asWebviewUri: (uri: vscode.Uri) => uri,
                cspSource: 'mock-csp-source',
            };
        }

        function generateHtml(): string {
            return getQueueJobDialogHtml(
                createMockWebview(),
                vscode.Uri.file('/mock/extension'),
                [{ id: 'gpt-4', label: 'GPT-4' }],
                'gpt-4',
                ['impl'],
                '/workspace'
            );
        }

        test('should use shared dialog CSS', () => {
            const html = generateHtml();
            const sharedCSS = getSharedDialogCSS();
            // Shared CSS content should be embedded in the style tag
            assert.ok(html.includes('.dialog-container'), 'Should include shared dialog-container CSS');
            assert.ok(html.includes('.mode-tabs'), 'Should include shared mode-tabs CSS');
            assert.ok(html.includes('.form-group'), 'Should include shared form-group CSS');
        });

        test('should use VSCode CSS variables for editor background', () => {
            const html = generateHtml();
            assert.ok(html.includes('--vscode-editor-background'), 'Should use editor background variable');
        });

        test('should use VSCode CSS variables for input styling', () => {
            const html = generateHtml();
            assert.ok(html.includes('--vscode-input-background'), 'Should use input background variable');
            assert.ok(html.includes('--vscode-input-border'), 'Should use input border variable');
            assert.ok(html.includes('--vscode-input-foreground'), 'Should use input foreground variable');
        });

        test('should use VSCode CSS variables for button styling', () => {
            const html = generateHtml();
            assert.ok(html.includes('--vscode-button-background'), 'Should use button background variable');
            assert.ok(html.includes('--vscode-button-foreground'), 'Should use button foreground variable');
        });

        test('should use VSCode focus border for interactive elements', () => {
            const html = generateHtml();
            assert.ok(html.includes('--vscode-focusBorder'), 'Should use focus border variable');
        });

        test('should use VSCode error foreground for validation', () => {
            const html = generateHtml();
            assert.ok(html.includes('--vscode-errorForeground'), 'Should use error foreground variable');
        });

        test('should link external components.css stylesheet', () => {
            const html = generateHtml();
            assert.ok(html.includes('components.css'), 'Should link components stylesheet');
            assert.ok(html.includes('rel="stylesheet"'), 'Should use rel=stylesheet');
        });
    });

    suite('getQueueJobDialogHtml - JavaScript behavior', () => {
        function createMockWebview(): any {
            return {
                asWebviewUri: (uri: vscode.Uri) => uri,
                cspSource: 'mock-csp-source',
            };
        }

        function generateHtml(
            skills: string[] = ['impl', 'go-deep'],
            initialMode?: QueueJobMode
        ): string {
            return getQueueJobDialogHtml(
                createMockWebview(),
                vscode.Uri.file('/mock/extension'),
                [
                    { id: 'gpt-4', label: 'GPT-4' },
                    { id: 'claude', label: 'Claude' }
                ],
                'gpt-4',
                skills,
                '/workspace',
                initialMode
            );
        }

        test('should embed models data as JSON', () => {
            const html = generateHtml();
            assert.ok(html.includes('"gpt-4"'), 'Should embed gpt-4 model id');
            assert.ok(html.includes('"claude"'), 'Should embed claude model id');
        });

        test('should embed skills data as JSON', () => {
            const html = generateHtml();
            assert.ok(html.includes('"impl"'), 'Should embed impl skill');
            assert.ok(html.includes('"go-deep"'), 'Should embed go-deep skill');
        });

        test('should embed default model', () => {
            const html = generateHtml();
            // The defaultModel should appear as a JSON string in the script
            assert.ok(html.includes('"gpt-4"'), 'Should embed default model');
        });

        test('should embed workspace root', () => {
            const html = generateHtml();
            assert.ok(html.includes('"/workspace"'), 'Should embed workspace root');
        });

        test('should set initial mode to prompt by default', () => {
            const html = generateHtml([], undefined);
            assert.ok(html.includes('"prompt"'), 'Should embed prompt as initial mode');
        });

        test('should set initial mode to skill when specified', () => {
            const html = generateHtml(['impl'], 'skill');
            // The initialMode variable should be 'skill'
            const initialModeMatch = html.match(/const initialMode = "([^"]+)"/);
            assert.ok(initialModeMatch, 'Should find initialMode assignment');
            assert.strictEqual(initialModeMatch![1], 'skill', 'Should be skill mode');
        });

        test('should include acquireVsCodeApi call', () => {
            const html = generateHtml();
            assert.ok(html.includes('acquireVsCodeApi()'), 'Should call acquireVsCodeApi');
        });

        test('should include Escape key handler', () => {
            const html = generateHtml();
            assert.ok(html.includes("e.key === 'Escape'"), 'Should handle Escape key');
        });

        test('should include Ctrl/Cmd+Enter submit shortcut', () => {
            const html = generateHtml();
            assert.ok(html.includes("e.key === 'Enter'"), 'Should handle Enter key');
            assert.ok(html.includes('e.ctrlKey || e.metaKey'), 'Should check Ctrl/Cmd modifier');
        });

        test('should post submit message with prompt mode data', () => {
            const html = generateHtml();
            // Should include message posting for prompt mode
            assert.ok(html.includes("type: 'submit'"), 'Should post submit message');
            assert.ok(html.includes("mode: 'prompt'"), 'Should include prompt mode');
        });

        test('should post submit message with skill mode data', () => {
            const html = generateHtml();
            // Should include message posting for skill mode
            assert.ok(html.includes("mode: 'skill'"), 'Should include skill mode');
            assert.ok(html.includes('skillName'), 'Should include skillName in skill mode submit');
        });

        test('should post cancel message', () => {
            const html = generateHtml();
            assert.ok(html.includes("type: 'cancel'"), 'Should post cancel message');
        });

        test('should include validation function', () => {
            const html = generateHtml();
            assert.ok(html.includes('updateValidation'), 'Should have updateValidation function');
        });

        test('should include switchMode function', () => {
            const html = generateHtml();
            assert.ok(html.includes('switchMode'), 'Should have switchMode function');
        });

        test('should include priority selection logic', () => {
            const html = generateHtml();
            assert.ok(html.includes('priorityOptions'), 'Should have priority options array');
            assert.ok(html.includes("'selected'"), 'Should toggle selected class on priority');
        });

        test('should include focus management', () => {
            const html = generateHtml();
            // Should set focus on initial load
            assert.ok(html.includes('.focus()'), 'Should manage focus');
        });
    });

    suite('getQueueJobDialogHtml - Model and skill population', () => {
        function createMockWebview(): any {
            return {
                asWebviewUri: (uri: vscode.Uri) => uri,
                cspSource: 'mock-csp-source',
            };
        }

        test('should include all provided models in data', () => {
            const models = [
                { id: 'model-a', label: 'Model A', description: '(Fast)' },
                { id: 'model-b', label: 'Model B' },
                { id: 'model-c', label: 'Model C', description: '(Default)', isDefault: true }
            ];

            const html = getQueueJobDialogHtml(
                createMockWebview(),
                vscode.Uri.file('/mock'),
                models,
                'model-a',
                ['skill-1'],
                '/workspace'
            );

            assert.ok(html.includes('"model-a"'), 'Should include model-a');
            assert.ok(html.includes('"model-b"'), 'Should include model-b');
            assert.ok(html.includes('"model-c"'), 'Should include model-c');
            assert.ok(html.includes('"Model A"'), 'Should include model labels');
        });

        test('should include all provided skills in data', () => {
            const skills = ['code-review', 'summarize', 'explain'];

            const html = getQueueJobDialogHtml(
                createMockWebview(),
                vscode.Uri.file('/mock'),
                [{ id: 'gpt-4', label: 'GPT-4' }],
                'gpt-4',
                skills,
                '/workspace'
            );

            assert.ok(html.includes('"code-review"'), 'Should include code-review skill');
            assert.ok(html.includes('"summarize"'), 'Should include summarize skill');
            assert.ok(html.includes('"explain"'), 'Should include explain skill');
        });

        test('should handle empty models list', () => {
            const html = getQueueJobDialogHtml(
                createMockWebview(),
                vscode.Uri.file('/mock'),
                [],
                '',
                ['impl'],
                '/workspace'
            );

            assert.ok(html.includes('id="aiModel"'), 'Should still have model select');
            assert.ok(html.includes('<!DOCTYPE html>'), 'Should produce valid HTML');
        });

        test('should handle many skills', () => {
            const manySkills = Array.from({ length: 20 }, (_, i) => `skill-${i + 1}`);

            const html = getQueueJobDialogHtml(
                createMockWebview(),
                vscode.Uri.file('/mock'),
                [{ id: 'gpt-4', label: 'GPT-4' }],
                'gpt-4',
                manySkills,
                '/workspace'
            );

            assert.ok(html.includes('"skill-1"'), 'Should include first skill');
            assert.ok(html.includes('"skill-20"'), 'Should include last skill');
        });
    });

    suite('getQueueJobDialogHtml - Edge cases', () => {
        function createMockWebview(): any {
            return {
                asWebviewUri: (uri: vscode.Uri) => uri,
                cspSource: 'mock-csp-source',
            };
        }

        test('should handle workspace root with spaces', () => {
            const html = getQueueJobDialogHtml(
                createMockWebview(),
                vscode.Uri.file('/mock'),
                [{ id: 'gpt-4', label: 'GPT-4' }],
                'gpt-4',
                [],
                '/path/with spaces/workspace'
            );

            assert.ok(html.includes('with spaces'), 'Should handle paths with spaces');
            assert.ok(html.includes('<!DOCTYPE html>'), 'Should produce valid HTML');
        });

        test('should handle empty workspace root', () => {
            const html = getQueueJobDialogHtml(
                createMockWebview(),
                vscode.Uri.file('/mock'),
                [{ id: 'gpt-4', label: 'GPT-4' }],
                'gpt-4',
                [],
                ''
            );

            assert.ok(html.includes('<!DOCTYPE html>'), 'Should produce valid HTML');
            assert.ok(html.includes('id="workingDir"'), 'Should still have working dir input');
        });

        test('should handle special characters in skill names', () => {
            const html = getQueueJobDialogHtml(
                createMockWebview(),
                vscode.Uri.file('/mock'),
                [{ id: 'gpt-4', label: 'GPT-4' }],
                'gpt-4',
                ['my-skill_v2.0'],
                '/workspace'
            );

            assert.ok(html.includes('my-skill_v2.0'), 'Should handle special chars in skills');
        });

        test('should handle special characters in model descriptions', () => {
            const html = getQueueJobDialogHtml(
                createMockWebview(),
                vscode.Uri.file('/mock'),
                [{ id: 'gpt-4', label: 'GPT-4', description: '(Fast & Reliable)' }],
                'gpt-4',
                [],
                '/workspace'
            );

            assert.ok(html.includes('Fast'), 'Should handle special chars in descriptions');
        });

        test('should produce self-contained HTML (no external script references)', () => {
            const html = getQueueJobDialogHtml(
                createMockWebview(),
                vscode.Uri.file('/mock'),
                [{ id: 'gpt-4', label: 'GPT-4' }],
                'gpt-4',
                ['impl'],
                '/workspace'
            );

            // Script should be inline, not from external file
            assert.ok(html.includes('<script nonce='), 'Should have inline script with nonce');
            // Should not reference external JS files
            const externalScriptMatch = html.match(/<script\s+src=/);
            assert.ok(!externalScriptMatch, 'Should not have external script references');
        });
    });

    suite('getQueueJobDialogHtml - Form dividers and layout', () => {
        function createMockWebview(): any {
            return {
                asWebviewUri: (uri: vscode.Uri) => uri,
                cspSource: 'mock-csp-source',
            };
        }

        function generateHtml(): string {
            return getQueueJobDialogHtml(
                createMockWebview(),
                vscode.Uri.file('/mock'),
                [{ id: 'gpt-4', label: 'GPT-4' }],
                'gpt-4',
                ['impl'],
                '/workspace'
            );
        }

        test('should have form dividers separating sections', () => {
            const html = generateHtml();
            assert.ok(html.includes('form-divider'), 'Should have form divider');
        });

        test('should have dialog-body container', () => {
            const html = generateHtml();
            assert.ok(html.includes('dialog-body'), 'Should have dialog-body container');
        });

        test('should have dialog-container as root layout', () => {
            const html = generateHtml();
            assert.ok(html.includes('dialog-container'), 'Should have dialog-container');
        });

        test('should have hints for form fields', () => {
            const html = generateHtml();
            // Count hint elements
            const hintCount = (html.match(/class="hint"/g) || []).length;
            assert.ok(hintCount >= 3, `Should have at least 3 hint elements, found ${hintCount}`);
        });

        test('should have form-group wrappers for all fields', () => {
            const html = generateHtml();
            const formGroupCount = (html.match(/class="form-group"/g) || []).length;
            assert.ok(formGroupCount >= 5, `Should have at least 5 form groups, found ${formGroupCount}`);
        });
    });
});
