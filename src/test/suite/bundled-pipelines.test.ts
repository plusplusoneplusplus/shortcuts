import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import {
    PipelineInfo,
    PipelineItem,
    PipelineManager,
    PipelinesTreeDataProvider,
    PipelineSource,
    BundledPipelineManifest,
    BUNDLED_PIPELINES,
    getBundledPipelineManifest,
    getAllBundledPipelineManifests,
    isValidBundledPipelineId,
    PipelineCategoryItem
} from '../../shortcuts/yaml-pipeline';

suite('Bundled Pipelines Tests', () => {
    let tempDir: string;
    let pipelineManager: PipelineManager;
    let mockExtensionContext: vscode.ExtensionContext;
    let bundledPipelinesPath: string;

    setup(() => {
        // Create temporary directory for testing
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shortcuts-bundled-test-'));

        // Create mock bundled pipelines directory
        bundledPipelinesPath = path.join(tempDir, 'extension', 'resources', 'bundled-pipelines');
        fs.mkdirSync(bundledPipelinesPath, { recursive: true });

        // Create mock bundled pipelines
        createMockBundledPipeline('code-review-checklist', {
            name: 'Code Review Checklist',
            description: 'Generate code review checklists from git diffs'
        }, ['checklist-template.md']);

        createMockBundledPipeline('bug-triage', {
            name: 'Bug Triage',
            description: 'Classify and prioritize bug reports from CSV'
        }, ['sample-input.csv']);

        createMockBundledPipeline('doc-generator', {
            name: 'Documentation Generator',
            description: 'Generate documentation from code files'
        });

        // Mock extension context
        mockExtensionContext = {
            extensionPath: path.join(tempDir, 'extension'),
            subscriptions: [],
            workspaceState: {
                get: () => undefined,
                update: () => Promise.resolve(),
                keys: () => []
            },
            globalState: {
                get: () => undefined,
                update: () => Promise.resolve(),
                keys: () => [],
                setKeysForSync: () => {}
            },
            extensionUri: vscode.Uri.file(path.join(tempDir, 'extension')),
            storageUri: vscode.Uri.file(tempDir),
            globalStorageUri: vscode.Uri.file(tempDir),
            logUri: vscode.Uri.file(tempDir),
            extensionMode: vscode.ExtensionMode.Test,
            asAbsolutePath: (relativePath: string) => path.join(tempDir, 'extension', relativePath),
            storagePath: tempDir,
            globalStoragePath: tempDir,
            logPath: tempDir,
            secrets: {
                get: () => Promise.resolve(undefined),
                store: () => Promise.resolve(),
                delete: () => Promise.resolve(),
                onDidChange: new vscode.EventEmitter<vscode.SecretStorageChangeEvent>().event
            },
            environmentVariableCollection: {} as any,
            extension: {} as any,
            languageModelAccessInformation: {} as any
        };

        // Mock vscode.workspace.getConfiguration
        const originalGetConfiguration = vscode.workspace.getConfiguration;
        (vscode.workspace as any).getConfiguration = (section?: string) => {
            if (section === 'workspaceShortcuts.pipelinesViewer') {
                return {
                    get: <T>(key: string, defaultValue?: T): T => {
                        const defaults: Record<string, any> = {
                            enabled: true,
                            folderPath: '.vscode/pipelines',
                            sortBy: 'name'
                        };
                        return (defaults[key] !== undefined ? defaults[key] : defaultValue) as T;
                    }
                };
            }
            return originalGetConfiguration(section);
        };

        // Create workspace directory
        const workspaceDir = path.join(tempDir, 'workspace');
        fs.mkdirSync(workspaceDir, { recursive: true });

        pipelineManager = new PipelineManager(workspaceDir, mockExtensionContext);
    });

    teardown(() => {
        // Dispose pipeline manager
        pipelineManager.dispose();

        // Clean up temporary directory
        if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    /**
     * Helper to create a mock bundled pipeline
     */
    function createMockBundledPipeline(
        directory: string,
        metadata: { name: string; description: string },
        resources?: string[]
    ): void {
        const pipelineDir = path.join(bundledPipelinesPath, directory);
        fs.mkdirSync(pipelineDir, { recursive: true });

        const pipelineContent = `name: "${metadata.name}"
description: "${metadata.description}"
input:
  items: []
map:
  prompt: "Test prompt"
  output:
    - result
reduce:
  type: json
`;
        fs.writeFileSync(path.join(pipelineDir, 'pipeline.yaml'), pipelineContent, 'utf8');

        if (resources) {
            for (const resource of resources) {
                fs.writeFileSync(path.join(pipelineDir, resource), `# ${resource}`, 'utf8');
            }
        }
    }

    /**
     * Helper to create a workspace pipeline
     */
    function createWorkspacePipeline(name: string): string {
        const pipelinesFolder = pipelineManager.getPipelinesFolder();
        if (!fs.existsSync(pipelinesFolder)) {
            fs.mkdirSync(pipelinesFolder, { recursive: true });
        }

        const sanitizedName = name.replace(/\s+/g, '-');
        const packagePath = path.join(pipelinesFolder, sanitizedName);
        fs.mkdirSync(packagePath, { recursive: true });

        const pipelineContent = `name: "${name}"
description: "A workspace pipeline"
input:
  from:
    type: csv
    path: "input.csv"
map:
  prompt: "Process: {{title}}"
  output:
    - result
reduce:
  type: json
`;
        const filePath = path.join(packagePath, 'pipeline.yaml');
        fs.writeFileSync(filePath, pipelineContent, 'utf8');
        fs.writeFileSync(path.join(packagePath, 'input.csv'), 'id,title\n1,Test', 'utf8');

        return filePath;
    }

    suite('Bundled Pipeline Registry', () => {
        test('should export all bundled pipeline manifests', () => {
            assert.ok(Array.isArray(BUNDLED_PIPELINES));
            assert.ok(BUNDLED_PIPELINES.length >= 3, 'Should have at least 3 bundled pipelines');
        });

        test('should have valid manifest structure for all bundled pipelines', () => {
            for (const manifest of BUNDLED_PIPELINES) {
                assert.ok(manifest.id, 'Manifest should have id');
                assert.ok(manifest.name, 'Manifest should have name');
                assert.ok(manifest.description, 'Manifest should have description');
                assert.ok(manifest.directory, 'Manifest should have directory');
            }
        });

        test('should have unique IDs for all bundled pipelines', () => {
            const ids = BUNDLED_PIPELINES.map(p => p.id);
            const uniqueIds = new Set(ids);
            assert.strictEqual(ids.length, uniqueIds.size, 'All IDs should be unique');
        });

        test('should get manifest by ID', () => {
            const manifest = getBundledPipelineManifest('code-review-checklist');
            assert.ok(manifest);
            assert.strictEqual(manifest?.id, 'code-review-checklist');
            assert.strictEqual(manifest?.name, 'Code Review Checklist');
        });

        test('should return undefined for non-existent ID', () => {
            const manifest = getBundledPipelineManifest('non-existent');
            assert.strictEqual(manifest, undefined);
        });

        test('should get all manifests', () => {
            const manifests = getAllBundledPipelineManifests();
            assert.ok(Array.isArray(manifests));
            assert.strictEqual(manifests.length, BUNDLED_PIPELINES.length);
        });

        test('should validate bundled pipeline IDs', () => {
            assert.strictEqual(isValidBundledPipelineId('code-review-checklist'), true);
            assert.strictEqual(isValidBundledPipelineId('bug-triage'), true);
            assert.strictEqual(isValidBundledPipelineId('non-existent'), false);
        });
    });

    suite('PipelineManager - Bundled Pipelines', () => {
        test('should load bundled pipelines from extension path', async () => {
            const bundled = await pipelineManager.getBundledPipelines();

            assert.ok(bundled.length >= 3, 'Should load at least 3 bundled pipelines');

            const names = bundled.map(p => p.name);
            assert.ok(names.includes('Code Review Checklist'));
            assert.ok(names.includes('Bug Triage'));
            assert.ok(names.includes('Documentation Generator'));
        });


        test('should include bundledId in bundled pipeline info', async () => {
            const bundled = await pipelineManager.getBundledPipelines();

            for (const pipeline of bundled) {
                assert.ok(pipeline.bundledId, 'Bundled pipeline should have bundledId');
            }
        });

        test('should return pipelines with correct source type', async () => {
            const bundled = await pipelineManager.getBundledPipelines();
            
            for (const pipeline of bundled) {
                assert.strictEqual(pipeline.source, PipelineSource.Bundled);
            }
        });

        test('should return both bundled and workspace pipelines', async () => {
            // Create a workspace pipeline
            createWorkspacePipeline('My Workspace Pipeline');

            const all = await pipelineManager.getAllPipelines();
            const bundled = all.filter(p => p.source === PipelineSource.Bundled);
            const workspace = all.filter(p => p.source === PipelineSource.Workspace);

            assert.ok(bundled.length >= 3);
            assert.strictEqual(workspace.length, 1);
            assert.strictEqual(workspace[0].name, 'My Workspace Pipeline');
        });

        test('should mark workspace pipelines with correct source', async () => {
            createWorkspacePipeline('Workspace Test');

            const workspace = await pipelineManager.getWorkspacePipelines();

            assert.strictEqual(workspace.length, 1);
            assert.strictEqual(workspace[0].source, PipelineSource.Workspace);
        });

        test('should include resource files for bundled pipelines', async () => {
            const bundled = await pipelineManager.getBundledPipelines();

            const codeReview = bundled.find(p => p.bundledId === 'code-review-checklist');
            assert.ok(codeReview);
            assert.ok(codeReview?.resourceFiles);
            assert.ok(codeReview?.resourceFiles?.some(r => r.fileName === 'checklist-template.md'));

            const bugTriage = bundled.find(p => p.bundledId === 'bug-triage');
            assert.ok(bugTriage);
            assert.ok(bugTriage?.resourceFiles);
            assert.ok(bugTriage?.resourceFiles?.some(r => r.fileName === 'sample-input.csv'));
        });

        test('should return empty array when no extension context', async () => {
            const managerWithoutContext = new PipelineManager(tempDir);
            const bundled = await managerWithoutContext.getBundledPipelines();

            assert.strictEqual(bundled.length, 0);
            managerWithoutContext.dispose();
        });
    });

    suite('PipelineManager - Copy to Workspace', () => {
        test('should copy bundled pipeline to workspace', async () => {
            const destPath = await pipelineManager.copyBundledToWorkspace('code-review-checklist');

            assert.ok(fs.existsSync(destPath));
            assert.ok(destPath.endsWith('pipeline.yaml'));

            const content = fs.readFileSync(destPath, 'utf8');
            assert.ok(content.includes('Code Review Checklist'));
        });

        test('should copy resource files when copying bundled pipeline', async () => {
            const destPath = await pipelineManager.copyBundledToWorkspace('code-review-checklist');
            const packagePath = path.dirname(destPath);

            assert.ok(fs.existsSync(path.join(packagePath, 'checklist-template.md')));
        });

        test('should allow custom name when copying', async () => {
            const destPath = await pipelineManager.copyBundledToWorkspace('bug-triage', 'my-custom-triage');
            const packagePath = path.dirname(destPath);

            assert.ok(packagePath.endsWith('my-custom-triage'));
            assert.ok(fs.existsSync(destPath));
        });

        test('should throw error when copying non-existent bundled pipeline', async () => {
            await assert.rejects(
                async () => await pipelineManager.copyBundledToWorkspace('non-existent'),
                /not found/i
            );
        });

        test('should throw error when destination already exists', async () => {
            await pipelineManager.copyBundledToWorkspace('bug-triage');

            await assert.rejects(
                async () => await pipelineManager.copyBundledToWorkspace('bug-triage'),
                /already exists/i
            );
        });

        test('should check if bundled pipeline is in workspace', async () => {
            assert.strictEqual(await pipelineManager.isBundledPipelineInWorkspace('bug-triage'), false);

            await pipelineManager.copyBundledToWorkspace('bug-triage');

            assert.strictEqual(await pipelineManager.isBundledPipelineInWorkspace('bug-triage'), true);
        });
    });

    suite('PipelineItem - Bundled vs Workspace', () => {
        test('should set correct context value for bundled pipeline', () => {
            const bundledPipeline: PipelineInfo = {
                packageName: 'code-review-checklist',
                packagePath: '/path/to/bundled',
                filePath: '/path/to/bundled/pipeline.yaml',
                relativePath: 'bundled://code-review-checklist',
                name: 'Code Review Checklist',
                description: 'Test description',
                lastModified: new Date(),
                size: 1024,
                isValid: true,
                source: PipelineSource.Bundled,
                bundledId: 'code-review-checklist'
            };

            const item = new PipelineItem(bundledPipeline);

            assert.strictEqual(item.contextValue, 'pipeline_bundled');
        });

        test('should set correct context value for workspace pipeline', () => {
            const workspacePipeline: PipelineInfo = {
                packageName: 'my-pipeline',
                packagePath: '/path/to/workspace',
                filePath: '/path/to/workspace/pipeline.yaml',
                relativePath: '.vscode/pipelines/my-pipeline',
                name: 'My Pipeline',
                lastModified: new Date(),
                size: 512,
                isValid: true,
                source: PipelineSource.Workspace
            };

            const item = new PipelineItem(workspacePipeline);

            assert.strictEqual(item.contextValue, 'pipeline');
        });

        test('should show (read-only) description for bundled pipeline', () => {
            const bundledPipeline: PipelineInfo = {
                packageName: 'test-bundled',
                packagePath: '/path/to/bundled',
                filePath: '/path/to/bundled/pipeline.yaml',
                relativePath: 'bundled://test-bundled',
                name: 'Test Bundled',
                lastModified: new Date(),
                size: 100,
                isValid: true,
                source: PipelineSource.Bundled,
                bundledId: 'test-bundled'
            };

            const item = new PipelineItem(bundledPipeline);

            assert.strictEqual(item.description, '(read-only)');
        });

        test('should show package name as description for workspace pipeline', () => {
            const workspacePipeline: PipelineInfo = {
                packageName: 'my-workspace-pipeline',
                packagePath: '/path/to/workspace',
                filePath: '/path/to/workspace/pipeline.yaml',
                relativePath: '.vscode/pipelines/my-workspace-pipeline',
                name: 'My Workspace Pipeline',
                lastModified: new Date(),
                size: 200,
                isValid: true,
                source: PipelineSource.Workspace
            };

            const item = new PipelineItem(workspacePipeline);

            assert.strictEqual(item.description, 'my-workspace-pipeline');
        });
    });

    suite('PipelineCategoryItem', () => {
        test('should create bundled category item', () => {
            const item = new PipelineCategoryItem(
                'Bundled Pipelines',
                'bundled',
                3,
                'Pre-installed pipeline templates'
            );

            assert.strictEqual(item.label, 'Bundled Pipelines');
            assert.strictEqual(item.categoryType, 'bundled');
            assert.strictEqual(item.description, '(3)');
            assert.strictEqual(item.contextValue, 'pipelineCategory_bundled');
            assert.strictEqual(item.itemType, 'category');
        });

        test('should create workspace category item', () => {
            const item = new PipelineCategoryItem(
                'Workspace Pipelines',
                'workspace',
                5,
                'Pipelines in .vscode/pipelines'
            );

            assert.strictEqual(item.label, 'Workspace Pipelines');
            assert.strictEqual(item.categoryType, 'workspace');
            assert.strictEqual(item.description, '(5)');
            assert.strictEqual(item.contextValue, 'pipelineCategory_workspace');
        });

        test('should be collapsed by default', () => {
            const item = new PipelineCategoryItem('Test', 'bundled', 0, 'Test');

            assert.strictEqual(item.collapsibleState, vscode.TreeItemCollapsibleState.Collapsed);
        });
    });

    suite('PipelinesTreeDataProvider - Categories', () => {
        let treeDataProvider: PipelinesTreeDataProvider;

        setup(() => {
            treeDataProvider = new PipelinesTreeDataProvider(pipelineManager);
        });

        teardown(() => {
            treeDataProvider.dispose();
        });

        test('should return category items at root level', async () => {
            const children = await treeDataProvider.getChildren();

            // Should have at least bundled category
            assert.ok(children.length >= 1);
            assert.ok(children.some(c => c.itemType === 'category'));
        });

        test('should return bundled category with correct count', async () => {
            const children = await treeDataProvider.getChildren();
            const bundledCategory = children.find(
                c => c.itemType === 'category' && (c as PipelineCategoryItem).categoryType === 'bundled'
            ) as PipelineCategoryItem;

            assert.ok(bundledCategory);
            const desc = String(bundledCategory.description || '');
            assert.ok(desc.includes('3') || desc.includes('('));
        });

        test('should return pipeline items when expanding category', async () => {
            const categories = await treeDataProvider.getChildren();
            const bundledCategory = categories.find(
                c => c.itemType === 'category' && (c as PipelineCategoryItem).categoryType === 'bundled'
            );

            assert.ok(bundledCategory);

            const pipelines = await treeDataProvider.getChildren(bundledCategory);
            assert.ok(pipelines.length >= 3);
            assert.ok(pipelines.every(p => p.itemType === 'package'));
        });

        test('should show workspace category when workspace pipelines exist', async () => {
            createWorkspacePipeline('Test Workspace Pipeline');

            const children = await treeDataProvider.getChildren();
            const workspaceCategory = children.find(
                c => c.itemType === 'category' && (c as PipelineCategoryItem).categoryType === 'workspace'
            );

            assert.ok(workspaceCategory);
        });

        test('should filter pipelines across categories', async () => {
            createWorkspacePipeline('Filter Test Pipeline');

            treeDataProvider.setFilter('code review');

            const categories = await treeDataProvider.getChildren();
            const bundledCategory = categories.find(
                c => c.itemType === 'category' && (c as PipelineCategoryItem).categoryType === 'bundled'
            );

            if (bundledCategory) {
                const pipelines = await treeDataProvider.getChildren(bundledCategory);
                assert.ok(pipelines.length <= 1, 'Filter should reduce results');
            }
        });
    });

    suite('Integration Tests', () => {
        test('should complete full bundled pipeline workflow', async () => {
            // 1. Get all pipelines (bundled + workspace)
            let all = await pipelineManager.getAllPipelines();
            const initialBundledCount = all.filter(p => p.source === PipelineSource.Bundled).length;
            assert.ok(initialBundledCount >= 3);

            // 2. Copy a bundled pipeline to workspace
            const destPath = await pipelineManager.copyBundledToWorkspace('bug-triage', 'my-bug-triage');
            assert.ok(fs.existsSync(destPath));

            // 3. Verify it appears in workspace pipelines
            all = await pipelineManager.getAllPipelines();
            const workspace = all.filter(p => p.source === PipelineSource.Workspace);
            assert.strictEqual(workspace.length, 1);
            assert.ok(workspace[0].packageName.includes('my-bug-triage'));

            // 4. Bundled count should remain the same
            const bundled = all.filter(p => p.source === PipelineSource.Bundled);
            assert.strictEqual(bundled.length, initialBundledCount);

            // 5. Verify copied pipeline is editable (has workspace source)
            assert.strictEqual(workspace[0].source, PipelineSource.Workspace);
        });

        test('should tree provider show correct hierarchy', async () => {
            const treeDataProvider = new PipelinesTreeDataProvider(pipelineManager);

            // Create workspace pipeline
            createWorkspacePipeline('Hierarchy Test');

            // Get root (categories)
            const categories = await treeDataProvider.getChildren();
            assert.ok(categories.length >= 2, 'Should have bundled and workspace categories');

            // Get bundled pipelines
            const bundledCategory = categories.find(
                c => c.itemType === 'category' && (c as PipelineCategoryItem).categoryType === 'bundled'
            );
            const bundledPipelines = await treeDataProvider.getChildren(bundledCategory);
            assert.ok(bundledPipelines.length >= 3);

            // Get workspace pipelines
            const workspaceCategory = categories.find(
                c => c.itemType === 'category' && (c as PipelineCategoryItem).categoryType === 'workspace'
            );
            const workspacePipelines = await treeDataProvider.getChildren(workspaceCategory);
            assert.strictEqual(workspacePipelines.length, 1);

            treeDataProvider.dispose();
        });
    });

    suite('Edge Cases', () => {
        test('should handle missing bundled pipeline directory gracefully', async () => {
            // Remove one bundled pipeline directory
            const missingDir = path.join(bundledPipelinesPath, 'code-review-checklist');
            fs.rmSync(missingDir, { recursive: true, force: true });

            const bundled = await pipelineManager.getBundledPipelines();

            // Should still load other bundled pipelines
            assert.ok(bundled.length >= 2);
            assert.ok(!bundled.some(p => p.bundledId === 'code-review-checklist'));
        });

        test('should handle invalid bundled pipeline YAML gracefully', async () => {
            // Create invalid YAML in bundled pipeline
            const invalidDir = path.join(bundledPipelinesPath, 'invalid-pipeline');
            fs.mkdirSync(invalidDir, { recursive: true });
            fs.writeFileSync(path.join(invalidDir, 'pipeline.yaml'), 'invalid: yaml: content:', 'utf8');

            // Should not throw, just skip invalid pipeline
            const bundled = await pipelineManager.getBundledPipelines();
            assert.ok(bundled.length >= 3);
        });

        test('should sanitize target name when copying', async () => {
            const destPath = await pipelineManager.copyBundledToWorkspace(
                'bug-triage',
                'My Pipeline: With <Special> Chars!'
            );

            const packagePath = path.dirname(destPath);
            const packageName = path.basename(packagePath);

            assert.ok(!packageName.includes(':'));
            assert.ok(!packageName.includes('<'));
            assert.ok(!packageName.includes('>'));
        });
    });
});
