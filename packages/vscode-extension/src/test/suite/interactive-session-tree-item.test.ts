/**
 * Tests for InteractiveSessionItem tree item
 *
 * Tests for the tree item display logic including custom names.
 */

import * as assert from 'assert';
import { InteractiveSessionItem, InteractiveSessionSectionItem } from '../../shortcuts/ai-service/interactive-session-tree-item';
import { InteractiveSession } from '../../shortcuts/ai-service/types';

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Create a mock session for testing
 */
function createMockSession(overrides: Partial<InteractiveSession> = {}): InteractiveSession {
    return {
        id: 'test-session-1',
        startTime: new Date(),
        status: 'active',
        workingDirectory: '/test/project',
        tool: 'copilot',
        terminalType: 'terminal.app',
        ...overrides
    };
}

// ============================================================================
// Label Display Tests
// ============================================================================

suite('InteractiveSessionItem - Label Display', () => {
    test('should display custom name when set', () => {
        const session = createMockSession({
            customName: 'My Debug Session'
        });

        const item = new InteractiveSessionItem(session);

        assert.strictEqual(item.label, 'My Debug Session');
    });

    test('should display truncated initial prompt when no custom name', () => {
        const session = createMockSession({
            initialPrompt: 'Explain this code'
        });

        const item = new InteractiveSessionItem(session);

        assert.strictEqual(item.label, 'Explain this code');
    });

    test('should truncate long initial prompt to 40 chars', () => {
        const longPrompt = 'This is a very long initial prompt that exceeds forty characters';
        const session = createMockSession({
            initialPrompt: longPrompt
        });

        const item = new InteractiveSessionItem(session);

        assert.strictEqual(item.label, 'This is a very long initial prompt that ...');
    });

    test('should display tool session when no custom name or prompt', () => {
        const session = createMockSession({
            tool: 'copilot'
        });

        const item = new InteractiveSessionItem(session);

        assert.strictEqual(item.label, 'copilot session');
    });

    test('should display claude session when tool is claude', () => {
        const session = createMockSession({
            tool: 'claude'
        });

        const item = new InteractiveSessionItem(session);

        assert.strictEqual(item.label, 'claude session');
    });

    test('should prefer custom name over initial prompt', () => {
        const session = createMockSession({
            customName: 'Custom Name',
            initialPrompt: 'Initial Prompt'
        });

        const item = new InteractiveSessionItem(session);

        assert.strictEqual(item.label, 'Custom Name');
    });

    test('should handle empty custom name (falls back to prompt)', () => {
        const session = createMockSession({
            customName: undefined,
            initialPrompt: 'Fallback Prompt'
        });

        const item = new InteractiveSessionItem(session);

        assert.strictEqual(item.label, 'Fallback Prompt');
    });
});

// ============================================================================
// Context Value Tests
// ============================================================================

suite('InteractiveSessionItem - Context Value', () => {
    test('should have correct context value for active session', () => {
        const session = createMockSession({ status: 'active' });
        const item = new InteractiveSessionItem(session);

        assert.strictEqual(item.contextValue, 'interactiveSession_active');
    });

    test('should have correct context value for starting session', () => {
        const session = createMockSession({ status: 'starting' });
        const item = new InteractiveSessionItem(session);

        assert.strictEqual(item.contextValue, 'interactiveSession_starting');
    });

    test('should have correct context value for ended session', () => {
        const session = createMockSession({ status: 'ended' });
        const item = new InteractiveSessionItem(session);

        assert.strictEqual(item.contextValue, 'interactiveSession_ended');
    });

    test('should have correct context value for error session', () => {
        const session = createMockSession({ status: 'error' });
        const item = new InteractiveSessionItem(session);

        assert.strictEqual(item.contextValue, 'interactiveSession_error');
    });
});

// ============================================================================
// Tooltip Tests
// ============================================================================

suite('InteractiveSessionItem - Tooltip', () => {
    test('should include custom name in tooltip when set', () => {
        const session = createMockSession({
            customName: 'My Named Session'
        });

        const item = new InteractiveSessionItem(session);

        // Tooltip is a MarkdownString, check its value
        const tooltipValue = (item.tooltip as any).value;
        assert.ok(tooltipValue.includes('**Name:** My Named Session'));
    });

    test('should not include name field in tooltip when no custom name', () => {
        const session = createMockSession({
            customName: undefined
        });

        const item = new InteractiveSessionItem(session);

        const tooltipValue = (item.tooltip as any).value;
        assert.ok(!tooltipValue.includes('**Name:**'));
    });

    test('should include tool in tooltip', () => {
        const session = createMockSession({
            tool: 'copilot'
        });

        const item = new InteractiveSessionItem(session);

        const tooltipValue = (item.tooltip as any).value;
        assert.ok(tooltipValue.includes('GitHub Copilot CLI'));
    });

    test('should include claude tool in tooltip', () => {
        const session = createMockSession({
            tool: 'claude'
        });

        const item = new InteractiveSessionItem(session);

        const tooltipValue = (item.tooltip as any).value;
        assert.ok(tooltipValue.includes('Claude CLI'));
    });

    test('should include working directory in tooltip', () => {
        const session = createMockSession({
            workingDirectory: '/path/to/project'
        });

        const item = new InteractiveSessionItem(session);

        const tooltipValue = (item.tooltip as any).value;
        assert.ok(tooltipValue.includes('/path/to/project'));
    });

    test('should include initial prompt in tooltip when set', () => {
        const session = createMockSession({
            initialPrompt: 'Help me debug this'
        });

        const item = new InteractiveSessionItem(session);

        const tooltipValue = (item.tooltip as any).value;
        assert.ok(tooltipValue.includes('Help me debug this'));
    });
});

// ============================================================================
// Section Header Tests
// ============================================================================

suite('InteractiveSessionSectionItem', () => {
    test('should display count when there are active sessions', () => {
        const item = new InteractiveSessionSectionItem(3);

        assert.strictEqual(item.label, 'Interactive Sessions (3 active)');
    });

    test('should not display count when no active sessions', () => {
        const item = new InteractiveSessionSectionItem(0);

        assert.strictEqual(item.label, 'Interactive Sessions');
    });

    test('should have correct context value', () => {
        const item = new InteractiveSessionSectionItem(0);

        assert.strictEqual(item.contextValue, 'interactiveSessionSection');
    });
});

// ============================================================================
// Special Characters Tests
// ============================================================================

suite('InteractiveSessionItem - Special Characters', () => {
    test('should handle special characters in custom name', () => {
        const session = createMockSession({
            customName: 'Debug: "main" (v2.0) - test\'s session!'
        });

        const item = new InteractiveSessionItem(session);

        assert.strictEqual(item.label, 'Debug: "main" (v2.0) - test\'s session!');
    });

    test('should handle unicode characters in custom name', () => {
        const session = createMockSession({
            customName: '调试会话 🔧 Debug セッション'
        });

        const item = new InteractiveSessionItem(session);

        assert.strictEqual(item.label, '调试会话 🔧 Debug セッション');
    });

    test('should handle newlines in initial prompt (truncated)', () => {
        const session = createMockSession({
            initialPrompt: 'Line 1\nLine 2\nLine 3'
        });

        const item = new InteractiveSessionItem(session);

        // Should contain the text (newlines may be preserved in label)
        assert.ok((item.label as string).startsWith('Line 1'));
    });
});

// ============================================================================
// Cross-Platform Path Tests
// ============================================================================

suite('InteractiveSessionItem - Cross-Platform Paths', () => {
    test('should handle Unix-style paths', () => {
        const session = createMockSession({
            workingDirectory: '/home/user/projects/myapp'
        });

        const item = new InteractiveSessionItem(session);

        const tooltipValue = (item.tooltip as any).value;
        assert.ok(tooltipValue.includes('/home/user/projects/myapp'));
    });

    test('should handle Windows-style paths', () => {
        const session = createMockSession({
            workingDirectory: 'C:\\Users\\user\\projects\\myapp'
        });

        const item = new InteractiveSessionItem(session);

        const tooltipValue = (item.tooltip as any).value;
        assert.ok(tooltipValue.includes('C:\\Users\\user\\projects\\myapp'));
    });

    test('should handle paths with spaces', () => {
        const session = createMockSession({
            workingDirectory: '/path/with spaces/to project'
        });

        const item = new InteractiveSessionItem(session);

        const tooltipValue = (item.tooltip as any).value;
        assert.ok(tooltipValue.includes('/path/with spaces/to project'));
    });
});
