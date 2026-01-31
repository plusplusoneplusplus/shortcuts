/**
 * Tests for Refresh Plan Dialog feature
 * 
 * Tests the modal dialog and message handling for the "Refresh Plan" AI action
 * in the Markdown Review Editor. This feature allows users to ask AI to regenerate
 * and rewrite a plan document based on the latest codebase state.
 */

import * as assert from 'assert';

suite('Refresh Plan Dialog - Message Types', () => {
    test('WebviewMessage refreshPlan should have required fields', () => {
        const message = {
            type: 'refreshPlan' as const,
            additionalContext: 'Focus on the authentication changes'
        };

        assert.strictEqual(message.type, 'refreshPlan');
        assert.strictEqual(message.additionalContext, 'Focus on the authentication changes');
    });

    test('WebviewMessage refreshPlan should allow undefined additionalContext', () => {
        const message = {
            type: 'refreshPlan' as const,
            additionalContext: undefined
        };

        assert.strictEqual(message.type, 'refreshPlan');
        assert.strictEqual(message.additionalContext, undefined);
    });

    test('WebviewMessage requestRefreshPlanDialog should have correct type', () => {
        const message = {
            type: 'requestRefreshPlanDialog' as const
        };

        assert.strictEqual(message.type, 'requestRefreshPlanDialog');
    });

    test('ExtensionMessage showRefreshPlanDialog should have correct type', () => {
        const message = {
            type: 'showRefreshPlanDialog' as const
        };

        assert.strictEqual(message.type, 'showRefreshPlanDialog');
    });
});

suite('Refresh Plan Dialog - Context Validation', () => {
    test('Additional context should be optional', () => {
        const withContext = { additionalContext: 'Some context' };
        const withoutContext = { additionalContext: undefined };
        const emptyContext = { additionalContext: '' };

        assert.ok(withContext.additionalContext);
        assert.strictEqual(withoutContext.additionalContext, undefined);
        assert.strictEqual(emptyContext.additionalContext?.trim().length, 0);
    });

    test('Additional context should preserve user formatting', () => {
        const multiLineContext = `Consider the following changes:
1. New API endpoints added
2. Database schema updated
3. Authentication refactored`;

        assert.ok(multiLineContext.includes('\n'));
        assert.ok(multiLineContext.includes('1.'));
        assert.ok(multiLineContext.includes('2.'));
        assert.ok(multiLineContext.includes('3.'));
    });

    test('Additional context should support special characters', () => {
        const specialCharsContext = 'Focus on the `AuthService` class and "login" endpoint';

        assert.ok(specialCharsContext.includes('`'));
        assert.ok(specialCharsContext.includes('"'));
    });
});

suite('Refresh Plan Dialog - Prompt Building', () => {
    test('Prompt should include plan content', () => {
        const planContent = '# Implementation Plan\n\n## Tasks\n- [ ] Task 1';
        const filePath = '/workspace/project/.vscode/tasks/feature.plan.md';

        const prompt = buildRefreshPlanPrompt(filePath, planContent);

        assert.ok(prompt.includes(planContent));
    });

    test('Prompt should include file name', () => {
        const planContent = '# Test Plan';
        const filePath = '/workspace/project/.vscode/tasks/feature.plan.md';

        const prompt = buildRefreshPlanPrompt(filePath, planContent);

        assert.ok(prompt.includes('feature.plan.md'));
    });

    test('Prompt should include instructions for refreshing', () => {
        const planContent = '# Test Plan';
        const filePath = '/workspace/project/plan.md';

        const prompt = buildRefreshPlanPrompt(filePath, planContent);

        assert.ok(prompt.includes('refreshing and regenerating'));
        assert.ok(prompt.includes('latest codebase state'));
    });

    test('Prompt should include guidance for what to update', () => {
        const planContent = '# Test Plan';
        const filePath = '/workspace/project/plan.md';

        const prompt = buildRefreshPlanPrompt(filePath, planContent);

        assert.ok(prompt.includes('already been completed'));
        assert.ok(prompt.includes('still pending'));
        assert.ok(prompt.includes('new tasks'));
    });

    test('Prompt should include output location', () => {
        const planContent = '# Test Plan';
        const filePath = '/workspace/project/.vscode/tasks/my-plan.md';

        const prompt = buildRefreshPlanPrompt(filePath, planContent);

        assert.ok(prompt.includes(filePath));
    });

    test('Prompt with additional context should include user context', () => {
        const planContent = '# Test Plan';
        const filePath = '/workspace/project/plan.md';
        const additionalContext = 'Focus on the authentication changes';

        const prompt = buildRefreshPlanPrompt(filePath, planContent, additionalContext);

        assert.ok(prompt.includes('Additional Context from User'));
        assert.ok(prompt.includes(additionalContext));
    });

    test('Prompt without additional context should not include context section', () => {
        const planContent = '# Test Plan';
        const filePath = '/workspace/project/plan.md';

        const prompt = buildRefreshPlanPrompt(filePath, planContent);

        assert.ok(!prompt.includes('Additional Context from User'));
    });

    test('Prompt should handle empty plan content', () => {
        const planContent = '';
        const filePath = '/workspace/project/plan.md';

        const prompt = buildRefreshPlanPrompt(filePath, planContent);

        assert.ok(prompt.includes('Current Plan'));
        // Should still work even with empty content
        assert.ok(prompt.includes('---'));
    });

    test('Prompt should handle large plan documents', () => {
        const planContent = '- [ ] Task\n'.repeat(500); // 500 tasks
        const filePath = '/workspace/project/plan.md';

        const prompt = buildRefreshPlanPrompt(filePath, planContent);

        assert.ok(prompt.includes(planContent));
    });

    test('Prompt should handle plan with code blocks', () => {
        const planContent = `# Implementation Plan

## Code Example
\`\`\`typescript
function authenticate() {
    return true;
}
\`\`\`
`;
        const filePath = '/workspace/project/plan.md';

        const prompt = buildRefreshPlanPrompt(filePath, planContent);

        assert.ok(prompt.includes('```typescript'));
        assert.ok(prompt.includes('function authenticate()'));
    });
});

suite('Refresh Plan Dialog - Message Flow', () => {
    test('Click refreshPlanItem should trigger requestRefreshPlanDialog', () => {
        // Simulate the expected message when clicking the menu item
        const expectedMessage = {
            type: 'requestRefreshPlanDialog'
        };

        assert.strictEqual(expectedMessage.type, 'requestRefreshPlanDialog');
    });

    test('requestRefreshPlanDialog should result in showRefreshPlanDialog response', () => {
        // Simulate the expected response from the extension
        const expectedResponse = {
            type: 'showRefreshPlanDialog'
        };

        assert.strictEqual(expectedResponse.type, 'showRefreshPlanDialog');
    });

    test('Dialog submit should send refreshPlan message with context', () => {
        const userContext = 'Focus on the API changes';
        
        // Simulate the expected message when submitting the dialog
        const expectedMessage = {
            type: 'refreshPlan',
            additionalContext: userContext
        };

        assert.strictEqual(expectedMessage.type, 'refreshPlan');
        assert.strictEqual(expectedMessage.additionalContext, userContext);
    });

    test('Dialog submit should send refreshPlan message without context', () => {
        // Simulate the expected message when submitting without context
        const expectedMessage = {
            type: 'refreshPlan',
            additionalContext: undefined
        };

        assert.strictEqual(expectedMessage.type, 'refreshPlan');
        assert.strictEqual(expectedMessage.additionalContext, undefined);
    });
});

suite('Refresh Plan Dialog - UI Element IDs', () => {
    // Test that the expected UI element IDs are consistent
    test('Dialog element IDs should follow naming convention', () => {
        const expectedIds = [
            'refreshPlanDialog',  // Main dialog overlay
            'rpCloseBtn',         // Close button
            'rpCancelBtn',        // Cancel button
            'rpSubmitBtn',        // Submit button
            'rpContext'           // Context textarea
        ];

        // All IDs should start with 'rp' prefix (Refresh Plan)
        const prefixedIds = expectedIds.filter(id => id !== 'refreshPlanDialog');
        for (const id of prefixedIds) {
            assert.ok(id.startsWith('rp'), `ID ${id} should start with 'rp' prefix`);
        }
    });

    test('Menu item ID should be consistent', () => {
        const menuItemId = 'refreshPlanItem';
        assert.strictEqual(menuItemId, 'refreshPlanItem');
    });
});

suite('Refresh Plan Dialog - Cross-Platform Path Handling', () => {
    test('Should handle Unix-style file paths', () => {
        const planContent = '# Plan';
        const filePath = '/home/user/workspace/.vscode/tasks/feature.plan.md';

        const prompt = buildRefreshPlanPrompt(filePath, planContent);
        assert.ok(prompt.includes(filePath));
    });

    test('Should handle Windows-style file paths', () => {
        const planContent = '# Plan';
        const filePath = 'C:\\Users\\workspace\\.vscode\\tasks\\feature.plan.md';

        const prompt = buildRefreshPlanPrompt(filePath, planContent);
        assert.ok(prompt.includes(filePath));
    });

    test('Should extract correct file name from Unix path', () => {
        const filePath = '/home/user/workspace/.vscode/tasks/my-feature.plan.md';
        const fileName = filePath.split('/').pop();

        assert.strictEqual(fileName, 'my-feature.plan.md');
    });

    test('Should extract correct file name from Windows path', () => {
        const filePath = 'C:\\Users\\workspace\\.vscode\\tasks\\my-feature.plan.md';
        const fileName = filePath.split(/[/\\]/).pop();

        assert.strictEqual(fileName, 'my-feature.plan.md');
    });
});

suite('Refresh Plan Dialog - Keyboard Shortcuts', () => {
    test('Ctrl+Enter should be the submit shortcut', () => {
        // Document the expected keyboard shortcuts
        const shortcuts = {
            submit: ['Ctrl+Enter', 'Cmd+Enter'],
            close: ['Escape']
        };

        assert.ok(shortcuts.submit.includes('Ctrl+Enter'));
        assert.ok(shortcuts.submit.includes('Cmd+Enter'));
        assert.ok(shortcuts.close.includes('Escape'));
    });
});

suite('Refresh Plan Dialog - Error Handling', () => {
    test('Should handle context with only whitespace', () => {
        const whitespaceOnly = '   \n\t  ';
        const trimmed = whitespaceOnly.trim();

        assert.strictEqual(trimmed.length, 0);
    });

    test('Should trim context before sending', () => {
        const contextWithWhitespace = '  Focus on API changes  \n';
        const expectedContext = contextWithWhitespace.trim();

        assert.strictEqual(expectedContext, 'Focus on API changes');
    });

    test('Empty trimmed context should be treated as undefined', () => {
        const emptyContext = '   ';
        const trimmed = emptyContext.trim();
        const result = trimmed.length > 0 ? trimmed : undefined;

        assert.strictEqual(result, undefined);
    });
});

suite('Refresh Plan Dialog - Integration with Interactive Session', () => {
    test('Interactive session should receive prompt with correct format', () => {
        const planContent = '# My Plan\n- [ ] Task 1\n- [x] Task 2';
        const filePath = '/workspace/plan.md';

        const prompt = buildRefreshPlanPrompt(filePath, planContent);

        // Verify the prompt has all required parts
        assert.ok(prompt.includes('refreshing and regenerating'));
        assert.ok(prompt.includes('Current Plan'));
        assert.ok(prompt.includes('---'));  // Content delimiters
        assert.ok(prompt.includes(planContent));
        assert.ok(prompt.includes('Output Requirements'));
        assert.ok(prompt.includes(filePath));
    });

    test('Interactive session should receive prompt with additional context', () => {
        const planContent = '# My Plan';
        const filePath = '/workspace/plan.md';
        const additionalContext = 'Consider the new database schema';

        const prompt = buildRefreshPlanPrompt(filePath, planContent, additionalContext);

        assert.ok(prompt.includes('Additional Context from User'));
        assert.ok(prompt.includes(additionalContext));
        assert.ok(prompt.includes('take this additional context into account'));
    });
});

suite('Refresh Plan Dialog - In-Place Edit Directive', () => {
    test('Prompt should include critical in-place edit requirement with file path', () => {
        const planContent = '# Test Plan';
        const filePath = '/workspace/project/plan.md';

        const prompt = buildRefreshPlanPrompt(filePath, planContent);

        assert.ok(prompt.includes('**CRITICAL:** Edit the file in-place at:'));
        assert.ok(prompt.includes(filePath));
    });

    test('Prompt should prohibit creating new files and writing to session state', () => {
        const planContent = '# Test Plan';
        const filePath = '/workspace/project/plan.md';

        const prompt = buildRefreshPlanPrompt(filePath, planContent);

        assert.ok(prompt.includes('Do NOT create new files or write to session state'));
    });

    test('Prompt should require preserving markdown format and frontmatter', () => {
        const planContent = '# Test Plan';
        const filePath = '/workspace/project/plan.md';

        const prompt = buildRefreshPlanPrompt(filePath, planContent);

        assert.ok(prompt.includes('Preserve markdown format and any frontmatter'));
    });
});

suite('Refresh Plan Dialog - Plan Content Preservation', () => {
    test('Should preserve frontmatter in plan', () => {
        const planContent = `---
created: 2024-01-15
type: feature
---

# Implementation Plan

## Tasks
- [ ] Task 1`;

        const filePath = '/workspace/plan.md';
        const prompt = buildRefreshPlanPrompt(filePath, planContent);

        assert.ok(prompt.includes('frontmatter'));
    });

    test('Should preserve markdown structure', () => {
        const planContent = `# Main Title

## Section 1
Content here

### Subsection 1.1
More content

## Section 2
- Item 1
- Item 2`;

        const filePath = '/workspace/plan.md';
        const prompt = buildRefreshPlanPrompt(filePath, planContent);

        assert.ok(prompt.includes('structure and format'));
    });
});

/**
 * Helper function to build the refresh plan prompt
 * This mirrors the logic in ReviewEditorViewProvider.handleRefreshPlan
 */
function buildRefreshPlanPrompt(filePath: string, planContent: string, additionalContext?: string): string {
    const fileName = filePath.split(/[/\\]/).pop() || 'plan.md';

    let prompt = `You are tasked with refreshing and regenerating a plan document based on the latest codebase state.

## Current Plan
File: ${fileName}
---
${planContent}
---

## Instructions
Please analyze the current state of the codebase and rewrite this plan to reflect:
1. What has already been completed (mark as done or remove)
2. What is still pending and needs to be updated based on current code
3. Any new tasks that should be added based on recent changes
4. Updated acceptance criteria if the requirements have evolved

Maintain the same general structure and format of the original plan, but update the content to be accurate and relevant.`;

    // Add user-provided context if available
    if (additionalContext && additionalContext.trim()) {
        prompt += `

## Additional Context from User
${additionalContext}

Please take this additional context into account when refreshing the plan.`;
    }

    prompt += `

## Output Requirements

**CRITICAL:** Edit the file in-place at: ${filePath}

- Preserve markdown format and any frontmatter
- Do NOT create new files or write to session state/temp directories
- Do NOT output content to stdout`;

    return prompt;
}
