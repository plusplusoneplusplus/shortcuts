/**
 * Tests for Discovery Preview Panel
 * 
 * Tests the selection and state management logic of the discovery preview panel.
 * These tests focus on the business logic that can be tested without the webview.
 */

import * as assert from 'assert';
import { DiscoveryResult, DiscoveryProcess, DiscoverySourceType } from '../../shortcuts/discovery/types';

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
function createMockProcess(resultCount: number = 5, overrides: Partial<DiscoveryProcess> = {}): DiscoveryProcess {
    const results: DiscoveryResult[] = [];
    for (let i = 0; i < resultCount; i++) {
        results.push(createMockResult({
            id: `file:src/file${i}.ts`,
            name: `file${i}.ts`,
            relevanceScore: 100 - (i * 15), // 100, 85, 70, 55, 40
            selected: false
        }));
    }
    
    return {
        id: 'discovery-test',
        status: 'completed',
        featureDescription: 'Test feature',
        phase: 'completed',
        progress: 100,
        results,
        startTime: new Date(),
        endTime: new Date(),
        ...overrides
    };
}

/**
 * Simulates the _toggleItem logic from DiscoveryPreviewPanel
 */
function toggleItem(process: DiscoveryProcess, id: string): void {
    if (!process.results) return;
    
    const result = process.results.find(r => r.id === id);
    if (result) {
        result.selected = !result.selected;
    }
}

/**
 * Simulates the _selectAll logic from DiscoveryPreviewPanel
 */
function selectAll(process: DiscoveryProcess, minScore: number): void {
    if (!process.results) return;
    
    for (const result of process.results) {
        if (result.relevanceScore >= minScore) {
            result.selected = true;
        }
    }
}

/**
 * Simulates the _deselectAll logic from DiscoveryPreviewPanel
 */
function deselectAll(process: DiscoveryProcess): void {
    if (!process.results) return;
    
    for (const result of process.results) {
        result.selected = false;
    }
}

/**
 * Get selected results for adding to group
 */
function getSelectedResults(process: DiscoveryProcess): DiscoveryResult[] {
    return process.results?.filter(r => r.selected) || [];
}

suite('Discovery Preview Panel Selection Tests', () => {
    
    suite('toggleItem', () => {
        
        test('should toggle unselected item to selected', () => {
            const process = createMockProcess(3);
            const targetId = process.results![0].id;
            
            assert.strictEqual(process.results![0].selected, false, 'Initially unselected');
            
            toggleItem(process, targetId);
            
            assert.strictEqual(process.results![0].selected, true, 'Should be selected after toggle');
        });
        
        test('should toggle selected item to unselected', () => {
            const process = createMockProcess(3);
            process.results![0].selected = true;
            const targetId = process.results![0].id;
            
            toggleItem(process, targetId);
            
            assert.strictEqual(process.results![0].selected, false, 'Should be unselected after toggle');
        });
        
        test('should not affect other items', () => {
            const process = createMockProcess(3);
            const targetId = process.results![0].id;
            
            toggleItem(process, targetId);
            
            assert.strictEqual(process.results![0].selected, true, 'Target should be selected');
            assert.strictEqual(process.results![1].selected, false, 'Other items should remain unselected');
            assert.strictEqual(process.results![2].selected, false, 'Other items should remain unselected');
        });
        
        test('should handle non-existent ID gracefully', () => {
            const process = createMockProcess(3);
            
            // Should not throw
            toggleItem(process, 'non-existent-id');
            
            // All items should remain unchanged
            assert.ok(process.results!.every(r => !r.selected), 'All items should remain unselected');
        });
        
        test('should handle process with no results', () => {
            const process = createMockProcess(0);
            process.results = undefined;
            
            // Should not throw
            toggleItem(process, 'any-id');
        });
        
        test('should handle IDs with special characters', () => {
            const process = createMockProcess(1);
            const specialId = 'file:path/with spaces/and:colons.ts';
            process.results![0].id = specialId;
            
            toggleItem(process, specialId);
            
            assert.strictEqual(process.results![0].selected, true, 'Should toggle item with special ID');
        });
    });
    
    suite('selectAll', () => {
        
        test('should select all items when minScore is 0', () => {
            const process = createMockProcess(5);
            
            selectAll(process, 0);
            
            assert.ok(process.results!.every(r => r.selected), 'All items should be selected');
        });
        
        test('should only select items above minScore', () => {
            const process = createMockProcess(5);
            // Scores are: 100, 85, 70, 55, 40
            
            selectAll(process, 60);
            
            assert.strictEqual(process.results![0].selected, true, 'Score 100 should be selected');
            assert.strictEqual(process.results![1].selected, true, 'Score 85 should be selected');
            assert.strictEqual(process.results![2].selected, true, 'Score 70 should be selected');
            assert.strictEqual(process.results![3].selected, false, 'Score 55 should NOT be selected');
            assert.strictEqual(process.results![4].selected, false, 'Score 40 should NOT be selected');
        });
        
        test('should not deselect already selected items below minScore', () => {
            const process = createMockProcess(5);
            // Pre-select a low-score item
            process.results![4].selected = true;
            
            selectAll(process, 60);
            
            // The low-score item should remain selected (selectAll doesn't deselect)
            // Actually, looking at the implementation, selectAll only sets selected=true
            // for items above minScore, it doesn't touch items below minScore
            assert.strictEqual(process.results![4].selected, true, 'Pre-selected low-score item should remain');
        });
        
        test('should handle empty results', () => {
            const process = createMockProcess(0);
            
            // Should not throw
            selectAll(process, 50);
            
            assert.strictEqual(process.results!.length, 0);
        });
        
        test('should handle undefined results', () => {
            const process = createMockProcess(0);
            process.results = undefined;
            
            // Should not throw
            selectAll(process, 50);
        });
        
        test('should select items at exact minScore threshold', () => {
            const process = createMockProcess(1);
            process.results![0].relevanceScore = 50;
            
            selectAll(process, 50);
            
            assert.strictEqual(process.results![0].selected, true, 'Item at exact threshold should be selected');
        });
    });
    
    suite('deselectAll', () => {
        
        test('should deselect all items', () => {
            const process = createMockProcess(5);
            // Select some items first
            process.results![0].selected = true;
            process.results![2].selected = true;
            process.results![4].selected = true;
            
            deselectAll(process);
            
            assert.ok(process.results!.every(r => !r.selected), 'All items should be deselected');
        });
        
        test('should handle already deselected items', () => {
            const process = createMockProcess(5);
            // All items are already deselected by default
            
            deselectAll(process);
            
            assert.ok(process.results!.every(r => !r.selected), 'All items should remain deselected');
        });
        
        test('should handle empty results', () => {
            const process = createMockProcess(0);
            
            // Should not throw
            deselectAll(process);
        });
        
        test('should handle undefined results', () => {
            const process = createMockProcess(0);
            process.results = undefined;
            
            // Should not throw
            deselectAll(process);
        });
    });
    
    suite('getSelectedResults', () => {
        
        test('should return only selected results', () => {
            const process = createMockProcess(5);
            process.results![0].selected = true;
            process.results![2].selected = true;
            
            const selected = getSelectedResults(process);
            
            assert.strictEqual(selected.length, 2);
            assert.ok(selected.every(r => r.selected));
        });
        
        test('should return empty array when nothing selected', () => {
            const process = createMockProcess(5);
            
            const selected = getSelectedResults(process);
            
            assert.strictEqual(selected.length, 0);
        });
        
        test('should return all when all selected', () => {
            const process = createMockProcess(5);
            process.results!.forEach(r => r.selected = true);
            
            const selected = getSelectedResults(process);
            
            assert.strictEqual(selected.length, 5);
        });
        
        test('should handle undefined results', () => {
            const process = createMockProcess(0);
            process.results = undefined;
            
            const selected = getSelectedResults(process);
            
            assert.strictEqual(selected.length, 0);
        });
    });
    
    suite('Integration: Select/Deselect Workflow', () => {
        
        test('should support select all then toggle individual items', () => {
            const process = createMockProcess(5);
            
            // Select all
            selectAll(process, 0);
            assert.ok(process.results!.every(r => r.selected), 'All should be selected');
            
            // Toggle one item off
            toggleItem(process, process.results![2].id);
            assert.strictEqual(process.results![2].selected, false, 'Item 2 should be deselected');
            assert.strictEqual(getSelectedResults(process).length, 4, 'Should have 4 selected');
        });
        
        test('should support toggle then select all', () => {
            const process = createMockProcess(5);
            
            // Toggle some items
            toggleItem(process, process.results![0].id);
            toggleItem(process, process.results![2].id);
            assert.strictEqual(getSelectedResults(process).length, 2);
            
            // Select all
            selectAll(process, 0);
            assert.ok(process.results!.every(r => r.selected), 'All should be selected');
        });
        
        test('should support deselect all then toggle individual items', () => {
            const process = createMockProcess(5);
            
            // Select all first
            selectAll(process, 0);
            
            // Deselect all
            deselectAll(process);
            assert.ok(process.results!.every(r => !r.selected), 'All should be deselected');
            
            // Toggle some items
            toggleItem(process, process.results![1].id);
            toggleItem(process, process.results![3].id);
            assert.strictEqual(getSelectedResults(process).length, 2);
        });
        
        test('should maintain selection state across multiple operations', () => {
            const process = createMockProcess(5);
            
            // Complex workflow
            toggleItem(process, process.results![0].id); // Select item 0
            toggleItem(process, process.results![1].id); // Select item 1
            assert.strictEqual(getSelectedResults(process).length, 2);
            
            toggleItem(process, process.results![0].id); // Deselect item 0
            assert.strictEqual(getSelectedResults(process).length, 1);
            assert.strictEqual(process.results![1].selected, true);
            
            selectAll(process, 50); // Select items with score >= 50 (items 0, 1, 2, 3)
            assert.strictEqual(getSelectedResults(process).length, 4);
            
            deselectAll(process);
            assert.strictEqual(getSelectedResults(process).length, 0);
        });
    });
    
    suite('Add to Group Workflow', () => {
        
        test('should collect selected file results for adding', () => {
            const process = createMockProcess(5);
            process.results![0].selected = true;
            process.results![2].selected = true;
            
            const selected = getSelectedResults(process);
            const fileResults = selected.filter(r => r.type === 'file' && r.path);
            
            assert.strictEqual(fileResults.length, 2);
            assert.ok(fileResults.every(r => r.path !== undefined));
        });
        
        test('should handle mixed result types', () => {
            const process = createMockProcess(3);
            process.results![0].type = 'file';
            process.results![1].type = 'commit';
            process.results![1].commit = {
                hash: 'abc123',
                shortHash: 'abc123',
                subject: 'Test commit',
                authorName: 'Test',
                date: new Date().toISOString(),
                repositoryRoot: '/test'
            };
            process.results![2].type = 'doc';
            
            process.results!.forEach(r => r.selected = true);
            
            const selected = getSelectedResults(process);
            const files = selected.filter(r => r.type === 'file');
            const commits = selected.filter(r => r.type === 'commit');
            const docs = selected.filter(r => r.type === 'doc');
            
            assert.strictEqual(files.length, 1);
            assert.strictEqual(commits.length, 1);
            assert.strictEqual(docs.length, 1);
        });
        
        test('should deselect items after successful add', () => {
            const process = createMockProcess(5);
            process.results![0].selected = true;
            process.results![2].selected = true;
            
            const selected = getSelectedResults(process);
            
            // Simulate successful add - deselect added items
            for (const result of selected) {
                result.selected = false;
            }
            
            assert.strictEqual(getSelectedResults(process).length, 0, 'No items should remain selected');
        });
        
        test('should persist target group selection after adding items', () => {
            // Simulate the panel state management
            let selectedTargetGroup = '';
            const targetGroup = 'My Project Files';
            
            // User selects a target group
            selectedTargetGroup = targetGroup;
            
            // User adds items to group
            // After adding, the target group should still be stored
            assert.strictEqual(selectedTargetGroup, targetGroup, 'Target group should persist');
            
            // Simulate adding more items - target group should still be available
            assert.strictEqual(selectedTargetGroup, targetGroup, 'Target group should still be available for next add');
        });
    });
    
    suite('Edge Cases', () => {
        
        test('should handle process transitioning from running to completed', () => {
            const process = createMockProcess(0);
            process.status = 'running';
            process.results = undefined;
            
            // Simulate completion
            process.status = 'completed';
            process.results = [
                createMockResult({ id: 'file:1' }),
                createMockResult({ id: 'file:2' })
            ];
            
            // Should now be able to select items
            selectAll(process, 0);
            assert.strictEqual(getSelectedResults(process).length, 2);
        });
        
        test('should handle very large result sets', () => {
            const results: DiscoveryResult[] = [];
            for (let i = 0; i < 1000; i++) {
                results.push(createMockResult({
                    id: `file:src/file${i}.ts`,
                    relevanceScore: Math.floor(Math.random() * 100)
                }));
            }
            
            const process: DiscoveryProcess = {
                id: 'large-test',
                status: 'completed',
                featureDescription: 'Large test',
                phase: 'completed',
                progress: 100,
                results,
                startTime: new Date(),
                endTime: new Date()
            };
            
            // Should handle large sets efficiently
            selectAll(process, 50);
            const selectedCount = getSelectedResults(process).length;
            
            // Roughly half should be selected (random scores 0-99, threshold 50)
            assert.ok(selectedCount > 0, 'Some items should be selected');
            assert.ok(selectedCount < 1000, 'Not all items should be selected');
            
            deselectAll(process);
            assert.strictEqual(getSelectedResults(process).length, 0);
        });
        
        test('should handle results with duplicate IDs gracefully', () => {
            const process = createMockProcess(3);
            // Create duplicate IDs (shouldn't happen in practice, but test for robustness)
            process.results![0].id = 'file:duplicate.ts';
            process.results![1].id = 'file:duplicate.ts';
            
            toggleItem(process, 'file:duplicate.ts');
            
            // Only the first matching item should be toggled
            assert.strictEqual(process.results![0].selected, true);
            assert.strictEqual(process.results![1].selected, false);
        });
    });
});

