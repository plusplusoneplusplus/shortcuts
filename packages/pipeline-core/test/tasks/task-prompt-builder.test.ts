/**
 * Task Prompt Builder Tests
 *
 * Tests for the pure-Node prompt-building functions extracted from
 * the VS Code extension's ai-task-commands.ts.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
    buildCreateTaskPrompt,
    buildCreateTaskPromptWithName,
    buildCreateFromFeaturePrompt,
    buildDeepModePrompt,
    gatherFeatureContext,
    parseCreatedFilePath,
    cleanAIResponse,
} from '../../src/tasks/task-prompt-builder';
import type { SelectedContext } from '../../src/tasks/task-prompt-builder';

// ============================================================================
// Helpers
// ============================================================================

let tmpDir: string;

beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-prompt-builder-test-'));
});

afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ============================================================================
// buildCreateTaskPrompt
// ============================================================================

describe('buildCreateTaskPrompt', () => {
    it('should include description in prompt', () => {
        const prompt = buildCreateTaskPrompt('Implement OAuth2 auth', '/tmp/tasks');
        expect(prompt).toContain('Implement OAuth2 auth');
    });

    it('should include target path in prompt', () => {
        const target = '/workspace/.vscode/tasks';
        const prompt = buildCreateTaskPrompt('some task', target);
        expect(prompt).toContain(target);
    });

    it('should include .plan.md instruction', () => {
        const prompt = buildCreateTaskPrompt('task', '/tmp');
        expect(prompt).toContain('.plan.md');
    });
});

// ============================================================================
// buildCreateTaskPromptWithName
// ============================================================================

describe('buildCreateTaskPromptWithName', () => {
    it('should include explicit name and path when name is provided', () => {
        const prompt = buildCreateTaskPromptWithName('my-task', 'desc', '/target');
        expect(prompt).toContain('/target/my-task.plan.md');
        expect(prompt).toContain('desc');
    });

    it('should instruct AI to generate filename when name is empty', () => {
        const prompt = buildCreateTaskPromptWithName('', 'desc', '/target');
        expect(prompt).toContain('Choose an appropriate filename');
        expect(prompt).toContain('kebab-case');
    });

    it('should handle undefined name', () => {
        const prompt = buildCreateTaskPromptWithName(undefined, 'desc', '/target');
        expect(prompt).toContain('Choose an appropriate filename');
    });

    it('should include description when provided', () => {
        const prompt = buildCreateTaskPromptWithName('n', 'Build a REST API', '/t');
        expect(prompt).toContain('Build a REST API');
    });
});

// ============================================================================
// buildCreateFromFeaturePrompt
// ============================================================================

describe('buildCreateFromFeaturePrompt', () => {
    it('should include feature description', () => {
        const context: SelectedContext = { description: 'My Feature' };
        const prompt = buildCreateFromFeaturePrompt(context, 'focus', undefined, '/target');
        expect(prompt).toContain('My Feature');
    });

    it('should truncate long plan content', () => {
        const longContent = 'A'.repeat(3000);
        const context: SelectedContext = { planContent: longContent };
        const prompt = buildCreateFromFeaturePrompt(context, 'focus', undefined, '/target');
        expect(prompt).toContain('...(truncated)');
        // Should not contain the full 3000 chars
        expect(prompt.length).toBeLessThan(longContent.length);
    });

    it('should truncate long spec content', () => {
        const longSpec = 'B'.repeat(3000);
        const context: SelectedContext = { specContent: longSpec };
        const prompt = buildCreateFromFeaturePrompt(context, 'focus', undefined, '/target');
        expect(prompt).toContain('...(truncated)');
    });

    it('should include related files (up to 20)', () => {
        const files = Array.from({ length: 25 }, (_, i) => `src/file${i}.ts`);
        const context: SelectedContext = { relatedFiles: files };
        const prompt = buildCreateFromFeaturePrompt(context, 'focus', undefined, '/target');
        expect(prompt).toContain('src/file0.ts');
        expect(prompt).toContain('src/file19.ts');
        expect(prompt).not.toContain('src/file20.ts');
    });

    it('should include target path and name when provided', () => {
        const context: SelectedContext = {};
        const prompt = buildCreateFromFeaturePrompt(context, 'focus', 'auth-impl', '/tasks');
        expect(prompt).toContain('/tasks/auth-impl.plan.md');
    });
});

// ============================================================================
// buildDeepModePrompt
// ============================================================================

describe('buildDeepModePrompt', () => {
    it('should prepend go-deep instruction', () => {
        const context: SelectedContext = { description: 'Feature X' };
        const prompt = buildDeepModePrompt(context, 'implement it', undefined, '/target', '/ws');
        expect(prompt).toMatch(/^Use go-deep skill/);
        // Should also contain the base prompt content
        expect(prompt).toContain('Feature X');
    });
});

// ============================================================================
// gatherFeatureContext
// ============================================================================

describe('gatherFeatureContext', () => {
    it('should return hasContent=false for empty folder', async () => {
        const ctx = await gatherFeatureContext(tmpDir, '/ws');
        expect(ctx.hasContent).toBe(false);
    });

    it('should read plan.md', async () => {
        fs.writeFileSync(path.join(tmpDir, 'plan.md'), '# Plan\nSteps here');
        const ctx = await gatherFeatureContext(tmpDir, '/ws');
        expect(ctx.hasContent).toBe(true);
        expect(ctx.planContent).toContain('Steps here');
    });

    it('should read spec.md', async () => {
        fs.writeFileSync(path.join(tmpDir, 'spec.md'), '# Spec\nSpec content');
        const ctx = await gatherFeatureContext(tmpDir, '/ws');
        expect(ctx.hasContent).toBe(true);
        expect(ctx.specContent).toContain('Spec content');
    });

    it('should read *.plan.md files', async () => {
        fs.writeFileSync(path.join(tmpDir, 'auth.plan.md'), '# Auth Plan');
        const ctx = await gatherFeatureContext(tmpDir, '/ws');
        expect(ctx.hasContent).toBe(true);
        expect(ctx.planContent).toContain('Auth Plan');
    });

    it('should read *.spec.md files', async () => {
        fs.writeFileSync(path.join(tmpDir, 'auth.spec.md'), '# Auth Spec');
        const ctx = await gatherFeatureContext(tmpDir, '/ws');
        expect(ctx.hasContent).toBe(true);
        expect(ctx.specContent).toContain('Auth Spec');
    });

    it('should handle non-existent folder gracefully', async () => {
        const ctx = await gatherFeatureContext(path.join(tmpDir, 'nonexistent'), '/ws');
        expect(ctx.hasContent).toBe(false);
    });
});

// ============================================================================
// parseCreatedFilePath
// ============================================================================

describe('parseCreatedFilePath', () => {
    it('should return undefined for empty response', () => {
        expect(parseCreatedFilePath(undefined, '/target')).toBeUndefined();
        expect(parseCreatedFilePath('', '/target')).toBeUndefined();
    });

    it('should find absolute paths after create verbs', () => {
        // Create an actual file to match
        const filePath = path.join(tmpDir, 'task.md');
        fs.writeFileSync(filePath, '# Task');
        const response = `I created the file ${filePath} for you.`;
        const result = parseCreatedFilePath(response, tmpDir);
        expect(result).toBe(filePath);
    });

    it('should find paths in backticks', () => {
        const filePath = path.join(tmpDir, 'my-task.md');
        fs.writeFileSync(filePath, '# My Task');
        const response = `Here is the file: \`${filePath}\``;
        const result = parseCreatedFilePath(response, tmpDir);
        expect(result).toBe(filePath);
    });

    it('should find paths matching target folder', () => {
        const filePath = path.join(tmpDir, 'feature.plan.md');
        fs.writeFileSync(filePath, '# Feature');
        const response = `Output: ${filePath}`;
        const result = parseCreatedFilePath(response, tmpDir);
        expect(result).toBe(filePath);
    });

    it('should return undefined when no .md file exists at the parsed path', () => {
        const response = 'I created /nonexistent/path/task.md';
        const result = parseCreatedFilePath(response, '/nonexistent/path');
        expect(result).toBeUndefined();
    });
});

// ============================================================================
// cleanAIResponse
// ============================================================================

describe('cleanAIResponse', () => {
    it('should strip ```markdown fences', () => {
        const input = '```markdown\n# Title\nContent\n```';
        expect(cleanAIResponse(input)).toBe('# Title\nContent');
    });

    it('should strip ```md fences', () => {
        const input = '```md\nContent here\n```';
        expect(cleanAIResponse(input)).toBe('Content here');
    });

    it('should strip plain ``` fences', () => {
        const input = '```\nraw code\n```';
        expect(cleanAIResponse(input)).toBe('raw code');
    });

    it('should return trimmed content without fences unchanged', () => {
        const input = '  # Title\nBody  ';
        expect(cleanAIResponse(input)).toBe('# Title\nBody');
    });
});
