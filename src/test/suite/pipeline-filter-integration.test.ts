/**
 * Integration Tests for Pipeline with Filters
 *
 * Tests the complete pipeline execution with filter phases.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import {
    executePipeline,
    PipelineExecutionError
} from '../../shortcuts/yaml-pipeline/executor';
import {
    PipelineConfig,
    AIInvoker,
    PromptItem
} from '../../shortcuts/yaml-pipeline/types';

suite('Pipeline Filter Integration Tests', () => {
    let tempDir: string;

    setup(() => {
        // Create temp directory for test files
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pipeline-filter-test-'));
    });

    teardown(() => {
        // Clean up temp directory
        if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    // Mock AI invoker for testing
    const createMockAIInvoker = (mapResponse: string, filterResponse?: (id: string) => boolean): AIInvoker => {
        return async (prompt) => {
            // Handle filter prompts (contains "Should include")
            if (filterResponse && prompt.includes('Should include')) {
                const match = prompt.match(/id[:\s]+(\d+)/i);
                if (match) {
                    const id = match[1];
                    const include = filterResponse(id);
                    return {
                        success: true,
                        response: JSON.stringify({ include, reason: 'Test' })
                    };
                }
            }
            
            // Handle map prompts
            return {
                success: true,
                response: mapResponse
            };
        };
    };

    suite('Rule Filter Integration', () => {
        test('filters items before map phase', async () => {
            const csvPath = path.join(tempDir, 'input.csv');
            fs.writeFileSync(csvPath, 'id,severity,status\n1,critical,open\n2,low,closed\n3,high,open');

            const config: PipelineConfig = {
                name: 'Test Filter Pipeline',
                input: {
                    from: { type: 'csv', path: csvPath }
                },
                filter: {
                    type: 'rule',
                    rule: {
                        rules: [
                            { field: 'status', operator: 'equals', value: 'open' }
                        ]
                    }
                },
                map: {
                    prompt: 'Analyze {{severity}}',
                    output: ['analysis']
                },
                reduce: {
                    type: 'list'
                }
            };

            const aiInvoker = createMockAIInvoker('{"analysis":"test"}');
            
            const result = await executePipeline(config, {
                aiInvoker,
                pipelineDirectory: tempDir
            });

            assert.ok(result.filterResult, 'Filter result should be present');
            assert.strictEqual(result.filterResult.stats.totalItems, 3);
            assert.strictEqual(result.filterResult.stats.includedCount, 2);
            assert.strictEqual(result.filterResult.stats.excludedCount, 1);
            
            // Map phase should only process 2 items
            assert.strictEqual(result.mapResults.filter(r => r.success).length, 2);
        });

        test('multiple filter rules with AND mode', async () => {
            const csvPath = path.join(tempDir, 'bugs.csv');
            fs.writeFileSync(csvPath, 
                'id,severity,status,priority\n' +
                '1,critical,open,8\n' +
                '2,high,open,3\n' +
                '3,critical,closed,9\n' +
                '4,high,open,7'
            );

            const config: PipelineConfig = {
                name: 'Critical Open Bugs',
                input: {
                    from: { type: 'csv', path: csvPath }
                },
                filter: {
                    type: 'rule',
                    rule: {
                        rules: [
                            { field: 'severity', operator: 'equals', value: 'critical' },
                            { field: 'status', operator: 'equals', value: 'open' },
                            { field: 'priority', operator: 'gte', value: 5 }
                        ],
                        mode: 'all'
                    }
                },
                map: {
                    prompt: 'Process {{id}}',
                    output: ['result']
                },
                reduce: {
                    type: 'list'
                }
            };

            const aiInvoker = createMockAIInvoker('{"result":"processed"}');
            
            const result = await executePipeline(config, {
                aiInvoker,
                pipelineDirectory: tempDir
            });

            assert.ok(result.filterResult);
            assert.strictEqual(result.filterResult.stats.includedCount, 1);
            
            const included = result.filterResult.included[0];
            assert.strictEqual(included.id, 1);
        });

        test('filter with OR mode', async () => {
            const config: PipelineConfig = {
                name: 'Priority Filter',
                input: {
                    items: [
                        { id: '1', category: 'bug' },
                        { id: '2', category: 'feature' },
                        { id: '3', category: 'security' }
                    ]
                },
                filter: {
                    type: 'rule',
                    rule: {
                        rules: [
                            { field: 'category', operator: 'equals', value: 'bug' },
                            { field: 'category', operator: 'equals', value: 'security' }
                        ],
                        mode: 'any'
                    }
                },
                map: {
                    prompt: 'Process {{category}}',
                    output: ['result']
                },
                reduce: {
                    type: 'list'
                }
            };

            const aiInvoker = createMockAIInvoker('{"result":"ok"}');
            
            const result = await executePipeline(config, {
                aiInvoker,
                pipelineDirectory: tempDir
            });

            assert.ok(result.filterResult);
            assert.strictEqual(result.filterResult.stats.includedCount, 2);
            
            const includedIds = result.filterResult.included.map(i => i.id).sort();
            assert.deepStrictEqual(includedIds, [1, 3]);
        });

        test('filter excludes all items', async () => {
            const config: PipelineConfig = {
                name: 'Exclude All',
                input: {
                    items: [
                        { id: '1', status: 'closed' },
                        { id: '2', status: 'resolved' }
                    ]
                },
                filter: {
                    type: 'rule',
                    rule: {
                        rules: [
                            { field: 'status', operator: 'equals', value: 'open' }
                        ]
                    }
                },
                map: {
                    prompt: 'Process {{id}}',
                    output: ['result']
                },
                reduce: {
                    type: 'list'
                }
            };

            const aiInvoker = createMockAIInvoker('{"result":"ok"}');
            
            const result = await executePipeline(config, {
                aiInvoker,
                pipelineDirectory: tempDir
            });

            assert.ok(result.filterResult);
            assert.strictEqual(result.filterResult.stats.includedCount, 0);
            assert.strictEqual(result.mapResults.filter(r => r.success).length, 0);
        });
    });

    suite('AI Filter Integration', () => {
        test('AI filter reduces items before map', async () => {
            const config: PipelineConfig = {
                name: 'AI Filter Test',
                input: {
                    items: [
                        { id: '1', title: 'Important task' },
                        { id: '2', title: 'Minor update' },
                        { id: '3', title: 'Critical bug' },
                        { id: '4', title: 'Trivial change' }
                    ]
                },
                filter: {
                    type: 'ai',
                    ai: {
                        prompt: 'Should include {{id}}?',
                        output: ['include', 'reason'],
                        parallel: 2
                    }
                },
                map: {
                    prompt: 'Process {{title}}',
                    output: ['result']
                },
                reduce: {
                    type: 'list'
                }
            };

            // AI includes only odd IDs
            const aiInvoker = createMockAIInvoker(
                '{"result":"processed"}',
                (id) => parseInt(id, 10) % 2 === 1
            );
            
            const result = await executePipeline(config, {
                aiInvoker,
                pipelineDirectory: tempDir
            });

            assert.ok(result.filterResult);
            assert.strictEqual(result.filterResult.stats.filterType, 'ai');
            assert.strictEqual(result.filterResult.stats.includedCount, 2);
            
            const includedIds = result.filterResult.included.map(i => i.id).sort();
            assert.deepStrictEqual(includedIds, [1, 3]);
        });
    });

    suite('Hybrid Filter Integration', () => {
        test('hybrid filter with AND mode', async () => {
            const config: PipelineConfig = {
                name: 'Hybrid Filter Test',
                input: {
                    items: [
                        { id: '1', status: 'open', priority: '5' },
                        { id: '2', status: 'open', priority: '3' },
                        { id: '3', status: 'closed', priority: '8' },
                        { id: '4', status: 'open', priority: '7' }
                    ]
                },
                filter: {
                    type: 'hybrid',
                    rule: {
                        rules: [
                            { field: 'status', operator: 'equals', value: 'open' }
                        ]
                    },
                    ai: {
                        prompt: 'Should include {{id}}?',
                        output: ['include']
                    },
                    combineMode: 'and'
                },
                map: {
                    prompt: 'Process {{id}}',
                    output: ['result']
                },
                reduce: {
                    type: 'list'
                }
            };

            // Rule passes items 1, 2, 4 (status='open')
            // AI passes odd IDs: 1, 3
            // AND result: 1
            const aiInvoker = createMockAIInvoker(
                '{"result":"ok"}',
                (id) => parseInt(id, 10) % 2 === 1
            );
            
            const result = await executePipeline(config, {
                aiInvoker,
                pipelineDirectory: tempDir
            });

            assert.ok(result.filterResult);
            assert.strictEqual(result.filterResult.stats.filterType, 'hybrid');
            assert.strictEqual(result.filterResult.stats.includedCount, 1);
            assert.strictEqual(result.filterResult.included[0].id, '1');
        });

        test('hybrid filter with OR mode', async () => {
            const config: PipelineConfig = {
                name: 'Hybrid OR Test',
                input: {
                    items: [
                        { id: '1', status: 'open' },
                        { id: '2', status: 'closed' },
                        { id: '3', status: 'resolved' },
                        { id: '4', status: 'open' }
                    ]
                },
                filter: {
                    type: 'hybrid',
                    rule: {
                        rules: [
                            { field: 'status', operator: 'equals', value: 'open' }
                        ]
                    },
                    ai: {
                        prompt: 'Include {{id}}?',
                        output: ['include']
                    },
                    combineMode: 'or'
                },
                map: {
                    prompt: 'Process {{id}}',
                    output: ['result']
                },
                reduce: {
                    type: 'list'
                }
            };

            // Rule passes 1, 4
            // Rule fails 2, 3
            // AI includes odd IDs from failed: 3
            // OR result: 1, 3, 4
            const aiInvoker = createMockAIInvoker(
                '{"result":"ok"}',
                (id) => parseInt(id, 10) % 2 === 1
            );
            
            const result = await executePipeline(config, {
                aiInvoker,
                pipelineDirectory: tempDir
            });

            assert.ok(result.filterResult);
            assert.strictEqual(result.filterResult.stats.includedCount, 3);
            
            const includedIds = result.filterResult.included.map(i => i.id).sort();
            assert.deepStrictEqual(includedIds, ['1', '3', '4']);
        });
    });

    suite('Pipeline without Filter', () => {
        test('pipeline works without filter config', async () => {
            const config: PipelineConfig = {
                name: 'No Filter Test',
                input: {
                    items: [
                        { id: '1', value: 'a' },
                        { id: '2', value: 'b' }
                    ]
                },
                // No filter configured
                map: {
                    prompt: 'Process {{value}}',
                    output: ['result']
                },
                reduce: {
                    type: 'list'
                }
            };

            const aiInvoker = createMockAIInvoker('{"result":"ok"}');
            
            const result = await executePipeline(config, {
                aiInvoker,
                pipelineDirectory: tempDir
            });

            assert.strictEqual(result.filterResult, undefined);
            assert.strictEqual(result.mapResults.filter(r => r.success).length, 2);
        });
    });

    suite('Error Handling', () => {
        test('invalid filter type throws error', async () => {
            const config: PipelineConfig = {
                name: 'Invalid Filter',
                input: {
                    items: [{ id: '1' }]
                },
                filter: {
                    type: 'invalid' as any
                },
                map: {
                    prompt: 'Process {{id}}',
                    output: ['result']
                },
                reduce: {
                    type: 'list'
                }
            };

            const aiInvoker = createMockAIInvoker('{"result":"ok"}');
            
            await assert.rejects(
                async () => executePipeline(config, { aiInvoker, pipelineDirectory: tempDir }),
                (error: any) => {
                    assert.ok(error instanceof PipelineExecutionError);
                    assert.strictEqual(error.phase, 'filter');
                    return true;
                }
            );
        });

        test('missing rule config for rule filter', async () => {
            const config: PipelineConfig = {
                name: 'Missing Rule',
                input: {
                    items: [{ id: '1' }]
                },
                filter: {
                    type: 'rule'
                    // Missing 'rule' property
                },
                map: {
                    prompt: 'Process {{id}}',
                    output: ['result']
                },
                reduce: {
                    type: 'list'
                }
            };

            const aiInvoker = createMockAIInvoker('{"result":"ok"}');
            
            await assert.rejects(
                async () => executePipeline(config, { aiInvoker, pipelineDirectory: tempDir }),
                /Rule filter requires "rule" configuration/
            );
        });
    });
});
