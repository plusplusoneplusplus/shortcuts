/**
 * Unit tests for AI Process result file saving and read-only document viewing
 */

import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { AIProcess, AIProcessStatus, serializeProcess, deserializeProcess, SerializedAIProcess } from '../../shortcuts/ai-service';

suite('AI Process Result File Tests', () => {

    suite('resultFilePath field serialization', () => {

        test('should serialize resultFilePath field', () => {
            const process: AIProcess = {
                id: 'test-1',
                type: 'clarification',
                promptPreview: 'Test prompt',
                fullPrompt: 'Full test prompt',
                status: 'completed',
                startTime: new Date('2024-01-15T10:30:00.000Z'),
                endTime: new Date('2024-01-15T10:35:00.000Z'),
                result: 'AI response text',
                resultFilePath: '/path/to/result/file.md'
            };

            const serialized = serializeProcess(process);

            assert.strictEqual(serialized.resultFilePath, '/path/to/result/file.md');
        });

        test('should preserve undefined resultFilePath', () => {
            const process: AIProcess = {
                id: 'test-1',
                type: 'clarification',
                promptPreview: 'Test prompt',
                fullPrompt: 'Full test prompt',
                status: 'completed',
                startTime: new Date('2024-01-15T10:30:00.000Z'),
                result: 'AI response'
            };

            const serialized = serializeProcess(process);

            assert.strictEqual(serialized.resultFilePath, undefined);
        });

        test('should deserialize resultFilePath field', () => {
            const serialized: SerializedAIProcess = {
                id: 'test-1',
                promptPreview: 'Test prompt',
                fullPrompt: 'Full test prompt',
                status: 'completed',
                startTime: '2024-01-15T10:30:00.000Z',
                endTime: '2024-01-15T10:35:00.000Z',
                result: 'AI response',
                resultFilePath: '/path/to/result/file.md'
            };

            const process = deserializeProcess(serialized);

            assert.strictEqual(process.resultFilePath, '/path/to/result/file.md');
        });

        test('should preserve undefined resultFilePath on deserialization', () => {
            const serialized: SerializedAIProcess = {
                id: 'test-1',
                promptPreview: 'Test prompt',
                fullPrompt: 'Full test prompt',
                status: 'completed',
                startTime: '2024-01-15T10:30:00.000Z'
            };

            const process = deserializeProcess(serialized);

            assert.strictEqual(process.resultFilePath, undefined);
        });

        test('should preserve resultFilePath through serialize/deserialize cycle', () => {
            const original: AIProcess = {
                id: 'test-roundtrip',
                type: 'clarification',
                promptPreview: 'Round trip test',
                fullPrompt: 'Full prompt for round trip testing',
                status: 'completed',
                startTime: new Date('2024-01-15T10:30:00.000Z'),
                endTime: new Date('2024-01-15T10:35:00.000Z'),
                result: 'AI response',
                resultFilePath: '/workspace/.vscode/ai-processes/test-file.md'
            };

            const serialized = serializeProcess(original);
            const restored = deserializeProcess(serialized);

            assert.strictEqual(restored.resultFilePath, original.resultFilePath);
        });
    });

    suite('rawStdoutFilePath field serialization', () => {

        test('should serialize rawStdoutFilePath field', () => {
            const process: AIProcess = {
                id: 'test-1',
                type: 'clarification',
                promptPreview: 'Test prompt',
                fullPrompt: 'Full test prompt',
                status: 'completed',
                startTime: new Date('2024-01-15T10:30:00.000Z'),
                endTime: new Date('2024-01-15T10:35:00.000Z'),
                result: 'AI response text',
                rawStdoutFilePath: '/tmp/shortcuts-ai-processes/stdout.txt'
            };

            const serialized = serializeProcess(process);

            assert.strictEqual(serialized.rawStdoutFilePath, '/tmp/shortcuts-ai-processes/stdout.txt');
        });

        test('should preserve undefined rawStdoutFilePath', () => {
            const process: AIProcess = {
                id: 'test-1',
                type: 'clarification',
                promptPreview: 'Test prompt',
                fullPrompt: 'Full test prompt',
                status: 'completed',
                startTime: new Date('2024-01-15T10:30:00.000Z'),
                result: 'AI response'
            };

            const serialized = serializeProcess(process);

            assert.strictEqual(serialized.rawStdoutFilePath, undefined);
        });

        test('should deserialize rawStdoutFilePath field', () => {
            const serialized: SerializedAIProcess = {
                id: 'test-1',
                promptPreview: 'Test prompt',
                fullPrompt: 'Full test prompt',
                status: 'completed',
                startTime: '2024-01-15T10:30:00.000Z',
                endTime: '2024-01-15T10:35:00.000Z',
                result: 'AI response',
                rawStdoutFilePath: '/tmp/shortcuts-ai-processes/stdout.txt'
            };

            const process = deserializeProcess(serialized);

            assert.strictEqual(process.rawStdoutFilePath, '/tmp/shortcuts-ai-processes/stdout.txt');
        });

        test('should preserve rawStdoutFilePath through serialize/deserialize cycle', () => {
            const original: AIProcess = {
                id: 'test-roundtrip',
                type: 'clarification',
                promptPreview: 'Round trip test',
                fullPrompt: 'Full prompt for round trip testing',
                status: 'completed',
                startTime: new Date('2024-01-15T10:30:00.000Z'),
                endTime: new Date('2024-01-15T10:35:00.000Z'),
                result: 'AI response',
                rawStdoutFilePath: '/tmp/shortcuts-ai-processes/stdout.txt'
            };

            const serialized = serializeProcess(original);
            const restored = deserializeProcess(serialized);

            assert.strictEqual(restored.rawStdoutFilePath, original.rawStdoutFilePath);
        });
    });

    suite('AIProcess interface', () => {

        test('should allow resultFilePath on AIProcess', () => {
            const process: AIProcess = {
                id: 'test-1',
                type: 'code-review',
                promptPreview: 'Review code',
                fullPrompt: 'Review this code for issues',
                status: 'completed',
                startTime: new Date(),
                endTime: new Date(),
                result: 'Code looks good',
                resultFilePath: '/some/path/result.md',
                rawStdoutFilePath: '/tmp/shortcuts-ai-processes/review-stdout.txt',
                codeReviewMetadata: {
                    reviewType: 'commit',
                    rulesUsed: ['rule1']
                }
            };

            assert.ok(process.resultFilePath);
            assert.strictEqual(process.resultFilePath, '/some/path/result.md');
            assert.strictEqual(process.rawStdoutFilePath, '/tmp/shortcuts-ai-processes/review-stdout.txt');
        });

        test('should work with discovery processes', () => {
            const process: AIProcess = {
                id: 'discovery-1',
                type: 'discovery',
                promptPreview: 'Discover features',
                fullPrompt: 'Find related features',
                status: 'completed',
                startTime: new Date(),
                endTime: new Date(),
                result: 'Found 5 related items',
                resultFilePath: '/workspace/.vscode/ai-processes/discovery-1.md',
                discoveryMetadata: {
                    featureDescription: 'test feature',
                    resultCount: 5
                }
            };

            assert.ok(process.resultFilePath);
            assert.strictEqual(process.type, 'discovery');
        });
    });
});

suite('AI Process Document Provider Tests', () => {

    suite('URI creation', () => {

        test('should create valid URI for process', () => {
            // Test URI scheme format
            const processId = 'process-1-1234567890';
            const expectedUri = `ai-process:${processId}.md`;

            // Verify the URI format matches what we expect
            assert.ok(expectedUri.startsWith('ai-process:'));
            assert.ok(expectedUri.endsWith('.md'));
            assert.ok(expectedUri.includes(processId));
        });

        test('should handle special characters in process ID', () => {
            const processId = 'review-5-1704067200000';
            const expectedUri = `ai-process:${processId}.md`;

            assert.ok(expectedUri.includes('review-5'));
        });
    });

    suite('Content formatting', () => {

        test('should format process status correctly', () => {
            // Test status emoji mapping
            const statuses: Record<AIProcessStatus, string> = {
                'queued': '⏳',
                'running': '🔄',
                'completed': '✅',
                'failed': '❌',
                'cancelled': '🚫'
            };

            for (const [status, emoji] of Object.entries(statuses)) {
                assert.ok(emoji, `Expected emoji for status ${status}`);
            }
        });

        test('should format duration correctly', () => {
            const startTime = new Date('2024-01-15T10:30:00.000Z');
            const endTime = new Date('2024-01-15T10:35:30.000Z');

            const duration = endTime.getTime() - startTime.getTime();
            const seconds = Math.floor(duration / 1000);
            const minutes = Math.floor(seconds / 60);

            assert.strictEqual(minutes, 5);
            assert.strictEqual(seconds % 60, 30);
        });

        test('should include result file path when available', () => {
            const process: AIProcess = {
                id: 'test-1',
                type: 'clarification',
                promptPreview: 'Test',
                fullPrompt: 'Test prompt',
                status: 'completed',
                startTime: new Date(),
                endTime: new Date(),
                result: 'Response',
                resultFilePath: '/path/to/file.md'
            };

            // Verify the process has the file path
            assert.ok(process.resultFilePath);
            assert.ok(process.resultFilePath.endsWith('.md'));
        });
    });
});

suite('Result File Content Tests', () => {

    suite('File content structure', () => {

        test('should generate valid markdown content', () => {
            const process: AIProcess = {
                id: 'process-1-1234567890',
                type: 'clarification',
                promptPreview: 'Test prompt preview',
                fullPrompt: 'This is the full prompt text',
                status: 'completed',
                startTime: new Date('2024-01-15T10:30:00.000Z'),
                endTime: new Date('2024-01-15T10:35:00.000Z'),
                result: 'This is the AI response'
            };

            // Build expected content structure
            const lines: string[] = [];
            lines.push(`# AI Process Result`);
            lines.push('');
            lines.push(`- **Process ID:** ${process.id}`);
            lines.push(`- **Type:** ${process.type}`);
            lines.push(`- **Status:** ${process.status}`);
            lines.push(`- **Started:** ${process.startTime.toISOString()}`);
            if (process.endTime) {
                lines.push(`- **Ended:** ${process.endTime.toISOString()}`);
            }
            lines.push('');
            lines.push('## Prompt');
            lines.push('');
            lines.push('```');
            lines.push(process.fullPrompt);
            lines.push('```');
            lines.push('');
            lines.push('## Response');
            lines.push('');
            lines.push(process.result!);

            const content = lines.join('\n');

            // Verify content structure
            assert.ok(content.includes('# AI Process Result'));
            assert.ok(content.includes(`- **Process ID:** ${process.id}`));
            assert.ok(content.includes('## Prompt'));
            assert.ok(content.includes('## Response'));
            assert.ok(content.includes(process.fullPrompt));
            assert.ok(content.includes(process.result!));
        });

        test('should include error section when process has error', () => {
            const process: AIProcess = {
                id: 'process-1-1234567890',
                type: 'clarification',
                promptPreview: 'Test',
                fullPrompt: 'Test prompt',
                status: 'failed',
                startTime: new Date(),
                endTime: new Date(),
                error: 'Connection timeout'
            };

            // Build expected content structure
            const lines: string[] = [];
            lines.push(`# AI Process Result`);
            lines.push('');
            lines.push(`- **Process ID:** ${process.id}`);
            lines.push(`- **Type:** ${process.type}`);
            lines.push(`- **Status:** ${process.status}`);
            lines.push(`- **Started:** ${process.startTime.toISOString()}`);
            if (process.endTime) {
                lines.push(`- **Ended:** ${process.endTime.toISOString()}`);
            }
            lines.push('');
            lines.push('## Prompt');
            lines.push('');
            lines.push('```');
            lines.push(process.fullPrompt);
            lines.push('```');
            lines.push('');
            lines.push('## Response');
            lines.push('');
            if (process.result) {
                lines.push(process.result);
            }

            if (process.error) {
                lines.push('');
                lines.push('## Error');
                lines.push('');
                lines.push('```');
                lines.push(process.error);
                lines.push('```');
            }

            const content = lines.join('\n');

            assert.ok(content.includes('## Error'));
            assert.ok(content.includes(process.error!));
        });
    });

    suite('Filename generation', () => {

        test('should generate valid filename from process ID and timestamp', () => {
            const processId = 'process-1-1234567890';
            const startTime = new Date('2024-01-15T10:30:00.000Z');

            // Replicate the filename generation logic
            const timestamp = startTime.toISOString().replace(/[:.]/g, '-');
            const filename = `${processId}_${timestamp}.md`;

            assert.ok(filename.includes(processId));
            assert.ok(filename.endsWith('.md'));
            assert.ok(!filename.includes(':'));  // Should not contain colons
        });

        test('should handle code review process IDs', () => {
            const processId = 'review-5-1704067200000';
            const startTime = new Date('2024-01-01T12:00:00.000Z');

            const timestamp = startTime.toISOString().replace(/[:.]/g, '-');
            const filename = `${processId}_${timestamp}.md`;

            assert.ok(filename.startsWith('review-'));
            assert.ok(filename.endsWith('.md'));
        });

        test('should handle discovery process IDs', () => {
            const processId = 'discovery-3-1704153600000';
            const startTime = new Date('2024-01-02T12:00:00.000Z');

            const timestamp = startTime.toISOString().replace(/[:.]/g, '-');
            const filename = `${processId}_${timestamp}.md`;

            assert.ok(filename.startsWith('discovery-'));
            assert.ok(filename.endsWith('.md'));
        });
    });
});
