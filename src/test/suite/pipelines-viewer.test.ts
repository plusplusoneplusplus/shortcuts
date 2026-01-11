import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import {
    PipelineManager,
    PipelinesTreeDataProvider,
    PipelineItem,
    PipelineInfo
} from '../../shortcuts/yaml-pipeline';

suite('Pipelines Viewer Tests', () => {
    let tempDir: string;
    let pipelineManager: PipelineManager;

    setup(() => {
        // Create temporary directory for testing
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shortcuts-pipelines-test-'));

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

        pipelineManager = new PipelineManager(tempDir);
    });

    teardown(() => {
        // Dispose pipeline manager
        pipelineManager.dispose();

        // Clean up temporary directory
        if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    suite('PipelineManager', () => {
        suite('Folder Management', () => {
            test('should get correct pipelines folder path', () => {
                const pipelinesFolder = pipelineManager.getPipelinesFolder();
                assert.strictEqual(pipelinesFolder, path.join(tempDir, '.vscode', 'pipelines'));
            });

            test('should create folders when ensurePipelinesFolderExists is called', () => {
                pipelineManager.ensurePipelinesFolderExists();

                const pipelinesFolder = pipelineManager.getPipelinesFolder();
                assert.ok(fs.existsSync(pipelinesFolder), 'Pipelines folder should exist');
            });

            test('should not throw if folders already exist', () => {
                pipelineManager.ensurePipelinesFolderExists();
                // Call again - should not throw
                assert.doesNotThrow(() => pipelineManager.ensurePipelinesFolderExists());
            });
        });

        suite('Pipeline Creation', () => {
            test('should create a new pipeline file', async () => {
                const filePath = await pipelineManager.createPipeline('My First Pipeline');

                assert.ok(fs.existsSync(filePath), 'Pipeline file should exist');
                assert.ok(filePath.endsWith('.yaml'), 'Pipeline file should be YAML');

                const content = fs.readFileSync(filePath, 'utf8');
                assert.ok(content.includes('name: "My First Pipeline"'), 'Pipeline should have name');
            });

            test('should sanitize pipeline name for file', async () => {
                const filePath = await pipelineManager.createPipeline('Pipeline: With <Special> Chars!');
                const fileName = path.basename(filePath);

                assert.ok(fs.existsSync(filePath));
                // Check only the filename to avoid Windows drive letter colon
                assert.ok(!fileName.includes(':'), 'Filename should not contain colon');
                assert.ok(!fileName.includes('<'), 'Filename should not contain <');
                assert.ok(!fileName.includes('>'), 'Filename should not contain >');
            });

            test('should throw error if pipeline already exists', async () => {
                await pipelineManager.createPipeline('Duplicate Pipeline');

                await assert.rejects(
                    async () => await pipelineManager.createPipeline('Duplicate Pipeline'),
                    /already exists/i
                );
            });

            test('should create pipeline with spaces in name', async () => {
                const filePath = await pipelineManager.createPipeline('Pipeline With Spaces');
                assert.ok(fs.existsSync(filePath));
            });

            test('should create pipeline with default template content', async () => {
                const filePath = await pipelineManager.createPipeline('Test Pipeline');
                const content = fs.readFileSync(filePath, 'utf8');

                // Check that template has required sections
                assert.ok(content.includes('name:'), 'Should have name field');
                assert.ok(content.includes('input:'), 'Should have input section');
                assert.ok(content.includes('map:'), 'Should have map section');
                assert.ok(content.includes('reduce:'), 'Should have reduce section');
            });
        });

        suite('Pipeline Reading', () => {
            test('should return empty array when no pipelines exist', async () => {
                pipelineManager.ensurePipelinesFolderExists();
                const pipelines = await pipelineManager.getPipelines();
                assert.strictEqual(pipelines.length, 0);
            });

            test('should return pipelines from folder', async () => {
                await pipelineManager.createPipeline('Pipeline 1');
                await pipelineManager.createPipeline('Pipeline 2');

                const pipelines = await pipelineManager.getPipelines();
                assert.strictEqual(pipelines.length, 2);
            });

            test('should populate pipeline properties correctly', async () => {
                await pipelineManager.createPipeline('Test Pipeline');

                const pipelines = await pipelineManager.getPipelines();
                assert.strictEqual(pipelines.length, 1);

                const pipeline = pipelines[0];
                assert.strictEqual(pipeline.name, 'Test Pipeline');
                assert.ok(pipeline.filePath.endsWith('.yaml'));
                assert.ok(pipeline.lastModified instanceof Date);
                assert.ok(pipeline.size > 0);
            });

            test('should not include non-YAML files', async () => {
                pipelineManager.ensurePipelinesFolderExists();
                const pipelinesFolder = pipelineManager.getPipelinesFolder();

                // Create a non-YAML file
                fs.writeFileSync(path.join(pipelinesFolder, 'readme.txt'), 'Not a pipeline');

                await pipelineManager.createPipeline('Real Pipeline');

                const pipelines = await pipelineManager.getPipelines();
                assert.strictEqual(pipelines.length, 1);
                assert.strictEqual(pipelines[0].name, 'Real Pipeline');
            });

            test('should support both .yaml and .yml extensions', async () => {
                pipelineManager.ensurePipelinesFolderExists();
                const pipelinesFolder = pipelineManager.getPipelinesFolder();

                // Create a .yml file manually
                const ymlContent = `name: "YML Pipeline"
input:
  type: csv
  path: data.csv
map:
  prompt: Test
  output:
    - result
reduce:
  type: json
`;
                fs.writeFileSync(path.join(pipelinesFolder, 'test.yml'), ymlContent);

                // Create a .yaml file
                await pipelineManager.createPipeline('YAML Pipeline');

                const pipelines = await pipelineManager.getPipelines();
                assert.strictEqual(pipelines.length, 2);
            });

            test('should get pipeline by file name', async () => {
                await pipelineManager.createPipeline('Find Me');

                const pipeline = await pipelineManager.getPipeline('Find-Me.yaml');
                assert.ok(pipeline);
                assert.strictEqual(pipeline?.name, 'Find Me');
            });

            test('should return undefined for non-existent pipeline', async () => {
                const pipeline = await pipelineManager.getPipeline('non-existent.yaml');
                assert.strictEqual(pipeline, undefined);
            });
        });

        suite('Pipeline Renaming', () => {
            test('should rename a pipeline file', async () => {
                const originalPath = await pipelineManager.createPipeline('Original Name');
                const newPath = await pipelineManager.renamePipeline(originalPath, 'New Name');

                assert.ok(!fs.existsSync(originalPath), 'Original file should not exist');
                assert.ok(fs.existsSync(newPath), 'New file should exist');

                // Check that name field was updated in YAML
                const content = fs.readFileSync(newPath, 'utf8');
                assert.ok(content.includes('New Name'), 'Name should be updated in YAML');
            });

            test('should throw error when renaming to existing name', async () => {
                const path1 = await pipelineManager.createPipeline('Pipeline One');
                const path2 = await pipelineManager.createPipeline('Pipeline Two');

                await assert.rejects(
                    async () => await pipelineManager.renamePipeline(path1, 'Pipeline-Two'),
                    /already exists/i
                );
            });

            test('should throw error when original file not found', async () => {
                await assert.rejects(
                    async () => await pipelineManager.renamePipeline('/non/existent/path.yaml', 'New Name'),
                    /not found/i
                );
            });
        });

        suite('Pipeline Deletion', () => {
            test('should delete a pipeline file', async () => {
                const filePath = await pipelineManager.createPipeline('To Delete');
                assert.ok(fs.existsSync(filePath));

                await pipelineManager.deletePipeline(filePath);
                assert.ok(!fs.existsSync(filePath), 'File should be deleted');
            });

            test('should throw error when file not found', async () => {
                await assert.rejects(
                    async () => await pipelineManager.deletePipeline('/non/existent/path.yaml'),
                    /not found/i
                );
            });
        });

        suite('Pipeline Validation', () => {
            test('should validate a valid pipeline', async () => {
                const filePath = await pipelineManager.createPipeline('Valid Pipeline');
                const result = await pipelineManager.validatePipeline(filePath);

                assert.strictEqual(result.valid, true);
                assert.strictEqual(result.errors.length, 0);
            });

            test('should detect missing name field', async () => {
                pipelineManager.ensurePipelinesFolderExists();
                const pipelinesFolder = pipelineManager.getPipelinesFolder();
                const filePath = path.join(pipelinesFolder, 'no-name.yaml');

                const content = `input:
  type: csv
  path: data.csv
map:
  prompt: Test
  output:
    - result
reduce:
  type: json
`;
                fs.writeFileSync(filePath, content);

                const result = await pipelineManager.validatePipeline(filePath);
                assert.strictEqual(result.valid, false);
                assert.ok(result.errors.some(e => e.includes('name')), 'Should report missing name');
            });

            test('should detect missing input field', async () => {
                pipelineManager.ensurePipelinesFolderExists();
                const pipelinesFolder = pipelineManager.getPipelinesFolder();
                const filePath = path.join(pipelinesFolder, 'no-input.yaml');

                const content = `name: "No Input"
map:
  prompt: Test
  output:
    - result
reduce:
  type: json
`;
                fs.writeFileSync(filePath, content);

                const result = await pipelineManager.validatePipeline(filePath);
                assert.strictEqual(result.valid, false);
                assert.ok(result.errors.some(e => e.includes('input')), 'Should report missing input');
            });

            test('should detect unsupported input type', async () => {
                pipelineManager.ensurePipelinesFolderExists();
                const pipelinesFolder = pipelineManager.getPipelinesFolder();
                const filePath = path.join(pipelinesFolder, 'bad-input.yaml');

                const content = `name: "Bad Input Type"
input:
  type: json
  path: data.json
map:
  prompt: Test
  output:
    - result
reduce:
  type: json
`;
                fs.writeFileSync(filePath, content);

                const result = await pipelineManager.validatePipeline(filePath);
                assert.strictEqual(result.valid, false);
                assert.ok(result.errors.some(e => e.includes('input type')), 'Should report unsupported input type');
            });

            test('should detect missing map field', async () => {
                pipelineManager.ensurePipelinesFolderExists();
                const pipelinesFolder = pipelineManager.getPipelinesFolder();
                const filePath = path.join(pipelinesFolder, 'no-map.yaml');

                const content = `name: "No Map"
input:
  type: csv
  path: data.csv
reduce:
  type: json
`;
                fs.writeFileSync(filePath, content);

                const result = await pipelineManager.validatePipeline(filePath);
                assert.strictEqual(result.valid, false);
                assert.ok(result.errors.some(e => e.includes('map')), 'Should report missing map');
            });

            test('should detect missing map.prompt', async () => {
                pipelineManager.ensurePipelinesFolderExists();
                const pipelinesFolder = pipelineManager.getPipelinesFolder();
                const filePath = path.join(pipelinesFolder, 'no-prompt.yaml');

                const content = `name: "No Prompt"
input:
  type: csv
  path: data.csv
map:
  output:
    - result
reduce:
  type: json
`;
                fs.writeFileSync(filePath, content);

                const result = await pipelineManager.validatePipeline(filePath);
                assert.strictEqual(result.valid, false);
                assert.ok(result.errors.some(e => e.includes('prompt')), 'Should report missing prompt');
            });

            test('should detect empty map.output array', async () => {
                pipelineManager.ensurePipelinesFolderExists();
                const pipelinesFolder = pipelineManager.getPipelinesFolder();
                const filePath = path.join(pipelinesFolder, 'empty-output.yaml');

                const content = `name: "Empty Output"
input:
  type: csv
  path: data.csv
map:
  prompt: Test
  output: []
reduce:
  type: json
`;
                fs.writeFileSync(filePath, content);

                const result = await pipelineManager.validatePipeline(filePath);
                assert.strictEqual(result.valid, false);
                assert.ok(result.errors.some(e => e.includes('output')), 'Should report empty output');
            });

            test('should detect missing reduce field', async () => {
                pipelineManager.ensurePipelinesFolderExists();
                const pipelinesFolder = pipelineManager.getPipelinesFolder();
                const filePath = path.join(pipelinesFolder, 'no-reduce.yaml');

                const content = `name: "No Reduce"
input:
  type: csv
  path: data.csv
map:
  prompt: Test
  output:
    - result
`;
                fs.writeFileSync(filePath, content);

                const result = await pipelineManager.validatePipeline(filePath);
                assert.strictEqual(result.valid, false);
                assert.ok(result.errors.some(e => e.includes('reduce')), 'Should report missing reduce');
            });

            test('should detect unsupported reduce type', async () => {
                pipelineManager.ensurePipelinesFolderExists();
                const pipelinesFolder = pipelineManager.getPipelinesFolder();
                const filePath = path.join(pipelinesFolder, 'bad-reduce.yaml');

                const content = `name: "Bad Reduce Type"
input:
  type: csv
  path: data.csv
map:
  prompt: Test
  output:
    - result
reduce:
  type: xml
`;
                fs.writeFileSync(filePath, content);

                const result = await pipelineManager.validatePipeline(filePath);
                assert.strictEqual(result.valid, false);
                assert.ok(result.errors.some(e => e.includes('reduce type')), 'Should report unsupported reduce type');
            });

            test('should detect invalid YAML syntax', async () => {
                pipelineManager.ensurePipelinesFolderExists();
                const pipelinesFolder = pipelineManager.getPipelinesFolder();
                const filePath = path.join(pipelinesFolder, 'invalid-yaml.yaml');

                // Invalid YAML - bad indentation
                const content = `name: "Invalid"
input:
type: csv
  path: data.csv
`;
                fs.writeFileSync(filePath, content);

                const result = await pipelineManager.validatePipeline(filePath);
                assert.strictEqual(result.valid, false);
                assert.ok(result.errors.some(e => e.includes('YAML') || e.includes('parse')), 'Should report YAML error');
            });

            test('should return error for non-existent file', async () => {
                const result = await pipelineManager.validatePipeline('/non/existent/file.yaml');
                assert.strictEqual(result.valid, false);
                assert.ok(result.errors.some(e => e.includes('not found')));
            });
        });

        suite('File Watching', () => {
            test('should call refresh callback on file changes', function (done) {
                // Increase timeout for file watching test (CI can be slow)
                this.timeout(5000);

                pipelineManager.ensurePipelinesFolderExists();

                let callCount = 0;
                pipelineManager.watchPipelinesFolder(() => {
                    callCount++;
                    if (callCount === 1) {
                        done();
                    }
                });

                // Small delay to ensure watcher is ready before creating file
                setTimeout(() => {
                    const pipelinesFolder = pipelineManager.getPipelinesFolder();
                    fs.writeFileSync(path.join(pipelinesFolder, 'trigger.yaml'), 'name: Test');
                }, 100);
            });
        });

        suite('Settings', () => {
            test('should get settings from configuration', () => {
                const settings = pipelineManager.getSettings();

                assert.strictEqual(settings.enabled, true);
                assert.strictEqual(settings.folderPath, '.vscode/pipelines');
                assert.strictEqual(settings.sortBy, 'name');
            });
        });
    });

    suite('PipelineItem', () => {
        test('should create pipeline item with correct properties', () => {
            const pipeline: PipelineInfo = {
                fileName: 'test-pipeline.yaml',
                filePath: '/path/to/test-pipeline.yaml',
                relativePath: '.vscode/pipelines/test-pipeline.yaml',
                name: 'Test Pipeline',
                description: 'A test pipeline',
                lastModified: new Date(),
                size: 1024,
                isValid: true
            };

            const item = new PipelineItem(pipeline);

            assert.strictEqual(item.label, 'Test Pipeline');
            assert.strictEqual(item.description, 'test-pipeline.yaml');
            assert.strictEqual(item.contextValue, 'pipeline');
            assert.strictEqual(item.collapsibleState, vscode.TreeItemCollapsibleState.None);
        });

        test('should set correct context value for invalid pipeline', () => {
            const pipeline: PipelineInfo = {
                fileName: 'invalid.yaml',
                filePath: '/path/to/invalid.yaml',
                relativePath: '.vscode/pipelines/invalid.yaml',
                name: 'Invalid Pipeline',
                lastModified: new Date(),
                size: 100,
                isValid: false,
                validationErrors: ['Missing input field']
            };

            const item = new PipelineItem(pipeline);

            assert.strictEqual(item.contextValue, 'pipeline_invalid');
        });

        test('should set open command', () => {
            const pipeline: PipelineInfo = {
                fileName: 'pipeline.yaml',
                filePath: '/path/to/pipeline.yaml',
                relativePath: '.vscode/pipelines/pipeline.yaml',
                name: 'Pipeline',
                lastModified: new Date(),
                size: 500,
                isValid: true
            };

            const item = new PipelineItem(pipeline);

            assert.ok(item.command);
            assert.strictEqual(item.command.command, 'vscode.open');
            assert.ok(item.command.arguments);
            assert.strictEqual(item.command.arguments.length, 1);
        });

        test('should have tooltip with pipeline details', () => {
            const pipeline: PipelineInfo = {
                fileName: 'pipeline.yaml',
                filePath: '/path/to/pipeline.yaml',
                relativePath: '.vscode/pipelines/pipeline.yaml',
                name: 'My Pipeline',
                description: 'This is a test pipeline',
                lastModified: new Date(),
                size: 2048,
                isValid: true
            };

            const item = new PipelineItem(pipeline);
            assert.ok(item.tooltip);
            assert.ok(item.tooltip instanceof vscode.MarkdownString);
        });

        test('should have resourceUri for potential drag support', () => {
            const pipeline: PipelineInfo = {
                fileName: 'pipeline.yaml',
                filePath: '/path/to/pipeline.yaml',
                relativePath: '.vscode/pipelines/pipeline.yaml',
                name: 'Pipeline',
                lastModified: new Date(),
                size: 500,
                isValid: true
            };

            const item = new PipelineItem(pipeline);

            assert.ok(item.resourceUri);
            // Use Uri.path for cross-platform comparison
            assert.strictEqual(item.resourceUri.path, '/path/to/pipeline.yaml');
        });
    });

    suite('PipelinesTreeDataProvider', () => {
        let treeDataProvider: PipelinesTreeDataProvider;

        setup(() => {
            treeDataProvider = new PipelinesTreeDataProvider(pipelineManager);
        });

        teardown(() => {
            treeDataProvider.dispose();
        });

        test('should implement TreeDataProvider interface', () => {
            assert.ok(treeDataProvider.onDidChangeTreeData);
            assert.ok(typeof treeDataProvider.getTreeItem === 'function');
            assert.ok(typeof treeDataProvider.getChildren === 'function');
        });

        test('should return empty array when no pipelines', async () => {
            pipelineManager.ensurePipelinesFolderExists();
            const children = await treeDataProvider.getChildren();
            assert.strictEqual(children.length, 0);
        });

        test('should return pipeline items', async () => {
            await pipelineManager.createPipeline('Pipeline 1');
            await pipelineManager.createPipeline('Pipeline 2');

            const children = await treeDataProvider.getChildren();
            assert.strictEqual(children.length, 2);
            assert.ok(children.every(c => c instanceof PipelineItem));
        });

        test('should return empty array for pipeline children', async () => {
            await pipelineManager.createPipeline('Pipeline');
            const children = await treeDataProvider.getChildren();
            const pipelineItem = children[0];

            const pipelineChildren = await treeDataProvider.getChildren(pipelineItem);
            assert.strictEqual(pipelineChildren.length, 0);
        });

        test('should fire change event on refresh', (done) => {
            const disposable = treeDataProvider.onDidChangeTreeData(() => {
                disposable.dispose();
                done();
            });

            treeDataProvider.refresh();
        });

        test('should filter pipelines by name', async () => {
            await pipelineManager.createPipeline('Apple Pipeline');
            await pipelineManager.createPipeline('Banana Pipeline');
            await pipelineManager.createPipeline('Cherry Pipeline');

            treeDataProvider.setFilter('banana');

            const children = await treeDataProvider.getChildren();
            assert.strictEqual(children.length, 1);
            assert.strictEqual((children[0] as PipelineItem).label, 'Banana Pipeline');
        });

        test('should filter pipelines by file name', async () => {
            await pipelineManager.createPipeline('Test One');
            await pipelineManager.createPipeline('Test Two');

            treeDataProvider.setFilter('test-one');

            const children = await treeDataProvider.getChildren();
            assert.strictEqual(children.length, 1);
        });

        test('should clear filter', async () => {
            await pipelineManager.createPipeline('Pipeline 1');
            await pipelineManager.createPipeline('Pipeline 2');

            treeDataProvider.setFilter('1');
            let children = await treeDataProvider.getChildren();
            assert.strictEqual(children.length, 1);

            treeDataProvider.clearFilter();
            children = await treeDataProvider.getChildren();
            assert.strictEqual(children.length, 2);
        });

        test('should get current filter', () => {
            assert.strictEqual(treeDataProvider.getFilter(), '');

            treeDataProvider.setFilter('test');
            assert.strictEqual(treeDataProvider.getFilter(), 'test');
        });

        test('should sort pipelines by name', async () => {
            await pipelineManager.createPipeline('Zebra');
            await pipelineManager.createPipeline('Apple');
            await pipelineManager.createPipeline('Mango');

            const children = await treeDataProvider.getChildren();
            const names = children.map(c => (c as PipelineItem).label);

            assert.strictEqual(names[0], 'Apple');
            assert.strictEqual(names[1], 'Mango');
            assert.strictEqual(names[2], 'Zebra');
        });

        test('should sort pipelines by modified date', async () => {
            // Override settings for modifiedDate sorting
            const originalGetConfiguration = vscode.workspace.getConfiguration;
            (vscode.workspace as any).getConfiguration = (section?: string) => {
                if (section === 'workspaceShortcuts.pipelinesViewer') {
                    return {
                        get: <T>(key: string, defaultValue?: T): T => {
                            const defaults: Record<string, any> = {
                                enabled: true,
                                folderPath: '.vscode/pipelines',
                                sortBy: 'modifiedDate'
                            };
                            return (defaults[key] !== undefined ? defaults[key] : defaultValue) as T;
                        }
                    };
                }
                return originalGetConfiguration(section);
            };

            // Create pipelines with some delay to get different timestamps
            await pipelineManager.createPipeline('First');
            await new Promise(resolve => setTimeout(resolve, 100));
            await pipelineManager.createPipeline('Second');
            await new Promise(resolve => setTimeout(resolve, 100));
            await pipelineManager.createPipeline('Third');

            const children = await treeDataProvider.getChildren();
            const names = children.map(c => (c as PipelineItem).label);

            // Newest first
            assert.strictEqual(names[0], 'Third');
            assert.strictEqual(names[1], 'Second');
            assert.strictEqual(names[2], 'First');
        });

        test('should return tree item unchanged', () => {
            const pipeline: PipelineInfo = {
                fileName: 'test.yaml',
                filePath: '/path/to/test.yaml',
                relativePath: '.vscode/pipelines/test.yaml',
                name: 'Test',
                lastModified: new Date(),
                size: 100,
                isValid: true
            };
            const item = new PipelineItem(pipeline);

            const returned = treeDataProvider.getTreeItem(item);
            assert.strictEqual(returned, item);
        });

        test('should get pipeline manager', () => {
            const manager = treeDataProvider.getPipelineManager();
            assert.strictEqual(manager, pipelineManager);
        });
    });

    suite('Integration Tests', () => {
        test('should complete full pipeline lifecycle', async () => {
            // Create pipeline
            const filePath = await pipelineManager.createPipeline('Lifecycle Pipeline');
            assert.ok(fs.existsSync(filePath));

            // Verify in list
            let pipelines = await pipelineManager.getPipelines();
            assert.strictEqual(pipelines.length, 1);

            // Validate pipeline
            const validation = await pipelineManager.validatePipeline(filePath);
            assert.strictEqual(validation.valid, true);

            // Rename pipeline
            const renamedPath = await pipelineManager.renamePipeline(filePath, 'Renamed Pipeline');
            assert.ok(fs.existsSync(renamedPath));

            // Verify rename
            pipelines = await pipelineManager.getPipelines();
            assert.strictEqual(pipelines.length, 1);
            assert.strictEqual(pipelines[0].name, 'Renamed Pipeline');

            // Delete pipeline
            await pipelineManager.deletePipeline(renamedPath);
            pipelines = await pipelineManager.getPipelines();
            assert.strictEqual(pipelines.length, 0);
        });

        test('should handle multiple pipelines', async () => {
            const count = 10;
            const paths: string[] = [];

            for (let i = 0; i < count; i++) {
                const filePath = await pipelineManager.createPipeline(`Pipeline ${i}`);
                paths.push(filePath);
            }

            const pipelines = await pipelineManager.getPipelines();
            assert.strictEqual(pipelines.length, count);

            // Delete half
            for (let i = 0; i < count / 2; i++) {
                await pipelineManager.deletePipeline(paths[i]);
            }

            const remainingPipelines = await pipelineManager.getPipelines();
            assert.strictEqual(remainingPipelines.length, count / 2);
        });

        test('should tree provider reflect changes', async () => {
            const treeDataProvider = new PipelinesTreeDataProvider(pipelineManager);

            // Initially empty
            let children = await treeDataProvider.getChildren();
            assert.strictEqual(children.length, 0);

            // Add pipeline
            await pipelineManager.createPipeline('New Pipeline');
            treeDataProvider.refresh();

            children = await treeDataProvider.getChildren();
            assert.strictEqual(children.length, 1);

            treeDataProvider.dispose();
        });

        test('should handle pipelines with description', async () => {
            pipelineManager.ensurePipelinesFolderExists();
            const pipelinesFolder = pipelineManager.getPipelinesFolder();
            const filePath = path.join(pipelinesFolder, 'with-description.yaml');

            const content = `name: "Described Pipeline"
description: "This pipeline does something cool"
input:
  type: csv
  path: data.csv
map:
  prompt: Process
  output:
    - result
reduce:
  type: json
`;
            fs.writeFileSync(filePath, content);

            const pipelines = await pipelineManager.getPipelines();
            const pipeline = pipelines.find(p => p.name === 'Described Pipeline');

            assert.ok(pipeline);
            assert.strictEqual(pipeline?.description, 'This pipeline does something cool');
        });

        test('should mark invalid pipelines appropriately', async () => {
            // Create a valid pipeline
            await pipelineManager.createPipeline('Valid');

            // Create an invalid pipeline manually
            const pipelinesFolder = pipelineManager.getPipelinesFolder();
            fs.writeFileSync(
                path.join(pipelinesFolder, 'invalid.yaml'),
                'name: Invalid\n# Missing required fields'
            );

            const pipelines = await pipelineManager.getPipelines();
            const validPipeline = pipelines.find(p => p.name === 'Valid');
            const invalidPipeline = pipelines.find(p => p.name === 'Invalid');

            assert.ok(validPipeline?.isValid, 'Valid pipeline should be marked valid');
            assert.ok(!invalidPipeline?.isValid, 'Invalid pipeline should be marked invalid');
            assert.ok(invalidPipeline?.validationErrors, 'Invalid pipeline should have errors');
        });
    });

    suite('Edge Cases', () => {
        test('should handle empty YAML file', async () => {
            pipelineManager.ensurePipelinesFolderExists();
            const pipelinesFolder = pipelineManager.getPipelinesFolder();
            const filePath = path.join(pipelinesFolder, 'empty.yaml');

            fs.writeFileSync(filePath, '');

            const pipelines = await pipelineManager.getPipelines();
            const emptyPipeline = pipelines.find(p => p.fileName === 'empty.yaml');

            assert.ok(emptyPipeline);
            assert.strictEqual(emptyPipeline?.isValid, false);
        });

        test('should handle YAML with only comments', async () => {
            pipelineManager.ensurePipelinesFolderExists();
            const pipelinesFolder = pipelineManager.getPipelinesFolder();
            const filePath = path.join(pipelinesFolder, 'comments-only.yaml');

            fs.writeFileSync(filePath, '# This is just a comment\n# Another comment');

            const pipelines = await pipelineManager.getPipelines();
            const commentPipeline = pipelines.find(p => p.fileName === 'comments-only.yaml');

            assert.ok(commentPipeline);
            assert.strictEqual(commentPipeline?.isValid, false);
        });

        test('should use filename as fallback name for unparseable YAML', async () => {
            pipelineManager.ensurePipelinesFolderExists();
            const pipelinesFolder = pipelineManager.getPipelinesFolder();
            const filePath = path.join(pipelinesFolder, 'bad-yaml.yaml');

            fs.writeFileSync(filePath, 'this: is: not: valid: yaml:');

            const pipelines = await pipelineManager.getPipelines();
            const badPipeline = pipelines.find(p => p.fileName === 'bad-yaml.yaml');

            assert.ok(badPipeline);
            // Should use filename (without extension) as fallback name
            assert.strictEqual(badPipeline?.name, 'bad-yaml');
        });

        test('should handle special characters in pipeline name', async () => {
            const name = 'Pipeline (Test) [v1.0] {beta}';
            const filePath = await pipelineManager.createPipeline(name);

            assert.ok(fs.existsSync(filePath));

            const content = fs.readFileSync(filePath, 'utf8');
            assert.ok(content.includes(name));
        });

        test('should handle unicode in pipeline name', async () => {
            const name = 'Pipeline 日本語 🚀';
            const filePath = await pipelineManager.createPipeline(name);

            assert.ok(fs.existsSync(filePath));

            const content = fs.readFileSync(filePath, 'utf8');
            assert.ok(content.includes(name));
        });
    });
});
