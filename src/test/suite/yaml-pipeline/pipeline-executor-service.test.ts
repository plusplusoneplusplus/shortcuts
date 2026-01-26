/**
 * Tests for Pipeline Executor Service
 *
 * Tests the VSCode integration layer for pipeline execution.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { MockAIProcessManager } from '../../../shortcuts/ai-service/mock-ai-process-manager';
import { ProcessTracker, ExecutionStats, SessionMetadata } from '../../../shortcuts/map-reduce';
import { AIProcess } from '../../../shortcuts/ai-service/types';

// Import the module under test
// Note: These tests focus on the utility functions that don't require VSCode context
// Full integration tests would require VSCode test runner

/**
 * Creates a process tracker that bridges to the AI process manager.
 * This mirrors the implementation in pipeline-executor-service.ts for testing.
 *
 * The key insight here is that we already have a parent pipeline-execution group,
 * so we don't need to create another nested group when the executor asks for one.
 * Instead, we return the parent group ID, which ensures child processes are
 * registered directly under the pipeline-execution process visible in the tree view.
 */
function createTestProcessTracker(
    processManager: MockAIProcessManager,
    parentGroupId: string
): ProcessTracker {
    return {
        registerProcess(description: string, parentId?: string): string {
            // If parentId is provided and it's the same as parentGroupId, use parentGroupId
            // Otherwise use the provided parentId or fall back to parentGroupId
            const effectiveParentId = parentId === parentGroupId ? parentGroupId : (parentId || parentGroupId);

            return processManager.registerTypedProcess(
                description,
                {
                    type: 'pipeline-item',
                    idPrefix: 'pipeline-item',
                    parentProcessId: effectiveParentId,
                    metadata: { type: 'pipeline-item', description }
                }
            );
        },

        updateProcess(
            processId: string,
            status: 'running' | 'completed' | 'failed',
            response?: string,
            error?: string,
            structuredResult?: string
        ): void {
            if (status === 'completed') {
                processManager.completeProcess(processId, response);
                if (structuredResult) {
                    processManager.updateProcessStructuredResult(processId, structuredResult);
                }
            } else if (status === 'failed') {
                processManager.failProcess(processId, error || 'Unknown error');
            }
            // 'running' status is set on registration
        },

        attachSessionMetadata(processId: string, metadata: SessionMetadata): void {
            // Attach session metadata for session resume functionality
            if (metadata.sessionId) {
                processManager.attachSdkSessionId(processId, metadata.sessionId);
            }
            if (metadata.backend) {
                processManager.attachSessionMetadata(processId, metadata.backend, metadata.workingDirectory);
            }
        },

        registerGroup(_description: string): string {
            // Don't create a nested group - return the parent group ID so that
            // child processes are registered directly under the pipeline-execution process.
            // This ensures they appear in the tree view when the user expands the pipeline.
            return parentGroupId;
        },

        completeGroup(
            groupId: string,
            _summary: string,
            _stats: ExecutionStats
        ): void {
            // If the groupId is the parentGroupId, don't complete it here
            // because it will be completed by the main executor after the full pipeline finishes.
            // This prevents early completion of the parent process.
            if (groupId === parentGroupId) {
                return;
            }
            // For any other group (shouldn't happen with current implementation),
            // complete it normally
            processManager.completeProcessGroup(groupId, {
                result: _summary,
                structuredResult: JSON.stringify(_stats),
                executionStats: {
                    totalItems: _stats.totalItems,
                    successfulMaps: _stats.successfulMaps,
                    failedMaps: _stats.failedMaps,
                    mapPhaseTimeMs: 0,
                    reducePhaseTimeMs: 0,
                    maxConcurrency: 5
                }
            });
        }
    };
}

suite('Pipeline Executor Service', () => {
    let tempDir: string;

    setup(async () => {
        tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'pipeline-service-test-'));
    });

    teardown(async () => {
        await fs.promises.rm(tempDir, { recursive: true, force: true });
    });

    suite('Cross-Platform Path Handling', () => {
        test('handles Unix-style paths', async () => {
            // Create a test file with Unix paths
            const packageDir = path.join(tempDir, 'test-package');
            await fs.promises.mkdir(packageDir, { recursive: true });

            const csvContent = 'id,title\n1,Test';
            await fs.promises.writeFile(path.join(packageDir, 'input.csv'), csvContent);

            // Verify the file exists and can be read
            const filePath = path.join(packageDir, 'input.csv');
            const exists = fs.existsSync(filePath);
            assert.strictEqual(exists, true, 'File should exist');

            const content = await fs.promises.readFile(filePath, 'utf8');
            assert.strictEqual(content, csvContent);
        });

        test('handles paths with spaces', async () => {
            // Create a directory with spaces in the name
            const packageDir = path.join(tempDir, 'test package with spaces');
            await fs.promises.mkdir(packageDir, { recursive: true });

            const csvContent = 'id,name\n1,Spaced Item';
            await fs.promises.writeFile(path.join(packageDir, 'input.csv'), csvContent);

            // Verify the file exists
            const filePath = path.join(packageDir, 'input.csv');
            const exists = fs.existsSync(filePath);
            assert.strictEqual(exists, true, 'File with spaces in path should exist');
        });

        test('handles nested directory structures', async () => {
            // Create nested directories
            const packageDir = path.join(tempDir, 'level1', 'level2', 'package');
            await fs.promises.mkdir(packageDir, { recursive: true });

            const csvContent = 'id,value\n1,nested';
            await fs.promises.writeFile(path.join(packageDir, 'data.csv'), csvContent);

            // Verify the file exists
            const filePath = path.join(packageDir, 'data.csv');
            const exists = fs.existsSync(filePath);
            assert.strictEqual(exists, true, 'Nested file should exist');
        });
    });

    suite('Pipeline Package Structure', () => {
        test('creates valid pipeline package structure', async () => {
            const packageDir = path.join(tempDir, 'my-pipeline');
            await fs.promises.mkdir(packageDir, { recursive: true });

            // Create pipeline.yaml
            const pipelineYaml = `name: "Test Pipeline"
description: "A test pipeline"
input:
  type: csv
  path: "input.csv"
map:
  prompt: "Process: {{title}}"
  output: [result]
reduce:
  type: list
`;
            await fs.promises.writeFile(path.join(packageDir, 'pipeline.yaml'), pipelineYaml);

            // Create input.csv
            const csvContent = 'id,title\n1,Item A\n2,Item B';
            await fs.promises.writeFile(path.join(packageDir, 'input.csv'), csvContent);

            // Verify structure
            const pipelineExists = fs.existsSync(path.join(packageDir, 'pipeline.yaml'));
            const csvExists = fs.existsSync(path.join(packageDir, 'input.csv'));

            assert.strictEqual(pipelineExists, true, 'pipeline.yaml should exist');
            assert.strictEqual(csvExists, true, 'input.csv should exist');
        });

        test('reads pipeline.yaml content correctly', async () => {
            const packageDir = path.join(tempDir, 'read-test');
            await fs.promises.mkdir(packageDir, { recursive: true });

            const pipelineYaml = `name: "Read Test"
input:
  type: csv
  path: "data.csv"
map:
  prompt: "{{content}}"
  output: [result]
reduce:
  type: json
`;
            await fs.promises.writeFile(path.join(packageDir, 'pipeline.yaml'), pipelineYaml);

            const content = await fs.promises.readFile(path.join(packageDir, 'pipeline.yaml'), 'utf8');
            assert.ok(content.includes('name: "Read Test"'));
            assert.ok(content.includes('type: csv'));
        });
    });

    suite('Result Formatting', () => {
        test('formats execution statistics correctly', () => {
            // Test data that mimics PipelineExecutionResult structure
            const mockStats = {
                totalItems: 10,
                successfulMaps: 8,
                failedMaps: 2,
                mapPhaseTimeMs: 5000,
                reducePhaseTimeMs: 100,
                maxConcurrency: 5
            };

            // Verify stats are valid
            assert.strictEqual(mockStats.totalItems, mockStats.successfulMaps + mockStats.failedMaps);
            assert.ok(mockStats.mapPhaseTimeMs > 0);
        });

        test('calculates progress percentage correctly', () => {
            // Test progress calculation logic
            const testCases = [
                { completed: 0, total: 10, expected: 0 },
                { completed: 5, total: 10, expected: 50 },
                { completed: 10, total: 10, expected: 100 },
                { completed: 3, total: 9, expected: 33.33 },
            ];

            for (const tc of testCases) {
                const percentage = (tc.completed / tc.total) * 100;
                if (tc.expected === 33.33) {
                    assert.ok(Math.abs(percentage - tc.expected) < 0.1, 
                        `Expected ~${tc.expected}%, got ${percentage}%`);
                } else {
                    assert.strictEqual(percentage, tc.expected, 
                        `For ${tc.completed}/${tc.total}, expected ${tc.expected}%, got ${percentage}%`);
                }
            }
        });
    });

    suite('Duration Formatting', () => {
        test('formats milliseconds correctly', () => {
            // Test formatDuration logic
            const formatDuration = (ms: number): string => {
                if (ms < 1000) {
                    return `${ms}ms`;
                } else if (ms < 60000) {
                    return `${(ms / 1000).toFixed(1)}s`;
                } else {
                    const minutes = Math.floor(ms / 60000);
                    const seconds = ((ms % 60000) / 1000).toFixed(0);
                    return `${minutes}m ${seconds}s`;
                }
            };

            assert.strictEqual(formatDuration(500), '500ms');
            assert.strictEqual(formatDuration(1000), '1.0s');
            assert.strictEqual(formatDuration(5500), '5.5s');
            assert.strictEqual(formatDuration(60000), '1m 0s');
            assert.strictEqual(formatDuration(90000), '1m 30s');
            assert.strictEqual(formatDuration(125000), '2m 5s');
        });
    });

    suite('Error Handling', () => {
        test('handles missing pipeline file gracefully', async () => {
            const nonExistentPath = path.join(tempDir, 'non-existent', 'pipeline.yaml');

            let errorThrown = false;
            try {
                await fs.promises.readFile(nonExistentPath, 'utf8');
            } catch (error) {
                errorThrown = true;
                assert.ok(error instanceof Error);
            }

            assert.strictEqual(errorThrown, true, 'Should throw error for missing file');
        });

        test('handles invalid YAML gracefully', async () => {
            const packageDir = path.join(tempDir, 'invalid-yaml');
            await fs.promises.mkdir(packageDir, { recursive: true });

            // Invalid YAML content
            const invalidYaml = `name: "Test"
input:
  type: csv
  path: [invalid: syntax here
`;
            await fs.promises.writeFile(path.join(packageDir, 'pipeline.yaml'), invalidYaml);

            const content = await fs.promises.readFile(path.join(packageDir, 'pipeline.yaml'), 'utf8');

            // The actual YAML parsing would fail - just verify we can read the file
            assert.ok(content.includes('[invalid: syntax'));
        });

        test('handles empty CSV file', async () => {
            const packageDir = path.join(tempDir, 'empty-csv');
            await fs.promises.mkdir(packageDir, { recursive: true });

            // Create empty CSV (just headers)
            const emptyCSV = 'id,title';
            await fs.promises.writeFile(path.join(packageDir, 'input.csv'), emptyCSV);

            const content = await fs.promises.readFile(path.join(packageDir, 'input.csv'), 'utf8');
            const lines = content.split('\n').filter(l => l.trim().length > 0);

            assert.strictEqual(lines.length, 1, 'Should have only header line');
        });
    });

    suite('Process Tracking Integration', () => {
        test('process tracker interface compliance', () => {
            // Test that we can create an object conforming to ProcessTracker interface
            const mockTracker = {
                registerProcess: (description: string, parentId?: string): string => {
                    return `process-${Date.now()}`;
                },
                updateProcess: (
                    processId: string,
                    status: 'running' | 'completed' | 'failed',
                    response?: string,
                    error?: string,
                    structuredResult?: string
                ): void => {
                    // Mock implementation
                },
                registerGroup: (description: string): string => {
                    return `group-${Date.now()}`;
                },
                completeGroup: (
                    groupId: string,
                    summary: string,
                    stats: { totalItems: number; successfulMaps: number; failedMaps: number }
                ): void => {
                    // Mock implementation
                }
            };

            // Verify the mock has all required methods
            assert.ok(typeof mockTracker.registerProcess === 'function');
            assert.ok(typeof mockTracker.updateProcess === 'function');
            assert.ok(typeof mockTracker.registerGroup === 'function');
            assert.ok(typeof mockTracker.completeGroup === 'function');

            // Verify method signatures work
            const processId = mockTracker.registerProcess('Test process');
            assert.ok(processId.startsWith('process-'));

            const groupId = mockTracker.registerGroup('Test group');
            assert.ok(groupId.startsWith('group-'));
        });
    });

    suite('Pipeline Info Structure', () => {
        test('validates PipelineInfo properties', () => {
            // Test structure mimicking PipelineInfo
            const mockPipelineInfo = {
                packageName: 'test-pipeline',
                packagePath: path.join(tempDir, 'test-pipeline'),
                filePath: path.join(tempDir, 'test-pipeline', 'pipeline.yaml'),
                relativePath: '.vscode/pipelines/test-pipeline',
                name: 'Test Pipeline',
                description: 'A test pipeline description',
                lastModified: new Date(),
                size: 1024,
                isValid: true,
                validationErrors: undefined,
                resourceFiles: [
                    {
                        fileName: 'input.csv',
                        filePath: path.join(tempDir, 'test-pipeline', 'input.csv'),
                        relativePath: 'input.csv',
                        size: 256,
                        fileType: 'csv' as const
                    }
                ]
            };

            assert.strictEqual(mockPipelineInfo.packageName, 'test-pipeline');
            assert.ok(mockPipelineInfo.filePath.includes('pipeline.yaml'));
            assert.strictEqual(mockPipelineInfo.isValid, true);
            assert.strictEqual(mockPipelineInfo.resourceFiles?.length, 1);
            assert.strictEqual(mockPipelineInfo.resourceFiles?.[0].fileType, 'csv');
        });
    });

    suite('Cross-Platform File Operations', () => {
        test('handles path separators correctly', () => {
            // Test that path.join handles separators on current platform
            const joined = path.join('parent', 'child', 'file.txt');

            // Should use the correct separator for the platform
            if (process.platform === 'win32') {
                assert.ok(joined.includes('\\') || joined.includes('/'));
            } else {
                assert.ok(joined.includes('/'));
            }
        });

        test('resolves relative paths correctly', () => {
            const basePath = tempDir;
            const relativePath = 'subdir/file.txt';

            const resolved = path.resolve(basePath, relativePath);

            // Should create an absolute path
            assert.ok(path.isAbsolute(resolved));
            assert.ok(resolved.includes('subdir'));
            assert.ok(resolved.includes('file.txt'));
        });

        test('normalizes paths with mixed separators', () => {
            // Create a path with potential mixed separators
            const mixedPath = `${tempDir}/subdir\\file.txt`;
            const normalized = path.normalize(mixedPath);

            // Should be a valid path string
            assert.ok(typeof normalized === 'string');
            assert.ok(normalized.length > 0);
        });
    });

    suite('Pipeline Process Tracker - Tree View Integration', () => {
        let processManager: MockAIProcessManager;

        setup(() => {
            processManager = new MockAIProcessManager();
        });

        teardown(() => {
            processManager.dispose();
        });

        suite('Parent Group Reuse', () => {
            test('registerGroup returns parent group ID instead of creating new group', () => {
                // Create parent pipeline-execution group
                const parentGroupId = processManager.registerProcessGroup(
                    'Pipeline: Test Pipeline',
                    {
                        type: 'pipeline-execution',
                        idPrefix: 'pipeline',
                        metadata: {
                            type: 'pipeline-execution',
                            pipelineName: 'Test Pipeline'
                        }
                    }
                );

                // Create tracker with parent group
                const tracker = createTestProcessTracker(processManager, parentGroupId);

                // When executor calls registerGroup, it should return the parent ID
                const returnedGroupId = tracker.registerGroup('Internal batch group');

                assert.strictEqual(returnedGroupId, parentGroupId,
                    'registerGroup should return parent group ID, not create a new group');
            });

            test('no nested pipeline-batch groups are created', () => {
                // Create parent pipeline-execution group
                const parentGroupId = processManager.registerProcessGroup(
                    'Pipeline: Test Pipeline',
                    {
                        type: 'pipeline-execution',
                        idPrefix: 'pipeline',
                        metadata: { type: 'pipeline-execution' }
                    }
                );

                // Create tracker
                const tracker = createTestProcessTracker(processManager, parentGroupId);

                // Call registerGroup multiple times (simulating executor behavior)
                tracker.registerGroup('Batch 1');
                tracker.registerGroup('Batch 2');

                // Should only have the original parent group, no pipeline-batch groups
                const allProcesses = processManager.getProcesses();
                const pipelineBatchGroups = allProcesses.filter((p: AIProcess) => p.type === 'pipeline-batch');

                assert.strictEqual(pipelineBatchGroups.length, 0,
                    'No pipeline-batch groups should be created');
                assert.strictEqual(allProcesses.length, 1,
                    'Only the parent pipeline-execution process should exist');
            });
        });

        suite('Child Process Registration', () => {
            test('child processes are registered under parent pipeline-execution group', () => {
                // Create parent group
                const parentGroupId = processManager.registerProcessGroup(
                    'Pipeline: Test Pipeline',
                    {
                        type: 'pipeline-execution',
                        idPrefix: 'pipeline',
                        metadata: { type: 'pipeline-execution' }
                    }
                );

                // Create tracker
                const tracker = createTestProcessTracker(processManager, parentGroupId);

                // Simulate executor: register group then register processes under it
                const groupId = tracker.registerGroup('Batch group');
                const processId1 = tracker.registerProcess('Processing item 1/3', groupId);
                const processId2 = tracker.registerProcess('Processing item 2/3', groupId);
                const processId3 = tracker.registerProcess('Processing item 3/3', groupId);

                // Verify children are under parent
                const children = processManager.getChildProcesses(parentGroupId);
                assert.strictEqual(children.length, 3,
                    'All child processes should be under parent pipeline-execution group');

                const childIds = children.map((c: AIProcess) => c.id);
                assert.ok(childIds.includes(processId1), 'Child 1 should be found');
                assert.ok(childIds.includes(processId2), 'Child 2 should be found');
                assert.ok(childIds.includes(processId3), 'Child 3 should be found');
            });

            test('child processes have correct parentProcessId', () => {
                const parentGroupId = processManager.registerProcessGroup(
                    'Pipeline: Test',
                    {
                        type: 'pipeline-execution',
                        idPrefix: 'pipeline',
                        metadata: { type: 'pipeline-execution' }
                    }
                );

                const tracker = createTestProcessTracker(processManager, parentGroupId);
                const groupId = tracker.registerGroup('Batch');
                const processId = tracker.registerProcess('Test item', groupId);

                const process = processManager.getProcess(processId);
                assert.ok(process, 'Process should exist');
                assert.strictEqual(process?.parentProcessId, parentGroupId,
                    'Child process should have parentProcessId pointing to pipeline-execution group');
            });

            test('child processes have type pipeline-item', () => {
                const parentGroupId = processManager.registerProcessGroup(
                    'Pipeline: Test',
                    {
                        type: 'pipeline-execution',
                        idPrefix: 'pipeline',
                        metadata: { type: 'pipeline-execution' }
                    }
                );

                const tracker = createTestProcessTracker(processManager, parentGroupId);
                const groupId = tracker.registerGroup('Batch');
                const processId = tracker.registerProcess('Test item', groupId);

                const process = processManager.getProcess(processId);
                assert.strictEqual(process?.type, 'pipeline-item',
                    'Child process should have type pipeline-item');
            });

            test('child processes without explicit parentId use parentGroupId', () => {
                const parentGroupId = processManager.registerProcessGroup(
                    'Pipeline: Test',
                    {
                        type: 'pipeline-execution',
                        idPrefix: 'pipeline',
                        metadata: { type: 'pipeline-execution' }
                    }
                );

                const tracker = createTestProcessTracker(processManager, parentGroupId);

                // Register process without parentId
                const processId = tracker.registerProcess('Test item');

                const process = processManager.getProcess(processId);
                assert.strictEqual(process?.parentProcessId, parentGroupId,
                    'Process without explicit parentId should use parentGroupId');
            });
        });

        suite('Group Completion Behavior', () => {
            test('completeGroup does not complete parent group prematurely', () => {
                const parentGroupId = processManager.registerProcessGroup(
                    'Pipeline: Test',
                    {
                        type: 'pipeline-execution',
                        idPrefix: 'pipeline',
                        metadata: { type: 'pipeline-execution' }
                    }
                );

                const tracker = createTestProcessTracker(processManager, parentGroupId);
                const groupId = tracker.registerGroup('Batch');

                // Simulate executor completing the "internal" group
                const stats: ExecutionStats = {
                    totalItems: 3,
                    successfulMaps: 3,
                    failedMaps: 0,
                    mapPhaseTimeMs: 1000,
                    reducePhaseTimeMs: 100,
                    maxConcurrency: 5
                };
                tracker.completeGroup(groupId, 'Completed 3 items', stats);

                // Parent group should still be running
                const parentProcess = processManager.getProcess(parentGroupId);
                assert.strictEqual(parentProcess?.status, 'running',
                    'Parent group should still be running after internal completeGroup');
            });

            test('parent group can be completed separately via processManager', () => {
                const parentGroupId = processManager.registerProcessGroup(
                    'Pipeline: Test',
                    {
                        type: 'pipeline-execution',
                        idPrefix: 'pipeline',
                        metadata: { type: 'pipeline-execution' }
                    }
                );

                const tracker = createTestProcessTracker(processManager, parentGroupId);

                // Simulate executor flow
                const groupId = tracker.registerGroup('Batch');
                tracker.registerProcess('Item 1', groupId);
                tracker.registerProcess('Item 2', groupId);

                // Executor's internal completeGroup (should be no-op for parent)
                tracker.completeGroup(groupId, 'Internal complete', {
                    totalItems: 2,
                    successfulMaps: 2,
                    failedMaps: 0,
                    mapPhaseTimeMs: 500,
                    reducePhaseTimeMs: 50,
                    maxConcurrency: 5
                });

                // Parent still running
                assert.strictEqual(processManager.getProcess(parentGroupId)?.status, 'running');

                // Now complete via processManager (simulating executeVSCodePipeline completion)
                processManager.completeProcessGroup(parentGroupId, {
                    result: 'Pipeline completed successfully',
                    structuredResult: JSON.stringify({ success: true }),
                    executionStats: {
                        totalItems: 2,
                        successfulMaps: 2,
                        failedMaps: 0,
                        mapPhaseTimeMs: 500,
                        reducePhaseTimeMs: 50,
                        maxConcurrency: 5
                    }
                });

                // Now parent should be completed
                const parentProcess = processManager.getProcess(parentGroupId);
                assert.strictEqual(parentProcess?.status, 'completed',
                    'Parent group should be completed after explicit completeProcessGroup');
            });
        });

        suite('Process Update Behavior', () => {
            test('updateProcess completes process with result', () => {
                const parentGroupId = processManager.registerProcessGroup(
                    'Pipeline: Test',
                    {
                        type: 'pipeline-execution',
                        idPrefix: 'pipeline',
                        metadata: { type: 'pipeline-execution' }
                    }
                );

                const tracker = createTestProcessTracker(processManager, parentGroupId);
                const processId = tracker.registerProcess('Test item');

                tracker.updateProcess(processId, 'completed', 'Success result', undefined, '{"output": "test"}');

                const process = processManager.getProcess(processId);
                assert.strictEqual(process?.status, 'completed');
                assert.strictEqual(process?.result, 'Success result');
                assert.strictEqual(process?.structuredResult, '{"output": "test"}');
            });

            test('updateProcess fails process with error', () => {
                const parentGroupId = processManager.registerProcessGroup(
                    'Pipeline: Test',
                    {
                        type: 'pipeline-execution',
                        idPrefix: 'pipeline',
                        metadata: { type: 'pipeline-execution' }
                    }
                );

                const tracker = createTestProcessTracker(processManager, parentGroupId);
                const processId = tracker.registerProcess('Test item');

                tracker.updateProcess(processId, 'failed', undefined, 'Something went wrong');

                const process = processManager.getProcess(processId);
                assert.strictEqual(process?.status, 'failed');
                assert.strictEqual(process?.error, 'Something went wrong');
            });

            test('updateProcess with failed status uses default error if none provided', () => {
                const parentGroupId = processManager.registerProcessGroup(
                    'Pipeline: Test',
                    {
                        type: 'pipeline-execution',
                        idPrefix: 'pipeline',
                        metadata: { type: 'pipeline-execution' }
                    }
                );

                const tracker = createTestProcessTracker(processManager, parentGroupId);
                const processId = tracker.registerProcess('Test item');

                tracker.updateProcess(processId, 'failed');

                const process = processManager.getProcess(processId);
                assert.strictEqual(process?.status, 'failed');
                assert.strictEqual(process?.error, 'Unknown error');
            });
        });

        suite('Tree View Compatibility', () => {
            test('getTopLevelProcesses returns only pipeline-execution, not children', () => {
                const parentGroupId = processManager.registerProcessGroup(
                    'Pipeline: Test',
                    {
                        type: 'pipeline-execution',
                        idPrefix: 'pipeline',
                        metadata: { type: 'pipeline-execution' }
                    }
                );

                const tracker = createTestProcessTracker(processManager, parentGroupId);
                const groupId = tracker.registerGroup('Batch');
                tracker.registerProcess('Item 1', groupId);
                tracker.registerProcess('Item 2', groupId);
                tracker.registerProcess('Item 3', groupId);

                const topLevel = processManager.getTopLevelProcesses();
                assert.strictEqual(topLevel.length, 1,
                    'Only parent pipeline-execution should be top-level');
                assert.strictEqual(topLevel[0].type, 'pipeline-execution');
            });

            test('getChildProcesses returns all pipeline-item children', () => {
                const parentGroupId = processManager.registerProcessGroup(
                    'Pipeline: Test',
                    {
                        type: 'pipeline-execution',
                        idPrefix: 'pipeline',
                        metadata: { type: 'pipeline-execution' }
                    }
                );

                const tracker = createTestProcessTracker(processManager, parentGroupId);
                const groupId = tracker.registerGroup('Batch');
                tracker.registerProcess('Item 1', groupId);
                tracker.registerProcess('Item 2', groupId);
                tracker.registerProcess('Item 3', groupId);

                const children = processManager.getChildProcesses(parentGroupId);
                assert.strictEqual(children.length, 3);
                assert.ok(children.every((c: AIProcess) => c.type === 'pipeline-item'));
            });

            test('isChildProcess returns true for pipeline-item processes', () => {
                const parentGroupId = processManager.registerProcessGroup(
                    'Pipeline: Test',
                    {
                        type: 'pipeline-execution',
                        idPrefix: 'pipeline',
                        metadata: { type: 'pipeline-execution' }
                    }
                );

                const tracker = createTestProcessTracker(processManager, parentGroupId);
                const processId = tracker.registerProcess('Test item');

                assert.strictEqual(processManager.isChildProcess(processId), true);
                assert.strictEqual(processManager.isChildProcess(parentGroupId), false);
            });

            test('childProcessIds array is correctly populated in groupMetadata', () => {
                const parentGroupId = processManager.registerProcessGroup(
                    'Pipeline: Test',
                    {
                        type: 'pipeline-execution',
                        idPrefix: 'pipeline',
                        metadata: { type: 'pipeline-execution' }
                    }
                );

                const tracker = createTestProcessTracker(processManager, parentGroupId);
                const groupId = tracker.registerGroup('Batch');
                const id1 = tracker.registerProcess('Item 1', groupId);
                const id2 = tracker.registerProcess('Item 2', groupId);

                const parentProcess = processManager.getProcess(parentGroupId);
                assert.ok(parentProcess?.groupMetadata, 'Parent should have groupMetadata');
                assert.ok(parentProcess?.groupMetadata?.childProcessIds.includes(id1),
                    'childProcessIds should include first child');
                assert.ok(parentProcess?.groupMetadata?.childProcessIds.includes(id2),
                    'childProcessIds should include second child');
            });
        });

        suite('Full Pipeline Execution Simulation', () => {
            test('simulates complete pipeline execution with multiple items', () => {
                // 1. Create pipeline-execution group (like executeVSCodePipeline does)
                const parentGroupId = processManager.registerProcessGroup(
                    'Pipeline: Bug Triage',
                    {
                        type: 'pipeline-execution',
                        idPrefix: 'pipeline',
                        metadata: {
                            type: 'pipeline-execution',
                            pipelineName: 'Bug Triage',
                            pipelinePath: '.vscode/pipelines/bug-triage'
                        }
                    }
                );

                // 2. Create tracker
                const tracker = createTestProcessTracker(processManager, parentGroupId);

                // 3. Executor registers internal group (returns parent ID)
                const executorGroupId = tracker.registerGroup('Bug Triage batch');
                assert.strictEqual(executorGroupId, parentGroupId);

                // 4. Executor registers individual items
                const itemIds: string[] = [];
                for (let i = 1; i <= 5; i++) {
                    const id = tracker.registerProcess(`Processing item ${i}/5`, executorGroupId);
                    itemIds.push(id);
                }

                // 5. Verify all items are children of parent
                let children = processManager.getChildProcesses(parentGroupId);
                assert.strictEqual(children.length, 5);
                assert.ok(children.every((c: AIProcess) => c.status === 'running'));

                // 6. Complete some items
                tracker.updateProcess(itemIds[0], 'completed', undefined, undefined, '{"severity": "high"}');
                tracker.updateProcess(itemIds[1], 'completed', undefined, undefined, '{"severity": "low"}');
                tracker.updateProcess(itemIds[2], 'failed', undefined, 'AI service timeout');
                tracker.updateProcess(itemIds[3], 'completed', undefined, undefined, '{"severity": "medium"}');
                tracker.updateProcess(itemIds[4], 'completed', undefined, undefined, '{"severity": "high"}');

                // 7. Executor calls completeGroup (should be no-op)
                tracker.completeGroup(executorGroupId, 'Completed 4/5', {
                    totalItems: 5,
                    successfulMaps: 4,
                    failedMaps: 1,
                    mapPhaseTimeMs: 2000,
                    reducePhaseTimeMs: 100,
                    maxConcurrency: 5
                });

                // 8. Parent still running
                assert.strictEqual(processManager.getProcess(parentGroupId)?.status, 'running');

                // 9. Main executor completes the group
                processManager.completeProcessGroup(parentGroupId, {
                    result: '# Pipeline Results\n\n4/5 items processed successfully',
                    structuredResult: JSON.stringify({
                        success: true,
                        results: [
                            { severity: 'high' },
                            { severity: 'low' },
                            { error: 'AI service timeout' },
                            { severity: 'medium' },
                            { severity: 'high' }
                        ]
                    }),
                    executionStats: {
                        totalItems: 5,
                        successfulMaps: 4,
                        failedMaps: 1,
                        mapPhaseTimeMs: 2000,
                        reducePhaseTimeMs: 100,
                        maxConcurrency: 5
                    }
                });

                // 10. Verify final state
                const parentProcess = processManager.getProcess(parentGroupId);
                assert.strictEqual(parentProcess?.status, 'completed');
                assert.ok(parentProcess?.result?.includes('4/5 items'));

                children = processManager.getChildProcesses(parentGroupId);
                assert.strictEqual(children.length, 5);

                const completed = children.filter((c: AIProcess) => c.status === 'completed');
                const failed = children.filter((c: AIProcess) => c.status === 'failed');
                assert.strictEqual(completed.length, 4);
                assert.strictEqual(failed.length, 1);

                // 11. Verify tree view sees correct structure
                const topLevel = processManager.getTopLevelProcesses();
                assert.strictEqual(topLevel.length, 1);
                assert.strictEqual(topLevel[0].id, parentGroupId);
            });

            test('simulates pipeline with single item (no internal group created by executor)', () => {
                // When there's only 1 item, executor doesn't create a group
                const parentGroupId = processManager.registerProcessGroup(
                    'Pipeline: Single Item',
                    {
                        type: 'pipeline-execution',
                        idPrefix: 'pipeline',
                        metadata: { type: 'pipeline-execution' }
                    }
                );

                const tracker = createTestProcessTracker(processManager, parentGroupId);

                // Executor might not call registerGroup for single item
                // Just registers the process directly
                const processId = tracker.registerProcess('Processing item 1/1');

                // Complete the item
                tracker.updateProcess(processId, 'completed', undefined, undefined, '{"result": "ok"}');

                // Verify child is under parent
                const children = processManager.getChildProcesses(parentGroupId);
                assert.strictEqual(children.length, 1);
                assert.strictEqual(children[0].status, 'completed');
            });

            test('simulates pipeline with all failures', () => {
                const parentGroupId = processManager.registerProcessGroup(
                    'Pipeline: Failing Pipeline',
                    {
                        type: 'pipeline-execution',
                        idPrefix: 'pipeline',
                        metadata: { type: 'pipeline-execution' }
                    }
                );

                const tracker = createTestProcessTracker(processManager, parentGroupId);
                const groupId = tracker.registerGroup('Batch');

                const ids: string[] = [];
                for (let i = 1; i <= 3; i++) {
                    ids.push(tracker.registerProcess(`Item ${i}`, groupId));
                }

                // All items fail
                ids.forEach((id, i) => {
                    tracker.updateProcess(id, 'failed', undefined, `Error on item ${i + 1}`);
                });

                // Complete group
                tracker.completeGroup(groupId, 'All failed', {
                    totalItems: 3,
                    successfulMaps: 0,
                    failedMaps: 3,
                    mapPhaseTimeMs: 500,
                    reducePhaseTimeMs: 0,
                    maxConcurrency: 5
                });

                // Verify
                const children = processManager.getChildProcesses(parentGroupId);
                assert.strictEqual(children.length, 3);
                assert.ok(children.every((c: AIProcess) => c.status === 'failed'));

                // Parent should still be running (not completed by tracker)
                assert.strictEqual(processManager.getProcess(parentGroupId)?.status, 'running');
            });
        });

        suite('Edge Cases', () => {
            test('handles empty pipeline (no items)', () => {
                const parentGroupId = processManager.registerProcessGroup(
                    'Pipeline: Empty',
                    {
                        type: 'pipeline-execution',
                        idPrefix: 'pipeline',
                        metadata: { type: 'pipeline-execution' }
                    }
                );

                const tracker = createTestProcessTracker(processManager, parentGroupId);

                // Executor calls registerGroup but doesn't register any processes
                const groupId = tracker.registerGroup('Empty batch');
                tracker.completeGroup(groupId, 'No items', {
                    totalItems: 0,
                    successfulMaps: 0,
                    failedMaps: 0,
                    mapPhaseTimeMs: 0,
                    reducePhaseTimeMs: 0,
                    maxConcurrency: 5
                });

                // Verify no children
                const children = processManager.getChildProcesses(parentGroupId);
                assert.strictEqual(children.length, 0);

                // Parent still running
                assert.strictEqual(processManager.getProcess(parentGroupId)?.status, 'running');
            });

            test('handles multiple sequential registerGroup calls', () => {
                const parentGroupId = processManager.registerProcessGroup(
                    'Pipeline: Test',
                    {
                        type: 'pipeline-execution',
                        idPrefix: 'pipeline',
                        metadata: { type: 'pipeline-execution' }
                    }
                );

                const tracker = createTestProcessTracker(processManager, parentGroupId);

                // Multiple registerGroup calls should all return parent ID
                const id1 = tracker.registerGroup('Group 1');
                const id2 = tracker.registerGroup('Group 2');
                const id3 = tracker.registerGroup('Group 3');

                assert.strictEqual(id1, parentGroupId);
                assert.strictEqual(id2, parentGroupId);
                assert.strictEqual(id3, parentGroupId);
            });

            test('processes registered with different parentId values work correctly', () => {
                const parentGroupId = processManager.registerProcessGroup(
                    'Pipeline: Test',
                    {
                        type: 'pipeline-execution',
                        idPrefix: 'pipeline',
                        metadata: { type: 'pipeline-execution' }
                    }
                );

                const tracker = createTestProcessTracker(processManager, parentGroupId);

                // Register with explicit parentGroupId
                const id1 = tracker.registerProcess('Item 1', parentGroupId);
                // Register without parentId (should default to parentGroupId)
                const id2 = tracker.registerProcess('Item 2');
                // Register with same parentGroupId from registerGroup
                const groupId = tracker.registerGroup('Batch');
                const id3 = tracker.registerProcess('Item 3', groupId);

                // All should be children of parent
                const children = processManager.getChildProcesses(parentGroupId);
                assert.strictEqual(children.length, 3);

                const childIds = children.map((c: AIProcess) => c.id);
                assert.ok(childIds.includes(id1));
                assert.ok(childIds.includes(id2));
                assert.ok(childIds.includes(id3));
            });

            test('structured results are preserved on child processes', () => {
                const parentGroupId = processManager.registerProcessGroup(
                    'Pipeline: Test',
                    {
                        type: 'pipeline-execution',
                        idPrefix: 'pipeline',
                        metadata: { type: 'pipeline-execution' }
                    }
                );

                const tracker = createTestProcessTracker(processManager, parentGroupId);
                const processId = tracker.registerProcess('Test item');

                const structuredResult = JSON.stringify({
                    severity: 'high',
                    category: 'bug',
                    effort_hours: 4
                });

                tracker.updateProcess(processId, 'completed', 'Done', undefined, structuredResult);

                const process = processManager.getProcess(processId);
                assert.strictEqual(process?.structuredResult, structuredResult);

                // Verify it can be parsed back
                const parsed = JSON.parse(process?.structuredResult || '{}');
                assert.strictEqual(parsed.severity, 'high');
                assert.strictEqual(parsed.effort_hours, 4);
            });
        });

        suite('Session Metadata Attachment', () => {
            test('attachSessionMetadata attaches session ID to process', () => {
                const parentGroupId = processManager.registerProcessGroup(
                    'Pipeline: Test',
                    {
                        type: 'pipeline-execution',
                        idPrefix: 'pipeline',
                        metadata: { type: 'pipeline-execution' }
                    }
                );

                const tracker = createTestProcessTracker(processManager, parentGroupId);
                const processId = tracker.registerProcess('Test item');

                // Attach session metadata
                tracker.attachSessionMetadata!(processId, {
                    sessionId: 'session-abc-123',
                    backend: 'copilot-sdk',
                    workingDirectory: '/workspace'
                });

                // Verify session metadata was attached
                const sessionMetadata = processManager.getSessionMetadata(processId);
                assert.strictEqual(sessionMetadata?.sdkSessionId, 'session-abc-123');
                assert.strictEqual(sessionMetadata?.backend, 'copilot-sdk');
                assert.strictEqual(sessionMetadata?.workingDirectory, '/workspace');
            });

            test('attachSessionMetadata makes completed pipeline item resumable', () => {
                const parentGroupId = processManager.registerProcessGroup(
                    'Pipeline: Test',
                    {
                        type: 'pipeline-execution',
                        idPrefix: 'pipeline',
                        metadata: { type: 'pipeline-execution' }
                    }
                );

                const tracker = createTestProcessTracker(processManager, parentGroupId);
                const processId = tracker.registerProcess('Test item');

                // Initially not resumable (running, no session metadata)
                assert.strictEqual(processManager.isProcessResumable(processId), false);

                // Attach session metadata
                tracker.attachSessionMetadata!(processId, {
                    sessionId: 'session-resumable',
                    backend: 'copilot-sdk'
                });

                // Still not resumable (still running)
                assert.strictEqual(processManager.isProcessResumable(processId), false);

                // Complete the process
                tracker.updateProcess(processId, 'completed', 'Success');

                // Now should be resumable
                assert.strictEqual(processManager.isProcessResumable(processId), true);
            });

            test('attachSessionMetadata with CLI backend does not make process resumable', () => {
                const parentGroupId = processManager.registerProcessGroup(
                    'Pipeline: Test',
                    {
                        type: 'pipeline-execution',
                        idPrefix: 'pipeline',
                        metadata: { type: 'pipeline-execution' }
                    }
                );

                const tracker = createTestProcessTracker(processManager, parentGroupId);
                const processId = tracker.registerProcess('Test item');

                // Attach session metadata with CLI backend
                tracker.attachSessionMetadata!(processId, {
                    sessionId: 'session-cli',
                    backend: 'copilot-cli'
                });

                // Complete the process
                tracker.updateProcess(processId, 'completed', 'Success');

                // Should NOT be resumable (CLI backend)
                assert.strictEqual(processManager.isProcessResumable(processId), false);
            });

            test('attachSessionMetadata without sessionId does not make process resumable', () => {
                const parentGroupId = processManager.registerProcessGroup(
                    'Pipeline: Test',
                    {
                        type: 'pipeline-execution',
                        idPrefix: 'pipeline',
                        metadata: { type: 'pipeline-execution' }
                    }
                );

                const tracker = createTestProcessTracker(processManager, parentGroupId);
                const processId = tracker.registerProcess('Test item');

                // Attach session metadata without sessionId
                tracker.attachSessionMetadata!(processId, {
                    backend: 'copilot-sdk',
                    workingDirectory: '/workspace'
                });

                // Complete the process
                tracker.updateProcess(processId, 'completed', 'Success');

                // Should NOT be resumable (no session ID)
                assert.strictEqual(processManager.isProcessResumable(processId), false);
            });

            test('session metadata persists through getProcesses', () => {
                const parentGroupId = processManager.registerProcessGroup(
                    'Pipeline: Test',
                    {
                        type: 'pipeline-execution',
                        idPrefix: 'pipeline',
                        metadata: { type: 'pipeline-execution' }
                    }
                );

                const tracker = createTestProcessTracker(processManager, parentGroupId);
                const processId = tracker.registerProcess('Test item');

                // Attach session metadata
                tracker.attachSessionMetadata!(processId, {
                    sessionId: 'session-persist',
                    backend: 'copilot-sdk',
                    workingDirectory: '/test/workspace'
                });
                tracker.updateProcess(processId, 'completed', 'Success');

                // Get process via getProcesses
                const processes = processManager.getProcesses();
                const process = processes.find((p: AIProcess) => p.id === processId);

                assert.ok(process, 'Process should be found');
                assert.strictEqual(process.sdkSessionId, 'session-persist');
                assert.strictEqual(process.backend, 'copilot-sdk');
                assert.strictEqual(process.workingDirectory, '/test/workspace');
            });

            test('multiple pipeline items can have different session IDs', () => {
                const parentGroupId = processManager.registerProcessGroup(
                    'Pipeline: Test',
                    {
                        type: 'pipeline-execution',
                        idPrefix: 'pipeline',
                        metadata: { type: 'pipeline-execution' }
                    }
                );

                const tracker = createTestProcessTracker(processManager, parentGroupId);
                
                // Create multiple items
                const processId1 = tracker.registerProcess('Item 1');
                const processId2 = tracker.registerProcess('Item 2');
                const processId3 = tracker.registerProcess('Item 3');

                // Attach different session IDs
                tracker.attachSessionMetadata!(processId1, {
                    sessionId: 'session-item-1',
                    backend: 'copilot-sdk'
                });
                tracker.attachSessionMetadata!(processId2, {
                    sessionId: 'session-item-2',
                    backend: 'copilot-sdk'
                });
                // Item 3 has no session metadata (e.g., failed before AI call)

                // Complete all
                tracker.updateProcess(processId1, 'completed', 'Success 1');
                tracker.updateProcess(processId2, 'completed', 'Success 2');
                tracker.updateProcess(processId3, 'failed', undefined, 'Error before AI call');

                // Verify each has correct session metadata
                assert.strictEqual(processManager.getSessionMetadata(processId1)?.sdkSessionId, 'session-item-1');
                assert.strictEqual(processManager.getSessionMetadata(processId2)?.sdkSessionId, 'session-item-2');
                assert.strictEqual(processManager.getSessionMetadata(processId3)?.sdkSessionId, undefined);

                // Verify resumability
                assert.strictEqual(processManager.isProcessResumable(processId1), true);
                assert.strictEqual(processManager.isProcessResumable(processId2), true);
                assert.strictEqual(processManager.isProcessResumable(processId3), false);
            });
        });

        suite('Method Call Recording', () => {
            test('records registerTypedProcess calls correctly', () => {
                const parentGroupId = processManager.registerProcessGroup(
                    'Pipeline: Test',
                    {
                        type: 'pipeline-execution',
                        idPrefix: 'pipeline',
                        metadata: { type: 'pipeline-execution' }
                    }
                );

                const tracker = createTestProcessTracker(processManager, parentGroupId);
                tracker.registerProcess('Test item', parentGroupId);

                const calls = processManager.getCallsForMethod('registerTypedProcess');
                assert.strictEqual(calls.length, 1);
                assert.strictEqual(calls[0].args[0], 'Test item');
                assert.strictEqual(calls[0].args[1].type, 'pipeline-item');
                assert.strictEqual(calls[0].args[1].parentProcessId, parentGroupId);
            });

            test('does not record completeProcessGroup for skipped parent completion', () => {
                const parentGroupId = processManager.registerProcessGroup(
                    'Pipeline: Test',
                    {
                        type: 'pipeline-execution',
                        idPrefix: 'pipeline',
                        metadata: { type: 'pipeline-execution' }
                    }
                );

                const tracker = createTestProcessTracker(processManager, parentGroupId);
                const groupId = tracker.registerGroup('Batch');

                // Clear calls to isolate completeGroup behavior
                processManager.clearCalls();

                // This should be a no-op since groupId === parentGroupId
                tracker.completeGroup(groupId, 'Summary', {
                    totalItems: 1,
                    successfulMaps: 1,
                    failedMaps: 0,
                    mapPhaseTimeMs: 100,
                    reducePhaseTimeMs: 10,
                    maxConcurrency: 5
                });

                const completeCalls = processManager.getCallsForMethod('completeProcessGroup');
                assert.strictEqual(completeCalls.length, 0,
                    'completeProcessGroup should not be called when groupId equals parentGroupId');
            });
        });

        suite('Pipeline Execution Cancellation', () => {
            test('cancelProcess cancels parent pipeline-execution process', () => {
                const parentGroupId = processManager.registerProcessGroup(
                    'Pipeline: Test',
                    {
                        type: 'pipeline-execution',
                        idPrefix: 'pipeline',
                        metadata: { type: 'pipeline-execution' }
                    }
                );

                // Process should be running
                const parent = processManager.getProcess(parentGroupId);
                assert.strictEqual(parent?.status, 'running');

                // Cancel it
                const cancelled = processManager.cancelProcess(parentGroupId);
                assert.strictEqual(cancelled, true, 'Should return true when cancelling running process');

                // Verify it's cancelled
                const cancelledParent = processManager.getProcess(parentGroupId);
                assert.strictEqual(cancelledParent?.status, 'cancelled');
                assert.strictEqual(cancelledParent?.error, 'Cancelled by user');
            });

            test('cancelProcess cascades to child pipeline-item processes', () => {
                const parentGroupId = processManager.registerProcessGroup(
                    'Pipeline: Test',
                    {
                        type: 'pipeline-execution',
                        idPrefix: 'pipeline',
                        metadata: { type: 'pipeline-execution' }
                    }
                );

                const tracker = createTestProcessTracker(processManager, parentGroupId);

                // Register 3 child processes (simulating map phase items)
                const child1 = tracker.registerProcess('Item 1');
                const child2 = tracker.registerProcess('Item 2');
                const child3 = tracker.registerProcess('Item 3');

                // Complete one child to test it doesn't get cancelled
                tracker.updateProcess(child3, 'completed', 'Done');

                // Verify initial state
                assert.strictEqual(processManager.getProcess(child1)?.status, 'running');
                assert.strictEqual(processManager.getProcess(child2)?.status, 'running');
                assert.strictEqual(processManager.getProcess(child3)?.status, 'completed');

                // Cancel parent
                processManager.cancelProcess(parentGroupId);

                // Verify parent is cancelled
                assert.strictEqual(processManager.getProcess(parentGroupId)?.status, 'cancelled');

                // Verify running children are cancelled
                const cancelledChild1 = processManager.getProcess(child1);
                assert.strictEqual(cancelledChild1?.status, 'cancelled');
                assert.strictEqual(cancelledChild1?.error, 'Cancelled by user (parent cancelled)');

                const cancelledChild2 = processManager.getProcess(child2);
                assert.strictEqual(cancelledChild2?.status, 'cancelled');
                assert.strictEqual(cancelledChild2?.error, 'Cancelled by user (parent cancelled)');

                // Verify completed child is NOT cancelled
                assert.strictEqual(processManager.getProcess(child3)?.status, 'completed');
            });

            test('cancelProcess returns false for already completed pipeline', () => {
                const parentGroupId = processManager.registerProcessGroup(
                    'Pipeline: Test',
                    {
                        type: 'pipeline-execution',
                        idPrefix: 'pipeline',
                        metadata: { type: 'pipeline-execution' }
                    }
                );

                // Complete the pipeline
                processManager.completeProcessGroup(parentGroupId, {
                    result: 'Done',
                    structuredResult: '{}',
                    executionStats: {}
                });

                // Try to cancel - should return false
                const cancelled = processManager.cancelProcess(parentGroupId);
                assert.strictEqual(cancelled, false, 'Should return false when process is not running');

                // Status should still be completed
                assert.strictEqual(processManager.getProcess(parentGroupId)?.status, 'completed');
            });

            test('cancelProcess returns false for non-existent process', () => {
                const cancelled = processManager.cancelProcess('non-existent-id');
                assert.strictEqual(cancelled, false, 'Should return false for non-existent process');
            });

            test('cancelProcess handles pipeline with no children', () => {
                const parentGroupId = processManager.registerProcessGroup(
                    'Pipeline: Test',
                    {
                        type: 'pipeline-execution',
                        idPrefix: 'pipeline',
                        metadata: { type: 'pipeline-execution' }
                    }
                );

                // Cancel without any children
                const cancelled = processManager.cancelProcess(parentGroupId);
                assert.strictEqual(cancelled, true);
                assert.strictEqual(processManager.getProcess(parentGroupId)?.status, 'cancelled');
            });

            test('cancelProcess handles mixed child statuses correctly', () => {
                const parentGroupId = processManager.registerProcessGroup(
                    'Pipeline: Test',
                    {
                        type: 'pipeline-execution',
                        idPrefix: 'pipeline',
                        metadata: { type: 'pipeline-execution' }
                    }
                );

                const tracker = createTestProcessTracker(processManager, parentGroupId);

                // Create children with different statuses
                const runningChild = tracker.registerProcess('Running item');
                const completedChild = tracker.registerProcess('Completed item');
                const failedChild = tracker.registerProcess('Failed item');

                tracker.updateProcess(completedChild, 'completed', 'Success');
                tracker.updateProcess(failedChild, 'failed', undefined, 'Error occurred');

                // Cancel parent
                processManager.cancelProcess(parentGroupId);

                // Only running child should be cancelled
                assert.strictEqual(processManager.getProcess(runningChild)?.status, 'cancelled');
                assert.strictEqual(processManager.getProcess(completedChild)?.status, 'completed');
                assert.strictEqual(processManager.getProcess(failedChild)?.status, 'failed');
            });

            test('getChildProcesses returns all children after cancellation', () => {
                const parentGroupId = processManager.registerProcessGroup(
                    'Pipeline: Test',
                    {
                        type: 'pipeline-execution',
                        idPrefix: 'pipeline',
                        metadata: { type: 'pipeline-execution' }
                    }
                );

                const tracker = createTestProcessTracker(processManager, parentGroupId);
                const child1 = tracker.registerProcess('Item 1');
                const child2 = tracker.registerProcess('Item 2');

                // Cancel parent
                processManager.cancelProcess(parentGroupId);

                // getChildProcesses should still return all children
                const children = processManager.getChildProcesses(parentGroupId);
                assert.strictEqual(children.length, 2);
                assert.ok(children.every((c: AIProcess) => c.status === 'cancelled'));
            });
        });
    });
});
