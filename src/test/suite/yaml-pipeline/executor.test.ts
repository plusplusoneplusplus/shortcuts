/**
 * Tests for Pipeline Executor
 *
 * Comprehensive tests for pipeline execution using the map-reduce framework.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    DEFAULT_PARALLEL_LIMIT,
    executePipeline,
    parsePipelineYAML,
    parsePipelineYAMLSync,
    PipelineExecutionError
} from '../../../shortcuts/yaml-pipeline/executor';
import {
    AIInvokerResult,
    JobProgress,
    PipelineConfig
} from '../../../shortcuts/yaml-pipeline/types';

suite('Pipeline Executor', () => {
    let tempDir: string;

    setup(async () => {
        tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'pipeline-test-'));
    });

    teardown(async () => {
        await fs.promises.rm(tempDir, { recursive: true, force: true });
    });

    // Helper to create a mock AI invoker
    function createMockAIInvoker(
        responses: Map<string, string> | ((prompt: string) => AIInvokerResult)
    ): (prompt: string) => Promise<AIInvokerResult> {
        return async (prompt: string): Promise<AIInvokerResult> => {
            if (typeof responses === 'function') {
                return responses(prompt);
            }

            // Look for matching response based on content
            for (const [key, response] of responses) {
                if (prompt.includes(key)) {
                    return { success: true, response };
                }
            }

            return { success: true, response: '{"result": "default"}' };
        };
    }

    // Helper to create test CSV
    async function createTestCSV(filename: string, content: string): Promise<string> {
        const filePath = path.join(tempDir, filename);
        await fs.promises.writeFile(filePath, content);
        return filePath;
    }

    suite('executePipeline', () => {
        test('executes simple pipeline successfully', async () => {
            await createTestCSV('data.csv', 'id,title\n1,Bug A\n2,Bug B');

            const config: PipelineConfig = {
                name: 'Test Pipeline',
                input: { type: 'csv', path: './data.csv' },
                map: {
                    prompt: 'Analyze: {{title}}',
                    output: ['severity']
                },
                reduce: { type: 'list' }
            };

            const responses = new Map([
                ['Bug A', '{"severity": "high"}'],
                ['Bug B', '{"severity": "low"}']
            ]);

            const result = await executePipeline(config, {
                aiInvoker: createMockAIInvoker(responses),
                pipelineDirectory: tempDir
            });

            assert.strictEqual(result.success, true);
            assert.ok(result.output);
            assert.strictEqual(result.output.results.length, 2);

            assert.strictEqual(result.output.results[0].success, true);
            assert.strictEqual(result.output.results[0].output.severity, 'high');

            assert.strictEqual(result.output.results[1].success, true);
            assert.strictEqual(result.output.results[1].output.severity, 'low');
        });

        test('handles empty CSV', async () => {
            await createTestCSV('empty.csv', 'id,title');

            const config: PipelineConfig = {
                name: 'Empty Test',
                input: { type: 'csv', path: './empty.csv' },
                map: { prompt: '{{title}}', output: ['result'] },
                reduce: { type: 'list' }
            };

            const result = await executePipeline(config, {
                aiInvoker: createMockAIInvoker(new Map()),
                pipelineDirectory: tempDir
            });

            assert.strictEqual(result.success, true);
            assert.strictEqual(result.executionStats.totalItems, 0);
        });

        test('handles AI failures gracefully', async () => {
            await createTestCSV('data.csv', 'id,title\n1,Good\n2,Bad');

            const config: PipelineConfig = {
                name: 'Failure Test',
                input: { type: 'csv', path: './data.csv' },
                map: { prompt: '{{title}}', output: ['result'] },
                reduce: { type: 'list' }
            };

            const aiInvoker = async (prompt: string): Promise<AIInvokerResult> => {
                if (prompt.includes('Bad')) {
                    return { success: false, error: 'AI service unavailable' };
                }
                return { success: true, response: '{"result": "ok"}' };
            };

            const result = await executePipeline(config, {
                aiInvoker,
                pipelineDirectory: tempDir
            });

            // The executor considers the job successful if all map operations completed
            // (even if some returned failure results). Individual failures are tracked
            // in the output results.
            assert.strictEqual(result.success, true);
            assert.strictEqual(result.executionStats.successfulMaps, 2); // Both maps completed
            assert.strictEqual(result.executionStats.failedMaps, 0); // No map operations threw

            assert.ok(result.output);
            assert.strictEqual(result.output.results[0].success, true);
            assert.strictEqual(result.output.results[1].success, false); // AI failure tracked in result
            assert.ok(result.output.results[1].error?.includes('AI service unavailable'));
        });

        test('handles JSON parse failures', async () => {
            await createTestCSV('data.csv', 'id,title\n1,Test');

            const config: PipelineConfig = {
                name: 'Parse Failure Test',
                input: { type: 'csv', path: './data.csv' },
                map: { prompt: '{{title}}', output: ['result'] },
                reduce: { type: 'list' }
            };

            const aiInvoker = async (): Promise<AIInvokerResult> => {
                return { success: true, response: 'This is not JSON at all!' };
            };

            const result = await executePipeline(config, {
                aiInvoker,
                pipelineDirectory: tempDir
            });

            // The executor considers the job successful if all map operations completed
            // Parse failures are tracked in individual results, not as map failures
            assert.strictEqual(result.success, true);
            assert.ok(result.output);
            assert.strictEqual(result.output.results[0].success, false);
            assert.ok(result.output.results[0].error?.includes('parse'));
        });

        test('respects parallel limit', async () => {
            // Create CSV with many rows
            const rows = Array.from({ length: 10 }, (_, i) => `${i},Item${i}`).join('\n');
            await createTestCSV('data.csv', `id,title\n${rows}`);

            const config: PipelineConfig = {
                name: 'Parallel Test',
                input: { type: 'csv', path: './data.csv' },
                map: {
                    prompt: '{{title}}',
                    output: ['result'],
                    parallel: 2 // Limit to 2 concurrent
                },
                reduce: { type: 'list' }
            };

            let maxConcurrent = 0;
            let currentConcurrent = 0;

            const aiInvoker = async (): Promise<AIInvokerResult> => {
                currentConcurrent++;
                maxConcurrent = Math.max(maxConcurrent, currentConcurrent);

                // Simulate some work
                await new Promise(resolve => setTimeout(resolve, 10));

                currentConcurrent--;
                return { success: true, response: '{"result": "ok"}' };
            };

            await executePipeline(config, {
                aiInvoker,
                pipelineDirectory: tempDir
            });

            assert.ok(maxConcurrent <= 2, `Max concurrent was ${maxConcurrent}, expected <= 2`);
        });

        test('reports progress during execution', async () => {
            await createTestCSV('data.csv', 'id,title\n1,A\n2,B\n3,C');

            const config: PipelineConfig = {
                name: 'Progress Test',
                input: { type: 'csv', path: './data.csv' },
                map: { prompt: '{{title}}', output: ['result'] },
                reduce: { type: 'list' }
            };

            const progressUpdates: JobProgress[] = [];

            await executePipeline(config, {
                aiInvoker: createMockAIInvoker(new Map()),
                pipelineDirectory: tempDir,
                onProgress: (progress) => progressUpdates.push({ ...progress })
            });

            // Verify progress updates were received
            assert.ok(progressUpdates.length > 0, 'Should have progress updates');

            // Verify final progress
            const finalProgress = progressUpdates[progressUpdates.length - 1];
            assert.strictEqual(finalProgress.percentage, 100);
        });

        test('handles multiple output fields', async () => {
            await createTestCSV('data.csv', 'id,title,description\n1,Bug,Something broke');

            const config: PipelineConfig = {
                name: 'Multi-output Test',
                input: { type: 'csv', path: './data.csv' },
                map: {
                    prompt: 'Title: {{title}}\nDescription: {{description}}',
                    output: ['severity', 'category', 'effort_hours', 'needs_more_info']
                },
                reduce: { type: 'list' }
            };

            const aiInvoker = async (): Promise<AIInvokerResult> => ({
                success: true,
                response: '{"severity": "high", "category": "backend", "effort_hours": 4, "needs_more_info": false}'
            });

            const result = await executePipeline(config, {
                aiInvoker,
                pipelineDirectory: tempDir
            });

            assert.strictEqual(result.success, true);
            assert.ok(result.output);
            assert.deepStrictEqual(result.output.results[0].output, {
                severity: 'high',
                category: 'backend',
                effort_hours: 4,
                needs_more_info: false
            });
        });

        test('uses custom delimiter', async () => {
            await createTestCSV('data.csv', 'id;title;value\n1;Test;100');

            const config: PipelineConfig = {
                name: 'Delimiter Test',
                input: { type: 'csv', path: './data.csv', delimiter: ';' },
                map: { prompt: '{{title}} {{value}}', output: ['result'] },
                reduce: { type: 'list' }
            };

            const result = await executePipeline(config, {
                aiInvoker: createMockAIInvoker(new Map([['Test 100', '{"result": "ok"}']])),
                pipelineDirectory: tempDir
            });

            assert.strictEqual(result.success, true);
            assert.ok(result.output);
            assert.strictEqual(result.output.results[0].item.title, 'Test');
            assert.strictEqual(result.output.results[0].item.value, '100');
        });

        test('records execution statistics', async () => {
            await createTestCSV('data.csv', 'id,title\n1,A\n2,B\n3,C');

            const config: PipelineConfig = {
                name: 'Stats Test',
                input: { type: 'csv', path: './data.csv' },
                map: { prompt: '{{title}}', output: ['result'] },
                reduce: { type: 'list' }
            };

            const result = await executePipeline(config, {
                aiInvoker: createMockAIInvoker(new Map()),
                pipelineDirectory: tempDir
            });

            assert.strictEqual(result.executionStats.totalItems, 3);
            assert.strictEqual(result.executionStats.successfulMaps, 3);
            assert.strictEqual(result.executionStats.failedMaps, 0);
            assert.ok(result.totalTimeMs >= 0);
            assert.ok(result.executionStats.mapPhaseTimeMs >= 0);
            assert.ok(result.executionStats.reducePhaseTimeMs >= 0);
        });

        test('resolves CSV path relative to pipeline directory', async () => {
            // Create a subdirectory structure mimicking a pipeline package
            const packageDir = path.join(tempDir, 'my-pipeline');
            await fs.promises.mkdir(packageDir, { recursive: true });

            // Create CSV in the package directory
            const csvContent = 'id,title\n1,PackageItem';
            await fs.promises.writeFile(path.join(packageDir, 'input.csv'), csvContent);

            const config: PipelineConfig = {
                name: 'Package Path Test',
                input: { type: 'csv', path: 'input.csv' }, // Relative to package
                map: { prompt: '{{title}}', output: ['result'] },
                reduce: { type: 'list' }
            };

            const result = await executePipeline(config, {
                aiInvoker: createMockAIInvoker(new Map([['PackageItem', '{"result": "ok"}']])),
                pipelineDirectory: packageDir // Pass package directory, not workspace root
            });

            assert.strictEqual(result.success, true);
            assert.ok(result.output);
            assert.strictEqual(result.output.results.length, 1);
            assert.strictEqual(result.output.results[0].item.title, 'PackageItem');
        });

        test('resolves nested CSV path relative to pipeline directory', async () => {
            // Create package with nested data directory
            const packageDir = path.join(tempDir, 'nested-package');
            const dataDir = path.join(packageDir, 'data');
            await fs.promises.mkdir(dataDir, { recursive: true });

            // Create CSV in nested directory
            const csvContent = 'id,title\n1,NestedItem';
            await fs.promises.writeFile(path.join(dataDir, 'input.csv'), csvContent);

            const config: PipelineConfig = {
                name: 'Nested Path Test',
                input: { type: 'csv', path: 'data/input.csv' }, // Nested relative path
                map: { prompt: '{{title}}', output: ['result'] },
                reduce: { type: 'list' }
            };

            const result = await executePipeline(config, {
                aiInvoker: createMockAIInvoker(new Map([['NestedItem', '{"result": "ok"}']])),
                pipelineDirectory: packageDir
            });

            assert.strictEqual(result.success, true);
            assert.ok(result.output);
            assert.strictEqual(result.output.results[0].item.title, 'NestedItem');
        });

        test('resolves shared CSV path via parent directory reference', async () => {
            // Create shared directory alongside package
            const pipelinesDir = path.join(tempDir, 'pipelines');
            const sharedDir = path.join(pipelinesDir, 'shared');
            const packageDir = path.join(pipelinesDir, 'my-package');
            await fs.promises.mkdir(sharedDir, { recursive: true });
            await fs.promises.mkdir(packageDir, { recursive: true });

            // Create CSV in shared directory
            const csvContent = 'id,title\n1,SharedItem';
            await fs.promises.writeFile(path.join(sharedDir, 'common.csv'), csvContent);

            const config: PipelineConfig = {
                name: 'Shared Path Test',
                input: { type: 'csv', path: '../shared/common.csv' }, // Parent directory reference
                map: { prompt: '{{title}}', output: ['result'] },
                reduce: { type: 'list' }
            };

            const result = await executePipeline(config, {
                aiInvoker: createMockAIInvoker(new Map([['SharedItem', '{"result": "ok"}']])),
                pipelineDirectory: packageDir
            });

            assert.strictEqual(result.success, true);
            assert.ok(result.output);
            assert.strictEqual(result.output.results[0].item.title, 'SharedItem');
        });
    });

    suite('validation errors', () => {
        test('throws for missing name', async () => {
            const config = {
                input: { type: 'csv', path: './data.csv' },
                map: { prompt: '{{x}}', output: ['y'] },
                reduce: { type: 'list' }
            } as unknown as PipelineConfig;

            await assert.rejects(
                async () => executePipeline(config, {
                    aiInvoker: createMockAIInvoker(new Map()),
                    pipelineDirectory: tempDir
                }),
                PipelineExecutionError
            );
        });

        test('throws for unsupported input type', async () => {
            const config = {
                name: 'Test',
                input: { type: 'json', path: './data.json' },
                map: { prompt: '{{x}}', output: ['y'] },
                reduce: { type: 'list' }
            } as unknown as PipelineConfig;

            await assert.rejects(
                async () => executePipeline(config, {
                    aiInvoker: createMockAIInvoker(new Map()),
                    pipelineDirectory: tempDir
                }),
                /Unsupported input type/
            );
        });

        test('throws for missing input path', async () => {
            const config = {
                name: 'Test',
                input: { type: 'csv' },
                map: { prompt: '{{x}}', output: ['y'] },
                reduce: { type: 'list' }
            } as unknown as PipelineConfig;

            await assert.rejects(
                async () => executePipeline(config, {
                    aiInvoker: createMockAIInvoker(new Map()),
                    pipelineDirectory: tempDir
                }),
                /missing.*path/i
            );
        });

        test('throws for empty output fields', async () => {
            const config: PipelineConfig = {
                name: 'Test',
                input: { type: 'csv', path: './data.csv' },
                map: { prompt: '{{x}}', output: [] },
                reduce: { type: 'list' }
            };

            await assert.rejects(
                async () => executePipeline(config, {
                    aiInvoker: createMockAIInvoker(new Map()),
                    pipelineDirectory: tempDir
                }),
                /non-empty array/
            );
        });

        test('throws for unsupported reduce type', async () => {
            const config = {
                name: 'Test',
                input: { type: 'csv', path: './data.csv' },
                map: { prompt: '{{x}}', output: ['y'] },
                reduce: { type: 'invalid' }
            } as unknown as PipelineConfig;

            await assert.rejects(
                async () => executePipeline(config, {
                    aiInvoker: createMockAIInvoker(new Map()),
                    pipelineDirectory: tempDir
                }),
                /Unsupported reduce type/
            );
        });

        test('throws for missing CSV columns', async () => {
            await createTestCSV('data.csv', 'id,name\n1,Test');

            const config: PipelineConfig = {
                name: 'Test',
                input: { type: 'csv', path: './data.csv' },
                map: { prompt: '{{title}} {{description}}', output: ['result'] },
                reduce: { type: 'list' }
            };

            await assert.rejects(
                async () => executePipeline(config, {
                    aiInvoker: createMockAIInvoker(new Map()),
                    pipelineDirectory: tempDir
                }),
                /missing required columns.*title.*description/i
            );
        });

        test('throws for missing CSV file', async () => {
            const config: PipelineConfig = {
                name: 'Test',
                input: { type: 'csv', path: './nonexistent.csv' },
                map: { prompt: '{{x}}', output: ['y'] },
                reduce: { type: 'list' }
            };

            await assert.rejects(
                async () => executePipeline(config, {
                    aiInvoker: createMockAIInvoker(new Map()),
                    pipelineDirectory: tempDir
                }),
                PipelineExecutionError
            );
        });
    });

    suite('parsePipelineYAML', () => {
        test('parses valid YAML config', async () => {
            const yaml = `
name: "Bug Triage"
input:
  type: csv
  path: "./bugs.csv"
map:
  prompt: |
    Analyze: {{title}}
  output: [severity, category]
reduce:
  type: list
`;

            const config = await parsePipelineYAML(yaml);

            assert.strictEqual(config.name, 'Bug Triage');
            assert.strictEqual(config.input.type, 'csv');
            assert.strictEqual(config.input.path, './bugs.csv');
            assert.ok(config.map.prompt.includes('Analyze: {{title}}'));
            assert.deepStrictEqual(config.map.output, ['severity', 'category']);
            assert.strictEqual(config.reduce.type, 'list');
        });

        test('parses YAML with optional fields', async () => {
            const yaml = `
name: "Test"
input:
  type: csv
  path: "./data.csv"
  delimiter: ";"
map:
  prompt: "{{x}}"
  output: [y]
  parallel: 3
reduce:
  type: list
`;

            const config = await parsePipelineYAML(yaml);

            assert.strictEqual(config.input.delimiter, ';');
            assert.strictEqual(config.map.parallel, 3);
        });

        test('throws on invalid YAML config', async () => {
            const yaml = `
name: "Test"
input:
  type: invalid
`;

            await assert.rejects(
                async () => parsePipelineYAML(yaml),
                PipelineExecutionError
            );
        });
    });

    suite('parsePipelineYAMLSync', () => {
        test('parses valid YAML config synchronously', () => {
            const yaml = `
name: "Sync Test"
input:
  type: csv
  path: "./data.csv"
map:
  prompt: "{{title}}"
  output: [result]
reduce:
  type: list
`;

            const config = parsePipelineYAMLSync(yaml);

            assert.strictEqual(config.name, 'Sync Test');
            assert.strictEqual(config.input.type, 'csv');
        });
    });

    suite('DEFAULT_PARALLEL_LIMIT', () => {
        test('has reasonable default value', () => {
            assert.strictEqual(DEFAULT_PARALLEL_LIMIT, 5);
        });
    });

    suite('real-world scenario from design doc', () => {
        test('executes bug triage pipeline', async () => {
            const csvContent = `id,title,description,priority
1,Login broken,Users can't login,high
2,Slow search,Search takes 10s,medium
3,UI glitch,"Button misaligned",low`;

            await createTestCSV('bugs.csv', csvContent);

            const config: PipelineConfig = {
                name: 'Bug Triage',
                input: { type: 'csv', path: './bugs.csv' },
                map: {
                    prompt: `Analyze this bug:

Title: {{title}}
Description: {{description}}
Reporter Priority: {{priority}}

Classify the severity (critical/high/medium/low), 
category (ui/backend/database/infra),
estimate effort in hours,
and note if more info is needed.`,
                    output: ['severity', 'category', 'effort_hours', 'needs_more_info'],
                    parallel: 3
                },
                reduce: { type: 'list' }
            };

            const responses = new Map([
                ['Login broken', '{"severity": "critical", "category": "backend", "effort_hours": 4, "needs_more_info": false}'],
                ['Slow search', '{"severity": "medium", "category": "database", "effort_hours": 8, "needs_more_info": false}'],
                ['UI glitch', '{"severity": "low", "category": "ui", "effort_hours": 2, "needs_more_info": true}']
            ]);

            const result = await executePipeline(config, {
                aiInvoker: createMockAIInvoker(responses),
                pipelineDirectory: tempDir
            });

            assert.strictEqual(result.success, true);
            assert.ok(result.output);
            assert.strictEqual(result.output.results.length, 3);

            // Verify first bug
            const loginBug = result.output.results.find((r) => r.item['title'] === 'Login broken');
            assert.ok(loginBug);
            assert.strictEqual(loginBug.output.severity, 'critical');
            assert.strictEqual(loginBug.output.category, 'backend');
            assert.strictEqual(loginBug.output.effort_hours, 4);
            assert.strictEqual(loginBug.output.needs_more_info, false);

            // Verify formatted output
            assert.ok(result.output.formattedOutput.includes('## Results (3 items)'));
            assert.ok(result.output.formattedOutput.includes('Login broken'));
            assert.ok(result.output.formattedOutput.includes('critical'));
        });
    });
});
