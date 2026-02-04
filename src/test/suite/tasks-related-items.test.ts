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

    test('RelatedFileItem uses vscode.open for non-markdown files', () => {
        const relatedItem: RelatedItem = {
            name: 'auth-service.ts',
            path: 'src/auth/auth-service.ts',
            type: 'file',
            category: 'source',
            relevance: 95,
            reason: 'Core auth implementation'
        };

        const item = new RelatedFileItem(relatedItem, '/path/to/folder', '/workspace');

        assert.strictEqual(item.command?.command, 'vscode.open');
        assert.strictEqual(item.command?.title, 'Open File');
    });

    test('RelatedFileItem uses vscode.openWith for markdown files', () => {
        const relatedItem: RelatedItem = {
            name: 'README.md',
            path: 'docs/README.md',
            type: 'file',
            category: 'doc',
            relevance: 80,
            reason: 'Documentation'
        };

        const item = new RelatedFileItem(relatedItem, '/path/to/folder', '/workspace');

        assert.strictEqual(item.command?.command, 'vscode.openWith');
        assert.strictEqual(item.command?.title, 'Open Document');
        assert.strictEqual(item.command?.arguments?.[1], 'reviewEditorView');
    });

    test('RelatedFileItem handles uppercase .MD extension', () => {
        const relatedItem: RelatedItem = {
            name: 'DESIGN.MD',
            path: 'docs/DESIGN.MD',
            type: 'file',
            category: 'doc',
            relevance: 75,
            reason: 'Design document'
        };

        const item = new RelatedFileItem(relatedItem, '/path/to/folder', '/workspace');

        assert.strictEqual(item.command?.command, 'vscode.openWith');
        assert.strictEqual(item.command?.arguments?.[1], 'reviewEditorView');
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

    test('RelatedCommitItem exposes full hash for copy command', () => {
        const relatedItem: RelatedItem = {
            name: 'feat: add JWT refresh tokens',
            type: 'commit',
            hash: 'abc1234567890def1234567890',
            category: 'commit',
            relevance: 88,
            reason: 'Recent feature addition'
        };

        const item = new RelatedCommitItem(relatedItem, '/path/to/folder', '/workspace');

        // The full hash should be accessible via relatedItem.hash
        assert.strictEqual(item.relatedItem.hash, 'abc1234567890def1234567890');
        // Label shows short hash (7 chars)
        assert.ok(item.label?.toString().startsWith('abc1234'));
    });

    test('RelatedCommitItem without hash handles gracefully', () => {
        const relatedItem: RelatedItem = {
            name: 'commit without hash',
            type: 'commit',
            category: 'commit',
            relevance: 50,
            reason: 'Test'
        };

        const item = new RelatedCommitItem(relatedItem, '/path/to/folder', '/workspace');

        assert.strictEqual(item.relatedItem.hash, undefined);
        assert.strictEqual(item.contextValue, 'relatedCommit');
        // Should not have a command since hash is missing
        assert.strictEqual(item.command, undefined);
    });

    test('RelatedCommitItem has viewRelatedCommit command', () => {
        const relatedItem: RelatedItem = {
            name: 'feat: add feature',
            type: 'commit',
            hash: 'abc1234567890',
            category: 'commit',
            relevance: 88,
            reason: 'Feature commit'
        };

        const item = new RelatedCommitItem(relatedItem, '/path/to/folder', '/workspace');

        assert.strictEqual(item.command?.command, 'tasksViewer.viewRelatedCommit');
        assert.deepStrictEqual(item.command?.arguments, ['abc1234567890', '/workspace']);
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

suite('Tasks Discovery - TaskManager.getFeatureFolders', () => {
    let tempDir: string;
    let TaskManager: typeof import('../../shortcuts/tasks-viewer/task-manager').TaskManager;

    setup(async () => {
        // Create a unique temp directory for each test
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tasks-feature-folders-test-'));
        
        // Dynamically import TaskManager
        const module = await import('../../shortcuts/tasks-viewer/task-manager');
        TaskManager = module.TaskManager;
    });

    teardown(() => {
        // Clean up temp directory
        if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    test('getFeatureFolders returns empty array when no folders exist', async () => {
        const tasksDir = path.join(tempDir, '.vscode', 'tasks');
        fs.mkdirSync(tasksDir, { recursive: true });

        const manager = new TaskManager(tempDir);
        const folders = await manager.getFeatureFolders();

        assert.deepStrictEqual(folders, []);
    });

    test('getFeatureFolders returns feature folders', async () => {
        const tasksDir = path.join(tempDir, '.vscode', 'tasks');
        fs.mkdirSync(path.join(tasksDir, 'feature1'), { recursive: true });
        fs.mkdirSync(path.join(tasksDir, 'feature2'), { recursive: true });

        const manager = new TaskManager(tempDir);
        const folders = await manager.getFeatureFolders();

        assert.strictEqual(folders.length, 2);
        assert.ok(folders.some(f => f.displayName === 'feature1'));
        assert.ok(folders.some(f => f.displayName === 'feature2'));
    });

    test('getFeatureFolders excludes archive folder', async () => {
        const tasksDir = path.join(tempDir, '.vscode', 'tasks');
        fs.mkdirSync(path.join(tasksDir, 'feature1'), { recursive: true });
        fs.mkdirSync(path.join(tasksDir, 'archive'), { recursive: true });

        const manager = new TaskManager(tempDir);
        const folders = await manager.getFeatureFolders();

        assert.strictEqual(folders.length, 1);
        assert.strictEqual(folders[0].displayName, 'feature1');
    });

    test('getFeatureFolders returns nested folders with proper display names', async () => {
        const tasksDir = path.join(tempDir, '.vscode', 'tasks');
        fs.mkdirSync(path.join(tasksDir, 'feature1', 'subfolder'), { recursive: true });

        const manager = new TaskManager(tempDir);
        const folders = await manager.getFeatureFolders();

        assert.strictEqual(folders.length, 2);
        assert.ok(folders.some(f => f.displayName === 'feature1'));
        // Path.join uses OS separator, but display name uses forward slash
        assert.ok(folders.some(f => f.relativePath === path.join('feature1', 'subfolder')));
    });
});

suite('Tasks Discovery - TaskManager.addRelatedItems', () => {
    let tempDir: string;
    let TaskManager: typeof import('../../shortcuts/tasks-viewer/task-manager').TaskManager;

    setup(async () => {
        // Create a unique temp directory for each test
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tasks-add-related-test-'));
        
        // Dynamically import TaskManager
        const module = await import('../../shortcuts/tasks-viewer/task-manager');
        TaskManager = module.TaskManager;
    });

    teardown(() => {
        // Clean up temp directory
        if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    test('addRelatedItems creates new related.yaml when none exists', async () => {
        const folderPath = path.join(tempDir, 'feature1');
        fs.mkdirSync(folderPath, { recursive: true });

        const manager = new TaskManager(tempDir);
        const items: RelatedItem[] = [
            { name: 'file1.ts', path: 'src/file1.ts', type: 'file', category: 'source', relevance: 90, reason: 'R1' }
        ];

        await manager.addRelatedItems(folderPath, items, 'Test feature');

        const loaded = await loadRelatedItems(folderPath);
        assert.strictEqual(loaded?.items.length, 1);
        assert.strictEqual(loaded?.description, 'Test feature');
    });

    test('addRelatedItems merges with existing items', async () => {
        const folderPath = path.join(tempDir, 'feature1');
        fs.mkdirSync(folderPath, { recursive: true });

        // Create existing related items
        const existingConfig: RelatedItemsConfig = {
            description: 'Existing',
            items: [
                { name: 'file1.ts', path: 'src/file1.ts', type: 'file', category: 'source', relevance: 90, reason: 'R1' }
            ]
        };
        await saveRelatedItems(folderPath, existingConfig);

        const manager = new TaskManager(tempDir);
        const newItems: RelatedItem[] = [
            { name: 'file2.ts', path: 'src/file2.ts', type: 'file', category: 'source', relevance: 85, reason: 'R2' }
        ];

        await manager.addRelatedItems(folderPath, newItems);

        const loaded = await loadRelatedItems(folderPath);
        assert.strictEqual(loaded?.items.length, 2);
    });

    test('addRelatedItems deduplicates by path', async () => {
        const folderPath = path.join(tempDir, 'feature1');
        fs.mkdirSync(folderPath, { recursive: true });

        const existingConfig: RelatedItemsConfig = {
            description: 'Existing',
            items: [
                { name: 'file1.ts', path: 'src/file1.ts', type: 'file', category: 'source', relevance: 90, reason: 'R1' }
            ]
        };
        await saveRelatedItems(folderPath, existingConfig);

        const manager = new TaskManager(tempDir);
        const newItems: RelatedItem[] = [
            { name: 'file1.ts', path: 'src/file1.ts', type: 'file', category: 'source', relevance: 95, reason: 'R2' }
        ];

        await manager.addRelatedItems(folderPath, newItems);

        const loaded = await loadRelatedItems(folderPath);
        assert.strictEqual(loaded?.items.length, 1);
    });
});

/**
 * Test suite to verify that related item contextValues do NOT match
 * the regex patterns used for status commands in package.json.
 * 
 * This is a defensive test to ensure related items never show
 * "Mark as Done", "Mark as In-Progress", etc. context menu options.
 * 
 * Status command patterns from package.json:
 * - task items: /^task(_reviewed|_needsReReview|_inProgress|_done)?$/
 * - taskDocument items: /^taskDocument(_reviewed|_needsReReview|_inProgress|_done)?$/
 */
suite('Tasks Related Items - contextValue should NOT match status command patterns', () => {
    // Regex patterns that would allow status commands (from package.json)
    const taskStatusPatterns = [
        /^task(_reviewed|_needsReReview|_inProgress|_done)?$/,
        /^task_(future|inProgress|done)(_reviewed|_needsReReview)?$/,
        /^task(_future|_done)?(_reviewed|_needsReReview)?$/,
        /^task(_future|_inProgress)?(_reviewed|_needsReReview)?$/
    ];
    
    const taskDocumentStatusPatterns = [
        /^taskDocument(_reviewed|_needsReReview|_inProgress|_done)?$/,
        /^taskDocument_(future|inProgress|done)(_reviewed|_needsReReview)?$/,
        /^taskDocument(_future|_done)?(_reviewed|_needsReReview)?$/,
        /^taskDocument(_future|_inProgress)?(_reviewed|_needsReReview)?$/
    ];

    // All related item contextValues
    const relatedContextValues = [
        'relatedItemsSection',
        'relatedCategory',
        'relatedFile',
        'relatedCommit'
    ];

    test('relatedItemsSection contextValue does not match any task status pattern', () => {
        const contextValue = 'relatedItemsSection';
        for (const pattern of [...taskStatusPatterns, ...taskDocumentStatusPatterns]) {
            assert.strictEqual(
                pattern.test(contextValue),
                false,
                `'${contextValue}' should NOT match pattern ${pattern}`
            );
        }
    });

    test('relatedCategory contextValue does not match any task status pattern', () => {
        const contextValue = 'relatedCategory';
        for (const pattern of [...taskStatusPatterns, ...taskDocumentStatusPatterns]) {
            assert.strictEqual(
                pattern.test(contextValue),
                false,
                `'${contextValue}' should NOT match pattern ${pattern}`
            );
        }
    });

    test('relatedFile contextValue does not match any task status pattern', () => {
        const contextValue = 'relatedFile';
        for (const pattern of [...taskStatusPatterns, ...taskDocumentStatusPatterns]) {
            assert.strictEqual(
                pattern.test(contextValue),
                false,
                `'${contextValue}' should NOT match pattern ${pattern}`
            );
        }
    });

    test('relatedCommit contextValue does not match any task status pattern', () => {
        const contextValue = 'relatedCommit';
        for (const pattern of [...taskStatusPatterns, ...taskDocumentStatusPatterns]) {
            assert.strictEqual(
                pattern.test(contextValue),
                false,
                `'${contextValue}' should NOT match pattern ${pattern}`
            );
        }
    });

    test('all related contextValues start with "related" prefix', () => {
        // This ensures the defensive exclusion pattern /^related/ works
        for (const contextValue of relatedContextValues) {
            assert.strictEqual(
                contextValue.startsWith('related'),
                true,
                `'${contextValue}' should start with 'related' prefix`
            );
        }
    });

    test('related contextValues match the exclusion pattern /^related/', () => {
        const exclusionPattern = /^related/;
        for (const contextValue of relatedContextValues) {
            assert.strictEqual(
                exclusionPattern.test(contextValue),
                true,
                `'${contextValue}' should match exclusion pattern ${exclusionPattern}`
            );
        }
    });

    test('RelatedItemsSectionItem has correct contextValue constant', () => {
        const config: RelatedItemsConfig = {
            description: 'Test',
            items: []
        };
        const item = new RelatedItemsSectionItem('/path', config);
        assert.strictEqual(item.contextValue, 'relatedItemsSection');
        assert.strictEqual(/^related/.test(item.contextValue), true);
    });

    test('RelatedCategoryItem has correct contextValue constant', () => {
        const item = new RelatedCategoryItem('source', [], '/path');
        assert.strictEqual(item.contextValue, 'relatedCategory');
        assert.strictEqual(/^related/.test(item.contextValue), true);
    });

    test('RelatedFileItem has correct contextValue constant', () => {
        const relatedItem: RelatedItem = {
            name: 'test.ts',
            path: 'src/test.ts',
            type: 'file',
            category: 'source',
            relevance: 90,
            reason: 'Test'
        };
        const item = new RelatedFileItem(relatedItem, '/path', '/workspace');
        assert.strictEqual(item.contextValue, 'relatedFile');
        assert.strictEqual(/^related/.test(item.contextValue), true);
    });

    test('RelatedCommitItem has correct contextValue constant', () => {
        const relatedItem: RelatedItem = {
            name: 'feat: test',
            type: 'commit',
            hash: 'abc123',
            category: 'commit',
            relevance: 90,
            reason: 'Test'
        };
        const item = new RelatedCommitItem(relatedItem, '/path', '/workspace');
        assert.strictEqual(item.contextValue, 'relatedCommit');
        assert.strictEqual(/^related/.test(item.contextValue), true);
    });
});
