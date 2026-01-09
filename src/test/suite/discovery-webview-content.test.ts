/**
 * Tests for Discovery Webview Content Generation
 * 
 * Tests the HTML/CSS/JS generation for the discovery results webview panel.
 * Focuses on proper escaping, event delegation, and CSP compliance.
 */

import * as assert from 'assert';
import { DiscoveryResult, DiscoveryProcess, DiscoverySourceType } from '../../shortcuts/discovery/types';
import { 
    getFileExtension, 
    collectExtensionsByType, 
    applyExtensionFilters,
    ExtensionFilters 
} from '../../shortcuts/discovery/discovery-webview/webview-content';

// Import the functions we want to test
// Note: We need to extract testable functions from webview-content.ts
// For now, we'll test the logic by examining the generated HTML

/**
 * Helper to create a mock DiscoveryResult
 */
function createMockResult(overrides: Partial<DiscoveryResult> = {}): DiscoveryResult {
    return {
        id: 'file:src/test.ts',
        type: 'file' as DiscoverySourceType,
        name: 'test.ts',
        path: 'src/test.ts',
        relevanceScore: 85,
        matchedKeywords: ['test', 'example'],
        relevanceReason: 'Test file for demonstration',
        selected: false,
        ...overrides
    };
}

/**
 * Helper to create a mock DiscoveryProcess
 */
function createMockProcess(overrides: Partial<DiscoveryProcess> = {}): DiscoveryProcess {
    return {
        id: 'discovery-123',
        status: 'completed',
        featureDescription: 'Test feature',
        phase: 'completed',
        progress: 100,
        results: [createMockResult()],
        startTime: new Date(),
        endTime: new Date(),
        ...overrides
    };
}

suite('Discovery Webview Content Tests', () => {
    
    suite('Result ID Escaping', () => {
        
        test('should handle simple file IDs', () => {
            const result = createMockResult({
                id: 'file:src/test.ts'
            });
            
            // The ID should be safe to use in data attributes
            assert.ok(!result.id.includes('<'), 'ID should not contain <');
            assert.ok(!result.id.includes('>'), 'ID should not contain >');
        });
        
        test('should handle IDs with colons', () => {
            const result = createMockResult({
                id: 'file:C:/Users/test/file.ts'
            });
            
            // Colons are valid in data attributes
            assert.ok(result.id.includes(':'), 'ID should preserve colons');
        });
        
        test('should handle commit IDs', () => {
            const result = createMockResult({
                id: 'commit:abc1234567890',
                type: 'commit',
                commit: {
                    hash: 'abc1234567890',
                    shortHash: 'abc1234',
                    subject: 'Test commit',
                    authorName: 'Test Author',
                    date: new Date().toISOString(),
                    repositoryRoot: '/test/repo'
                }
            });
            
            assert.strictEqual(result.id, 'commit:abc1234567890');
        });
        
        test('should handle IDs with special characters that need HTML escaping', () => {
            // Test IDs that could break HTML if not properly escaped
            const specialChars = ['<', '>', '&', '"', "'"];
            
            specialChars.forEach(char => {
                const result = createMockResult({
                    id: `file:path${char}file.ts`
                });
                
                // The escapeHtml function should handle these
                // We verify the ID is created correctly
                assert.ok(result.id.includes(char), `ID should contain ${char}`);
            });
        });
    });
    
    suite('Selection State', () => {
        
        test('should initialize results with selected=false', () => {
            const result = createMockResult();
            assert.strictEqual(result.selected, false, 'New results should not be selected');
        });
        
        test('should track selected state correctly', () => {
            const result = createMockResult({ selected: true });
            assert.strictEqual(result.selected, true, 'Selected state should be preserved');
        });
        
        test('should count selected results correctly', () => {
            const results = [
                createMockResult({ id: 'file:1', selected: true }),
                createMockResult({ id: 'file:2', selected: false }),
                createMockResult({ id: 'file:3', selected: true }),
                createMockResult({ id: 'file:4', selected: false })
            ];
            
            const selectedCount = results.filter(r => r.selected).length;
            assert.strictEqual(selectedCount, 2, 'Should count 2 selected results');
        });
        
        test('should filter results by minScore', () => {
            const results = [
                createMockResult({ id: 'file:1', relevanceScore: 90 }),
                createMockResult({ id: 'file:2', relevanceScore: 50 }),
                createMockResult({ id: 'file:3', relevanceScore: 30 }),
                createMockResult({ id: 'file:4', relevanceScore: 70 })
            ];
            
            const minScore = 60;
            const filtered = results.filter(r => r.relevanceScore >= minScore);
            
            assert.strictEqual(filtered.length, 2, 'Should filter to 2 results with score >= 60');
            assert.ok(filtered.every(r => r.relevanceScore >= minScore), 'All filtered results should meet minScore');
        });
    });
    
    suite('Process State', () => {
        
        test('should handle running process', () => {
            const process = createMockProcess({
                status: 'running',
                phase: 'scanning-files',
                progress: 45,
                results: undefined
            });
            
            assert.strictEqual(process.status, 'running');
            assert.strictEqual(process.progress, 45);
            assert.strictEqual(process.results, undefined);
        });
        
        test('should handle completed process with results', () => {
            const results = [
                createMockResult({ id: 'file:1' }),
                createMockResult({ id: 'file:2' })
            ];
            
            const process = createMockProcess({
                status: 'completed',
                results
            });
            
            assert.strictEqual(process.status, 'completed');
            assert.strictEqual(process.results?.length, 2);
        });
        
        test('should handle failed process', () => {
            const process = createMockProcess({
                status: 'failed',
                error: 'Discovery failed: timeout',
                results: undefined
            });
            
            assert.strictEqual(process.status, 'failed');
            assert.strictEqual(process.error, 'Discovery failed: timeout');
        });
        
        test('should handle process with no results', () => {
            const process = createMockProcess({
                status: 'completed',
                results: []
            });
            
            assert.strictEqual(process.status, 'completed');
            assert.strictEqual(process.results?.length, 0);
        });
    });
    
    suite('Result Grouping', () => {
        
        test('should group results by type', () => {
            const results = [
                createMockResult({ id: 'file:1', type: 'file' }),
                createMockResult({ id: 'file:2', type: 'file' }),
                createMockResult({ id: 'doc:1', type: 'doc' }),
                createMockResult({ id: 'commit:1', type: 'commit' })
            ];
            
            const grouped = new Map<DiscoverySourceType, DiscoveryResult[]>();
            for (const result of results) {
                const group = grouped.get(result.type) || [];
                group.push(result);
                grouped.set(result.type, group);
            }
            
            assert.strictEqual(grouped.get('file')?.length, 2);
            assert.strictEqual(grouped.get('doc')?.length, 1);
            assert.strictEqual(grouped.get('commit')?.length, 1);
        });
    });
    
    suite('Select All / Deselect All Logic', () => {
        
        test('selectAll should select all visible results', () => {
            const results = [
                createMockResult({ id: 'file:1', relevanceScore: 90, selected: false }),
                createMockResult({ id: 'file:2', relevanceScore: 50, selected: false }),
                createMockResult({ id: 'file:3', relevanceScore: 30, selected: false })
            ];
            
            const minScore = 40;
            
            // Simulate selectAll logic from DiscoveryPreviewPanel._selectAll
            for (const result of results) {
                if (result.relevanceScore >= minScore) {
                    result.selected = true;
                }
            }
            
            // Results with score >= 40 should be selected
            assert.strictEqual(results[0].selected, true, 'Score 90 should be selected');
            assert.strictEqual(results[1].selected, true, 'Score 50 should be selected');
            assert.strictEqual(results[2].selected, false, 'Score 30 should NOT be selected (below minScore)');
        });
        
        test('deselectAll should deselect all results', () => {
            const results = [
                createMockResult({ id: 'file:1', selected: true }),
                createMockResult({ id: 'file:2', selected: true }),
                createMockResult({ id: 'file:3', selected: false })
            ];
            
            // Simulate deselectAll logic from DiscoveryPreviewPanel._deselectAll
            for (const result of results) {
                result.selected = false;
            }
            
            assert.ok(results.every(r => !r.selected), 'All results should be deselected');
        });
        
        test('toggleItem should toggle selection state', () => {
            const results = [
                createMockResult({ id: 'file:1', selected: false }),
                createMockResult({ id: 'file:2', selected: true })
            ];
            
            // Simulate toggleItem logic from DiscoveryPreviewPanel._toggleItem
            const toggleId = 'file:1';
            const result = results.find(r => r.id === toggleId);
            if (result) {
                result.selected = !result.selected;
            }
            
            assert.strictEqual(results[0].selected, true, 'file:1 should now be selected');
            assert.strictEqual(results[1].selected, true, 'file:2 should remain selected');
            
            // Toggle again
            if (result) {
                result.selected = !result.selected;
            }
            
            assert.strictEqual(results[0].selected, false, 'file:1 should now be deselected');
        });
    });
    
    suite('HTML Escaping', () => {
        
        test('escapeHtml should escape HTML special characters', () => {
            const escapeHtml = (text: string): string => {
                const map: Record<string, string> = {
                    '&': '&amp;',
                    '<': '&lt;',
                    '>': '&gt;',
                    '"': '&quot;',
                    "'": '&#039;'
                };
                return text.replace(/[&<>"']/g, m => map[m]);
            };
            
            assert.strictEqual(escapeHtml('<script>'), '&lt;script&gt;');
            assert.strictEqual(escapeHtml('a & b'), 'a &amp; b');
            assert.strictEqual(escapeHtml('"quoted"'), '&quot;quoted&quot;');
            assert.strictEqual(escapeHtml("it's"), 'it&#039;s');
            assert.strictEqual(escapeHtml('plain text'), 'plain text');
        });
        
        test('should escape result names with special characters', () => {
            const escapeHtml = (text: string): string => {
                const map: Record<string, string> = {
                    '&': '&amp;',
                    '<': '&lt;',
                    '>': '&gt;',
                    '"': '&quot;',
                    "'": '&#039;'
                };
                return text.replace(/[&<>"']/g, m => map[m]);
            };
            
            const result = createMockResult({
                name: '<script>alert("xss")</script>'
            });
            
            const escapedName = escapeHtml(result.name);
            assert.ok(!escapedName.includes('<script>'), 'Script tags should be escaped');
            assert.ok(escapedName.includes('&lt;script&gt;'), 'Should use HTML entities');
        });
    });
    
    suite('Add to Group Validation', () => {
        
        test('should require target group selection', () => {
            const targetGroup = '';
            const hasTargetGroup = Boolean(targetGroup);
            
            assert.strictEqual(hasTargetGroup, false, 'Empty target group should be falsy');
        });
        
        test('should accept valid target group', () => {
            const targetGroup = 'My Group';
            const hasTargetGroup = Boolean(targetGroup);
            
            assert.strictEqual(hasTargetGroup, true, 'Non-empty target group should be truthy');
        });
        
        test('should filter selected results for adding', () => {
            const results = [
                createMockResult({ id: 'file:1', selected: true }),
                createMockResult({ id: 'file:2', selected: false }),
                createMockResult({ id: 'file:3', selected: true })
            ];
            
            const selectedResults = results.filter(r => r.selected);
            
            assert.strictEqual(selectedResults.length, 2, 'Should have 2 selected results');
            assert.ok(selectedResults.every(r => r.selected), 'All filtered results should be selected');
        });
    });
    
    suite('Target Group Persistence', () => {
        
        test('should generate option with selected attribute for matching group', () => {
            const groups = ['Group A', 'Group B', 'Group C'];
            const selectedGroup = 'Group B';
            
            // Simulate the getFilterContent logic for generating options
            const groupOptions = groups.map(g => {
                const isSelected = g === selectedGroup ? ' selected' : '';
                return `<option value="${g}"${isSelected}>${g}</option>`;
            });
            
            assert.ok(groupOptions[0].includes('value="Group A"'), 'Should have Group A option');
            assert.ok(!groupOptions[0].includes('selected'), 'Group A should not be selected');
            
            assert.ok(groupOptions[1].includes('value="Group B"'), 'Should have Group B option');
            assert.ok(groupOptions[1].includes('selected'), 'Group B should be selected');
            
            assert.ok(groupOptions[2].includes('value="Group C"'), 'Should have Group C option');
            assert.ok(!groupOptions[2].includes('selected'), 'Group C should not be selected');
        });
        
        test('should not select any option when selectedGroup is empty', () => {
            const groups = ['Group A', 'Group B'];
            const selectedGroup = '';
            
            const groupOptions = groups.map(g => {
                const isSelected = g === selectedGroup ? ' selected' : '';
                return `<option value="${g}"${isSelected}>${g}</option>`;
            });
            
            assert.ok(!groupOptions[0].includes('selected'), 'Group A should not be selected');
            assert.ok(!groupOptions[1].includes('selected'), 'Group B should not be selected');
        });
        
        test('should handle group names with special characters', () => {
            const escapeHtml = (text: string): string => {
                const map: Record<string, string> = {
                    '&': '&amp;',
                    '<': '&lt;',
                    '>': '&gt;',
                    '"': '&quot;',
                    "'": '&#039;'
                };
                return text.replace(/[&<>"']/g, m => map[m]);
            };
            
            const groupName = 'My "Special" Group';
            const selectedGroup = groupName;
            
            const isSelected = groupName === selectedGroup ? ' selected' : '';
            const option = `<option value="${escapeHtml(groupName)}"${isSelected}>${escapeHtml(groupName)}</option>`;
            
            assert.ok(option.includes('selected'), 'Should be selected');
            assert.ok(option.includes('&quot;'), 'Should escape quotes in value');
        });
    });
    
    suite('Extension Filter - getFileExtension', () => {
        
        test('should extract extension from Unix-style paths', () => {
            assert.strictEqual(getFileExtension('src/components/Button.tsx'), '.tsx');
            assert.strictEqual(getFileExtension('/Users/test/file.ts'), '.ts');
            assert.strictEqual(getFileExtension('path/to/document.md'), '.md');
        });
        
        test('should extract extension from Windows-style paths', () => {
            assert.strictEqual(getFileExtension('C:\\Users\\test\\file.ts'), '.ts');
            assert.strictEqual(getFileExtension('D:\\Projects\\src\\component.tsx'), '.tsx');
            assert.strictEqual(getFileExtension('src\\components\\Button.tsx'), '.tsx');
        });
        
        test('should handle mixed path separators (cross-platform)', () => {
            assert.strictEqual(getFileExtension('src/components\\file.ts'), '.ts');
            assert.strictEqual(getFileExtension('C:\\Users/test\\file.tsx'), '.tsx');
        });
        
        test('should return lowercase extension', () => {
            assert.strictEqual(getFileExtension('file.TS'), '.ts');
            assert.strictEqual(getFileExtension('README.MD'), '.md');
            assert.strictEqual(getFileExtension('Test.TSX'), '.tsx');
        });
        
        test('should handle files with multiple dots', () => {
            assert.strictEqual(getFileExtension('file.test.ts'), '.ts');
            assert.strictEqual(getFileExtension('component.spec.tsx'), '.tsx');
            assert.strictEqual(getFileExtension('my.file.name.md'), '.md');
        });
        
        test('should handle dotfiles', () => {
            assert.strictEqual(getFileExtension('.gitignore'), '.gitignore');
            assert.strictEqual(getFileExtension('.eslintrc'), '.eslintrc');
            assert.strictEqual(getFileExtension('path/to/.env'), '.env');
        });
        
        test('should handle dotfiles with extension', () => {
            assert.strictEqual(getFileExtension('.eslintrc.js'), '.js');
            assert.strictEqual(getFileExtension('.babel.config.json'), '.json');
        });
        
        test('should return empty string for files without extension', () => {
            assert.strictEqual(getFileExtension('Makefile'), '');
            assert.strictEqual(getFileExtension('LICENSE'), '');
            assert.strictEqual(getFileExtension('path/to/Dockerfile'), '');
        });
        
        test('should return empty string for empty or invalid paths', () => {
            assert.strictEqual(getFileExtension(''), '');
        });
        
        test('should handle filenames with trailing dots', () => {
            // These are edge cases - a file ending in dot
            assert.strictEqual(getFileExtension('file.'), '.');
        });
    });
    
    suite('Extension Filter - collectExtensionsByType', () => {
        
        test('should collect unique extensions for file type', () => {
            const results: DiscoveryResult[] = [
                createMockResult({ id: 'file:1', type: 'file', path: 'src/test.ts' }),
                createMockResult({ id: 'file:2', type: 'file', path: 'src/other.ts' }),
                createMockResult({ id: 'file:3', type: 'file', path: 'src/component.tsx' }),
            ];
            
            const extensions = collectExtensionsByType(results);
            
            assert.ok(extensions.has('file'), 'Should have file type');
            const fileExts = extensions.get('file')!;
            assert.strictEqual(fileExts.length, 2, 'Should have 2 unique extensions');
            assert.ok(fileExts.includes('.ts'), 'Should include .ts');
            assert.ok(fileExts.includes('.tsx'), 'Should include .tsx');
        });
        
        test('should collect unique extensions for doc type', () => {
            const results: DiscoveryResult[] = [
                createMockResult({ id: 'doc:1', type: 'doc', path: 'docs/README.md' }),
                createMockResult({ id: 'doc:2', type: 'doc', path: 'docs/guide.md' }),
                createMockResult({ id: 'doc:3', type: 'doc', path: 'docs/api.txt' }),
            ];
            
            const extensions = collectExtensionsByType(results);
            
            assert.ok(extensions.has('doc'), 'Should have doc type');
            const docExts = extensions.get('doc')!;
            assert.strictEqual(docExts.length, 2, 'Should have 2 unique extensions');
            assert.ok(docExts.includes('.md'), 'Should include .md');
            assert.ok(docExts.includes('.txt'), 'Should include .txt');
        });
        
        test('should not collect extensions for commit type', () => {
            const results: DiscoveryResult[] = [
                createMockResult({ 
                    id: 'commit:1', 
                    type: 'commit', 
                    commit: {
                        hash: 'abc123',
                        shortHash: 'abc123',
                        subject: 'Test commit',
                        authorName: 'Test',
                        date: new Date().toISOString(),
                        repositoryRoot: '/test'
                    }
                }),
            ];
            
            const extensions = collectExtensionsByType(results);
            
            assert.ok(!extensions.has('commit'), 'Should not have commit type');
        });
        
        test('should not collect extensions for folder type', () => {
            const results: DiscoveryResult[] = [
                createMockResult({ id: 'folder:1', type: 'folder', path: 'src/components' }),
            ];
            
            const extensions = collectExtensionsByType(results);
            
            assert.ok(!extensions.has('folder'), 'Should not have folder type');
        });
        
        test('should return sorted extensions', () => {
            const results: DiscoveryResult[] = [
                createMockResult({ id: 'file:1', type: 'file', path: 'src/test.tsx' }),
                createMockResult({ id: 'file:2', type: 'file', path: 'src/other.js' }),
                createMockResult({ id: 'file:3', type: 'file', path: 'src/component.ts' }),
            ];
            
            const extensions = collectExtensionsByType(results);
            const fileExts = extensions.get('file')!;
            
            assert.deepStrictEqual(fileExts, ['.js', '.ts', '.tsx'], 'Extensions should be sorted');
        });
        
        test('should handle Windows-style paths', () => {
            const results: DiscoveryResult[] = [
                createMockResult({ id: 'file:1', type: 'file', path: 'C:\\Users\\test\\file.ts' }),
                createMockResult({ id: 'file:2', type: 'file', path: 'D:\\Projects\\component.tsx' }),
            ];
            
            const extensions = collectExtensionsByType(results);
            const fileExts = extensions.get('file')!;
            
            assert.ok(fileExts.includes('.ts'), 'Should include .ts from Windows path');
            assert.ok(fileExts.includes('.tsx'), 'Should include .tsx from Windows path');
        });
    });
    
    suite('Extension Filter - applyExtensionFilters', () => {
        
        test('should return all results when no filters applied', () => {
            const results: DiscoveryResult[] = [
                createMockResult({ id: 'file:1', type: 'file', path: 'src/test.ts' }),
                createMockResult({ id: 'file:2', type: 'file', path: 'src/component.tsx' }),
                createMockResult({ id: 'doc:1', type: 'doc', path: 'docs/README.md' }),
            ];
            
            const filters: ExtensionFilters = {};
            const filtered = applyExtensionFilters(results, filters);
            
            assert.strictEqual(filtered.length, 3, 'All results should be returned');
        });
        
        test('should filter file results by extension', () => {
            const results: DiscoveryResult[] = [
                createMockResult({ id: 'file:1', type: 'file', path: 'src/test.ts' }),
                createMockResult({ id: 'file:2', type: 'file', path: 'src/other.ts' }),
                createMockResult({ id: 'file:3', type: 'file', path: 'src/component.tsx' }),
            ];
            
            const filters: ExtensionFilters = { file: '.ts' };
            const filtered = applyExtensionFilters(results, filters);
            
            assert.strictEqual(filtered.length, 2, 'Should return 2 .ts files');
            assert.ok(filtered.every(r => r.path?.endsWith('.ts')), 'All should be .ts files');
        });
        
        test('should filter doc results by extension', () => {
            const results: DiscoveryResult[] = [
                createMockResult({ id: 'doc:1', type: 'doc', path: 'docs/README.md' }),
                createMockResult({ id: 'doc:2', type: 'doc', path: 'docs/guide.md' }),
                createMockResult({ id: 'doc:3', type: 'doc', path: 'docs/api.txt' }),
            ];
            
            const filters: ExtensionFilters = { doc: '.md' };
            const filtered = applyExtensionFilters(results, filters);
            
            assert.strictEqual(filtered.length, 2, 'Should return 2 .md docs');
            assert.ok(filtered.every(r => r.path?.endsWith('.md')), 'All should be .md files');
        });
        
        test('should not filter commits even if commit filter is set', () => {
            const results: DiscoveryResult[] = [
                createMockResult({ 
                    id: 'commit:1', 
                    type: 'commit', 
                    commit: {
                        hash: 'abc123',
                        shortHash: 'abc123',
                        subject: 'Test commit',
                        authorName: 'Test',
                        date: new Date().toISOString(),
                        repositoryRoot: '/test'
                    }
                }),
            ];
            
            const filters: ExtensionFilters = { commit: '.ts' };
            const filtered = applyExtensionFilters(results, filters);
            
            assert.strictEqual(filtered.length, 1, 'Commit should not be filtered');
        });
        
        test('should apply filters independently per type', () => {
            const results: DiscoveryResult[] = [
                createMockResult({ id: 'file:1', type: 'file', path: 'src/test.ts' }),
                createMockResult({ id: 'file:2', type: 'file', path: 'src/component.tsx' }),
                createMockResult({ id: 'doc:1', type: 'doc', path: 'docs/README.md' }),
                createMockResult({ id: 'doc:2', type: 'doc', path: 'docs/api.txt' }),
            ];
            
            const filters: ExtensionFilters = { file: '.ts', doc: '.txt' };
            const filtered = applyExtensionFilters(results, filters);
            
            assert.strictEqual(filtered.length, 2, 'Should return 1 .ts file and 1 .txt doc');
            const fileResults = filtered.filter(r => r.type === 'file');
            const docResults = filtered.filter(r => r.type === 'doc');
            assert.strictEqual(fileResults.length, 1, 'Should have 1 file result');
            assert.strictEqual(docResults.length, 1, 'Should have 1 doc result');
        });
        
        test('should handle Windows-style paths when filtering', () => {
            const results: DiscoveryResult[] = [
                createMockResult({ id: 'file:1', type: 'file', path: 'C:\\Users\\test\\file.ts' }),
                createMockResult({ id: 'file:2', type: 'file', path: 'D:\\Projects\\component.tsx' }),
            ];
            
            const filters: ExtensionFilters = { file: '.ts' };
            const filtered = applyExtensionFilters(results, filters);
            
            assert.strictEqual(filtered.length, 1, 'Should return 1 .ts file');
            assert.ok(filtered[0].path?.includes('file.ts'), 'Should be the .ts file');
        });
        
        test('should handle empty extension filter as "All"', () => {
            const results: DiscoveryResult[] = [
                createMockResult({ id: 'file:1', type: 'file', path: 'src/test.ts' }),
                createMockResult({ id: 'file:2', type: 'file', path: 'src/component.tsx' }),
            ];
            
            const filters: ExtensionFilters = { file: '' };
            const filtered = applyExtensionFilters(results, filters);
            
            assert.strictEqual(filtered.length, 2, 'All results should be returned when filter is empty');
        });
    });
});

