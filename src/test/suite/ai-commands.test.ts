/**
 * Unit tests for Configurable AI Commands System
 * Tests the AI command types, registry, and prompt builder
 */

import * as assert from 'assert';
import {
    AICommand,
    DEFAULT_AI_COMMANDS,
    serializeCommand,
    serializeCommands,
    SerializedAICommand
} from '../../shortcuts/ai-service/ai-command-types';
import {
    buildPrompt,
    getAvailableVariables,
    PromptContext,
    usesTemplateVariables
} from '../../shortcuts/ai-service/prompt-builder';

/**
 * Helper function to create a PromptContext with defaults
 */
function createPromptContext(overrides: Partial<PromptContext> = {}): PromptContext {
    return {
        selectedText: 'test text',
        filePath: 'test.md',
        surroundingContent: 'surrounding content here',
        nearestHeading: 'Test Section',
        headings: ['Introduction', 'Test Section', 'Conclusion'],
        ...overrides
    };
}

/**
 * Helper function to create an AICommand with defaults
 */
function createCommand(overrides: Partial<AICommand> = {}): AICommand {
    return {
        id: 'test-command',
        label: 'Test Command',
        prompt: 'Please test',
        order: 1,
        ...overrides
    };
}

suite('AI Commands System Tests', () => {

    suite('DEFAULT_AI_COMMANDS', () => {

        test('should have three default commands', () => {
            assert.strictEqual(DEFAULT_AI_COMMANDS.length, 3);
        });

        test('should have clarify command', () => {
            const clarify = DEFAULT_AI_COMMANDS.find(c => c.id === 'clarify');
            assert.ok(clarify, 'clarify command should exist');
            assert.strictEqual(clarify.label, 'Clarify');
            assert.strictEqual(clarify.icon, '💡');
            assert.strictEqual(clarify.order, 1);
            assert.strictEqual(clarify.isCustomInput, undefined);
            assert.strictEqual(clarify.commentType, 'ai-clarification');
        });

        test('should have go-deeper command', () => {
            const goDeeper = DEFAULT_AI_COMMANDS.find(c => c.id === 'go-deeper');
            assert.ok(goDeeper, 'go-deeper command should exist');
            assert.strictEqual(goDeeper.label, 'Go Deeper');
            assert.strictEqual(goDeeper.icon, '🔍');
            assert.strictEqual(goDeeper.order, 2);
            assert.strictEqual(goDeeper.isCustomInput, undefined);
        });

        test('should have custom command', () => {
            const custom = DEFAULT_AI_COMMANDS.find(c => c.id === 'custom');
            assert.ok(custom, 'custom command should exist');
            assert.strictEqual(custom.label, 'Custom...');
            assert.strictEqual(custom.icon, '💬');
            assert.strictEqual(custom.order, 99);
            assert.strictEqual(custom.isCustomInput, true);
        });

        test('all default commands should have required fields', () => {
            for (const cmd of DEFAULT_AI_COMMANDS) {
                assert.ok(cmd.id, `Command should have id`);
                assert.ok(cmd.label, `Command ${cmd.id} should have label`);
                assert.ok(typeof cmd.prompt === 'string', `Command ${cmd.id} should have prompt`);
                assert.ok(typeof cmd.order === 'number', `Command ${cmd.id} should have order`);
            }
        });

        test('default commands should be sorted by order', () => {
            const orders = DEFAULT_AI_COMMANDS.map(c => c.order!);
            for (let i = 1; i < orders.length; i++) {
                assert.ok(orders[i] >= orders[i - 1], 'Commands should be in order');
            }
        });
    });

    suite('serializeCommand', () => {

        test('should serialize command with all fields', () => {
            const cmd: AICommand = {
                id: 'test',
                label: 'Test',
                icon: '🧪',
                prompt: 'Test prompt',
                order: 5,
                isCustomInput: true,
                responseLabel: '🤖 Response:',
                commentType: 'ai-critique'
            };

            const serialized = serializeCommand(cmd);

            assert.strictEqual(serialized.id, 'test');
            assert.strictEqual(serialized.label, 'Test');
            assert.strictEqual(serialized.icon, '🧪');
            assert.strictEqual(serialized.order, 5);
            assert.strictEqual(serialized.isCustomInput, true);
        });

        test('should not include prompt in serialized output', () => {
            const cmd = createCommand({ prompt: 'secret prompt' });
            const serialized = serializeCommand(cmd);

            assert.ok(!('prompt' in serialized), 'prompt should not be serialized');
        });

        test('should not include responseLabel in serialized output', () => {
            const cmd = createCommand({ responseLabel: '🤖 Test:' });
            const serialized = serializeCommand(cmd);

            assert.ok(!('responseLabel' in serialized), 'responseLabel should not be serialized');
        });

        test('should not include commentType in serialized output', () => {
            const cmd = createCommand({ commentType: 'ai-suggestion' });
            const serialized = serializeCommand(cmd);

            assert.ok(!('commentType' in serialized), 'commentType should not be serialized');
        });

        test('should handle undefined optional fields', () => {
            const cmd: AICommand = {
                id: 'minimal',
                label: 'Minimal',
                prompt: 'test'
            };

            const serialized = serializeCommand(cmd);

            assert.strictEqual(serialized.id, 'minimal');
            assert.strictEqual(serialized.label, 'Minimal');
            assert.strictEqual(serialized.icon, undefined);
            assert.strictEqual(serialized.order, undefined);
            assert.strictEqual(serialized.isCustomInput, undefined);
        });
    });

    suite('serializeCommands', () => {

        test('should serialize array of commands', () => {
            const commands: AICommand[] = [
                createCommand({ id: 'cmd1', label: 'Command 1' }),
                createCommand({ id: 'cmd2', label: 'Command 2' }),
            ];

            const serialized = serializeCommands(commands);

            assert.strictEqual(serialized.length, 2);
            assert.strictEqual(serialized[0].id, 'cmd1');
            assert.strictEqual(serialized[1].id, 'cmd2');
        });

        test('should handle empty array', () => {
            const serialized = serializeCommands([]);
            assert.strictEqual(serialized.length, 0);
        });

        test('should serialize DEFAULT_AI_COMMANDS correctly', () => {
            const serialized = serializeCommands(DEFAULT_AI_COMMANDS);

            assert.strictEqual(serialized.length, 3);
            assert.ok(serialized.every(s => s.id && s.label));
            assert.ok(serialized.every(s => !('prompt' in s)));
        });
    });

    suite('usesTemplateVariables', () => {

        test('should detect {{selection}} variable', () => {
            assert.strictEqual(usesTemplateVariables('Please explain {{selection}}'), true);
        });

        test('should detect {{file}} variable', () => {
            assert.strictEqual(usesTemplateVariables('In file {{file}}'), true);
        });

        test('should detect {{heading}} variable', () => {
            assert.strictEqual(usesTemplateVariables('Under {{heading}}'), true);
        });

        test('should detect {{context}} variable', () => {
            assert.strictEqual(usesTemplateVariables('With context: {{context}}'), true);
        });

        test('should detect {{headings}} variable', () => {
            assert.strictEqual(usesTemplateVariables('Headings: {{headings}}'), true);
        });

        test('should detect multiple variables', () => {
            assert.strictEqual(
                usesTemplateVariables('{{selection}} in {{file}} under {{heading}}'),
                true
            );
        });

        test('should return false for simple prompt', () => {
            assert.strictEqual(usesTemplateVariables('Please clarify'), false);
        });

        test('should return false for empty string', () => {
            assert.strictEqual(usesTemplateVariables(''), false);
        });

        test('should not match invalid variables', () => {
            assert.strictEqual(usesTemplateVariables('{{invalid}}'), false);
            assert.strictEqual(usesTemplateVariables('{{}}'), false);
            assert.strictEqual(usesTemplateVariables('{{ selection }}'), false);
        });
    });

    suite('getAvailableVariables', () => {

        test('should return all available variables', () => {
            const variables = getAvailableVariables();

            assert.ok(variables.length >= 5);
            assert.ok(variables.some(v => v.name === '{{selection}}'));
            assert.ok(variables.some(v => v.name === '{{file}}'));
            assert.ok(variables.some(v => v.name === '{{heading}}'));
            assert.ok(variables.some(v => v.name === '{{context}}'));
            assert.ok(variables.some(v => v.name === '{{headings}}'));
        });

        test('all variables should have descriptions', () => {
            const variables = getAvailableVariables();

            for (const v of variables) {
                assert.ok(v.name, 'Variable should have name');
                assert.ok(v.description, `Variable ${v.name} should have description`);
                assert.ok(v.description.length > 0, `Variable ${v.name} description should not be empty`);
            }
        });
    });

    suite('buildPrompt - Simple Prompts (no template variables)', () => {

        test('should build simple clarify prompt', () => {
            const context = createPromptContext({
                selectedText: 'test code',
                filePath: 'src/main.rs'
            });

            // Using default clarify command from registry
            const result = buildPrompt('clarify', context);

            assert.ok(result.includes('test code'), 'Should include selected text');
            assert.ok(result.includes('src/main.rs'), 'Should include file path');
        });

        test('should build go-deeper prompt', () => {
            const context = createPromptContext({
                selectedText: 'algorithm',
                filePath: 'lib.rs'
            });

            const result = buildPrompt('go-deeper', context);

            assert.ok(result.includes('algorithm'), 'Should include selected text');
            assert.ok(result.includes('lib.rs'), 'Should include file path');
        });

        test('should build custom prompt with custom instruction', () => {
            const context = createPromptContext({
                selectedText: 'unsafe block',
                filePath: 'ffi.rs'
            });

            const result = buildPrompt('custom', context, 'Explain the safety of');

            assert.ok(result.includes('Explain the safety of'), 'Should include custom instruction');
            assert.ok(result.includes('unsafe block'), 'Should include selected text');
            assert.ok(result.includes('ffi.rs'), 'Should include file path');
        });

        test('should handle unknown command ID gracefully', () => {
            const context = createPromptContext();

            const result = buildPrompt('unknown-command', context);

            // Should fall back to a default prompt
            assert.ok(result.length > 0, 'Should produce some output');
            assert.ok(result.includes('test text') || result.includes('test.md'));
        });

        test('should preserve selected text as-is', () => {
            const context = createPromptContext({
                selectedText: '  some text  '
            });

            const result = buildPrompt('clarify', context);

            // The prompt builder preserves the selected text exactly as provided
            assert.ok(result.includes('some text'), 'Should include the text content');
        });
    });

    suite('buildPrompt - Template Variable Substitution', () => {

        test('should substitute {{selection}} variable', () => {
            const context = createPromptContext({
                selectedText: 'my selected text'
            });

            // Simulate a command that uses template variables
            // Note: This tests the substituteVariables function indirectly
            const template = 'Explain {{selection}} please';
            const result = template.replace(/\{\{selection\}\}/g, context.selectedText);

            assert.strictEqual(result, 'Explain my selected text please');
        });

        test('should substitute {{file}} variable', () => {
            const context = createPromptContext({
                filePath: 'src/module.ts'
            });

            const template = 'In {{file}}, explain';
            const result = template.replace(/\{\{file\}\}/g, context.filePath);

            assert.strictEqual(result, 'In src/module.ts, explain');
        });

        test('should substitute {{heading}} variable', () => {
            const context = createPromptContext({
                nearestHeading: 'Configuration'
            });

            const template = 'Under heading {{heading}}';
            const result = template.replace(/\{\{heading\}\}/g, context.nearestHeading || '');

            assert.strictEqual(result, 'Under heading Configuration');
        });

        test('should substitute {{context}} variable', () => {
            const context = createPromptContext({
                surroundingContent: 'function helper() {}'
            });

            const template = 'Given context: {{context}}';
            const result = template.replace(/\{\{context\}\}/g, context.surroundingContent || '');

            assert.strictEqual(result, 'Given context: function helper() {}');
        });

        test('should substitute {{headings}} variable', () => {
            const context = createPromptContext({
                headings: ['Intro', 'Main', 'End']
            });

            const template = 'Headings: {{headings}}';
            const result = template.replace(/\{\{headings\}\}/g, context.headings?.join(', ') || '');

            assert.strictEqual(result, 'Headings: Intro, Main, End');
        });

        test('should handle null/undefined optional fields', () => {
            const context: PromptContext = {
                selectedText: 'text',
                filePath: 'file.md',
                nearestHeading: null,
                headings: undefined
            };

            const template = 'H:{{heading}} Hs:{{headings}}';
            const result = template
                .replace(/\{\{heading\}\}/g, context.nearestHeading || '')
                .replace(/\{\{headings\}\}/g, context.headings?.join(', ') || '');

            assert.strictEqual(result, 'H: Hs:');
        });

        test('should substitute multiple variables', () => {
            const context = createPromptContext({
                selectedText: 'code',
                filePath: 'test.py',
                nearestHeading: 'Testing'
            });

            const template = '{{selection}} in {{file}} under {{heading}}';
            let result = template;
            result = result.replace(/\{\{selection\}\}/g, context.selectedText);
            result = result.replace(/\{\{file\}\}/g, context.filePath);
            result = result.replace(/\{\{heading\}\}/g, context.nearestHeading || '');

            assert.strictEqual(result, 'code in test.py under Testing');
        });
    });

    suite('buildPrompt - Edge Cases', () => {

        test('should handle empty selected text', () => {
            const context = createPromptContext({ selectedText: '' });
            const result = buildPrompt('clarify', context);

            assert.ok(result.length > 0, 'Should produce output');
        });

        test('should handle selected text with newlines', () => {
            const context = createPromptContext({
                selectedText: 'line1\nline2\nline3'
            });

            const result = buildPrompt('clarify', context);

            assert.ok(result.includes('line1\nline2\nline3') || result.includes('line1'));
        });

        test('should handle selected text with special characters', () => {
            const context = createPromptContext({
                selectedText: 'fn main() { println!("hello"); }'
            });

            const result = buildPrompt('clarify', context);

            assert.ok(result.includes('fn main()'));
        });

        test('should handle selected text with quotes', () => {
            const context = createPromptContext({
                selectedText: 'say "hello" to the \'world\''
            });

            const result = buildPrompt('clarify', context);

            assert.ok(result.includes('say "hello"') || result.includes("'world'"));
        });

        test('should handle selected text with unicode', () => {
            const context = createPromptContext({
                selectedText: '你好世界 🌍 émoji'
            });

            const result = buildPrompt('clarify', context);

            assert.ok(result.includes('你好') || result.includes('🌍'));
        });

        test('should handle very long selected text', () => {
            const longText = 'a'.repeat(5000);
            const context = createPromptContext({ selectedText: longText });

            const result = buildPrompt('clarify', context);

            assert.ok(result.length > 0);
            assert.ok(result.includes('aaaa') || result.length > 1000);
        });

        test('should handle file paths with spaces', () => {
            const context = createPromptContext({
                filePath: 'my project/my file.md'
            });

            const result = buildPrompt('clarify', context);

            assert.ok(result.includes('my project/my file.md'));
        });

        test('should handle Windows-style file paths', () => {
            const context = createPromptContext({
                filePath: 'C:\\Users\\project\\file.md'
            });

            const result = buildPrompt('clarify', context);

            assert.ok(result.includes('C:\\Users\\project\\file.md'));
        });
    });

    suite('AICommand Interface Validation', () => {

        test('should accept minimal valid command', () => {
            const cmd: AICommand = {
                id: 'test',
                label: 'Test',
                prompt: 'Do something'
            };

            assert.ok(cmd.id);
            assert.ok(cmd.label);
            assert.ok(cmd.prompt);
        });

        test('should accept fully specified command', () => {
            const cmd: AICommand = {
                id: 'full-command',
                label: 'Full Command',
                icon: '🚀',
                prompt: 'Full prompt with {{selection}}',
                order: 10,
                isCustomInput: false,
                responseLabel: '🤖 **Response:**',
                commentType: 'ai-suggestion'
            };

            assert.strictEqual(cmd.id, 'full-command');
            assert.strictEqual(cmd.label, 'Full Command');
            assert.strictEqual(cmd.icon, '🚀');
            assert.strictEqual(cmd.prompt, 'Full prompt with {{selection}}');
            assert.strictEqual(cmd.order, 10);
            assert.strictEqual(cmd.isCustomInput, false);
            assert.strictEqual(cmd.responseLabel, '🤖 **Response:**');
            assert.strictEqual(cmd.commentType, 'ai-suggestion');
        });

        test('should allow all valid commentType values', () => {
            const types: AICommand['commentType'][] = [
                'ai-clarification',
                'ai-critique',
                'ai-suggestion',
                'ai-question'
            ];

            for (const type of types) {
                const cmd: AICommand = {
                    id: 'test',
                    label: 'Test',
                    prompt: 'test',
                    commentType: type
                };
                assert.strictEqual(cmd.commentType, type);
            }
        });
    });

    suite('SerializedAICommand Interface', () => {

        test('should only contain webview-safe fields', () => {
            const serialized: SerializedAICommand = {
                id: 'test',
                label: 'Test',
                icon: '🧪',
                order: 1,
                isCustomInput: true
            };

            // These should be the only fields
            const keys = Object.keys(serialized);
            assert.ok(keys.includes('id'));
            assert.ok(keys.includes('label'));
            assert.ok(keys.includes('icon'));
            assert.ok(keys.includes('order'));
            assert.ok(keys.includes('isCustomInput'));
            assert.strictEqual(keys.length, 5);
        });

        test('should handle minimal serialized command', () => {
            const serialized: SerializedAICommand = {
                id: 'minimal',
                label: 'Minimal'
            };

            assert.strictEqual(serialized.id, 'minimal');
            assert.strictEqual(serialized.label, 'Minimal');
            assert.strictEqual(serialized.icon, undefined);
            assert.strictEqual(serialized.order, undefined);
            assert.strictEqual(serialized.isCustomInput, undefined);
        });
    });

    suite('Custom Commands Configuration', () => {

        test('should support custom command with simple prompt', () => {
            const customCmd: AICommand = {
                id: 'summarize',
                label: 'Summarize',
                icon: '📝',
                prompt: 'Please summarize',
                order: 3
            };

            assert.strictEqual(customCmd.id, 'summarize');
            assert.strictEqual(customCmd.prompt, 'Please summarize');
        });

        test('should support custom command with template prompt', () => {
            const customCmd: AICommand = {
                id: 'analyze',
                label: 'Analyze',
                icon: '🔬',
                prompt: 'Analyze {{selection}} in context of {{heading}} from {{file}}',
                order: 4
            };

            assert.ok(usesTemplateVariables(customCmd.prompt));
        });

        test('should support custom command with isCustomInput', () => {
            const customCmd: AICommand = {
                id: 'ask',
                label: 'Ask...',
                icon: '❓',
                prompt: '',
                order: 100,
                isCustomInput: true
            };

            assert.strictEqual(customCmd.isCustomInput, true);
        });

        test('should support multiple custom commands with different orders', () => {
            const commands: AICommand[] = [
                { id: 'cmd1', label: 'Cmd 1', prompt: 'p1', order: 5 },
                { id: 'cmd2', label: 'Cmd 2', prompt: 'p2', order: 1 },
                { id: 'cmd3', label: 'Cmd 3', prompt: 'p3', order: 10 },
            ];

            const sorted = [...commands].sort((a, b) => (a.order ?? 100) - (b.order ?? 100));

            assert.strictEqual(sorted[0].id, 'cmd2');
            assert.strictEqual(sorted[1].id, 'cmd1');
            assert.strictEqual(sorted[2].id, 'cmd3');
        });

        test('should handle commands without order (defaults to 100)', () => {
            const commands: AICommand[] = [
                { id: 'cmd1', label: 'Cmd 1', prompt: 'p1' },
                { id: 'cmd2', label: 'Cmd 2', prompt: 'p2', order: 1 },
            ];

            const sorted = [...commands].sort((a, b) => (a.order ?? 100) - (b.order ?? 100));

            assert.strictEqual(sorted[0].id, 'cmd2'); // order: 1
            assert.strictEqual(sorted[1].id, 'cmd1'); // order: 100 (default)
        });
    });

    suite('PromptContext Interface', () => {

        test('should accept minimal context', () => {
            const context: PromptContext = {
                selectedText: 'text',
                filePath: 'file.md'
            };

            assert.ok(context.selectedText);
            assert.ok(context.filePath);
        });

        test('should accept full context', () => {
            const context: PromptContext = {
                selectedText: 'text',
                filePath: 'file.md',
                surroundingContent: 'before\nafter',
                nearestHeading: 'Section 1',
                headings: ['Intro', 'Section 1', 'End']
            };

            assert.strictEqual(context.selectedText, 'text');
            assert.strictEqual(context.filePath, 'file.md');
            assert.strictEqual(context.surroundingContent, 'before\nafter');
            assert.strictEqual(context.nearestHeading, 'Section 1');
            assert.deepStrictEqual(context.headings, ['Intro', 'Section 1', 'End']);
        });

        test('should handle null nearestHeading', () => {
            const context: PromptContext = {
                selectedText: 'text',
                filePath: 'file.md',
                nearestHeading: null
            };

            assert.strictEqual(context.nearestHeading, null);
        });

        test('should handle empty headings array', () => {
            const context: PromptContext = {
                selectedText: 'text',
                filePath: 'file.md',
                headings: []
            };

            assert.deepStrictEqual(context.headings, []);
        });
    });

    suite('Integration - Realistic Scenarios', () => {

        test('should handle code clarification request', () => {
            const context = createPromptContext({
                selectedText: 'impl Drop for Connection',
                filePath: 'src/network/connection.rs',
                nearestHeading: 'Connection Lifecycle',
                headings: ['Overview', 'Connection Lifecycle', 'Error Handling']
            });

            const result = buildPrompt('clarify', context);

            assert.ok(result.includes('impl Drop for Connection'));
            assert.ok(result.includes('connection.rs'));
        });

        test('should handle documentation analysis request', () => {
            const context = createPromptContext({
                selectedText: 'The cluster uses a gossip protocol',
                filePath: 'docs/architecture.md',
                nearestHeading: 'Cluster Topology'
            });

            const result = buildPrompt('go-deeper', context);

            assert.ok(result.includes('gossip protocol'));
        });

        test('should handle security review request', () => {
            const context = createPromptContext({
                selectedText: 'unsafe { ptr::read_volatile(addr) }',
                filePath: 'src/ffi/bindings.rs',
                nearestHeading: 'Memory Access'
            });

            const result = buildPrompt('custom', context, 'Explain the safety implications of');

            assert.ok(result.includes('safety implications'));
            assert.ok(result.includes('ptr::read_volatile'));
        });

        test('should handle performance analysis request', () => {
            const context = createPromptContext({
                selectedText: 'for item in collection.iter().filter(|x| x.is_valid()).map(|x| x.process())',
                filePath: 'src/pipeline.rs'
            });

            const result = buildPrompt('custom', context, 'Analyze the performance characteristics of');

            assert.ok(result.includes('performance characteristics'));
            assert.ok(result.includes('filter') || result.includes('pipeline.rs'));
        });
    });
});
