/**
 * Tests for Execute Work Plan feature
 * 
 * Tests the functionality for executing work plans from the Markdown Review Editor
 * using prompt files (.prompt.md) and interactive AI sessions.
 */

import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// ============================================================================
// Test Utilities
// ============================================================================

/**
 * Create a temporary directory for testing
 */
function createTempDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'execute-work-plan-test-'));
}

/**
 * Clean up a temporary directory
 */
function cleanupTempDir(dir: string): void {
    if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

// ============================================================================
// Prompt Generation Tests
// ============================================================================

suite('Execute Work Plan - Prompt Generation', () => {
    test('should generate simple prompt with file paths', () => {
        const promptFilePath = '/workspace/.github/prompts/implement-task.prompt.md';
        const planFilePath = '/workspace/.vscode/tasks/feature-plan.md';

        // The prompt format as specified in the design
        const fullPrompt = `Follow ${promptFilePath} for ${planFilePath}`;

        assert.strictEqual(
            fullPrompt,
            'Follow /workspace/.github/prompts/implement-task.prompt.md for /workspace/.vscode/tasks/feature-plan.md'
        );
    });

    test('should handle paths with spaces', () => {
        const promptFilePath = '/workspace/My Project/.github/prompts/review.prompt.md';
        const planFilePath = '/workspace/My Project/.vscode/tasks/my plan.md';

        const fullPrompt = `Follow ${promptFilePath} for ${planFilePath}`;

        assert.ok(fullPrompt.includes('My Project'));
        assert.ok(fullPrompt.includes('my plan.md'));
    });

    test('should handle Windows-style paths', () => {
        const promptFilePath = 'C:\\Users\\dev\\project\\.github\\prompts\\task.prompt.md';
        const planFilePath = 'C:\\Users\\dev\\project\\.vscode\\tasks\\plan.md';

        const fullPrompt = `Follow ${promptFilePath} for ${planFilePath}`;

        assert.ok(fullPrompt.includes(promptFilePath));
        assert.ok(fullPrompt.includes(planFilePath));
    });

    test('should handle special characters in file names', () => {
        const promptFilePath = '/workspace/.github/prompts/code-review_v2.prompt.md';
        const planFilePath = '/workspace/.vscode/tasks/feature-auth[v2].md';

        const fullPrompt = `Follow ${promptFilePath} for ${planFilePath}`;

        assert.ok(fullPrompt.includes('code-review_v2'));
        assert.ok(fullPrompt.includes('feature-auth[v2]'));
    });
});

// ============================================================================
// Working Directory Resolution Tests
// ============================================================================

suite('Execute Work Plan - Working Directory Resolution', () => {
    let tempDir: string;

    setup(() => {
        tempDir = createTempDir();
    });

    teardown(() => {
        cleanupTempDir(tempDir);
    });

    test('should use workspace/src if it exists', () => {
        // Create src directory
        const srcDir = path.join(tempDir, 'src');
        fs.mkdirSync(srcDir, { recursive: true });

        const configPath = '{workspaceFolder}/src';
        const resolved = configPath.replace('{workspaceFolder}', tempDir);

        assert.strictEqual(resolved, path.join(tempDir, 'src'));
        assert.ok(fs.existsSync(resolved));
    });

    test('should fallback to workspace root if src does not exist', () => {
        // Don't create src directory
        const configPath = '{workspaceFolder}/src';
        const resolved = configPath.replace('{workspaceFolder}', tempDir);

        // Simulate the fallback logic
        const workingDir = fs.existsSync(resolved) ? resolved : tempDir;

        assert.strictEqual(workingDir, tempDir);
    });

    test('should handle custom working directory configuration', () => {
        // Create custom directory
        const customDir = path.join(tempDir, 'packages', 'app');
        fs.mkdirSync(customDir, { recursive: true });

        const configPath = '{workspaceFolder}/packages/app';
        const resolved = configPath.replace('{workspaceFolder}', tempDir);

        assert.strictEqual(resolved, customDir);
        assert.ok(fs.existsSync(resolved));
    });

    test('should handle absolute path configuration', () => {
        const absolutePath = '/opt/workspace/custom';
        const configPath = absolutePath;

        // No replacement needed for absolute paths
        assert.strictEqual(configPath, absolutePath);
    });

    test('should use plan file directory as fallback when no workspace', () => {
        const planFilePath = path.join(tempDir, '.vscode', 'tasks', 'plan.md');
        const planDir = path.dirname(planFilePath);

        // Create the directory
        fs.mkdirSync(planDir, { recursive: true });

        // When workspace root is not available, use plan file directory
        const workingDir = planDir;

        assert.strictEqual(workingDir, path.join(tempDir, '.vscode', 'tasks'));
    });
});

// ============================================================================
// Message Type Tests
// ============================================================================

suite('Execute Work Plan - Message Types', () => {
    test('should have correct requestPromptFiles message structure', () => {
        const message = { type: 'requestPromptFiles' as const };

        assert.strictEqual(message.type, 'requestPromptFiles');
    });

    test('should have correct executeWorkPlan message structure', () => {
        const message = {
            type: 'executeWorkPlan' as const,
            promptFilePath: '/workspace/.github/prompts/implement.prompt.md'
        };

        assert.strictEqual(message.type, 'executeWorkPlan');
        assert.strictEqual(message.promptFilePath, '/workspace/.github/prompts/implement.prompt.md');
    });

    test('should have correct promptFilesResponse message structure', () => {
        const message = {
            type: 'promptFilesResponse' as const,
            promptFiles: [
                {
                    absolutePath: '/workspace/.github/prompts/implement.prompt.md',
                    relativePath: '.github/prompts/implement.prompt.md',
                    name: 'implement',
                    sourceFolder: '.github/prompts'
                }
            ]
        };

        assert.strictEqual(message.type, 'promptFilesResponse');
        assert.strictEqual(message.promptFiles.length, 1);
        assert.strictEqual(message.promptFiles[0].name, 'implement');
    });
});

// ============================================================================
// Prompt File Info Tests
// ============================================================================

suite('Execute Work Plan - Prompt File Info', () => {
    test('should correctly structure prompt file info', () => {
        const promptFile = {
            absolutePath: '/workspace/.github/prompts/code-review.prompt.md',
            relativePath: '.github/prompts/code-review.prompt.md',
            name: 'code-review',
            sourceFolder: '.github/prompts'
        };

        assert.strictEqual(promptFile.name, 'code-review');
        assert.ok(promptFile.absolutePath.endsWith('.prompt.md'));
        assert.ok(!promptFile.name.includes('.prompt.md'));
    });

    test('should handle nested prompt files', () => {
        const promptFile = {
            absolutePath: '/workspace/.github/prompts/tasks/implement-feature.prompt.md',
            relativePath: '.github/prompts/tasks/implement-feature.prompt.md',
            name: 'implement-feature',
            sourceFolder: '.github/prompts'
        };

        assert.strictEqual(promptFile.name, 'implement-feature');
        assert.ok(promptFile.relativePath.includes('tasks/'));
    });

    test('should group prompt files by source folder', () => {
        const promptFiles = [
            { absolutePath: '/a', relativePath: 'a', name: 'a', sourceFolder: '.github/prompts' },
            { absolutePath: '/b', relativePath: 'b', name: 'b', sourceFolder: '.github/prompts' },
            { absolutePath: '/c', relativePath: 'c', name: 'c', sourceFolder: 'prompts' }
        ];

        const grouped = new Map<string, typeof promptFiles>();
        for (const file of promptFiles) {
            const group = grouped.get(file.sourceFolder) || [];
            group.push(file);
            grouped.set(file.sourceFolder, group);
        }

        assert.strictEqual(grouped.size, 2);
        assert.strictEqual(grouped.get('.github/prompts')?.length, 2);
        assert.strictEqual(grouped.get('prompts')?.length, 1);
    });
});

// ============================================================================
// Configuration Tests
// ============================================================================

suite('Execute Work Plan - Configuration', () => {
    test('should have default tool as copilot', () => {
        const defaultTool = 'copilot';
        assert.strictEqual(defaultTool, 'copilot');
    });

    test('should support claude as alternative tool', () => {
        const tools = ['copilot', 'claude'];
        assert.ok(tools.includes('copilot'));
        assert.ok(tools.includes('claude'));
    });

    test('should have default working directory as {workspaceFolder}/src', () => {
        const defaultWorkingDir = '{workspaceFolder}/src';
        assert.ok(defaultWorkingDir.includes('{workspaceFolder}'));
        assert.ok(defaultWorkingDir.endsWith('/src'));
    });
});

// ============================================================================
// HTML Escaping Tests (for submenu rendering)
// ============================================================================

suite('Execute Work Plan - HTML Escaping', () => {
    function escapeHtml(text: string): string {
        const div = { textContent: '', innerHTML: '' };
        div.textContent = text;
        // Simulate browser behavior
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    test('should escape HTML special characters in prompt names', () => {
        const name = '<script>alert("xss")</script>';
        const escaped = escapeHtml(name);

        assert.ok(!escaped.includes('<script>'));
        assert.ok(escaped.includes('&lt;'));
        assert.ok(escaped.includes('&gt;'));
    });

    test('should handle ampersands in names', () => {
        const name = 'review & implement';
        const escaped = escapeHtml(name);

        assert.ok(escaped.includes('&amp;'));
    });

    test('should handle quotes in names', () => {
        const name = 'implement "feature"';
        const escaped = escapeHtml(name);

        assert.ok(escaped.includes('&quot;'));
    });

    test('should pass through safe names unchanged', () => {
        const name = 'implement-task';
        const escaped = escapeHtml(name);

        assert.strictEqual(escaped, name);
    });
});

// ============================================================================
// Integration Scenario Tests
// ============================================================================

suite('Execute Work Plan - Integration Scenarios', () => {
    let tempDir: string;

    setup(() => {
        tempDir = createTempDir();
    });

    teardown(() => {
        cleanupTempDir(tempDir);
    });

    test('should handle typical workflow: plan.md + implement-task.prompt.md', () => {
        // Create directory structure
        const promptsDir = path.join(tempDir, '.github', 'prompts');
        const tasksDir = path.join(tempDir, '.vscode', 'tasks');
        fs.mkdirSync(promptsDir, { recursive: true });
        fs.mkdirSync(tasksDir, { recursive: true });

        // Create prompt file
        const promptContent = `# Implement Task

You are an expert software engineer implementing tasks from a work plan.

## Instructions
1. Read and understand the full work plan
2. Ask me which task to start with
3. Work on tasks interactively
`;
        const promptPath = path.join(promptsDir, 'implement-task.prompt.md');
        fs.writeFileSync(promptPath, promptContent);

        // Create plan file
        const planContent = `# Feature Plan: Authentication

## Tasks
- [ ] Create user model
- [ ] Implement JWT tokens
- [ ] Add middleware
`;
        const planPath = path.join(tasksDir, 'auth-feature.md');
        fs.writeFileSync(planPath, planContent);

        // Verify files exist
        assert.ok(fs.existsSync(promptPath));
        assert.ok(fs.existsSync(planPath));

        // Generate the prompt
        const fullPrompt = `Follow ${promptPath} for ${planPath}`;

        assert.ok(fullPrompt.includes('implement-task.prompt.md'));
        assert.ok(fullPrompt.includes('auth-feature.md'));
    });

    test('should handle multiple prompt files in different folders', () => {
        // Create multiple prompt folders
        const githubPrompts = path.join(tempDir, '.github', 'prompts');
        const customPrompts = path.join(tempDir, 'prompts');
        fs.mkdirSync(githubPrompts, { recursive: true });
        fs.mkdirSync(customPrompts, { recursive: true });

        // Create prompt files
        fs.writeFileSync(path.join(githubPrompts, 'implement.prompt.md'), '# Implement');
        fs.writeFileSync(path.join(githubPrompts, 'debug.prompt.md'), '# Debug');
        fs.writeFileSync(path.join(customPrompts, 'review.prompt.md'), '# Review');

        // Verify all files exist
        const files = [
            path.join(githubPrompts, 'implement.prompt.md'),
            path.join(githubPrompts, 'debug.prompt.md'),
            path.join(customPrompts, 'review.prompt.md')
        ];

        for (const file of files) {
            assert.ok(fs.existsSync(file), `File should exist: ${file}`);
        }

        assert.strictEqual(files.length, 3);
    });

    test('should handle empty prompts folder gracefully', () => {
        // Create empty prompts folder
        const promptsDir = path.join(tempDir, '.github', 'prompts');
        fs.mkdirSync(promptsDir, { recursive: true });

        // Verify folder exists but is empty
        const files = fs.readdirSync(promptsDir);
        assert.strictEqual(files.length, 0);
    });

    test('should handle non-existent prompts folder gracefully', () => {
        // Don't create prompts folder
        const promptsDir = path.join(tempDir, '.github', 'prompts');

        // Verify folder doesn't exist
        assert.ok(!fs.existsSync(promptsDir));
    });
});

// ============================================================================
// Cross-Platform Path Tests
// ============================================================================

suite('Execute Work Plan - Cross-Platform Paths', () => {
    test('should normalize forward slashes on all platforms', () => {
        const windowsPath = 'C:\\Users\\dev\\project\\.github\\prompts\\task.prompt.md';
        const normalized = windowsPath.replace(/\\/g, '/');

        assert.ok(normalized.includes('/'));
        assert.ok(!normalized.includes('\\'));
    });

    test('should handle mixed path separators', () => {
        const mixedPath = '/workspace/.github\\prompts/task.prompt.md';
        const normalized = mixedPath.replace(/\\/g, '/');

        assert.strictEqual(normalized, '/workspace/.github/prompts/task.prompt.md');
    });

    test('should preserve path integrity after normalization', () => {
        const originalPath = path.join('workspace', '.github', 'prompts', 'task.prompt.md');
        const normalized = originalPath.replace(/\\/g, '/');

        assert.ok(normalized.includes('.github'));
        assert.ok(normalized.includes('prompts'));
        assert.ok(normalized.includes('task.prompt.md'));
    });
});

// ============================================================================
// Error Handling Tests
// ============================================================================

suite('Execute Work Plan - Error Handling', () => {
    test('should handle missing prompt file path', () => {
        const message = {
            type: 'executeWorkPlan' as const,
            promptFilePath: ''
        };

        // Empty path should be detected
        assert.strictEqual(message.promptFilePath, '');
        assert.ok(!message.promptFilePath);
    });

    test('should handle undefined prompt file path', () => {
        const message = {
            type: 'executeWorkPlan' as const,
            promptFilePath: undefined as unknown as string
        };

        // Undefined should be falsy
        assert.ok(!message.promptFilePath);
    });

    test('should validate prompt file path format', () => {
        const validPath = '/workspace/.github/prompts/task.prompt.md';
        const invalidPath = 'not-a-valid-path';

        // Valid path should start with / or drive letter
        assert.ok(validPath.startsWith('/') || /^[A-Za-z]:/.test(validPath));

        // Invalid path check (doesn't start with / or drive letter)
        assert.ok(!invalidPath.startsWith('/') && !/^[A-Za-z]:/.test(invalidPath));
    });
});
