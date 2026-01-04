/**
 * Tests for Discovery Grouping Features
 * 
 * Tests the new discovery functionality:
 * 1. Grouping items by type (source/doc/commits) as subgroups
 * 2. Passing target group context from discovery trigger
 * 3. Filtering out items already in the logical group
 */

import * as assert from 'assert';
import { 
    DiscoveryResult, 
    DiscoveryProcess, 
    DiscoverySourceType,
    DiscoveryRequest,
    DEFAULT_DISCOVERY_SCOPE,
    serializeDiscoveryProcess,
    deserializeDiscoveryProcess
} from '../../shortcuts/discovery/types';
import { LogicalGroup, LogicalGroupItem, ShortcutsConfig } from '../../shortcuts/types';

/**
 * Helper to create a mock DiscoveryResult
 */
function createMockResult(overrides: Partial<DiscoveryResult> = {}): DiscoveryResult {
    return {
        id: `file:src/test-${Math.random().toString(36).substr(2, 9)}.ts`,
        type: 'file' as DiscoverySourceType,
        name: 'test.ts',
        path: 'src/test.ts',
        relevanceScore: 85,
        matchedKeywords: ['test'],
        relevanceReason: 'Test file',
        selected: false,
        ...overrides
    };
}

/**
 * Helper to create a mock DiscoveryProcess with results
 */
function createMockProcess(overrides: Partial<DiscoveryProcess> = {}): DiscoveryProcess {
    return {
        id: 'discovery-test',
        status: 'completed',
        featureDescription: 'Test feature',
        phase: 'completed',
        progress: 100,
        results: [],
        startTime: new Date(),
        endTime: new Date(),
        ...overrides
    };
}

/**
 * Helper to create a mock LogicalGroup
 */
function createMockGroup(name: string, items: LogicalGroupItem[] = [], groups?: LogicalGroup[]): LogicalGroup {
    return {
        name,
        items,
        groups
    };
}

/**
 * Helper to create a mock ShortcutsConfig
 */
function createMockConfig(logicalGroups: LogicalGroup[] = []): ShortcutsConfig {
    return {
        logicalGroups
    };
}

/**
 * Simulates grouping results by type
 */
function groupResultsByType(results: DiscoveryResult[]): {
    sourceResults: DiscoveryResult[];
    docResults: DiscoveryResult[];
    commitResults: DiscoveryResult[];
} {
    const sourceResults: DiscoveryResult[] = [];
    const docResults: DiscoveryResult[] = [];
    const commitResults: DiscoveryResult[] = [];
    
    for (const result of results) {
        if (result.type === 'commit') {
            commitResults.push(result);
        } else if (result.type === 'doc') {
            docResults.push(result);
        } else {
            // file, folder, or other source code
            sourceResults.push(result);
        }
    }
    
    return { sourceResults, docResults, commitResults };
}

/**
 * Simulates collecting existing items from a group (including subgroups)
 */
function collectExistingItems(group: LogicalGroup): { filePaths: Set<string>; commitHashes: Set<string> } {
    const filePaths = new Set<string>();
    const commitHashes = new Set<string>();
    
    function collectFromGroup(g: LogicalGroup): void {
        for (const item of g.items) {
            if (item.type === 'commit' && item.commitRef) {
                commitHashes.add(item.commitRef.hash);
            } else if (item.path) {
                filePaths.add(item.path);
            }
        }
        
        if (g.groups) {
            for (const subgroup of g.groups) {
                collectFromGroup(subgroup);
            }
        }
    }
    
    collectFromGroup(group);
    return { filePaths, commitHashes };
}

/**
 * Simulates filtering out existing items from discovery results
 */
function filterExistingItems(
    results: DiscoveryResult[],
    existingItems: { filePaths: Set<string>; commitHashes: Set<string> }
): DiscoveryResult[] {
    return results.filter(result => {
        if (result.type === 'commit' && result.commit) {
            return !existingItems.commitHashes.has(result.commit.hash);
        } else if (result.path) {
            return !existingItems.filePaths.has(result.path);
        }
        return true;
    });
}

suite('Discovery Grouping Tests', () => {
    
    suite('Target Group Path in Process', () => {
        
        test('should include targetGroupPath in process when provided in request', () => {
            const process = createMockProcess({
                targetGroupPath: 'My Feature Group'
            });
            
            assert.strictEqual(process.targetGroupPath, 'My Feature Group');
        });
        
        test('should allow undefined targetGroupPath', () => {
            const process = createMockProcess();
            
            assert.strictEqual(process.targetGroupPath, undefined);
        });
        
        test('should support nested group paths', () => {
            const process = createMockProcess({
                targetGroupPath: 'Parent Group/Child Group/Grandchild'
            });
            
            assert.strictEqual(process.targetGroupPath, 'Parent Group/Child Group/Grandchild');
        });
        
        test('should serialize and deserialize targetGroupPath correctly', () => {
            const originalProcess = createMockProcess({
                targetGroupPath: 'Test Group/Subgroup'
            });
            
            const serialized = serializeDiscoveryProcess(originalProcess);
            const deserialized = deserializeDiscoveryProcess(serialized);
            
            assert.strictEqual(deserialized.targetGroupPath, 'Test Group/Subgroup');
        });
        
        test('should preserve targetGroupPath through serialization when undefined', () => {
            const originalProcess = createMockProcess();
            
            const serialized = serializeDiscoveryProcess(originalProcess);
            const deserialized = deserializeDiscoveryProcess(serialized);
            
            assert.strictEqual(deserialized.targetGroupPath, undefined);
        });
    });
    
    suite('Group Results by Type', () => {
        
        test('should separate file results into sourceResults', () => {
            const results = [
                createMockResult({ type: 'file', name: 'file1.ts' }),
                createMockResult({ type: 'file', name: 'file2.ts' })
            ];
            
            const grouped = groupResultsByType(results);
            
            assert.strictEqual(grouped.sourceResults.length, 2);
            assert.strictEqual(grouped.docResults.length, 0);
            assert.strictEqual(grouped.commitResults.length, 0);
        });
        
        test('should separate doc results into docResults', () => {
            const results = [
                createMockResult({ type: 'doc', name: 'README.md' }),
                createMockResult({ type: 'doc', name: 'DESIGN.md' })
            ];
            
            const grouped = groupResultsByType(results);
            
            assert.strictEqual(grouped.sourceResults.length, 0);
            assert.strictEqual(grouped.docResults.length, 2);
            assert.strictEqual(grouped.commitResults.length, 0);
        });
        
        test('should separate commit results into commitResults', () => {
            const results = [
                createMockResult({ 
                    type: 'commit', 
                    name: 'feat: add feature',
                    commit: {
                        hash: 'abc123',
                        shortHash: 'abc123',
                        subject: 'feat: add feature',
                        authorName: 'Test',
                        date: new Date().toISOString(),
                        repositoryRoot: '/test'
                    }
                })
            ];
            
            const grouped = groupResultsByType(results);
            
            assert.strictEqual(grouped.sourceResults.length, 0);
            assert.strictEqual(grouped.docResults.length, 0);
            assert.strictEqual(grouped.commitResults.length, 1);
        });
        
        test('should correctly group mixed result types', () => {
            const results = [
                createMockResult({ type: 'file', name: 'main.ts' }),
                createMockResult({ type: 'doc', name: 'README.md' }),
                createMockResult({ 
                    type: 'commit', 
                    name: 'fix: bug',
                    commit: {
                        hash: 'def456',
                        shortHash: 'def456',
                        subject: 'fix: bug',
                        authorName: 'Test',
                        date: new Date().toISOString(),
                        repositoryRoot: '/test'
                    }
                }),
                createMockResult({ type: 'file', name: 'utils.ts' }),
                createMockResult({ type: 'folder', name: 'components' })
            ];
            
            const grouped = groupResultsByType(results);
            
            assert.strictEqual(grouped.sourceResults.length, 3, 'Should have 3 source items (2 files + 1 folder)');
            assert.strictEqual(grouped.docResults.length, 1, 'Should have 1 doc item');
            assert.strictEqual(grouped.commitResults.length, 1, 'Should have 1 commit item');
        });
        
        test('should treat folders as source results', () => {
            const results = [
                createMockResult({ type: 'folder', name: 'src' })
            ];
            
            const grouped = groupResultsByType(results);
            
            assert.strictEqual(grouped.sourceResults.length, 1);
            assert.strictEqual(grouped.sourceResults[0].type, 'folder');
        });
        
        test('should handle empty results array', () => {
            const grouped = groupResultsByType([]);
            
            assert.strictEqual(grouped.sourceResults.length, 0);
            assert.strictEqual(grouped.docResults.length, 0);
            assert.strictEqual(grouped.commitResults.length, 0);
        });
    });
    
    suite('Collect Existing Items from Group', () => {
        
        test('should collect file paths from group items', () => {
            const group = createMockGroup('Test', [
                { name: 'file1.ts', path: 'src/file1.ts', type: 'file' },
                { name: 'file2.ts', path: 'src/file2.ts', type: 'file' }
            ]);
            
            const existing = collectExistingItems(group);
            
            assert.strictEqual(existing.filePaths.size, 2);
            assert.ok(existing.filePaths.has('src/file1.ts'));
            assert.ok(existing.filePaths.has('src/file2.ts'));
        });
        
        test('should collect commit hashes from group items', () => {
            const group = createMockGroup('Test', [
                { 
                    name: 'feat: add feature', 
                    type: 'commit',
                    commitRef: { hash: 'abc123', repositoryRoot: '/test' }
                },
                { 
                    name: 'fix: bug', 
                    type: 'commit',
                    commitRef: { hash: 'def456', repositoryRoot: '/test' }
                }
            ]);
            
            const existing = collectExistingItems(group);
            
            assert.strictEqual(existing.commitHashes.size, 2);
            assert.ok(existing.commitHashes.has('abc123'));
            assert.ok(existing.commitHashes.has('def456'));
        });
        
        test('should collect items from nested subgroups', () => {
            const group = createMockGroup('Parent', 
                [{ name: 'parent-file.ts', path: 'parent-file.ts', type: 'file' }],
                [
                    createMockGroup('Source Code', [
                        { name: 'child-file.ts', path: 'src/child-file.ts', type: 'file' }
                    ]),
                    createMockGroup('Commits', [
                        { 
                            name: 'commit', 
                            type: 'commit',
                            commitRef: { hash: 'nested123', repositoryRoot: '/test' }
                        }
                    ])
                ]
            );
            
            const existing = collectExistingItems(group);
            
            assert.strictEqual(existing.filePaths.size, 2);
            assert.ok(existing.filePaths.has('parent-file.ts'));
            assert.ok(existing.filePaths.has('src/child-file.ts'));
            assert.strictEqual(existing.commitHashes.size, 1);
            assert.ok(existing.commitHashes.has('nested123'));
        });
        
        test('should collect items from deeply nested subgroups', () => {
            const group = createMockGroup('Level1', [], [
                createMockGroup('Level2', [], [
                    createMockGroup('Level3', [
                        { name: 'deep-file.ts', path: 'deep/file.ts', type: 'file' }
                    ])
                ])
            ]);
            
            const existing = collectExistingItems(group);
            
            assert.strictEqual(existing.filePaths.size, 1);
            assert.ok(existing.filePaths.has('deep/file.ts'));
        });
        
        test('should handle groups with no items', () => {
            const group = createMockGroup('Empty');
            
            const existing = collectExistingItems(group);
            
            assert.strictEqual(existing.filePaths.size, 0);
            assert.strictEqual(existing.commitHashes.size, 0);
        });
        
        test('should ignore command and task items', () => {
            const group = createMockGroup('Test', [
                { name: 'file.ts', path: 'file.ts', type: 'file' },
                { name: 'Command', type: 'command', command: 'test.command' },
                { name: 'Task', type: 'task', task: 'test-task' }
            ]);
            
            const existing = collectExistingItems(group);
            
            assert.strictEqual(existing.filePaths.size, 1);
            assert.ok(existing.filePaths.has('file.ts'));
        });
    });
    
    suite('Filter Existing Items', () => {
        
        test('should filter out files that already exist in group', () => {
            const results = [
                createMockResult({ id: 'file:1', path: 'src/file1.ts' }),
                createMockResult({ id: 'file:2', path: 'src/file2.ts' }),
                createMockResult({ id: 'file:3', path: 'src/file3.ts' })
            ];
            
            const existingItems = {
                filePaths: new Set(['src/file1.ts', 'src/file3.ts']),
                commitHashes: new Set<string>()
            };
            
            const filtered = filterExistingItems(results, existingItems);
            
            assert.strictEqual(filtered.length, 1);
            assert.strictEqual(filtered[0].path, 'src/file2.ts');
        });
        
        test('should filter out commits that already exist in group', () => {
            const results = [
                createMockResult({ 
                    id: 'commit:abc123',
                    type: 'commit',
                    commit: {
                        hash: 'abc123',
                        shortHash: 'abc123',
                        subject: 'feat: existing',
                        authorName: 'Test',
                        date: new Date().toISOString(),
                        repositoryRoot: '/test'
                    }
                }),
                createMockResult({ 
                    id: 'commit:def456',
                    type: 'commit',
                    commit: {
                        hash: 'def456',
                        shortHash: 'def456',
                        subject: 'feat: new',
                        authorName: 'Test',
                        date: new Date().toISOString(),
                        repositoryRoot: '/test'
                    }
                })
            ];
            
            const existingItems = {
                filePaths: new Set<string>(),
                commitHashes: new Set(['abc123'])
            };
            
            const filtered = filterExistingItems(results, existingItems);
            
            assert.strictEqual(filtered.length, 1);
            assert.strictEqual(filtered[0].commit?.hash, 'def456');
        });
        
        test('should filter out both files and commits', () => {
            const results = [
                createMockResult({ id: 'file:1', path: 'existing.ts' }),
                createMockResult({ id: 'file:2', path: 'new.ts' }),
                createMockResult({ 
                    id: 'commit:existing',
                    type: 'commit',
                    commit: {
                        hash: 'existing',
                        shortHash: 'existin',
                        subject: 'existing commit',
                        authorName: 'Test',
                        date: new Date().toISOString(),
                        repositoryRoot: '/test'
                    }
                }),
                createMockResult({ 
                    id: 'commit:new',
                    type: 'commit',
                    commit: {
                        hash: 'new',
                        shortHash: 'new',
                        subject: 'new commit',
                        authorName: 'Test',
                        date: new Date().toISOString(),
                        repositoryRoot: '/test'
                    }
                })
            ];
            
            const existingItems = {
                filePaths: new Set(['existing.ts']),
                commitHashes: new Set(['existing'])
            };
            
            const filtered = filterExistingItems(results, existingItems);
            
            assert.strictEqual(filtered.length, 2);
            assert.ok(filtered.some(r => r.path === 'new.ts'));
            assert.ok(filtered.some(r => r.commit?.hash === 'new'));
        });
        
        test('should keep all results when nothing exists in group', () => {
            const results = [
                createMockResult({ id: 'file:1', path: 'file1.ts' }),
                createMockResult({ id: 'file:2', path: 'file2.ts' })
            ];
            
            const existingItems = {
                filePaths: new Set<string>(),
                commitHashes: new Set<string>()
            };
            
            const filtered = filterExistingItems(results, existingItems);
            
            assert.strictEqual(filtered.length, 2);
        });
        
        test('should filter all results when all exist in group', () => {
            const results = [
                createMockResult({ id: 'file:1', path: 'file1.ts' }),
                createMockResult({ id: 'file:2', path: 'file2.ts' })
            ];
            
            const existingItems = {
                filePaths: new Set(['file1.ts', 'file2.ts']),
                commitHashes: new Set<string>()
            };
            
            const filtered = filterExistingItems(results, existingItems);
            
            assert.strictEqual(filtered.length, 0);
        });
        
        test('should handle results without path or commit', () => {
            const results = [
                createMockResult({ id: 'file:1', path: 'file1.ts' }),
                createMockResult({ id: 'unknown', path: undefined, commit: undefined })
            ];
            
            const existingItems = {
                filePaths: new Set<string>(),
                commitHashes: new Set<string>()
            };
            
            const filtered = filterExistingItems(results, existingItems);
            
            // Both should be kept - the one with path and the one without
            assert.strictEqual(filtered.length, 2);
        });
    });
    
    suite('Integration: Complete Workflow', () => {
        
        test('should correctly process discovery results for a target group', () => {
            // Create a group with some existing items
            const group = createMockGroup('Feature X', 
                [{ name: 'existing.ts', path: 'src/existing.ts', type: 'file' }],
                [
                    createMockGroup('Commits', [
                        { 
                            name: 'old commit', 
                            type: 'commit',
                            commitRef: { hash: 'old123', repositoryRoot: '/test' }
                        }
                    ])
                ]
            );
            
            // Create discovery results with mixed types
            const results = [
                createMockResult({ type: 'file', path: 'src/existing.ts', name: 'existing.ts' }),
                createMockResult({ type: 'file', path: 'src/new.ts', name: 'new.ts' }),
                createMockResult({ type: 'doc', path: 'docs/README.md', name: 'README.md' }),
                createMockResult({ 
                    type: 'commit',
                    commit: {
                        hash: 'old123',
                        shortHash: 'old123',
                        subject: 'old commit',
                        authorName: 'Test',
                        date: new Date().toISOString(),
                        repositoryRoot: '/test'
                    }
                }),
                createMockResult({ 
                    type: 'commit',
                    commit: {
                        hash: 'new456',
                        shortHash: 'new456',
                        subject: 'new commit',
                        authorName: 'Test',
                        date: new Date().toISOString(),
                        repositoryRoot: '/test'
                    }
                })
            ];
            
            // Step 1: Collect existing items
            const existingItems = collectExistingItems(group);
            
            // Step 2: Filter out existing items
            const filteredResults = filterExistingItems(results, existingItems);
            
            // Step 3: Group by type
            const grouped = groupResultsByType(filteredResults);
            
            // Verify: should have 1 new file, 1 doc, 1 new commit
            assert.strictEqual(filteredResults.length, 3, 'Should filter out 2 existing items');
            assert.strictEqual(grouped.sourceResults.length, 1, 'Should have 1 source file');
            assert.strictEqual(grouped.docResults.length, 1, 'Should have 1 doc');
            assert.strictEqual(grouped.commitResults.length, 1, 'Should have 1 commit');
            
            // Verify the correct items are in each group
            assert.strictEqual(grouped.sourceResults[0].path, 'src/new.ts');
            assert.strictEqual(grouped.docResults[0].path, 'docs/README.md');
            assert.strictEqual(grouped.commitResults[0].commit?.hash, 'new456');
        });
        
        test('should handle discovery triggered from nested group', () => {
            const process = createMockProcess({
                targetGroupPath: 'Parent/Child/Grandchild',
                featureDescription: 'Test feature'
            });
            
            // Verify the path is preserved
            assert.strictEqual(process.targetGroupPath, 'Parent/Child/Grandchild');
            
            // Serialize and deserialize
            const serialized = serializeDiscoveryProcess(process);
            const deserialized = deserializeDiscoveryProcess(serialized);
            
            assert.strictEqual(deserialized.targetGroupPath, 'Parent/Child/Grandchild');
        });
    });
});

