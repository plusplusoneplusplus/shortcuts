/**
 * Job Templates Tests
 *
 * Comprehensive tests for the AI Job Templates feature:
 * - JobTemplate types and validation
 * - Template variable extraction and substitution
 * - JobTemplateManager CRUD operations and persistence
 * - Template sorting and scoping
 * - Edge cases and error handling
 *
 * All tests work on Linux, macOS, and Windows.
 */

import * as assert from 'assert';
import * as vscode from 'vscode';
import {
    JobTemplate,
    JobTemplateScope,
    JobTemplateType,
    JobTemplateSortBy,
    CreateTemplateOptions,
    extractTemplateVariables,
    hasTemplateVariables,
    substituteTemplateVariables,
    validateTemplateName
} from '../../shortcuts/ai-service/job-template-types';
import {
    JobTemplateManager,
    getJobTemplateManager,
    resetJobTemplateManager
} from '../../shortcuts/ai-service/job-template-manager';

// ============================================================================
// Mock Classes
// ============================================================================

/**
 * Mock Memento implementation for testing
 */
class MockMemento implements vscode.Memento {
    private storage: Map<string, unknown> = new Map();

    keys(): readonly string[] {
        return Array.from(this.storage.keys());
    }

    get<T>(key: string): T | undefined;
    get<T>(key: string, defaultValue: T): T;
    get<T>(key: string, defaultValue?: T): T | undefined {
        return this.storage.has(key) ? this.storage.get(key) as T : defaultValue;
    }

    async update(key: string, value: unknown): Promise<void> {
        if (value === undefined) {
            this.storage.delete(key);
        } else {
            this.storage.set(key, value);
        }
    }

    setKeysForSync(_keys: readonly string[]): void {
        // No-op for testing
    }

    clear(): void {
        this.storage.clear();
    }
}

/**
 * Mock ExtensionContext for testing
 */
class MockExtensionContext {
    workspaceState = new MockMemento();
    globalState = new MockMemento();
    extensionUri = vscode.Uri.file('/mock/extension');
    subscriptions: vscode.Disposable[] = [];
}

// ============================================================================
// Test Suite
// ============================================================================

suite('Job Templates', () => {
    let manager: JobTemplateManager;
    let mockContext: MockExtensionContext;

    setup(() => {
        resetJobTemplateManager();
        manager = new JobTemplateManager();
        mockContext = new MockExtensionContext();
        manager.initialize(mockContext as unknown as vscode.ExtensionContext);
    });

    teardown(() => {
        manager.dispose();
    });

    // ========================================================================
    // Template Variable Extraction
    // ========================================================================

    suite('extractTemplateVariables', () => {
        test('should extract single variable', () => {
            const vars = extractTemplateVariables('Review {{file}} for bugs');
            assert.deepStrictEqual(vars, ['file']);
        });

        test('should extract multiple unique variables', () => {
            const vars = extractTemplateVariables('Analyze {{file}} in {{module}} context');
            assert.deepStrictEqual(vars, ['file', 'module']);
        });

        test('should return unique variables only', () => {
            const vars = extractTemplateVariables('{{file}} and again {{file}}');
            assert.deepStrictEqual(vars, ['file']);
        });

        test('should return empty array for no variables', () => {
            const vars = extractTemplateVariables('Plain prompt with no variables');
            assert.deepStrictEqual(vars, []);
        });

        test('should handle underscores in variable names', () => {
            const vars = extractTemplateVariables('Check {{file_path}} for {{error_type}}');
            assert.deepStrictEqual(vars, ['file_path', 'error_type']);
        });

        test('should handle variables with digits', () => {
            const vars = extractTemplateVariables('Process {{item1}} and {{item2}}');
            assert.deepStrictEqual(vars, ['item1', 'item2']);
        });

        test('should ignore invalid variable patterns', () => {
            const vars = extractTemplateVariables('Not a {{}} variable or {{123}}');
            assert.deepStrictEqual(vars, []);
        });

        test('should handle variables at start and end', () => {
            const vars = extractTemplateVariables('{{start}} middle {{end}}');
            assert.deepStrictEqual(vars, ['start', 'end']);
        });

        test('should handle adjacent variables', () => {
            const vars = extractTemplateVariables('{{a}}{{b}}{{c}}');
            assert.deepStrictEqual(vars, ['a', 'b', 'c']);
        });

        test('should handle empty string', () => {
            const vars = extractTemplateVariables('');
            assert.deepStrictEqual(vars, []);
        });

        test('should handle multiline prompts', () => {
            const vars = extractTemplateVariables(
                'Line 1 {{var1}}\nLine 2 {{var2}}\nLine 3 {{var1}}'
            );
            assert.deepStrictEqual(vars, ['var1', 'var2']);
        });
    });

    // ========================================================================
    // hasTemplateVariables
    // ========================================================================

    suite('hasTemplateVariables', () => {
        test('should return true when variables exist', () => {
            assert.strictEqual(hasTemplateVariables('Hello {{name}}'), true);
        });

        test('should return false when no variables', () => {
            assert.strictEqual(hasTemplateVariables('Hello world'), false);
        });

        test('should return false for empty string', () => {
            assert.strictEqual(hasTemplateVariables(''), false);
        });

        test('should return false for empty braces', () => {
            assert.strictEqual(hasTemplateVariables('Hello {{}}'), false);
        });

        test('should return true for valid variable at end', () => {
            assert.strictEqual(hasTemplateVariables('Value is {{x}}'), true);
        });
    });

    // ========================================================================
    // substituteTemplateVariables
    // ========================================================================

    suite('substituteTemplateVariables', () => {
        test('should substitute single variable', () => {
            const result = substituteTemplateVariables('Review {{file}}', { file: 'main.ts' });
            assert.strictEqual(result, 'Review main.ts');
        });

        test('should substitute multiple variables', () => {
            const result = substituteTemplateVariables(
                '{{action}} {{file}} in {{dir}}',
                { action: 'Analyze', file: 'index.ts', dir: 'src/' }
            );
            assert.strictEqual(result, 'Analyze index.ts in src/');
        });

        test('should leave unmatched variables unchanged', () => {
            const result = substituteTemplateVariables(
                '{{known}} and {{unknown}}',
                { known: 'value' }
            );
            assert.strictEqual(result, 'value and {{unknown}}');
        });

        test('should handle empty values', () => {
            const result = substituteTemplateVariables('Pre {{var}} Post', { var: '' });
            assert.strictEqual(result, 'Pre  Post');
        });

        test('should handle duplicate variables', () => {
            const result = substituteTemplateVariables(
                '{{x}} and {{x}}',
                { x: 'same' }
            );
            assert.strictEqual(result, 'same and same');
        });

        test('should handle no variables in template', () => {
            const result = substituteTemplateVariables('No variables here', { file: 'test' });
            assert.strictEqual(result, 'No variables here');
        });

        test('should handle empty values map', () => {
            const result = substituteTemplateVariables('Keep {{var}}', {});
            assert.strictEqual(result, 'Keep {{var}}');
        });

        test('should handle special characters in values', () => {
            const result = substituteTemplateVariables('Path: {{path}}', {
                path: '/Users/test/Documents/My Project/src'
            });
            assert.strictEqual(result, 'Path: /Users/test/Documents/My Project/src');
        });
    });

    // ========================================================================
    // validateTemplateName
    // ========================================================================

    suite('validateTemplateName', () => {
        test('should accept valid name', () => {
            assert.strictEqual(validateTemplateName('Review PR changes'), null);
        });

        test('should reject empty string', () => {
            const result = validateTemplateName('');
            assert.ok(result !== null);
            assert.ok(result!.toLowerCase().includes('empty'));
        });

        test('should reject whitespace-only string', () => {
            const result = validateTemplateName('   \t\n  ');
            assert.ok(result !== null);
        });

        test('should accept single character', () => {
            assert.strictEqual(validateTemplateName('x'), null);
        });

        test('should accept name with special characters', () => {
            assert.strictEqual(validateTemplateName('Review: PR #42 (bugfix)'), null);
        });

        test('should reject name over 100 characters', () => {
            const longName = 'a'.repeat(101);
            const result = validateTemplateName(longName);
            assert.ok(result !== null);
            assert.ok(result!.includes('100'));
        });

        test('should accept name at exactly 100 characters', () => {
            const name = 'a'.repeat(100);
            assert.strictEqual(validateTemplateName(name), null);
        });
    });

    // ========================================================================
    // JobTemplate type structure
    // ========================================================================

    suite('JobTemplate type structure', () => {
        test('should create valid freeform template', () => {
            const template: JobTemplate = {
                id: 'tmpl-1',
                name: 'Test Template',
                scope: 'workspace',
                prompt: 'Analyze this code',
                type: 'freeform',
                createdAt: new Date().toISOString(),
                useCount: 0,
            };
            assert.strictEqual(template.id, 'tmpl-1');
            assert.strictEqual(template.type, 'freeform');
            assert.strictEqual(template.skillName, undefined);
        });

        test('should create valid skill template', () => {
            const template: JobTemplate = {
                id: 'tmpl-2',
                name: 'Skill Template',
                scope: 'global',
                prompt: 'Analyze {{file}}',
                type: 'skill',
                skillName: 'code-review',
                model: 'claude-sonnet-4.5',
                workingDirectory: '/workspace/src',
                createdAt: new Date().toISOString(),
                lastUsedAt: new Date().toISOString(),
                useCount: 5,
            };
            assert.strictEqual(template.type, 'skill');
            assert.strictEqual(template.skillName, 'code-review');
            assert.strictEqual(template.scope, 'global');
        });

        test('should support optional fields', () => {
            const template: JobTemplate = {
                id: 'tmpl-3',
                name: 'Minimal Template',
                scope: 'workspace',
                prompt: 'Simple prompt',
                type: 'freeform',
                createdAt: new Date().toISOString(),
                useCount: 0,
            };
            assert.strictEqual(template.model, undefined);
            assert.strictEqual(template.workingDirectory, undefined);
            assert.strictEqual(template.skillName, undefined);
            assert.strictEqual(template.lastUsedAt, undefined);
        });
    });

    // ========================================================================
    // JobTemplateManager - Initialization
    // ========================================================================

    suite('JobTemplateManager initialization', () => {
        test('should initialize with context', () => {
            assert.ok(manager.isInitialized());
        });

        test('should not be initialized before calling initialize', () => {
            const freshManager = new JobTemplateManager();
            assert.strictEqual(freshManager.isInitialized(), false);
            freshManager.dispose();
        });

        test('should return empty templates when no data stored', () => {
            const templates = manager.getAllTemplates();
            assert.strictEqual(templates.length, 0);
        });

        test('should return 0 count when empty', () => {
            assert.strictEqual(manager.getTemplateCount(), 0);
        });
    });

    // ========================================================================
    // JobTemplateManager - Save Template
    // ========================================================================

    suite('JobTemplateManager saveTemplate', () => {
        test('should save a freeform workspace template', async () => {
            const template = await manager.saveTemplate({
                name: 'My Template',
                scope: 'workspace',
                prompt: 'Test prompt',
                type: 'freeform',
            });
            assert.ok(template);
            assert.strictEqual(template!.name, 'My Template');
            assert.strictEqual(template!.scope, 'workspace');
            assert.strictEqual(template!.type, 'freeform');
            assert.strictEqual(template!.useCount, 0);
            assert.ok(template!.id.startsWith('tmpl-'));
            assert.ok(template!.createdAt);
        });

        test('should save a global template', async () => {
            const template = await manager.saveTemplate({
                name: 'Global Template',
                scope: 'global',
                prompt: 'Global prompt',
                type: 'freeform',
            });
            assert.ok(template);
            assert.strictEqual(template!.scope, 'global');
        });

        test('should save a skill template with all fields', async () => {
            const template = await manager.saveTemplate({
                name: 'Skill Template',
                scope: 'workspace',
                prompt: 'Review {{file}}',
                type: 'skill',
                skillName: 'code-review',
                model: 'claude-sonnet-4.5',
                workingDirectory: '/workspace/src',
            });
            assert.ok(template);
            assert.strictEqual(template!.type, 'skill');
            assert.strictEqual(template!.skillName, 'code-review');
            assert.strictEqual(template!.model, 'claude-sonnet-4.5');
            assert.strictEqual(template!.workingDirectory, '/workspace/src');
        });

        test('should trim whitespace from name', async () => {
            const template = await manager.saveTemplate({
                name: '  Spaces  ',
                scope: 'workspace',
                prompt: 'Test',
                type: 'freeform',
            });
            assert.ok(template);
            assert.strictEqual(template!.name, 'Spaces');
        });

        test('should reject empty name', async () => {
            const template = await manager.saveTemplate({
                name: '',
                scope: 'workspace',
                prompt: 'Test',
                type: 'freeform',
            });
            assert.strictEqual(template, undefined);
        });

        test('should reject whitespace-only name', async () => {
            const template = await manager.saveTemplate({
                name: '   ',
                scope: 'workspace',
                prompt: 'Test',
                type: 'freeform',
            });
            assert.strictEqual(template, undefined);
        });

        test('should overwrite existing template with same name (case-insensitive)', async () => {
            await manager.saveTemplate({
                name: 'Duplicate',
                scope: 'workspace',
                prompt: 'Original',
                type: 'freeform',
            });

            const updated = await manager.saveTemplate({
                name: 'duplicate',
                scope: 'workspace',
                prompt: 'Updated',
                type: 'freeform',
            });

            assert.ok(updated);
            assert.strictEqual(updated!.prompt, 'Updated');
            assert.strictEqual(manager.getTemplatesByScope('workspace').length, 1);
        });

        test('should return undefined when not initialized', async () => {
            const uninit = new JobTemplateManager();
            const result = await uninit.saveTemplate({
                name: 'Test',
                scope: 'workspace',
                prompt: 'Test',
                type: 'freeform',
            });
            assert.strictEqual(result, undefined);
            uninit.dispose();
        });

        test('should persist templates to workspace state', async () => {
            await manager.saveTemplate({
                name: 'Workspace Template',
                scope: 'workspace',
                prompt: 'WS prompt',
                type: 'freeform',
            });

            // Create new manager, initialize with same context
            const newManager = new JobTemplateManager();
            newManager.initialize(mockContext as unknown as vscode.ExtensionContext);
            const templates = newManager.getTemplatesByScope('workspace');
            assert.strictEqual(templates.length, 1);
            assert.strictEqual(templates[0].name, 'Workspace Template');
            newManager.dispose();
        });

        test('should persist templates to global state', async () => {
            await manager.saveTemplate({
                name: 'Global Template',
                scope: 'global',
                prompt: 'Global prompt',
                type: 'freeform',
            });

            const newManager = new JobTemplateManager();
            newManager.initialize(mockContext as unknown as vscode.ExtensionContext);
            const templates = newManager.getTemplatesByScope('global');
            assert.strictEqual(templates.length, 1);
            assert.strictEqual(templates[0].name, 'Global Template');
            newManager.dispose();
        });
    });

    // ========================================================================
    // JobTemplateManager - Retrieval
    // ========================================================================

    suite('JobTemplateManager retrieval', () => {
        setup(async () => {
            await manager.saveTemplate({ name: 'WS1', scope: 'workspace', prompt: 'p1', type: 'freeform' });
            await manager.saveTemplate({ name: 'WS2', scope: 'workspace', prompt: 'p2', type: 'freeform' });
            await manager.saveTemplate({ name: 'G1', scope: 'global', prompt: 'p3', type: 'freeform' });
        });

        test('getAllTemplates returns all templates', () => {
            const all = manager.getAllTemplates();
            assert.strictEqual(all.length, 3);
        });

        test('getTemplatesByScope filters correctly', () => {
            assert.strictEqual(manager.getTemplatesByScope('workspace').length, 2);
            assert.strictEqual(manager.getTemplatesByScope('global').length, 1);
        });

        test('getTemplate returns by ID', async () => {
            const all = manager.getAllTemplates();
            const first = all[0];
            const found = manager.getTemplate(first.id);
            assert.ok(found);
            assert.strictEqual(found!.id, first.id);
        });

        test('getTemplate returns undefined for non-existent ID', () => {
            assert.strictEqual(manager.getTemplate('non-existent'), undefined);
        });

        test('getTemplateByName finds case-insensitively', () => {
            const found = manager.getTemplateByName('ws1');
            assert.ok(found);
            assert.strictEqual(found!.name, 'WS1');
        });

        test('getTemplateByName with scope filter', () => {
            const found = manager.getTemplateByName('WS1', 'workspace');
            assert.ok(found);

            const notFound = manager.getTemplateByName('WS1', 'global');
            assert.strictEqual(notFound, undefined);
        });

        test('getTemplateByName returns undefined for non-existent', () => {
            assert.strictEqual(manager.getTemplateByName('NonExistent'), undefined);
        });

        test('getTemplateCount returns correct count', () => {
            assert.strictEqual(manager.getTemplateCount(), 3);
        });

        test('hasTemplateName checks correctly', () => {
            assert.strictEqual(manager.hasTemplateName('WS1'), true);
            assert.strictEqual(manager.hasTemplateName('ws1'), true);
            assert.strictEqual(manager.hasTemplateName('NonExistent'), false);
        });

        test('hasTemplateName with scope filter', () => {
            assert.strictEqual(manager.hasTemplateName('WS1', 'workspace'), true);
            assert.strictEqual(manager.hasTemplateName('WS1', 'global'), false);
        });
    });

    // ========================================================================
    // JobTemplateManager - Delete
    // ========================================================================

    suite('JobTemplateManager deleteTemplate', () => {
        test('should delete workspace template by ID', async () => {
            const template = await manager.saveTemplate({
                name: 'ToDelete',
                scope: 'workspace',
                prompt: 'Delete me',
                type: 'freeform',
            });
            assert.ok(template);

            const deleted = await manager.deleteTemplate(template!.id);
            assert.strictEqual(deleted, true);
            assert.strictEqual(manager.getTemplateCount(), 0);
        });

        test('should delete global template by ID', async () => {
            const template = await manager.saveTemplate({
                name: 'GlobalToDelete',
                scope: 'global',
                prompt: 'Delete me',
                type: 'freeform',
            });
            assert.ok(template);

            const deleted = await manager.deleteTemplate(template!.id);
            assert.strictEqual(deleted, true);
            assert.strictEqual(manager.getTemplatesByScope('global').length, 0);
        });

        test('should return false for non-existent ID', async () => {
            const deleted = await manager.deleteTemplate('non-existent');
            assert.strictEqual(deleted, false);
        });

        test('should not affect other templates', async () => {
            const t1 = await manager.saveTemplate({ name: 'Keep', scope: 'workspace', prompt: 'p', type: 'freeform' });
            const t2 = await manager.saveTemplate({ name: 'Delete', scope: 'workspace', prompt: 'p', type: 'freeform' });

            await manager.deleteTemplate(t2!.id);
            assert.strictEqual(manager.getTemplateCount(), 1);
            assert.ok(manager.getTemplate(t1!.id));
        });
    });

    // ========================================================================
    // JobTemplateManager - Rename
    // ========================================================================

    suite('JobTemplateManager renameTemplate', () => {
        test('should rename a template', async () => {
            const template = await manager.saveTemplate({
                name: 'OldName',
                scope: 'workspace',
                prompt: 'test',
                type: 'freeform',
            });

            const renamed = await manager.renameTemplate(template!.id, 'NewName');
            assert.strictEqual(renamed, true);

            const updated = manager.getTemplate(template!.id);
            assert.strictEqual(updated!.name, 'NewName');
        });

        test('should reject empty name', async () => {
            const template = await manager.saveTemplate({
                name: 'Original',
                scope: 'workspace',
                prompt: 'test',
                type: 'freeform',
            });

            const renamed = await manager.renameTemplate(template!.id, '');
            assert.strictEqual(renamed, false);
        });

        test('should reject if name conflicts with another template', async () => {
            await manager.saveTemplate({ name: 'Existing', scope: 'workspace', prompt: 'test', type: 'freeform' });
            const t2 = await manager.saveTemplate({ name: 'ToRename', scope: 'workspace', prompt: 'test', type: 'freeform' });

            const renamed = await manager.renameTemplate(t2!.id, 'Existing');
            assert.strictEqual(renamed, false);
        });

        test('should allow renaming to same name (no-op)', async () => {
            const template = await manager.saveTemplate({
                name: 'SameName',
                scope: 'workspace',
                prompt: 'test',
                type: 'freeform',
            });

            const renamed = await manager.renameTemplate(template!.id, 'SameName');
            assert.strictEqual(renamed, true);
        });

        test('should return false for non-existent ID', async () => {
            const renamed = await manager.renameTemplate('non-existent', 'NewName');
            assert.strictEqual(renamed, false);
        });
    });

    // ========================================================================
    // JobTemplateManager - Usage Tracking
    // ========================================================================

    suite('JobTemplateManager recordUsage', () => {
        test('should increment useCount', async () => {
            const template = await manager.saveTemplate({
                name: 'Usage Test',
                scope: 'workspace',
                prompt: 'test',
                type: 'freeform',
            });
            assert.strictEqual(template!.useCount, 0);

            await manager.recordUsage(template!.id);
            const updated = manager.getTemplate(template!.id);
            assert.strictEqual(updated!.useCount, 1);

            await manager.recordUsage(template!.id);
            const updated2 = manager.getTemplate(template!.id);
            assert.strictEqual(updated2!.useCount, 2);
        });

        test('should update lastUsedAt', async () => {
            const template = await manager.saveTemplate({
                name: 'Usage Time',
                scope: 'workspace',
                prompt: 'test',
                type: 'freeform',
            });
            assert.strictEqual(template!.lastUsedAt, undefined);

            await manager.recordUsage(template!.id);
            const updated = manager.getTemplate(template!.id);
            assert.ok(updated!.lastUsedAt);
        });

        test('should be no-op for non-existent ID', async () => {
            // Should not throw
            await manager.recordUsage('non-existent');
        });
    });

    // ========================================================================
    // JobTemplateManager - Clear
    // ========================================================================

    suite('JobTemplateManager clearTemplates', () => {
        setup(async () => {
            await manager.saveTemplate({ name: 'WS', scope: 'workspace', prompt: 'p', type: 'freeform' });
            await manager.saveTemplate({ name: 'G', scope: 'global', prompt: 'p', type: 'freeform' });
        });

        test('should clear workspace templates only', async () => {
            await manager.clearTemplates('workspace');
            assert.strictEqual(manager.getTemplatesByScope('workspace').length, 0);
            assert.strictEqual(manager.getTemplatesByScope('global').length, 1);
        });

        test('should clear global templates only', async () => {
            await manager.clearTemplates('global');
            assert.strictEqual(manager.getTemplatesByScope('workspace').length, 1);
            assert.strictEqual(manager.getTemplatesByScope('global').length, 0);
        });

        test('should clear all templates when no scope given', async () => {
            await manager.clearTemplates();
            assert.strictEqual(manager.getTemplateCount(), 0);
        });
    });

    // ========================================================================
    // JobTemplateManager - Sorting
    // ========================================================================

    suite('JobTemplateManager sorting', () => {
        test('should sort by name', async () => {
            await manager.saveTemplate({ name: 'Charlie', scope: 'workspace', prompt: 'p', type: 'freeform' });
            await manager.saveTemplate({ name: 'Alpha', scope: 'workspace', prompt: 'p', type: 'freeform' });
            await manager.saveTemplate({ name: 'Bravo', scope: 'workspace', prompt: 'p', type: 'freeform' });

            const sorted = manager.getAllTemplates('name');
            assert.strictEqual(sorted[0].name, 'Alpha');
            assert.strictEqual(sorted[1].name, 'Bravo');
            assert.strictEqual(sorted[2].name, 'Charlie');
        });

        test('should sort by useCount (most used first)', async () => {
            const t1 = await manager.saveTemplate({ name: 'Low', scope: 'workspace', prompt: 'p', type: 'freeform' });
            const t2 = await manager.saveTemplate({ name: 'High', scope: 'workspace', prompt: 'p', type: 'freeform' });
            const t3 = await manager.saveTemplate({ name: 'Mid', scope: 'workspace', prompt: 'p', type: 'freeform' });

            await manager.recordUsage(t2!.id);
            await manager.recordUsage(t2!.id);
            await manager.recordUsage(t2!.id);
            await manager.recordUsage(t3!.id);

            const sorted = manager.getAllTemplates('useCount');
            assert.strictEqual(sorted[0].name, 'High');
            assert.strictEqual(sorted[1].name, 'Mid');
            assert.strictEqual(sorted[2].name, 'Low');
        });

        test('should sort by lastUsed (most recent first)', async () => {
            const t1 = await manager.saveTemplate({ name: 'Old', scope: 'workspace', prompt: 'p', type: 'freeform' });
            const t2 = await manager.saveTemplate({ name: 'New', scope: 'workspace', prompt: 'p', type: 'freeform' });

            // Use t1 first, then t2 - t2 should appear first in lastUsed sort
            await manager.recordUsage(t1!.id);
            // Small delay to ensure different timestamps
            await new Promise(resolve => setTimeout(resolve, 10));
            await manager.recordUsage(t2!.id);

            const sorted = manager.getAllTemplates('lastUsed');
            assert.strictEqual(sorted[0].name, 'New');
            assert.strictEqual(sorted[1].name, 'Old');
        });
    });

    // ========================================================================
    // JobTemplateManager - Variable Values Persistence
    // ========================================================================

    suite('JobTemplateManager variable values', () => {
        test('should save and retrieve variable values', async () => {
            await manager.saveLastUsedVariables('tmpl-1', { file: 'main.ts', module: 'auth' });

            const values = manager.getLastUsedVariables('tmpl-1');
            assert.strictEqual(values.file, 'main.ts');
            assert.strictEqual(values.module, 'auth');
        });

        test('should return empty object for unknown template', () => {
            const values = manager.getLastUsedVariables('unknown');
            assert.deepStrictEqual(values, {});
        });

        test('should overwrite previous values', async () => {
            await manager.saveLastUsedVariables('tmpl-1', { file: 'old.ts' });
            await manager.saveLastUsedVariables('tmpl-1', { file: 'new.ts' });

            const values = manager.getLastUsedVariables('tmpl-1');
            assert.strictEqual(values.file, 'new.ts');
        });

        test('should keep values isolated per template', async () => {
            await manager.saveLastUsedVariables('tmpl-1', { file: 'a.ts' });
            await manager.saveLastUsedVariables('tmpl-2', { file: 'b.ts' });

            assert.strictEqual(manager.getLastUsedVariables('tmpl-1').file, 'a.ts');
            assert.strictEqual(manager.getLastUsedVariables('tmpl-2').file, 'b.ts');
        });
    });

    // ========================================================================
    // JobTemplateManager - Events
    // ========================================================================

    suite('JobTemplateManager events', () => {
        test('should fire onDidChangeTemplates on save', async () => {
            let fired = false;
            manager.onDidChangeTemplates(() => { fired = true; });

            await manager.saveTemplate({ name: 'Event Test', scope: 'workspace', prompt: 'p', type: 'freeform' });
            assert.strictEqual(fired, true);
        });

        test('should fire onDidChangeTemplates on delete', async () => {
            const t = await manager.saveTemplate({ name: 'ToDelete', scope: 'workspace', prompt: 'p', type: 'freeform' });
            let fired = false;
            manager.onDidChangeTemplates(() => { fired = true; });

            await manager.deleteTemplate(t!.id);
            assert.strictEqual(fired, true);
        });

        test('should fire onDidChangeTemplates on rename', async () => {
            const t = await manager.saveTemplate({ name: 'ToRename', scope: 'workspace', prompt: 'p', type: 'freeform' });
            let fired = false;
            manager.onDidChangeTemplates(() => { fired = true; });

            await manager.renameTemplate(t!.id, 'Renamed');
            assert.strictEqual(fired, true);
        });

        test('should fire onDidChangeTemplates on clear', async () => {
            await manager.saveTemplate({ name: 'ToClear', scope: 'workspace', prompt: 'p', type: 'freeform' });
            let fired = false;
            manager.onDidChangeTemplates(() => { fired = true; });

            await manager.clearTemplates();
            assert.strictEqual(fired, true);
        });

        test('should fire onDidChangeTemplates on recordUsage', async () => {
            const t = await manager.saveTemplate({ name: 'Usage', scope: 'workspace', prompt: 'p', type: 'freeform' });
            let fired = false;
            manager.onDidChangeTemplates(() => { fired = true; });

            await manager.recordUsage(t!.id);
            assert.strictEqual(fired, true);
        });
    });

    // ========================================================================
    // Singleton
    // ========================================================================

    suite('Singleton pattern', () => {
        test('getJobTemplateManager returns same instance', () => {
            resetJobTemplateManager();
            const m1 = getJobTemplateManager();
            const m2 = getJobTemplateManager();
            assert.strictEqual(m1, m2);
        });

        test('resetJobTemplateManager creates new instance', () => {
            resetJobTemplateManager();
            const m1 = getJobTemplateManager();
            resetJobTemplateManager();
            const m2 = getJobTemplateManager();
            assert.notStrictEqual(m1, m2);
        });
    });

    // ========================================================================
    // Edge Cases
    // ========================================================================

    suite('Edge cases', () => {
        test('should handle concurrent saves', async () => {
            const promises = [];
            for (let i = 0; i < 10; i++) {
                promises.push(manager.saveTemplate({
                    name: `Template ${i}`,
                    scope: 'workspace',
                    prompt: `Prompt ${i}`,
                    type: 'freeform',
                }));
            }

            const results = await Promise.all(promises);
            const successCount = results.filter(r => r !== undefined).length;
            assert.strictEqual(successCount, 10);
        });

        test('should handle scope isolation', async () => {
            // Same name in different scopes should both exist
            await manager.saveTemplate({ name: 'Same Name', scope: 'workspace', prompt: 'WS', type: 'freeform' });
            await manager.saveTemplate({ name: 'Same Name', scope: 'global', prompt: 'Global', type: 'freeform' });

            assert.strictEqual(manager.getTemplatesByScope('workspace').length, 1);
            assert.strictEqual(manager.getTemplatesByScope('global').length, 1);
            assert.strictEqual(manager.getTemplateCount(), 2);
        });

        test('should handle empty prompt', async () => {
            const template = await manager.saveTemplate({
                name: 'Empty Prompt',
                scope: 'workspace',
                prompt: '',
                type: 'freeform',
            });
            assert.ok(template);
            assert.strictEqual(template!.prompt, '');
        });

        test('should handle unicode in names and prompts', async () => {
            const template = await manager.saveTemplate({
                name: '🔍 Review コード',
                scope: 'workspace',
                prompt: '分析 {{ファイル}} для поиска ошибок',
                type: 'freeform',
            });
            assert.ok(template);
            assert.strictEqual(template!.name, '🔍 Review コード');
        });

        test('uninitialised manager returns empty arrays', () => {
            const uninit = new JobTemplateManager();
            assert.deepStrictEqual(uninit.getTemplatesByScope('workspace'), []);
            assert.deepStrictEqual(uninit.getTemplatesByScope('global'), []);
            assert.deepStrictEqual(uninit.getAllTemplates(), []);
            assert.strictEqual(uninit.getTemplateCount(), 0);
            uninit.dispose();
        });

        test('uninitialised manager getLastUsedVariables returns empty object', () => {
            const uninit = new JobTemplateManager();
            assert.deepStrictEqual(uninit.getLastUsedVariables('test'), {});
            uninit.dispose();
        });
    });

    // ========================================================================
    // Template Overwrite via Same Scope
    // ========================================================================

    suite('Template overwrite behavior', () => {
        test('overwrite preserves original createdAt', async () => {
            const original = await manager.saveTemplate({
                name: 'Overwrite Test',
                scope: 'workspace',
                prompt: 'Original',
                type: 'freeform',
            });
            const originalCreatedAt = original!.createdAt;

            // Small delay to ensure different timestamps
            await new Promise(resolve => setTimeout(resolve, 10));

            const updated = await manager.saveTemplate({
                name: 'Overwrite Test',
                scope: 'workspace',
                prompt: 'Updated',
                type: 'freeform',
            });

            assert.strictEqual(updated!.createdAt, originalCreatedAt);
            assert.strictEqual(updated!.prompt, 'Updated');
        });

        test('overwrite preserves original ID', async () => {
            const original = await manager.saveTemplate({
                name: 'ID Preserve',
                scope: 'workspace',
                prompt: 'Original',
                type: 'freeform',
            });
            const originalId = original!.id;

            const updated = await manager.saveTemplate({
                name: 'id preserve',
                scope: 'workspace',
                prompt: 'Updated',
                type: 'freeform',
            });

            assert.strictEqual(updated!.id, originalId);
        });
    });

    // ========================================================================
    // Max Templates Enforcement
    // ========================================================================

    suite('Max templates enforcement', () => {
        test('should not exceed 50 templates per scope', async () => {
            // Save 51 templates to workspace scope
            for (let i = 0; i < 51; i++) {
                await manager.saveTemplate({
                    name: `Template ${i.toString().padStart(3, '0')}`,
                    scope: 'workspace',
                    prompt: `Prompt ${i}`,
                    type: 'freeform',
                });
            }

            const wsTemplates = manager.getTemplatesByScope('workspace');
            assert.ok(wsTemplates.length <= 50, `Expected <= 50 templates, got ${wsTemplates.length}`);
        });
    });
});
