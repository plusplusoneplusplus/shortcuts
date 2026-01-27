/**
 * Tests for AI Discovery in Tasks Viewer
 * 
 * Tests the related items functionality for feature folders.
 */

import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
    loadRelatedItems,
    saveRelatedItems,
    hasRelatedItems,
    deleteRelatedItems,
    removeRelatedItem,
    mergeRelatedItems,
    categorizeItem,
    RELATED_ITEMS_FILENAME
} from '../../shortcuts/tasks-viewer/related-items-loader';
import { RelatedItem, RelatedItemsConfig, TaskFolder } from '../../shortcuts/tasks-viewer/types';
import {
    RelatedItemsSectionItem,
    RelatedCategoryItem,
    RelatedFileItem,
    RelatedCommitItem
} from '../../shortcuts/tasks-viewer/related-items-tree-items';

suite('Tasks Discovery - Related Items Loader', () => {
    let tempDir: string;

    setup(() => {
        // Create a unique temp directory for each test
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tasks-discovery-test-'));
    });

    teardown(() => {
        // Clean up temp directory
        if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    test('loadRelatedItems returns undefined when file does not exist', async () => {
        const result = await loadRelatedItems(tempDir);
        assert.strictEqual(result, undefined);
    });

    test('saveRelatedItems creates file with correct content', async () => {
        const config: RelatedItemsConfig = {
            description: 'Test feature',
            items: [
                {
                    name: 'test-file.ts',
                    path: 'src/test-file.ts',
                    type: 'file',
                    category: 'source',
                    relevance: 95,
                    reason: 'Test reason'
                }
            ]
        };

        await saveRelatedItems(tempDir, config);

        const filePath = path.join(tempDir, RELATED_ITEMS_FILENAME);
        assert.strictEqual(fs.existsSync(filePath), true);

        // Load and verify
        const loaded = await loadRelatedItems(tempDir);
        assert.strictEqual(loaded?.description, 'Test feature');
        assert.strictEqual(loaded?.items.length, 1);
        assert.strictEqual(loaded?.items[0].name, 'test-file.ts');
        assert.ok(loaded?.lastUpdated);
    });

    test('hasRelatedItems returns correct value', async () => {
        assert.strictEqual(hasRelatedItems(tempDir), false);

        const config: RelatedItemsConfig = {
            description: 'Test',
            items: []
        };
        await saveRelatedItems(tempDir, config);

        assert.strictEqual(hasRelatedItems(tempDir), true);
    });

    test('deleteRelatedItems removes the file', async () => {
        const config: RelatedItemsConfig = {
            description: 'Test',
            items: []
        };
        await saveRelatedItems(tempDir, config);
        assert.strictEqual(hasRelatedItems(tempDir), true);

        await deleteRelatedItems(tempDir);
        assert.strictEqual(hasRelatedItems(tempDir), false);
    });

    test('removeRelatedItem removes file item by path', async () => {
        const config: RelatedItemsConfig = {
            description: 'Test',
            items: [
                { name: 'file1.ts', path: 'src/file1.ts', type: 'file', category: 'source', relevance: 90, reason: 'R1' },
                { name: 'file2.ts', path: 'src/file2.ts', type: 'file', category: 'source', relevance: 85, reason: 'R2' }
            ]
        };
        await saveRelatedItems(tempDir, config);

        const removed = await removeRelatedItem(tempDir, 'src/file1.ts');
        assert.strictEqual(removed, true);

        const loaded = await loadRelatedItems(tempDir);
        assert.strictEqual(loaded?.items.length, 1);
        assert.strictEqual(loaded?.items[0].path, 'src/file2.ts');
    });

    test('removeRelatedItem removes commit item by hash', async () => {
        const config: RelatedItemsConfig = {
            description: 'Test',
            items: [
                { name: 'file1.ts', path: 'src/file1.ts', type: 'file', category: 'source', relevance: 90, reason: 'R1' },
                { name: 'feat: add feature', type: 'commit', hash: 'abc1234', category: 'commit', relevance: 85, reason: 'R2' }
            ]
        };
        await saveRelatedItems(tempDir, config);

        const removed = await removeRelatedItem(tempDir, 'abc1234');
        assert.strictEqual(removed, true);

        const loaded = await loadRelatedItems(tempDir);
        assert.strictEqual(loaded?.items.length, 1);
        assert.strictEqual(loaded?.items[0].type, 'file');
    });

    test('removeRelatedItem returns false when item not found', async () => {
        const config: RelatedItemsConfig = {
            description: 'Test',
            items: [
                { name: 'file1.ts', path: 'src/file1.ts', type: 'file', category: 'source', relevance: 90, reason: 'R1' }
            ]
        };
        await saveRelatedItems(tempDir, config);

        const removed = await removeRelatedItem(tempDir, 'src/nonexistent.ts');
        assert.strictEqual(removed, false);
    });

    test('mergeRelatedItems creates new file when none exists', async () => {
        const newItems: RelatedItem[] = [
            { name: 'file1.ts', path: 'src/file1.ts', type: 'file', category: 'source', relevance: 90, reason: 'R1' }
        ];

        const result = await mergeRelatedItems(tempDir, newItems, 'Test feature');
        
        assert.strictEqual(result.description, 'Test feature');
        assert.strictEqual(result.items.length, 1);
    });

    test('mergeRelatedItems deduplicates by path', async () => {
        const config: RelatedItemsConfig = {
            description: 'Test',
            items: [
                { name: 'file1.ts', path: 'src/file1.ts', type: 'file', category: 'source', relevance: 90, reason: 'R1' }
            ]
        };
        await saveRelatedItems(tempDir, config);

        const newItems: RelatedItem[] = [
            { name: 'file1.ts', path: 'src/file1.ts', type: 'file', category: 'source', relevance: 95, reason: 'R2' },
            { name: 'file2.ts', path: 'src/file2.ts', type: 'file', category: 'source', relevance: 85, reason: 'R3' }
        ];

        const result = await mergeRelatedItems(tempDir, newItems);
        
        // Should have 2 items (original file1 + new file2, not duplicated file1)
        assert.strictEqual(result.items.length, 2);
    });

    test('mergeRelatedItems deduplicates commits by hash', async () => {
        const config: RelatedItemsConfig = {
            description: 'Test',
            items: [
                { name: 'feat: first', type: 'commit', hash: 'abc1234', category: 'commit', relevance: 90, reason: 'R1' }
            ]
        };
        await saveRelatedItems(tempDir, config);

        const newItems: RelatedItem[] = [
            { name: 'feat: first', type: 'commit', hash: 'abc1234', category: 'commit', relevance: 95, reason: 'R2' },
            { name: 'feat: second', type: 'commit', hash: 'def5678', category: 'commit', relevance: 85, reason: 'R3' }
        ];

        const result = await mergeRelatedItems(tempDir, newItems);
        
        assert.strictEqual(result.items.length, 2);
    });
});

suite('Tasks Discovery - categorizeItem', () => {
    test('categorizes test files correctly', () => {
        assert.strictEqual(categorizeItem('src/test/auth.test.ts'), 'test');
        assert.strictEqual(categorizeItem('src/tests/auth.spec.ts'), 'test');
        assert.strictEqual(categorizeItem('src/__tests__/auth.ts'), 'test');
        assert.strictEqual(categorizeItem('src/auth_test.py'), 'test');
    });

    test('categorizes documentation files correctly', () => {
        assert.strictEqual(categorizeItem('docs/readme.md'), 'doc');
        assert.strictEqual(categorizeItem('README.md'), 'doc');
        assert.strictEqual(categorizeItem('src/auth.txt'), 'doc');
    });

    test('categorizes config files correctly', () => {
        assert.strictEqual(categorizeItem('package.json'), 'config');
        assert.strictEqual(categorizeItem('tsconfig.json'), 'config');
        assert.strictEqual(categorizeItem('.eslintrc.js'), 'config');
        assert.strictEqual(categorizeItem('config.yaml'), 'config');
    });

    test('categorizes source files correctly', () => {
        assert.strictEqual(categorizeItem('src/auth/service.ts'), 'source');
        assert.strictEqual(categorizeItem('src/utils/helper.js'), 'source');
        assert.strictEqual(categorizeItem('lib/core.py'), 'source');
    });
});

suite('Tasks Discovery - Tree Items', () => {
    test('RelatedItemsSectionItem has correct properties', () => {
        const config: RelatedItemsConfig = {
            description: 'Auth feature',
            items: [
                { name: 'file1.ts', path: 'src/file1.ts', type: 'file', category: 'source', relevance: 90, reason: 'R1' },
                { name: 'file2.ts', path: 'src/file2.ts', type: 'file', category: 'test', relevance: 85, reason: 'R2' }
            ]
        };

        const item = new RelatedItemsSectionItem('/path/to/folder', config);

        assert.strictEqual(item.label, 'Related Items (2)');
        assert.strictEqual(item.contextValue, 'relatedItemsSection');
        assert.strictEqual(item.folderPath, '/path/to/folder');
        assert.strictEqual(item.config, config);
    });

    test('RelatedCategoryItem has correct properties', () => {
        const items: RelatedItem[] = [
            { name: 'file1.ts', path: 'src/file1.ts', type: 'file', category: 'source', relevance: 90, reason: 'R1' },
            { name: 'file2.ts', path: 'src/file2.ts', type: 'file', category: 'source', relevance: 85, reason: 'R2' }
        ];

        const item = new RelatedCategoryItem('source', items, '/path/to/folder');

        assert.strictEqual(item.label, 'Source (2)');
        assert.strictEqual(item.contextValue, 'relatedCategory');
        assert.strictEqual(item.category, 'source');
        assert.strictEqual(item.items.length, 2);
    });

    test('RelatedFileItem has correct properties', () => {
        const relatedItem: RelatedItem = {
            name: 'auth-service.ts',
            path: 'src/auth/auth-service.ts',
            type: 'file',
            category: 'source',
            relevance: 95,
            reason: 'Core auth implementation'
        };

        const item = new RelatedFileItem(relatedItem, '/path/to/folder', '/workspace');

        assert.strictEqual(item.label, 'auth-service.ts');
        assert.strictEqual(item.contextValue, 'relatedFile');
        assert.ok(item.tooltip?.toString().includes('Core auth implementation'));
        assert.strictEqual(item.description, 'src/auth/auth-service.ts');
    });

    test('RelatedCommitItem has correct properties', () => {
        const relatedItem: RelatedItem = {
            name: 'feat: add JWT refresh tokens',
            type: 'commit',
            hash: 'abc1234567890',
            category: 'commit',
            relevance: 88,
            reason: 'Recent feature addition'
        };

        const item = new RelatedCommitItem(relatedItem, '/path/to/folder', '/workspace');

        assert.strictEqual(item.label, 'abc1234 - feat: add JWT refresh tokens');
        assert.strictEqual(item.contextValue, 'relatedCommit');
        assert.ok(item.tooltip?.toString().includes('Recent feature addition'));
    });
});

suite('Tasks Discovery - TaskFolder with relatedItems', () => {
    test('TaskFolder type accepts relatedItems property', () => {
        const config: RelatedItemsConfig = {
            description: 'Auth feature',
            items: [
                { name: 'file1.ts', path: 'src/file1.ts', type: 'file', category: 'source', relevance: 90, reason: 'R1' }
            ]
        };

        const folder: TaskFolder = {
            name: 'auth',
            folderPath: '/workspace/.vscode/tasks/auth',
            relativePath: 'auth',
            isArchived: false,
            children: [],
            tasks: [],
            documentGroups: [],
            singleDocuments: [],
            relatedItems: config
        };

        assert.strictEqual(folder.relatedItems?.items.length, 1);
        assert.strictEqual(folder.relatedItems?.description, 'Auth feature');
    });

    test('TaskFolder type works without relatedItems', () => {
        const folder: TaskFolder = {
            name: 'auth',
            folderPath: '/workspace/.vscode/tasks/auth',
            relativePath: 'auth',
            isArchived: false,
            children: [],
            tasks: [],
            documentGroups: [],
            singleDocuments: []
        };

        assert.strictEqual(folder.relatedItems, undefined);
    });
});
