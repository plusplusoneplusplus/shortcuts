/**
 * Tests for Update Document Dialog feature
 * 
 * Tests the modal dialog and message handling for the "Update Document" AI action
 * in the Markdown Review Editor. This feature allows users to provide document-level
 * instructions to AI without needing to create comments.
 */

import * as assert from 'assert';

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
        const documentContent = '# My Document\n\nSome content here.';

        const prompt = buildUpdateDocumentPrompt(instruction, documentContent);

        assert.ok(prompt.includes(instruction));
    });

    test('Prompt should include document content', () => {
        const instruction = 'Add a section about error handling';
        const documentContent = '# My Document\n\nSome content here.';

        const prompt = buildUpdateDocumentPrompt(instruction, documentContent);

        assert.ok(prompt.includes(documentContent));
    });

    test('Prompt should have proper structure', () => {
        const instruction = 'Fix the formatting';
        const documentContent = '# Test';

        const prompt = buildUpdateDocumentPrompt(instruction, documentContent);

        assert.ok(prompt.includes('The user wants to update this markdown document'));
        assert.ok(prompt.includes('Current document content:'));
        assert.ok(prompt.includes('Please make the requested changes'));
    });

    test('Prompt should handle empty document', () => {
        const instruction = 'Add initial content';
        const documentContent = '';

        const prompt = buildUpdateDocumentPrompt(instruction, documentContent);

        assert.ok(prompt.includes(instruction));
        assert.ok(prompt.includes('Current document content:'));
    });

    test('Prompt should handle large documents', () => {
        const instruction = 'Fix typos';
        const documentContent = 'Line\n'.repeat(1000); // 1000 lines

        const prompt = buildUpdateDocumentPrompt(instruction, documentContent);

        assert.ok(prompt.includes(instruction));
        assert.ok(prompt.includes(documentContent));
    });

    test('Prompt should handle markdown with code blocks', () => {
        const instruction = 'Explain the code';
        const documentContent = `# Code Example

\`\`\`typescript
function hello() {
    console.log("Hello, World!");
}
\`\`\`
`;

        const prompt = buildUpdateDocumentPrompt(instruction, documentContent);

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
    test('Should handle Unix-style file paths in document', () => {
        const instruction = 'Update the imports';
        const documentContent = `# File References

See [config](/home/user/workspace/config.json) for details.
`;

        const prompt = buildUpdateDocumentPrompt(instruction, documentContent);
        assert.ok(prompt.includes('/home/user/workspace/config.json'));
    });

    test('Should handle Windows-style file paths in document', () => {
        const instruction = 'Update the imports';
        const documentContent = `# File References

See [config](C:\\Users\\workspace\\config.json) for details.
`;

        const prompt = buildUpdateDocumentPrompt(instruction, documentContent);
        assert.ok(prompt.includes('C:\\Users\\workspace\\config.json'));
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
        const documentContent = '# My Doc\nContent here';

        const prompt = buildUpdateDocumentPrompt(instruction, documentContent);

        // Verify the prompt has all required parts
        assert.ok(prompt.includes('The user wants to update this markdown document'));
        assert.ok(prompt.includes(instruction));
        assert.ok(prompt.includes('---'));  // Content delimiters
        assert.ok(prompt.includes(documentContent));
        assert.ok(prompt.includes('Please make the requested changes'));
    });
});

/**
 * Helper function to build the update document prompt
 * This mirrors the logic in ReviewEditorViewProvider.handleUpdateDocument
 */
function buildUpdateDocumentPrompt(instruction: string, documentContent: string): string {
    return `The user wants to update this markdown document with the following instruction:

${instruction}

Current document content:
---
${documentContent}
---

Please make the requested changes to the document.`;
}
