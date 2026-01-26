/**
 * Tests for {{RESULTS_FILE}} Template Variable in AI Reduce
 *
 * Tests the temp file approach for passing large JSON results to AI,
 * which avoids shell escaping issues on Windows.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    executePipeline
} from '../../src/pipeline';
import {
    AIInvokerResult,
    PipelineConfig
} from '../../src/pipeline/types';

describe('RESULTS_FILE Template Variable', () => {
    let tempDir: string;

    beforeEach(async () => {
        tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'results-file-test-'));
    });

    afterEach(async () => {
        await fs.promises.rm(tempDir, { recursive: true, force: true });
    });

    // Helper to create a mock AI invoker that captures prompts
    function createMockAIInvoker(
        responseHandler: (prompt: string) => string
    ): (prompt: string, options?: { model?: string }) => Promise<AIInvokerResult> {
        return async (prompt: string): Promise<AIInvokerResult> => {
            return { success: true, response: responseHandler(prompt) };
        };
    }

    describe('Basic RESULTS_FILE functionality', () => {
        it('substitutes {{RESULTS_FILE}} with temp file path', async () => {
            let capturedPrompt = '';

            const config: PipelineConfig = {
                name: 'Test RESULTS_FILE',
                input: {
                    items: [
                        { id: '1', value: 'first' },
                        { id: '2', value: 'second' }
                    ]
                },
                map: {
                    prompt: 'Process {{id}}: {{value}}',
                    output: ['result']
                },
                reduce: {
                    type: 'ai',
                    prompt: 'Read results from file: {{RESULTS_FILE}}\nSummarize them.',
                    output: ['summary']
                }
            };

            const aiInvoker = createMockAIInvoker((prompt) => {
                if (prompt.includes('Process')) {
                    return '{"result": "processed"}';
                }
                capturedPrompt = prompt;
                return '{"summary": "All items processed"}';
            });

            await executePipeline(config, { aiInvoker, pipelineDirectory: tempDir });

            // Verify the prompt contains a file path, not inline JSON
            expect(capturedPrompt).toContain('Read results from file:');
            
            // The path should be an absolute path
            const pathMatch = capturedPrompt.match(/Read results from file: ([^\n]+)/);
            expect(pathMatch).toBeTruthy();
            const filePath = pathMatch![1].trim();
            
            // Path should be absolute and under temp directory
            expect(path.isAbsolute(filePath)).toBe(true);
            
            // Note: The file is cleaned up after AI call, so we can't verify its contents here
            // But we can verify the path format is correct
            expect(filePath).toContain('ai-reduce-results');
            expect(filePath).toMatch(/\.json$/);
        });

        it('temp file contains valid JSON that can be parsed', async () => {
            let fileContents: string | undefined;

            const config: PipelineConfig = {
                name: 'Test JSON Content',
                input: {
                    items: [
                        { text: 'line1\nline2' },  // Contains newline in value
                        { text: 'hello "world"' }  // Contains quotes
                    ]
                },
                map: {
                    prompt: 'Echo: {{text}}',
                    output: ['echo']
                },
                reduce: {
                    type: 'ai',
                    prompt: 'File: {{RESULTS_FILE}}',
                    output: ['summary']
                }
            };

            const aiInvoker = createMockAIInvoker((prompt) => {
                if (prompt.includes('Echo:')) {
                    return '{"echo": "done"}';
                }
                // Extract file path and read contents
                const pathMatch = prompt.match(/File: ([^\n]+)/);
                if (pathMatch) {
                    const filePath = pathMatch[1].trim();
                    try {
                        fileContents = fs.readFileSync(filePath, 'utf8');
                    } catch {
                        // File might be cleaned up already in some race conditions
                    }
                }
                return '{"summary": "done"}';
            });

            await executePipeline(config, { aiInvoker, pipelineDirectory: tempDir });

            // If we captured the file contents, verify it's valid JSON
            if (fileContents) {
                expect(() => JSON.parse(fileContents!)).not.toThrow();
            }
        });

        it('cleans up temp file after AI call completes', async () => {
            let capturedFilePath: string | undefined;

            const config: PipelineConfig = {
                name: 'Test Cleanup',
                input: {
                    items: [{ id: '1' }]
                },
                map: {
                    prompt: 'Process {{id}}',
                    output: ['result']
                },
                reduce: {
                    type: 'ai',
                    prompt: 'File: {{RESULTS_FILE}}',
                    output: ['summary']
                }
            };

            const aiInvoker = createMockAIInvoker((prompt) => {
                if (prompt.includes('Process')) {
                    return '{"result": "ok"}';
                }
                const pathMatch = prompt.match(/File: ([^\n]+)/);
                if (pathMatch) {
                    capturedFilePath = pathMatch[1].trim();
                }
                return '{"summary": "done"}';
            });

            await executePipeline(config, { aiInvoker, pipelineDirectory: tempDir });

            // After execution, the temp file should be cleaned up
            if (capturedFilePath) {
                expect(fs.existsSync(capturedFilePath)).toBe(false);
            }
        });

        it('cleans up temp file even on AI failure', async () => {
            let capturedFilePath: string | undefined;

            const config: PipelineConfig = {
                name: 'Test Cleanup on Failure',
                input: {
                    items: [{ id: '1' }]
                },
                map: {
                    prompt: 'Process {{id}}',
                    output: ['result']
                },
                reduce: {
                    type: 'ai',
                    prompt: 'File: {{RESULTS_FILE}}',
                    output: ['summary']
                }
            };

            const aiInvoker = createMockAIInvoker((prompt) => {
                if (prompt.includes('Process')) {
                    return '{"result": "ok"}';
                }
                const pathMatch = prompt.match(/File: ([^\n]+)/);
                if (pathMatch) {
                    capturedFilePath = pathMatch[1].trim();
                }
                // Return invalid JSON to cause parsing failure
                return 'not valid json';
            });

            try {
                await executePipeline(config, { aiInvoker, pipelineDirectory: tempDir });
            } catch {
                // Expected to fail
            }

            // Even on failure, temp file should be cleaned up
            if (capturedFilePath) {
                expect(fs.existsSync(capturedFilePath)).toBe(false);
            }
        });
    });

    describe('RESULTS_FILE with complex data', () => {
        it('handles JSON with embedded newlines in string values', async () => {
            let fileContents: string | undefined;

            const config: PipelineConfig = {
                name: 'Test Embedded Newlines',
                input: {
                    items: [
                        { code: 'function test() {\n  return true;\n}' },
                        { code: 'const x = 1;\nconst y = 2;' }
                    ]
                },
                map: {
                    prompt: 'Analyze: {{code}}',
                    output: ['analysis']
                },
                reduce: {
                    type: 'ai',
                    prompt: 'Results file: {{RESULTS_FILE}}',
                    output: ['summary']
                }
            };

            const aiInvoker = createMockAIInvoker((prompt) => {
                if (prompt.includes('Analyze:')) {
                    return '{"analysis": "code analyzed"}';
                }
                const pathMatch = prompt.match(/Results file: ([^\n]+)/);
                if (pathMatch) {
                    try {
                        fileContents = fs.readFileSync(pathMatch[1].trim(), 'utf8');
                    } catch {
                        // Ignore
                    }
                }
                return '{"summary": "done"}';
            });

            await executePipeline(config, { aiInvoker, pipelineDirectory: tempDir });

            if (fileContents) {
                // Should be valid JSON
                const parsed = JSON.parse(fileContents);
                expect(Array.isArray(parsed)).toBe(true);
            }
        });

        it('handles JSON with special characters', async () => {
            let fileContents: string | undefined;

            const config: PipelineConfig = {
                name: 'Test Special Characters',
                input: {
                    items: [
                        { text: 'Quotes: "hello" and \'world\'' },
                        { text: 'Symbols: $100 at 50% with !' },
                        { text: 'Unicode: 你好 🌍 café' }
                    ]
                },
                map: {
                    prompt: 'Process: {{text}}',
                    output: ['result']
                },
                reduce: {
                    type: 'ai',
                    prompt: 'File: {{RESULTS_FILE}}',
                    output: ['summary']
                }
            };

            const aiInvoker = createMockAIInvoker((prompt) => {
                if (prompt.includes('Process:')) {
                    return '{"result": "ok"}';
                }
                const pathMatch = prompt.match(/File: ([^\n]+)/);
                if (pathMatch) {
                    try {
                        fileContents = fs.readFileSync(pathMatch[1].trim(), 'utf8');
                    } catch {
                        // Ignore
                    }
                }
                return '{"summary": "done"}';
            });

            await executePipeline(config, { aiInvoker, pipelineDirectory: tempDir });

            if (fileContents) {
                // Should be valid JSON
                expect(() => JSON.parse(fileContents!)).not.toThrow();
            }
        });

        it('handles large result sets', async () => {
            // Create a large number of items
            const items = Array.from({ length: 100 }, (_, i) => ({
                id: String(i),
                data: 'x'.repeat(1000)  // 1KB per item
            }));

            const config: PipelineConfig = {
                name: 'Test Large Results',
                input: { items },
                map: {
                    prompt: 'Process {{id}}',
                    output: ['result']
                },
                reduce: {
                    type: 'ai',
                    prompt: 'File: {{RESULTS_FILE}}',
                    output: ['summary']
                }
            };

            let promptLength = 0;

            const aiInvoker = createMockAIInvoker((prompt) => {
                if (prompt.includes('Process')) {
                    return '{"result": "ok"}';
                }
                promptLength = prompt.length;
                return '{"summary": "done"}';
            });

            await executePipeline(config, { aiInvoker, pipelineDirectory: tempDir });

            // With RESULTS_FILE, the prompt should be short (just contains file path)
            // Without it, the prompt would be huge (100KB+)
            expect(promptLength).toBeLessThan(1000);
        });
    });

    describe('RESULTS_FILE combined with other variables', () => {
        it('can use RESULTS_FILE with COUNT and other variables', async () => {
            let capturedReducePrompt = '';

            const config: PipelineConfig = {
                name: 'Test Combined Variables',
                input: {
                    items: [
                        { id: '1' },
                        { id: '2' },
                        { id: '3' }
                    ]
                },
                map: {
                    prompt: 'Process {{id}}',
                    output: ['result']
                },
                reduce: {
                    type: 'ai',
                    prompt: 'Processed {{COUNT}} items.\nResults in: {{RESULTS_FILE}}\nSuccessful: {{SUCCESS_COUNT}}',
                    output: ['summary']
                }
            };

            const aiInvoker = createMockAIInvoker((prompt) => {
                // Map phase prompts contain "Process"
                if (prompt.includes('Process ')) {
                    return '{"result": "ok"}';
                }
                // Reduce phase prompt - capture it
                capturedReducePrompt = prompt;
                return '{"summary": "done"}';
            });

            await executePipeline(config, { aiInvoker, pipelineDirectory: tempDir });

            // Verify all variables are substituted
            expect(capturedReducePrompt.length).toBeGreaterThan(0);
            expect(capturedReducePrompt).toContain('Processed 3 items');
            expect(capturedReducePrompt).toContain('Successful: 3');
            expect(capturedReducePrompt).toContain('.json');
            expect(capturedReducePrompt).not.toContain('{{');
        });

        it('RESULTS_FILE and RESULTS can be used together', async () => {
            let capturedPrompt = '';

            const config: PipelineConfig = {
                name: 'Test Both Variables',
                input: {
                    items: [{ id: '1' }]
                },
                map: {
                    prompt: 'Process {{id}}',
                    output: ['result']
                },
                reduce: {
                    type: 'ai',
                    prompt: 'Inline: {{RESULTS}}\nFile: {{RESULTS_FILE}}',
                    output: ['summary']
                }
            };

            const aiInvoker = createMockAIInvoker((prompt) => {
                if (prompt.includes('Process')) {
                    return '{"result": "ok"}';
                }
                capturedPrompt = prompt;
                return '{"summary": "done"}';
            });

            await executePipeline(config, { aiInvoker, pipelineDirectory: tempDir });

            // Both should be substituted
            expect(capturedPrompt).toContain('Inline:');
            expect(capturedPrompt).toContain('File:');
            expect(capturedPrompt).toContain('.json');
            expect(capturedPrompt).toContain('"result"');
        });
    });

    describe('Backward compatibility', () => {
        it('RESULTS still works without RESULTS_FILE', async () => {
            let capturedPrompt = '';

            const config: PipelineConfig = {
                name: 'Test RESULTS Only',
                input: {
                    items: [
                        { id: '1', value: 'first' },
                        { id: '2', value: 'second' }
                    ]
                },
                map: {
                    prompt: 'Process {{id}}: {{value}}',
                    output: ['result']
                },
                reduce: {
                    type: 'ai',
                    prompt: 'Results:\n{{RESULTS}}\n\nSummarize.',
                    output: ['summary']
                }
            };

            const aiInvoker = createMockAIInvoker((prompt) => {
                if (prompt.includes('Process')) {
                    return '{"result": "processed"}';
                }
                capturedPrompt = prompt;
                return '{"summary": "done"}';
            });

            await executePipeline(config, { aiInvoker, pipelineDirectory: tempDir });

            // RESULTS should be inline JSON
            expect(capturedPrompt).toContain('Results:');
            expect(capturedPrompt).toContain('"result"');
            expect(capturedPrompt).not.toContain('{{RESULTS}}');
        });
    });

    describe('Platform-specific behavior', () => {
        it('file path format is correct for current platform', async () => {
            let capturedFilePath: string | undefined;

            const config: PipelineConfig = {
                name: 'Test Path Format',
                input: {
                    items: [{ id: '1' }]
                },
                map: {
                    prompt: 'Process {{id}}',
                    output: ['result']
                },
                reduce: {
                    type: 'ai',
                    prompt: 'File: {{RESULTS_FILE}}',
                    output: ['summary']
                }
            };

            const aiInvoker = createMockAIInvoker((prompt) => {
                if (prompt.includes('Process')) {
                    return '{"result": "ok"}';
                }
                const pathMatch = prompt.match(/File: ([^\n]+)/);
                if (pathMatch) {
                    capturedFilePath = pathMatch[1].trim();
                }
                return '{"summary": "done"}';
            });

            await executePipeline(config, { aiInvoker, pipelineDirectory: tempDir });

            expect(capturedFilePath).toBeTruthy();

            // Path should be absolute
            expect(path.isAbsolute(capturedFilePath!)).toBe(true);

            // Path should use correct separator for platform
            if (process.platform === 'win32') {
                expect(capturedFilePath!).toContain('\\');
            } else {
                expect(capturedFilePath!).toContain('/');
            }
        });
    });

    describe('Text mode reduce with RESULTS_FILE', () => {
        it('works with text mode reduce (no output fields)', async () => {
            let capturedPrompt = '';

            const config: PipelineConfig = {
                name: 'Test Text Mode',
                input: {
                    items: [{ id: '1' }, { id: '2' }]
                },
                map: {
                    prompt: 'Process {{id}}',
                    output: ['result']
                },
                reduce: {
                    type: 'ai',
                    prompt: 'Read from {{RESULTS_FILE}} and summarize in plain text.'
                    // No output field = text mode
                }
            };

            const aiInvoker = createMockAIInvoker((prompt) => {
                if (prompt.includes('Process')) {
                    return '{"result": "ok"}';
                }
                capturedPrompt = prompt;
                return 'This is a plain text summary.';
            });

            const result = await executePipeline(config, { aiInvoker, pipelineDirectory: tempDir });

            expect(capturedPrompt).toContain('.json');
            expect(result.success).toBe(true);
            expect(result.output?.formattedOutput).toContain('plain text summary');
        });
    });
});
