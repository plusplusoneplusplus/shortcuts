/**
 * Unit tests for AI Menu Builder
 * Tests the AI submenu HTML generation and hover preview functionality
 *
 * Note: Since ai-menu-builder.ts is a webview script bundled for browser,
 * we test the pure function logic by recreating it here.
 */

import * as assert from 'assert';

/**
 * Serialized AI command interface (mirrors the webview type)
 */
interface SerializedAICommand {
    id: string;
    label: string;
    icon?: string;
    order?: number;
    isCustomInput?: boolean;
    prompt?: string;
}

/**
 * Serialized AI menu configuration (mirrors the webview type)
 */
interface SerializedAIMenuConfig {
    commentCommands: SerializedAICommand[];
    interactiveCommands: SerializedAICommand[];
}

/**
 * AI command mode type
 */
type AICommandMode = 'comment' | 'interactive';

/**
 * Default AI commands - mirrors the constants in ai-menu-builder.ts
 */
const DEFAULT_AI_COMMANDS: SerializedAICommand[] = [
    {
        id: 'clarify',
        label: 'Clarify',
        icon: '💡',
        order: 1,
        prompt: 'Please clarify the following snippet with more depth.'
    },
    {
        id: 'go-deeper',
        label: 'Go Deeper',
        icon: '🔍',
        order: 2,
        prompt: 'Please provide an in-depth explanation and analysis of the following snippet.'
    },
    {
        id: 'custom',
        label: 'Custom...',
        icon: '💬',
        order: 99,
        isCustomInput: true,
        prompt: 'Please explain the following snippet'
    }
];

/**
 * Get the AI commands to display in menus (mirrors the function in ai-menu-builder.ts)
 */
function getAICommands(configuredCommands?: SerializedAICommand[]): SerializedAICommand[] {
    if (configuredCommands && configuredCommands.length > 0) {
        return [...configuredCommands].sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
    }
    return DEFAULT_AI_COMMANDS;
}

/**
 * Get AI menu configuration (mirrors the function in ai-menu-builder.ts)
 */
function getAIMenuConfig(config?: SerializedAIMenuConfig): SerializedAIMenuConfig {
    if (config && config.commentCommands && config.commentCommands.length > 0) {
        return {
            commentCommands: [...config.commentCommands].sort((a, b) => (a.order ?? 100) - (b.order ?? 100)),
            interactiveCommands: [...config.interactiveCommands].sort((a, b) => (a.order ?? 100) - (b.order ?? 100))
        };
    }
    return {
        commentCommands: DEFAULT_AI_COMMANDS,
        interactiveCommands: DEFAULT_AI_COMMANDS
    };
}

/**
 * Build the AI submenu HTML (mirrors the function in ai-menu-builder.ts)
 */
function buildAISubmenuHTML(commands: SerializedAICommand[], mode: AICommandMode = 'comment'): string {
    const modeClass = mode === 'interactive' ? 'ask-ai-interactive-item' : 'ask-ai-item';
    const items = commands.map(cmd => {
        const icon = cmd.icon ? `<span class="menu-icon">${cmd.icon}</span>` : '';
        const dataCustomInput = cmd.isCustomInput ? 'data-custom-input="true"' : '';
        const dataPrompt = cmd.prompt ? `data-prompt="${encodeURIComponent(cmd.prompt)}"` : '';
        return `<div class="context-menu-item ${modeClass}" data-command-id="${cmd.id}" data-mode="${mode}" ${dataCustomInput} ${dataPrompt}>
            ${icon}${cmd.label}
        </div>`;
    });

    return items.join('');
}

suite('AI Menu Builder Tests', () => {

    suite('getAICommands', () => {

        test('should return default commands when none configured', () => {
            const commands = getAICommands();
            assert.strictEqual(commands.length, 3);
            assert.ok(commands.some(c => c.id === 'clarify'));
            assert.ok(commands.some(c => c.id === 'go-deeper'));
            assert.ok(commands.some(c => c.id === 'custom'));
        });

        test('should return default commands when empty array provided', () => {
            const commands = getAICommands([]);
            assert.strictEqual(commands.length, 3);
        });

        test('should return configured commands when provided', () => {
            const customCommands: SerializedAICommand[] = [
                { id: 'cmd1', label: 'Command 1', order: 1 },
                { id: 'cmd2', label: 'Command 2', order: 2 }
            ];
            const commands = getAICommands(customCommands);
            assert.strictEqual(commands.length, 2);
            assert.strictEqual(commands[0].id, 'cmd1');
            assert.strictEqual(commands[1].id, 'cmd2');
        });

        test('should sort commands by order', () => {
            const customCommands: SerializedAICommand[] = [
                { id: 'cmd2', label: 'Command 2', order: 2 },
                { id: 'cmd1', label: 'Command 1', order: 1 },
                { id: 'cmd3', label: 'Command 3', order: 3 }
            ];
            const commands = getAICommands(customCommands);
            assert.strictEqual(commands[0].id, 'cmd1');
            assert.strictEqual(commands[1].id, 'cmd2');
            assert.strictEqual(commands[2].id, 'cmd3');
        });

        test('should handle commands without order (defaults to 100)', () => {
            const customCommands: SerializedAICommand[] = [
                { id: 'no-order', label: 'No Order' },
                { id: 'with-order', label: 'With Order', order: 1 }
            ];
            const commands = getAICommands(customCommands);
            assert.strictEqual(commands[0].id, 'with-order');
            assert.strictEqual(commands[1].id, 'no-order');
        });
    });

    suite('getAIMenuConfig', () => {

        test('should return default config when none provided', () => {
            const config = getAIMenuConfig();
            assert.ok(config.commentCommands.length > 0);
            assert.ok(config.interactiveCommands.length > 0);
        });

        test('should return default config when empty config provided', () => {
            const config = getAIMenuConfig({ commentCommands: [], interactiveCommands: [] });
            assert.strictEqual(config.commentCommands.length, 3);
            assert.strictEqual(config.interactiveCommands.length, 3);
        });

        test('should return configured commands when provided', () => {
            const customConfig: SerializedAIMenuConfig = {
                commentCommands: [{ id: 'comment-cmd', label: 'Comment Cmd', order: 1 }],
                interactiveCommands: [{ id: 'interactive-cmd', label: 'Interactive Cmd', order: 1 }]
            };
            const config = getAIMenuConfig(customConfig);
            assert.strictEqual(config.commentCommands.length, 1);
            assert.strictEqual(config.commentCommands[0].id, 'comment-cmd');
            assert.strictEqual(config.interactiveCommands.length, 1);
            assert.strictEqual(config.interactiveCommands[0].id, 'interactive-cmd');
        });

        test('should sort both comment and interactive commands by order', () => {
            const customConfig: SerializedAIMenuConfig = {
                commentCommands: [
                    { id: 'c2', label: 'C2', order: 2 },
                    { id: 'c1', label: 'C1', order: 1 }
                ],
                interactiveCommands: [
                    { id: 'i2', label: 'I2', order: 2 },
                    { id: 'i1', label: 'I1', order: 1 }
                ]
            };
            const config = getAIMenuConfig(customConfig);
            assert.strictEqual(config.commentCommands[0].id, 'c1');
            assert.strictEqual(config.interactiveCommands[0].id, 'i1');
        });
    });

    suite('buildAISubmenuHTML', () => {

        test('should generate HTML with command id', () => {
            const commands: SerializedAICommand[] = [
                { id: 'test-cmd', label: 'Test Command' }
            ];
            const html = buildAISubmenuHTML(commands, 'comment');
            assert.ok(html.includes('data-command-id="test-cmd"'));
        });

        test('should generate HTML with mode attribute for comment mode', () => {
            const commands: SerializedAICommand[] = [
                { id: 'test', label: 'Test' }
            ];
            const html = buildAISubmenuHTML(commands, 'comment');
            assert.ok(html.includes('data-mode="comment"'));
        });

        test('should generate HTML with mode attribute for interactive mode', () => {
            const commands: SerializedAICommand[] = [
                { id: 'test', label: 'Test' }
            ];
            const html = buildAISubmenuHTML(commands, 'interactive');
            assert.ok(html.includes('data-mode="interactive"'));
        });

        test('should include icon when provided', () => {
            const commands: SerializedAICommand[] = [
                { id: 'test', label: 'Test', icon: '🔍' }
            ];
            const html = buildAISubmenuHTML(commands, 'comment');
            assert.ok(html.includes('🔍'));
            assert.ok(html.includes('class="menu-icon"'));
        });

        test('should not include icon span when icon not provided', () => {
            const commands: SerializedAICommand[] = [
                { id: 'test', label: 'Test' }
            ];
            const html = buildAISubmenuHTML(commands, 'comment');
            assert.ok(!html.includes('class="menu-icon"'));
        });

        test('should include custom input attribute when specified', () => {
            const commands: SerializedAICommand[] = [
                { id: 'custom', label: 'Custom...', isCustomInput: true }
            ];
            const html = buildAISubmenuHTML(commands, 'comment');
            assert.ok(html.includes('data-custom-input="true"'));
        });

        test('should not include custom input attribute when not specified', () => {
            const commands: SerializedAICommand[] = [
                { id: 'test', label: 'Test' }
            ];
            const html = buildAISubmenuHTML(commands, 'comment');
            assert.ok(!html.includes('data-custom-input'));
        });

        test('should use correct CSS class for comment mode', () => {
            const commands: SerializedAICommand[] = [
                { id: 'test', label: 'Test' }
            ];
            const html = buildAISubmenuHTML(commands, 'comment');
            assert.ok(html.includes('ask-ai-item'));
            assert.ok(!html.includes('ask-ai-interactive-item'));
        });

        test('should use correct CSS class for interactive mode', () => {
            const commands: SerializedAICommand[] = [
                { id: 'test', label: 'Test' }
            ];
            const html = buildAISubmenuHTML(commands, 'interactive');
            assert.ok(html.includes('ask-ai-interactive-item'));
        });

        test('should include prompt as data attribute when provided', () => {
            const commands: SerializedAICommand[] = [
                { id: 'test', label: 'Test', prompt: 'This is a test prompt' }
            ];
            const html = buildAISubmenuHTML(commands, 'comment');
            assert.ok(html.includes('data-prompt='));
            assert.ok(html.includes(encodeURIComponent('This is a test prompt')));
        });

        test('should not include prompt attribute when not provided', () => {
            const commands: SerializedAICommand[] = [
                { id: 'test', label: 'Test' }
            ];
            const html = buildAISubmenuHTML(commands, 'comment');
            assert.ok(!html.includes('data-prompt'));
        });

        test('should URL encode prompt with special characters', () => {
            const commands: SerializedAICommand[] = [
                { id: 'test', label: 'Test', prompt: 'Test "quotes" & <special> chars' }
            ];
            const html = buildAISubmenuHTML(commands, 'comment');
            const encoded = encodeURIComponent('Test "quotes" & <special> chars');
            assert.ok(html.includes(`data-prompt="${encoded}"`));
        });

        test('should generate HTML for multiple commands', () => {
            const commands: SerializedAICommand[] = [
                { id: 'cmd1', label: 'Command 1', icon: '💡', prompt: 'Prompt 1' },
                { id: 'cmd2', label: 'Command 2', icon: '🔍', prompt: 'Prompt 2' },
                { id: 'cmd3', label: 'Command 3', isCustomInput: true }
            ];
            const html = buildAISubmenuHTML(commands, 'comment');

            assert.ok(html.includes('data-command-id="cmd1"'));
            assert.ok(html.includes('data-command-id="cmd2"'));
            assert.ok(html.includes('data-command-id="cmd3"'));
            assert.ok(html.includes('💡'));
            assert.ok(html.includes('🔍'));
            assert.ok(html.includes(encodeURIComponent('Prompt 1')));
            assert.ok(html.includes(encodeURIComponent('Prompt 2')));
        });

        test('should include label text in HTML', () => {
            const commands: SerializedAICommand[] = [
                { id: 'test', label: 'My Label' }
            ];
            const html = buildAISubmenuHTML(commands, 'comment');
            assert.ok(html.includes('My Label'));
        });
    });

    suite('Default AI Commands Prompts', () => {

        test('clarify command should have prompt', () => {
            const clarify = DEFAULT_AI_COMMANDS.find(c => c.id === 'clarify');
            assert.ok(clarify, 'clarify command should exist');
            assert.ok(clarify.prompt, 'clarify should have prompt');
            assert.ok(clarify.prompt.length > 10, 'prompt should be meaningful');
        });

        test('go-deeper command should have prompt', () => {
            const goDeeper = DEFAULT_AI_COMMANDS.find(c => c.id === 'go-deeper');
            assert.ok(goDeeper, 'go-deeper command should exist');
            assert.ok(goDeeper.prompt, 'go-deeper should have prompt');
            assert.ok(goDeeper.prompt.length > 10, 'prompt should be meaningful');
        });

        test('custom command should have prompt', () => {
            const custom = DEFAULT_AI_COMMANDS.find(c => c.id === 'custom');
            assert.ok(custom, 'custom command should exist');
            assert.ok(custom.prompt, 'custom should have prompt');
            assert.ok(custom.prompt.length > 10, 'prompt should be meaningful');
        });

        test('all default commands should have prompts', () => {
            for (const cmd of DEFAULT_AI_COMMANDS) {
                assert.ok(cmd.prompt, `Command ${cmd.id} should have prompt`);
            }
        });

        test('default commands should have appropriate icons', () => {
            const clarify = DEFAULT_AI_COMMANDS.find(c => c.id === 'clarify');
            assert.strictEqual(clarify?.icon, '💡');

            const goDeeper = DEFAULT_AI_COMMANDS.find(c => c.id === 'go-deeper');
            assert.strictEqual(goDeeper?.icon, '🔍');

            const custom = DEFAULT_AI_COMMANDS.find(c => c.id === 'custom');
            assert.strictEqual(custom?.icon, '💬');
        });

        test('generated HTML includes prompts for default commands', () => {
            const html = buildAISubmenuHTML(DEFAULT_AI_COMMANDS, 'comment');

            for (const cmd of DEFAULT_AI_COMMANDS) {
                if (cmd.prompt) {
                    assert.ok(
                        html.includes(encodeURIComponent(cmd.prompt)),
                        `HTML should include encoded prompt for ${cmd.id}`
                    );
                }
            }
        });
    });

    suite('Prompt Encoding', () => {

        test('should encode spaces in prompt', () => {
            const commands: SerializedAICommand[] = [
                { id: 'test', label: 'Test', prompt: 'word1 word2 word3' }
            ];
            const html = buildAISubmenuHTML(commands, 'comment');
            assert.ok(html.includes('word1%20word2%20word3'));
        });

        test('should encode newlines in prompt', () => {
            const commands: SerializedAICommand[] = [
                { id: 'test', label: 'Test', prompt: 'line1\nline2' }
            ];
            const html = buildAISubmenuHTML(commands, 'comment');
            assert.ok(html.includes(encodeURIComponent('line1\nline2')));
        });

        test('should encode ampersands in prompt', () => {
            const commands: SerializedAICommand[] = [
                { id: 'test', label: 'Test', prompt: 'this & that' }
            ];
            const html = buildAISubmenuHTML(commands, 'comment');
            assert.ok(html.includes('this%20%26%20that'));
        });

        test('should encode angle brackets in prompt', () => {
            const commands: SerializedAICommand[] = [
                { id: 'test', label: 'Test', prompt: '<tag>content</tag>' }
            ];
            const html = buildAISubmenuHTML(commands, 'comment');
            assert.ok(html.includes(encodeURIComponent('<tag>content</tag>')));
        });

        test('should handle unicode in prompt', () => {
            const commands: SerializedAICommand[] = [
                { id: 'test', label: 'Test', prompt: '你好 🌍 émoji' }
            ];
            const html = buildAISubmenuHTML(commands, 'comment');
            assert.ok(html.includes(encodeURIComponent('你好 🌍 émoji')));
        });
    });

    suite('Hover Preview Integration', () => {

        test('prompt can be decoded after encoding', () => {
            const originalPrompt = 'This is a "test" with <special> & characters';
            const encoded = encodeURIComponent(originalPrompt);
            const decoded = decodeURIComponent(encoded);
            assert.strictEqual(decoded, originalPrompt);
        });

        test('HTML structure supports hover preview extraction', () => {
            const commands: SerializedAICommand[] = [
                { id: 'clarify', label: 'Clarify', prompt: 'Test prompt for clarify' }
            ];
            const html = buildAISubmenuHTML(commands, 'comment');

            // Verify the HTML has the right structure for JS to extract prompt
            assert.ok(html.includes('data-prompt='));
            assert.ok(html.includes('data-command-id="clarify"'));

            // Simulate extracting and decoding as JS would do
            const match = html.match(/data-prompt="([^"]*)"/);
            assert.ok(match, 'Should be able to extract data-prompt');
            const extractedPrompt = decodeURIComponent(match![1]);
            assert.strictEqual(extractedPrompt, 'Test prompt for clarify');
        });

        test('multiple items have separate prompts', () => {
            const commands: SerializedAICommand[] = [
                { id: 'cmd1', label: 'Cmd1', prompt: 'Prompt 1' },
                { id: 'cmd2', label: 'Cmd2', prompt: 'Prompt 2' }
            ];
            const html = buildAISubmenuHTML(commands, 'comment');

            assert.ok(html.includes(encodeURIComponent('Prompt 1')));
            assert.ok(html.includes(encodeURIComponent('Prompt 2')));
        });
    });
});
