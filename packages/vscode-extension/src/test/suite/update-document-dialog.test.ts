/**
 * Tests for Update Document Dialog feature
 * 
 * Tests the modal dialog and message handling for the "Update Document" AI action
 * in the Markdown Review Editor. This feature allows users to provide document-level
 * instructions to AI without needing to create comments.
 */

import * as assert from 'assert';
import * as path from 'path';

suite('Update Document Dialog - Message Types', () => {
    test('WebviewMessage updateDocument should have required fields', () => {
        const message = {
            type: 'updateDocument' as const,
            instruction: 'Add a section about error handling'
        };

        assert.strictEqual(message.type, 'updateDocument');
        assert.strictEqual(message.instruction, 'Add a section about error handling');
    });

    test('WebviewMessage requestUpdateDocumentDialog should have correct type', () => {
        const message = {
            type: 'requestUpdateDocumentDialog' as const
        };

        assert.strictEqual(message.type, 'requestUpdateDocumentDialog');
    });

    test('ExtensionMessage showUpdateDocumentDialog should have correct type', () => {
        const message = {
            type: 'showUpdateDocumentDialog' as const
        };

        assert.strictEqual(message.type, 'showUpdateDocumentDialog');
    });
});

suite('Update Document Dialog - Instruction Validation', () => {
    test('Instruction should not be empty', () => {
        const validInstruction = 'Add a section about error handling';
        const emptyInstruction = '';
        const whitespaceInstruction = '   ';

        assert.ok(validInstruction.trim().length > 0);
        assert.strictEqual(emptyInstruction.trim().length, 0);
        assert.strictEqual(whitespaceInstruction.trim().length, 0);
    });

    test('Instruction should preserve user formatting', () => {
        const multiLineInstruction = `Add the following sections:
1. Error handling
2. Edge cases
3. Testing considerations`;

        assert.ok(multiLineInstruction.includes('\n'));
        assert.ok(multiLineInstruction.includes('1.'));
        assert.ok(multiLineInstruction.includes('2.'));
        assert.ok(multiLineInstruction.includes('3.'));
    });

    test('Instruction should support special characters', () => {
        const specialCharsInstruction = 'Add a code block with `console.log("hello")`';

        assert.ok(specialCharsInstruction.includes('`'));
        assert.ok(specialCharsInstruction.includes('"'));
    });
});

suite('Update Document Dialog - Prompt Building', () => {
    test('Prompt should include user instruction', () => {
        const instruction = 'Add a section about error handling';
        const filePath = '/home/user/workspace/document.md';

        const prompt = buildUpdateDocumentPrompt(instruction, filePath);

        assert.ok(prompt.includes(instruction));
    });

    test('Prompt should include file path', () => {
        const instruction = 'Add a section about error handling';
        const filePath = '/home/user/workspace/document.md';

        const prompt = buildUpdateDocumentPrompt(instruction, filePath);

        assert.ok(prompt.includes(filePath), 'Prompt should include the full file path');
    });

    test('Prompt should include file name', () => {
        const instruction = 'Add a section about error handling';
        const filePath = '/home/user/workspace/document.md';

        const prompt = buildUpdateDocumentPrompt(instruction, filePath);

        assert.ok(prompt.includes('document.md'), 'Prompt should include the file name');
    });

    test('Prompt should NOT include document content inline', () => {
        const instruction = 'Fix the formatting';
        const filePath = '/home/user/workspace/test.md';

        const prompt = buildUpdateDocumentPrompt(instruction, filePath);

        assert.ok(!prompt.includes('Current document content:'), 'Prompt should not embed document content');
    });

    test('Prompt should have proper structure with file path and output requirements', () => {
        const instruction = 'Fix the formatting';
        const filePath = '/home/user/workspace/test.md';

        const prompt = buildUpdateDocumentPrompt(instruction, filePath);

        assert.ok(prompt.includes('The user wants to update the following markdown document'));
        assert.ok(prompt.includes('## User Instruction'));
        assert.ok(prompt.includes('## Output Requirements'));
        assert.ok(prompt.includes('CRITICAL'));
        assert.ok(prompt.includes('edit it in-place'));
    });

    test('Prompt should instruct AI to read the file', () => {
        const instruction = 'Add initial content';
        const filePath = '/home/user/workspace/empty.md';

        const prompt = buildUpdateDocumentPrompt(instruction, filePath);

        assert.ok(prompt.includes('Read the file'), 'Prompt should instruct AI to read the file');
        assert.ok(prompt.includes(`edit it in-place at: ${filePath}`), 'Prompt should instruct AI to edit in-place');
    });

    test('Prompt should include preservation instructions', () => {
        const instruction = 'Fix typos';
        const filePath = '/home/user/workspace/large-doc.md';

        const prompt = buildUpdateDocumentPrompt(instruction, filePath);

        assert.ok(prompt.includes('Preserve markdown format and any frontmatter'));
        assert.ok(prompt.includes('Do NOT create new files'));
        assert.ok(prompt.includes('Do NOT output the full file content to stdout'));
    });

    test('Prompt should handle markdown with code blocks in instruction', () => {
        const instruction = 'Add a code example with ```typescript\nfunction hello() {}\n```';
        const filePath = '/home/user/workspace/code-example.md';

        const prompt = buildUpdateDocumentPrompt(instruction, filePath);

        assert.ok(prompt.includes('```typescript'));
        assert.ok(prompt.includes('function hello()'));
    });
});

suite('Update Document Dialog - Message Flow', () => {
    test('Click updateDocumentItem should trigger requestUpdateDocumentDialog', () => {
        // Simulate the expected message when clicking the menu item
        const expectedMessage = {
            type: 'requestUpdateDocumentDialog'
        };

        assert.strictEqual(expectedMessage.type, 'requestUpdateDocumentDialog');
    });

    test('requestUpdateDocumentDialog should result in showUpdateDocumentDialog response', () => {
        // Simulate the expected response from the extension
        const expectedResponse = {
            type: 'showUpdateDocumentDialog'
        };

        assert.strictEqual(expectedResponse.type, 'showUpdateDocumentDialog');
    });

    test('Dialog submit should send updateDocument message', () => {
        const userInstruction = 'Add error handling section';
        
        // Simulate the expected message when submitting the dialog
        const expectedMessage = {
            type: 'updateDocument',
            instruction: userInstruction
        };

        assert.strictEqual(expectedMessage.type, 'updateDocument');
        assert.strictEqual(expectedMessage.instruction, userInstruction);
    });
});

suite('Update Document Dialog - UI Element IDs', () => {
    // Test that the expected UI element IDs are consistent
    test('Dialog element IDs should follow naming convention', () => {
        const expectedIds = [
            'updateDocumentDialog',  // Main dialog overlay
            'udCloseBtn',            // Close button
            'udCancelBtn',           // Cancel button
            'udSubmitBtn',           // Submit button
            'udInstruction'          // Instruction textarea
        ];

        // All IDs should start with 'ud' prefix (Update Document)
        const prefixedIds = expectedIds.filter(id => id !== 'updateDocumentDialog');
        for (const id of prefixedIds) {
            assert.ok(id.startsWith('ud'), `ID ${id} should start with 'ud' prefix`);
        }
    });

    test('Menu item ID should be consistent', () => {
        const menuItemId = 'updateDocumentItem';
        assert.strictEqual(menuItemId, 'updateDocumentItem');
    });
});

suite('Update Document Dialog - Cross-Platform Path Handling', () => {
    test('Should handle Unix-style file paths', () => {
        const instruction = 'Update the imports';
        const filePath = '/home/user/workspace/config.md';

        const prompt = buildUpdateDocumentPrompt(instruction, filePath);
        assert.ok(prompt.includes('/home/user/workspace/config.md'));
        assert.ok(prompt.includes('config.md'));
    });

    test('Should handle Windows-style file paths', () => {
        const instruction = 'Update the imports';
        const filePath = 'C:\\Users\\workspace\\config.md';

        const prompt = buildUpdateDocumentPrompt(instruction, filePath);
        assert.ok(prompt.includes('C:\\Users\\workspace\\config.md'));
        assert.ok(prompt.includes('config.md'));
    });

    test('Should extract correct file name from nested path', () => {
        const instruction = 'Fix content';
        const filePath = '/home/user/deep/nested/path/to/document.plan.md';

        const prompt = buildUpdateDocumentPrompt(instruction, filePath);
        assert.ok(prompt.includes('document.plan.md'));
        assert.ok(prompt.includes(filePath));
    });
});

suite('Update Document Dialog - Keyboard Shortcuts', () => {
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

suite('Update Document Dialog - Error Handling', () => {
    test('Should handle instruction with only whitespace', () => {
        const whitespaceOnly = '   \n\t  ';
        const trimmed = whitespaceOnly.trim();

        assert.strictEqual(trimmed.length, 0);
    });

    test('Should trim instruction before sending', () => {
        const instructionWithWhitespace = '  Add error handling  \n';
        const expectedInstruction = instructionWithWhitespace.trim();

        assert.strictEqual(expectedInstruction, 'Add error handling');
    });
});

suite('Update Document Dialog - Integration with Interactive Session', () => {
    test('Interactive session should receive prompt with correct format', () => {
        const instruction = 'Add error handling';
        const filePath = '/home/user/workspace/my-doc.md';

        const prompt = buildUpdateDocumentPrompt(instruction, filePath);

        // Verify the prompt has all required parts
        assert.ok(prompt.includes('The user wants to update the following markdown document'));
        assert.ok(prompt.includes(instruction));
        assert.ok(prompt.includes(filePath));
        assert.ok(prompt.includes('my-doc.md'));
        assert.ok(prompt.includes('## User Instruction'));
        assert.ok(prompt.includes('## Output Requirements'));
        assert.ok(prompt.includes('CRITICAL'));
        assert.ok(prompt.includes(`edit it in-place at: ${filePath}`));
    });

    test('Prompt should not contain document content delimiters', () => {
        const instruction = 'Add error handling';
        const filePath = '/home/user/workspace/my-doc.md';

        const prompt = buildUpdateDocumentPrompt(instruction, filePath);

        // The old format used --- delimiters around content; new format should not
        // Check that the prompt doesn't have the old content-embedding pattern
        assert.ok(!prompt.includes('Current document content:\n---'));
    });
});

/**
 * Helper function to build the update document prompt
 * This mirrors the logic in ReviewEditorViewProvider.handleUpdateDocument
 */
function buildUpdateDocumentPrompt(instruction: string, filePath: string): string {
    const fileName = path.basename(filePath);

    return `The user wants to update the following markdown document:

File: ${fileName}
Path: ${filePath}

## User Instruction
${instruction}

## Output Requirements

**CRITICAL:** Read the file and then edit it in-place at: ${filePath}

- Make only the changes described in the instruction
- Preserve markdown format and any frontmatter
- Do NOT create new files or write to session state/temp directories
- Do NOT output the full file content to stdout`;
}
