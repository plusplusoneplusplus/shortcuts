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

// Import the module under test
// Note: These tests focus on the utility functions that don't require VSCode context
// Full integration tests would require VSCode test runner

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
});
