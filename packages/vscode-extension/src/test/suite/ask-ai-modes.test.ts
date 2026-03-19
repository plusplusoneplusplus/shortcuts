/**
 * Tests for Ask AI modes functionality
 * Tests the "Ask AI to Comment" and "Ask AI Interactively" menu modes
 */

import * as assert from 'assert';

// Types matching the implementation
type AICommandMode = 'comment' | 'interactive';

interface SerializedAICommand {
    id: string;
    label: string;
    icon?: string;
    order?: number;
    isCustomInput?: boolean;
}

interface SerializedAIMenuConfig {
    commentCommands: SerializedAICommand[];
    interactiveCommands: SerializedAICommand[];
}

interface AskAIContext {
    selectedText: string;
    startLine: number;
    endLine: number;
    surroundingLines: string;
    nearestHeading: string | null;
    allHeadings: string[];
    instructionType: string;
    customInstruction?: string;
    mode: AICommandMode;
}

/**
 * Default AI commands when none are configured
 */
const DEFAULT_AI_COMMANDS: SerializedAICommand[] = [
    { id: 'clarify', label: 'Clarify', icon: '💡', order: 1 },
    { id: 'go-deeper', label: 'Go Deeper', icon: '🔍', order: 2 },
    { id: 'custom', label: 'Custom...', icon: '💬', order: 99, isCustomInput: true }
];

suite('Ask AI Modes Tests', () => {

    suite('AICommandMode Type', () => {
        test('should accept "comment" as valid mode', () => {
            const mode: AICommandMode = 'comment';
            assert.strictEqual(mode, 'comment');
        });

        test('should accept "interactive" as valid mode', () => {
            const mode: AICommandMode = 'interactive';
            assert.strictEqual(mode, 'interactive');
        });
    });

    suite('SerializedAIMenuConfig', () => {
        test('should create menu config with both command sets', () => {
            const config: SerializedAIMenuConfig = {
                commentCommands: DEFAULT_AI_COMMANDS,
                interactiveCommands: DEFAULT_AI_COMMANDS
            };

            assert.strictEqual(config.commentCommands.length, 3);
            assert.strictEqual(config.interactiveCommands.length, 3);
        });

        test('should allow different commands for each mode', () => {
            const commentCommands: SerializedAICommand[] = [
                { id: 'clarify', label: 'Clarify', order: 1 }
            ];
            const interactiveCommands: SerializedAICommand[] = [
                { id: 'clarify', label: 'Clarify', order: 1 },
                { id: 'go-deeper', label: 'Go Deeper', order: 2 }
            ];

            const config: SerializedAIMenuConfig = {
                commentCommands,
                interactiveCommands
            };

            assert.strictEqual(config.commentCommands.length, 1);
            assert.strictEqual(config.interactiveCommands.length, 2);
        });
    });

    suite('AskAIContext with Mode', () => {
        test('should include mode in context for comment mode', () => {
            const context: AskAIContext = {
                selectedText: 'const x = 1;',
                startLine: 5,
                endLine: 5,
                surroundingLines: 'line 4\nline 6',
                nearestHeading: 'Variables',
                allHeadings: ['Variables', 'Functions'],
                instructionType: 'clarify',
                mode: 'comment'
            };

            assert.strictEqual(context.mode, 'comment');
            assert.strictEqual(context.instructionType, 'clarify');
        });

        test('should include mode in context for interactive mode', () => {
            const context: AskAIContext = {
                selectedText: 'function test() {}',
                startLine: 10,
                endLine: 12,
                surroundingLines: 'line 8\nline 9\nline 13',
                nearestHeading: 'Functions',
                allHeadings: ['Variables', 'Functions'],
                instructionType: 'go-deeper',
                mode: 'interactive'
            };

            assert.strictEqual(context.mode, 'interactive');
            assert.strictEqual(context.instructionType, 'go-deeper');
        });

        test('should include custom instruction with mode', () => {
            const context: AskAIContext = {
                selectedText: 'security check',
                startLine: 20,
                endLine: 20,
                surroundingLines: '',
                nearestHeading: null,
                allHeadings: [],
                instructionType: 'custom',
                customInstruction: 'Explain security implications',
                mode: 'interactive'
            };

            assert.strictEqual(context.mode, 'interactive');
            assert.strictEqual(context.instructionType, 'custom');
            assert.strictEqual(context.customInstruction, 'Explain security implications');
        });
    });

    suite('Menu HTML Building', () => {
        /**
         * Simulate buildAISubmenuHTML from ai-menu-builder.ts
         */
        function buildAISubmenuHTML(commands: SerializedAICommand[], mode: AICommandMode): string {
            const modeClass = mode === 'interactive' ? 'ask-ai-interactive-item' : 'ask-ai-item';
            const items = commands.map(cmd => {
                const icon = cmd.icon ? `<span class="menu-icon">${cmd.icon}</span>` : '';
                const dataCustomInput = cmd.isCustomInput ? 'data-custom-input="true"' : '';
                return `<div class="context-menu-item ${modeClass}" data-command-id="${cmd.id}" data-mode="${mode}" ${dataCustomInput}>
            ${icon}${cmd.label}
        </div>`;
            });
            return items.join('');
        }

        test('should generate HTML with comment mode class', () => {
            const html = buildAISubmenuHTML(DEFAULT_AI_COMMANDS, 'comment');
            
            assert.ok(html.includes('ask-ai-item'));
            assert.ok(!html.includes('ask-ai-interactive-item'));
            assert.ok(html.includes('data-mode="comment"'));
        });

        test('should generate HTML with interactive mode class', () => {
            const html = buildAISubmenuHTML(DEFAULT_AI_COMMANDS, 'interactive');
            
            assert.ok(html.includes('ask-ai-interactive-item'));
            assert.ok(!html.includes('class="context-menu-item ask-ai-item"'));
            assert.ok(html.includes('data-mode="interactive"'));
        });

        test('should include command IDs in HTML', () => {
            const html = buildAISubmenuHTML(DEFAULT_AI_COMMANDS, 'comment');
            
            assert.ok(html.includes('data-command-id="clarify"'));
            assert.ok(html.includes('data-command-id="go-deeper"'));
            assert.ok(html.includes('data-command-id="custom"'));
        });

        test('should mark custom input commands', () => {
            const html = buildAISubmenuHTML(DEFAULT_AI_COMMANDS, 'comment');
            
            // Only the custom command should have data-custom-input
            const customMatches = html.match(/data-custom-input="true"/g);
            assert.strictEqual(customMatches?.length, 1);
        });

        test('should include icons when present', () => {
            const html = buildAISubmenuHTML(DEFAULT_AI_COMMANDS, 'comment');
            
            assert.ok(html.includes('💡'));
            assert.ok(html.includes('🔍'));
            assert.ok(html.includes('💬'));
        });
    });

    suite('Menu Configuration', () => {
        /**
         * Simulate getAIMenuConfig from ai-menu-builder.ts
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

        test('should return default config when no config provided', () => {
            const config = getAIMenuConfig();
            
            assert.strictEqual(config.commentCommands.length, 3);
            assert.strictEqual(config.interactiveCommands.length, 3);
            assert.strictEqual(config.commentCommands[0].id, 'clarify');
        });

        test('should return default config when empty config provided', () => {
            const config = getAIMenuConfig({
                commentCommands: [],
                interactiveCommands: []
            });
            
            assert.strictEqual(config.commentCommands.length, 3);
            assert.strictEqual(config.interactiveCommands.length, 3);
        });

        test('should use provided config when valid', () => {
            const customConfig: SerializedAIMenuConfig = {
                commentCommands: [{ id: 'custom-cmd', label: 'Custom', order: 1 }],
                interactiveCommands: [{ id: 'custom-cmd', label: 'Custom', order: 1 }]
            };
            
            const config = getAIMenuConfig(customConfig);
            
            assert.strictEqual(config.commentCommands.length, 1);
            assert.strictEqual(config.commentCommands[0].id, 'custom-cmd');
        });

        test('should sort commands by order', () => {
            const customConfig: SerializedAIMenuConfig = {
                commentCommands: [
                    { id: 'third', label: 'Third', order: 3 },
                    { id: 'first', label: 'First', order: 1 },
                    { id: 'second', label: 'Second', order: 2 }
                ],
                interactiveCommands: [
                    { id: 'third', label: 'Third', order: 3 },
                    { id: 'first', label: 'First', order: 1 },
                    { id: 'second', label: 'Second', order: 2 }
                ]
            };
            
            const config = getAIMenuConfig(customConfig);
            
            assert.strictEqual(config.commentCommands[0].id, 'first');
            assert.strictEqual(config.commentCommands[1].id, 'second');
            assert.strictEqual(config.commentCommands[2].id, 'third');
        });
    });

    suite('Message Types', () => {
        interface WebviewMessage {
            type: string;
            context?: AskAIContext;
        }

        test('should build askAI message for comment mode', () => {
            const context: AskAIContext = {
                selectedText: 'test',
                startLine: 1,
                endLine: 1,
                surroundingLines: '',
                nearestHeading: null,
                allHeadings: [],
                instructionType: 'clarify',
                mode: 'comment'
            };

            const message: WebviewMessage = {
                type: 'askAI',
                context
            };

            assert.strictEqual(message.type, 'askAI');
            assert.strictEqual(message.context?.mode, 'comment');
        });

        test('should build askAIInteractive message for interactive mode', () => {
            const context: AskAIContext = {
                selectedText: 'test',
                startLine: 1,
                endLine: 1,
                surroundingLines: '',
                nearestHeading: null,
                allHeadings: [],
                instructionType: 'clarify',
                mode: 'interactive'
            };

            const message: WebviewMessage = {
                type: 'askAIInteractive',
                context
            };

            assert.strictEqual(message.type, 'askAIInteractive');
            assert.strictEqual(message.context?.mode, 'interactive');
        });
    });

    suite('Context Menu Visibility', () => {
        interface Settings {
            askAIEnabled?: boolean;
        }

        function shouldShowAskAIMenus(settings: Settings): boolean {
            return settings.askAIEnabled === true;
        }

        test('should show both Ask AI menus when enabled', () => {
            const settings: Settings = { askAIEnabled: true };
            assert.strictEqual(shouldShowAskAIMenus(settings), true);
        });

        test('should hide both Ask AI menus when disabled', () => {
            const settings: Settings = { askAIEnabled: false };
            assert.strictEqual(shouldShowAskAIMenus(settings), false);
        });

        test('should hide both Ask AI menus when undefined', () => {
            const settings: Settings = {};
            assert.strictEqual(shouldShowAskAIMenus(settings), false);
        });
    });

    suite('Prompt Building for Interactive Mode', () => {
        /**
         * Simulate prompt building for interactive sessions
         */
        function buildInteractivePrompt(
            context: AskAIContext,
            filePath: string
        ): string {
            const promptParts: string[] = [];
            
            promptParts.push(`File: ${filePath}`);
            if (context.nearestHeading) {
                promptParts.push(`Section: ${context.nearestHeading}`);
            }
            promptParts.push(`Lines: ${context.startLine}-${context.endLine}`);
            promptParts.push('');
            
            promptParts.push('Selected text:');
            promptParts.push('```');
            promptParts.push(context.selectedText);
            promptParts.push('```');
            promptParts.push('');
            
            if (context.customInstruction) {
                promptParts.push(`Instruction: ${context.customInstruction}`);
            } else {
                const instructionMap: Record<string, string> = {
                    'clarify': 'Please clarify and explain the selected text.',
                    'go-deeper': 'Please provide a deep analysis of the selected text.',
                    'custom': 'Please help me understand the selected text.'
                };
                promptParts.push(instructionMap[context.instructionType] || instructionMap['clarify']);
            }
            
            if (context.surroundingLines) {
                promptParts.push('');
                promptParts.push('Surrounding context:');
                promptParts.push('```');
                promptParts.push(context.surroundingLines);
                promptParts.push('```');
            }

            return promptParts.join('\n');
        }

        test('should build prompt with file path', () => {
            const context: AskAIContext = {
                selectedText: 'const x = 1;',
                startLine: 5,
                endLine: 5,
                surroundingLines: '',
                nearestHeading: null,
                allHeadings: [],
                instructionType: 'clarify',
                mode: 'interactive'
            };

            const prompt = buildInteractivePrompt(context, 'src/test.ts');
            
            assert.ok(prompt.includes('File: src/test.ts'));
            assert.ok(prompt.includes('Lines: 5-5'));
        });

        test('should include section heading when available', () => {
            const context: AskAIContext = {
                selectedText: 'const x = 1;',
                startLine: 5,
                endLine: 5,
                surroundingLines: '',
                nearestHeading: 'Variables',
                allHeadings: ['Variables'],
                instructionType: 'clarify',
                mode: 'interactive'
            };

            const prompt = buildInteractivePrompt(context, 'src/test.ts');
            
            assert.ok(prompt.includes('Section: Variables'));
        });

        test('should include selected text in code block', () => {
            const context: AskAIContext = {
                selectedText: 'function test() {\n  return 42;\n}',
                startLine: 10,
                endLine: 12,
                surroundingLines: '',
                nearestHeading: null,
                allHeadings: [],
                instructionType: 'clarify',
                mode: 'interactive'
            };

            const prompt = buildInteractivePrompt(context, 'src/test.ts');
            
            assert.ok(prompt.includes('Selected text:'));
            assert.ok(prompt.includes('function test()'));
            assert.ok(prompt.includes('return 42;'));
        });

        test('should use custom instruction when provided', () => {
            const context: AskAIContext = {
                selectedText: 'security check',
                startLine: 20,
                endLine: 20,
                surroundingLines: '',
                nearestHeading: null,
                allHeadings: [],
                instructionType: 'custom',
                customInstruction: 'Explain the security implications',
                mode: 'interactive'
            };

            const prompt = buildInteractivePrompt(context, 'src/auth.ts');
            
            assert.ok(prompt.includes('Instruction: Explain the security implications'));
        });

        test('should include surrounding context when available', () => {
            const context: AskAIContext = {
                selectedText: 'const x = 1;',
                startLine: 5,
                endLine: 5,
                surroundingLines: 'import { foo } from "bar";\n\nconst y = 2;',
                nearestHeading: null,
                allHeadings: [],
                instructionType: 'clarify',
                mode: 'interactive'
            };

            const prompt = buildInteractivePrompt(context, 'src/test.ts');
            
            assert.ok(prompt.includes('Surrounding context:'));
            assert.ok(prompt.includes('import { foo } from "bar";'));
            assert.ok(prompt.includes('const y = 2;'));
        });
    });
});
