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
    ResourceItem,
    PIPELINE_TEMPLATES,
    PipelineTemplateType,
    PipelineSource
} from '../../shortcuts/yaml-pipeline';

suite('Pipelines Viewer Tests (Package Structure)', () => {
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

    /**
     * Helper to create a pipeline package directory with pipeline.yaml
     */
    function createPipelinePackage(
        packageName: string,
        pipelineContent: string,
        resourceFiles?: { name: string; content: string }[]
    ): string {
        const pipelinesFolder = pipelineManager.getPipelinesFolder();
        if (!fs.existsSync(pipelinesFolder)) {
            fs.mkdirSync(pipelinesFolder, { recursive: true });
        }

        const packagePath = path.join(pipelinesFolder, packageName);
        fs.mkdirSync(packagePath, { recursive: true });

        fs.writeFileSync(path.join(packagePath, 'pipeline.yaml'), pipelineContent, 'utf8');

        if (resourceFiles) {
            for (const file of resourceFiles) {
                const filePath = path.join(packagePath, file.name);
                const fileDir = path.dirname(filePath);
                if (!fs.existsSync(fileDir)) {
                    fs.mkdirSync(fileDir, { recursive: true });
                }
                fs.writeFileSync(filePath, file.content, 'utf8');
            }
        }

        return packagePath;
    }

    /**
     * Generate valid pipeline YAML content
     */
    function validPipelineYAML(name: string, description?: string): string {
        return `name: "${name}"
${description ? `description: "${description}"\n` : ''}input:
  from:
    type: csv
    path: "input.csv"
map:
  prompt: |
    Process: {{title}}
  output:
    - result
reduce:
  type: json
`;
    }

    suite('PipelineManager - Package Structure', () => {
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

        suite('Pipeline Package Discovery', () => {
            test('should return empty array when no pipeline packages exist', async () => {
                pipelineManager.ensurePipelinesFolderExists();
                const pipelines = await pipelineManager.getPipelines();
                assert.strictEqual(pipelines.length, 0);
            });

            test('should discover pipeline packages with pipeline.yaml', async () => {
                createPipelinePackage('run-tests', validPipelineYAML('Run Tests'));
                createPipelinePackage('analyze-code', validPipelineYAML('Analyze Code'));

                const pipelines = await pipelineManager.getPipelines();
                assert.strictEqual(pipelines.length, 2);

                const names = pipelines.map(p => p.packageName).sort();
                assert.deepStrictEqual(names, ['analyze-code', 'run-tests']);
            });

            test('should discover pipeline packages with pipeline.yml', async () => {
                const pipelinesFolder = pipelineManager.getPipelinesFolder();
                fs.mkdirSync(pipelinesFolder, { recursive: true });

                const packagePath = path.join(pipelinesFolder, 'yml-pipeline');
                fs.mkdirSync(packagePath);
                fs.writeFileSync(
                    path.join(packagePath, 'pipeline.yml'),
                    validPipelineYAML('YML Pipeline'),
                    'utf8'
                );

                const pipelines = await pipelineManager.getPipelines();
                assert.strictEqual(pipelines.length, 1);
                assert.strictEqual(pipelines[0].packageName, 'yml-pipeline');
            });

            test('should ignore directories without pipeline.yaml', async () => {
                createPipelinePackage('valid-pipeline', validPipelineYAML('Valid'));

                // Create a directory without pipeline.yaml
                const pipelinesFolder = pipelineManager.getPipelinesFolder();
                const invalidDir = path.join(pipelinesFolder, 'not-a-pipeline');
                fs.mkdirSync(invalidDir, { recursive: true });
                fs.writeFileSync(path.join(invalidDir, 'random.txt'), 'Not a pipeline');

                const pipelines = await pipelineManager.getPipelines();
                assert.strictEqual(pipelines.length, 1);
                assert.strictEqual(pipelines[0].packageName, 'valid-pipeline');
            });

            test('should ignore loose YAML files in root (breaking change from flat structure)', async () => {
                pipelineManager.ensurePipelinesFolderExists();
                const pipelinesFolder = pipelineManager.getPipelinesFolder();

                // Create a loose YAML file in root (old flat structure)
                fs.writeFileSync(
                    path.join(pipelinesFolder, 'old-style.yaml'),
                    validPipelineYAML('Old Style'),
                    'utf8'
                );

                // Create a valid package
                createPipelinePackage('new-style', validPipelineYAML('New Style'));

                const pipelines = await pipelineManager.getPipelines();
                assert.strictEqual(pipelines.length, 1);
                assert.strictEqual(pipelines[0].packageName, 'new-style');
            });

            test('should populate pipeline properties from package', async () => {
                createPipelinePackage('test-package', validPipelineYAML('Test Pipeline', 'A test description'));

                const pipelines = await pipelineManager.getPipelines();
                assert.strictEqual(pipelines.length, 1);

                const pipeline = pipelines[0];
                assert.strictEqual(pipeline.packageName, 'test-package');
                assert.strictEqual(pipeline.name, 'Test Pipeline');
                assert.strictEqual(pipeline.description, 'A test description');
                assert.ok(pipeline.filePath.endsWith('pipeline.yaml'));
                assert.ok(pipeline.packagePath.endsWith('test-package'));
                assert.ok(pipeline.lastModified instanceof Date);
                assert.ok(pipeline.size > 0);
            });

            test('should use package name as fallback for name', async () => {
                const pipelinesFolder = pipelineManager.getPipelinesFolder();
                fs.mkdirSync(pipelinesFolder, { recursive: true });

                const packagePath = path.join(pipelinesFolder, 'no-name-field');
                fs.mkdirSync(packagePath);

                // YAML without name field
                fs.writeFileSync(path.join(packagePath, 'pipeline.yaml'), `
input:
  type: csv
  path: data.csv
map:
  prompt: Test
  output:
    - result
reduce:
  type: json
`, 'utf8');

                const pipelines = await pipelineManager.getPipelines();
                assert.strictEqual(pipelines.length, 1);
                assert.strictEqual(pipelines[0].name, 'no-name-field');
            });

            test('should get pipeline by package name', async () => {
                createPipelinePackage('find-me', validPipelineYAML('Find Me'));

                const pipeline = await pipelineManager.getPipeline('find-me');
                assert.ok(pipeline);
                assert.strictEqual(pipeline?.packageName, 'find-me');
                assert.strictEqual(pipeline?.name, 'Find Me');
            });

            test('should return undefined for non-existent package', async () => {
                const pipeline = await pipelineManager.getPipeline('non-existent');
                assert.strictEqual(pipeline, undefined);
            });
        });

        suite('Resource Files Discovery', () => {
            test('should discover resource files in package', async () => {
                createPipelinePackage('with-resources', validPipelineYAML('With Resources'), [
                    { name: 'input.csv', content: 'id,title\n1,Test' },
                    { name: 'config.json', content: '{}' }
                ]);

                const pipelines = await pipelineManager.getPipelines();
                assert.strictEqual(pipelines.length, 1);
                assert.ok(pipelines[0].resourceFiles);
                assert.strictEqual(pipelines[0].resourceFiles?.length, 2);

                const fileNames = pipelines[0].resourceFiles?.map(r => r.fileName).sort();
                assert.deepStrictEqual(fileNames, ['config.json', 'input.csv']);
            });

            test('should discover nested resource files', async () => {
                createPipelinePackage('nested-resources', validPipelineYAML('Nested Resources'), [
                    { name: 'input.csv', content: 'id,title\n1,Test' },
                    { name: 'data/files.csv', content: 'file,path\n1,src/' },
                    { name: 'templates/prompt.txt', content: 'Process: {{item}}' }
                ]);

                const pipelines = await pipelineManager.getPipelines();
                assert.strictEqual(pipelines.length, 1);
                assert.ok(pipelines[0].resourceFiles);
                assert.strictEqual(pipelines[0].resourceFiles?.length, 3);

                const relativePaths = pipelines[0].resourceFiles?.map(r => r.relativePath).sort();
                assert.ok(relativePaths?.some(p => p.includes('data')));
                assert.ok(relativePaths?.some(p => p.includes('templates')));
            });

            test('should identify correct file types', async () => {
                createPipelinePackage('file-types', validPipelineYAML('File Types'), [
                    { name: 'data.csv', content: 'a,b' },
                    { name: 'config.json', content: '{}' },
                    { name: 'readme.txt', content: 'text' },
                    { name: 'prompt.template', content: 'template' },
                    { name: 'other.xyz', content: 'other' }
                ]);

                const pipelines = await pipelineManager.getPipelines();
                const resources = pipelines[0].resourceFiles || [];

                const csv = resources.find(r => r.fileName === 'data.csv');
                const json = resources.find(r => r.fileName === 'config.json');
                const txt = resources.find(r => r.fileName === 'readme.txt');
                const template = resources.find(r => r.fileName === 'prompt.template');
                const other = resources.find(r => r.fileName === 'other.xyz');

                assert.strictEqual(csv?.fileType, 'csv');
                assert.strictEqual(json?.fileType, 'json');
                assert.strictEqual(txt?.fileType, 'txt');
                assert.strictEqual(template?.fileType, 'template');
                assert.strictEqual(other?.fileType, 'other');
            });

            test('should not include pipeline.yaml in resources', async () => {
                createPipelinePackage('exclude-pipeline', validPipelineYAML('Exclude Pipeline'), [
                    { name: 'input.csv', content: 'id\n1' }
                ]);

                const pipelines = await pipelineManager.getPipelines();
                const resources = pipelines[0].resourceFiles || [];

                assert.ok(!resources.some(r => r.fileName === 'pipeline.yaml'));
                assert.ok(!resources.some(r => r.fileName === 'pipeline.yml'));
            });
        });

        suite('Pipeline Package Creation', () => {
            test('should create a new pipeline package directory', async () => {
                const filePath = await pipelineManager.createPipeline('My First Pipeline');

                assert.ok(fs.existsSync(filePath), 'Pipeline file should exist');
                assert.ok(filePath.endsWith('pipeline.yaml'), 'Should be pipeline.yaml');

                const packagePath = path.dirname(filePath);
                assert.ok(fs.existsSync(packagePath), 'Package directory should exist');
            });

            test('should create sample input.csv in package', async () => {
                const filePath = await pipelineManager.createPipeline('With Sample CSV');
                const packagePath = path.dirname(filePath);

                const csvPath = path.join(packagePath, 'input.csv');
                assert.ok(fs.existsSync(csvPath), 'input.csv should exist');

                const content = fs.readFileSync(csvPath, 'utf8');
                assert.ok(content.includes('id,title,description'), 'CSV should have headers');
            });

            test('should sanitize package name', async () => {
                const filePath = await pipelineManager.createPipeline('Pipeline: With <Special> Chars!');
                const packagePath = path.dirname(filePath);
                const packageName = path.basename(packagePath);

                assert.ok(!packageName.includes(':'), 'Should not contain colon');
                assert.ok(!packageName.includes('<'), 'Should not contain <');
                assert.ok(!packageName.includes('>'), 'Should not contain >');
            });

            test('should throw error if package already exists', async () => {
                await pipelineManager.createPipeline('Duplicate Pipeline');

                await assert.rejects(
                    async () => await pipelineManager.createPipeline('Duplicate Pipeline'),
                    /already exists/i
                );
            });

            test('should create pipeline with template containing package-relative path', async () => {
                const filePath = await pipelineManager.createPipeline('Test Pipeline');
                const content = fs.readFileSync(filePath, 'utf8');

                // Check that template uses relative paths
                assert.ok(content.includes('path: "input.csv"'), 'Should have relative path to input.csv');
            });
        });

        suite('Pipeline Package Renaming', () => {
            test('should rename a pipeline package directory', async () => {
                const originalPath = await pipelineManager.createPipeline('Original Name');
                const originalPackagePath = path.dirname(originalPath);

                const newPath = await pipelineManager.renamePipeline(originalPath, 'New Name');
                const newPackagePath = path.dirname(newPath);

                assert.ok(!fs.existsSync(originalPackagePath), 'Original package should not exist');
                assert.ok(fs.existsSync(newPackagePath), 'New package should exist');
                assert.ok(fs.existsSync(newPath), 'pipeline.yaml should exist in new location');
            });

            test('should update name field in YAML when renaming', async () => {
                const originalPath = await pipelineManager.createPipeline('Original');
                const newPath = await pipelineManager.renamePipeline(originalPath, 'Renamed');

                const content = fs.readFileSync(newPath, 'utf8');
                assert.ok(content.includes('Renamed'), 'Name should be updated in YAML');
            });

            test('should preserve resource files when renaming', async () => {
                const originalPath = await pipelineManager.createPipeline('To Rename');
                const originalPackagePath = path.dirname(originalPath);

                // Add extra resource file
                fs.writeFileSync(path.join(originalPackagePath, 'extra.csv'), 'col1\nval1');

                const newPath = await pipelineManager.renamePipeline(originalPath, 'Renamed');
                const newPackagePath = path.dirname(newPath);

                // Check all files exist in new location
                assert.ok(fs.existsSync(path.join(newPackagePath, 'pipeline.yaml')));
                assert.ok(fs.existsSync(path.join(newPackagePath, 'input.csv')));
                assert.ok(fs.existsSync(path.join(newPackagePath, 'extra.csv')));
            });

            test('should throw error when renaming to existing package name', async () => {
                const path1 = await pipelineManager.createPipeline('Pipeline One');
                await pipelineManager.createPipeline('Pipeline Two');

                await assert.rejects(
                    async () => await pipelineManager.renamePipeline(path1, 'Pipeline-Two'),
                    /already exists/i
                );
            });

            test('should throw error when package not found', async () => {
                await assert.rejects(
                    async () => await pipelineManager.renamePipeline('/non/existent/pipeline.yaml', 'New Name'),
                    /not found/i
                );
            });
        });

        suite('Pipeline Package Deletion', () => {
            test('should delete entire pipeline package directory', async () => {
                const filePath = await pipelineManager.createPipeline('To Delete');
                const packagePath = path.dirname(filePath);

                assert.ok(fs.existsSync(packagePath));

                await pipelineManager.deletePipeline(filePath);
                assert.ok(!fs.existsSync(packagePath), 'Package directory should be deleted');
            });

            test('should delete package with nested resource directories', async () => {
                createPipelinePackage('nested-delete', validPipelineYAML('Nested Delete'), [
                    { name: 'data/input.csv', content: 'id\n1' },
                    { name: 'templates/prompt.txt', content: 'text' }
                ]);

                const pipelines = await pipelineManager.getPipelines();
                const pipeline = pipelines[0];

                await pipelineManager.deletePipeline(pipeline.filePath);
                assert.ok(!fs.existsSync(pipeline.packagePath), 'Package should be deleted');
            });

            test('should throw error when package not found', async () => {
                await assert.rejects(
                    async () => await pipelineManager.deletePipeline('/non/existent/pipeline.yaml'),
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

            test('should detect missing input file as warning', async () => {
                createPipelinePackage('missing-csv', `
name: "Missing CSV"
input:
  from:
    type: csv
    path: "nonexistent.csv"
map:
  prompt: Test
  output:
    - result
reduce:
  type: json
`);

                const pipelines = await pipelineManager.getPipelines();
                const result = await pipelineManager.validatePipeline(pipelines[0].filePath);

                // Missing CSV is a warning, not an error (pipeline structure is valid)
                assert.ok(result.warnings.some(w => w.includes('not found')));
            });

            test('should detect missing name field', async () => {
                createPipelinePackage('no-name', `
input:
  from:
    type: csv
    path: data.csv
map:
  prompt: Test
  output:
    - result
reduce:
  type: json
`);

                const pipelines = await pipelineManager.getPipelines();
                const result = await pipelineManager.validatePipeline(pipelines[0].filePath);

                assert.strictEqual(result.valid, false);
                assert.ok(result.errors.some(e => e.includes('name')));
            });

            test('should detect unsupported input type', async () => {
                createPipelinePackage('bad-input', `
name: "Bad Input Type"
input:
  from:
    type: json
    path: data.json
map:
  prompt: Test
  output:
    - result
reduce:
  type: json
`);

                const pipelines = await pipelineManager.getPipelines();
                const result = await pipelineManager.validatePipeline(pipelines[0].filePath);

                assert.strictEqual(result.valid, false);
                assert.ok(result.errors.some(e => e.includes('input') && e.includes('type')));
            });

            test('should detect old input format and provide helpful error', async () => {
                createPipelinePackage('old-format', `
name: "Old Format"
input:
  type: csv
  path: data.csv
map:
  prompt: Test
  output:
    - result
reduce:
  type: json
`);

                const pipelines = await pipelineManager.getPipelines();
                const result = await pipelineManager.validatePipeline(pipelines[0].filePath);

                assert.strictEqual(result.valid, false);
                assert.ok(result.errors.some(e => e.includes('input.from')), 'Should mention correct format');
            });

            test('should validate inline items input', async () => {
                createPipelinePackage('inline-items', `
name: "Inline Items"
input:
  items:
    - title: "Item 1"
    - title: "Item 2"
map:
  prompt: "Process: {{title}}"
  output:
    - result
reduce:
  type: json
`);

                const pipelines = await pipelineManager.getPipelines();
                const result = await pipelineManager.validatePipeline(pipelines[0].filePath);

                assert.strictEqual(result.valid, true);
            });

            test('should reject having both items and from', async () => {
                createPipelinePackage('both-inputs', `
name: "Both Inputs"
input:
  items:
    - title: "Item 1"
  from:
    type: csv
    path: data.csv
map:
  prompt: Test
  output:
    - result
reduce:
  type: json
`);

                const pipelines = await pipelineManager.getPipelines();
                const result = await pipelineManager.validatePipeline(pipelines[0].filePath);

                assert.strictEqual(result.valid, false);
                assert.ok(result.errors.some(e => e.includes('multiple sources')));
            });

            test('should validate inline array in from (multi-model fanout)', async () => {
                createPipelinePackage('multi-model', `
name: "Multi-Model Fanout"
input:
  from:
    - model: gpt-4
    - model: claude-sonnet
    - model: gemini-pro
  parameters:
    - name: code
      value: "const x = 1;"
map:
  prompt: "Review: {{code}}"
  output:
    - verdict
    - reasoning
  model: "{{model}}"
reduce:
  type: ai
  prompt: |
    Models responded:
    {{RESULTS}}
    Identify consensus.
  output:
    - consensus
    - conflicts
`);

                const pipelines = await pipelineManager.getPipelines();
                const result = await pipelineManager.validatePipeline(pipelines[0].filePath);

                assert.strictEqual(result.valid, true, `Validation errors: ${result.errors.join(', ')}`);
                assert.strictEqual(result.errors.length, 0);
            });

            test('should warn for empty inline array in from', async () => {
                createPipelinePackage('empty-from', `
name: "Empty From Array"
input:
  from: []
map:
  prompt: "Test"
  output:
    - result
reduce:
  type: list
`);

                const pipelines = await pipelineManager.getPipelines();
                const result = await pipelineManager.validatePipeline(pipelines[0].filePath);

                assert.strictEqual(result.valid, true);
                assert.ok(result.warnings.some(w => w.includes('empty')));
            });
        });

        suite('Path Resolution', () => {
            test('should resolve relative path from package directory', () => {
                // Use tempDir which is fully qualified on all platforms
                const packagePath = path.join(tempDir, '.vscode', 'pipelines', 'run-tests');

                const result = pipelineManager.resolveResourcePath('input.csv', packagePath);
                assert.strictEqual(result, path.join(packagePath, 'input.csv'));
            });

            test('should resolve nested relative path', () => {
                // Use tempDir which is fully qualified on all platforms
                const packagePath = path.join(tempDir, '.vscode', 'pipelines', 'run-tests');

                const result = pipelineManager.resolveResourcePath('data/files.csv', packagePath);
                assert.strictEqual(result, path.join(packagePath, 'data', 'files.csv'));
            });

            test('should resolve parent directory reference', () => {
                // Use tempDir which is fully qualified on all platforms
                const packagePath = path.join(tempDir, '.vscode', 'pipelines', 'run-tests');

                const result = pipelineManager.resolveResourcePath('../shared/common.csv', packagePath);
                assert.strictEqual(result, path.resolve(packagePath, '../shared/common.csv'));
            });

            test('should preserve absolute paths', () => {
                // Use tempDir which is fully qualified on all platforms
                const packagePath = path.join(tempDir, '.vscode', 'pipelines', 'run-tests');
                // Create an absolute path using tempDir to ensure it's valid on all platforms
                const absolutePath = path.join(tempDir, 'absolute', 'path', 'to', 'file.csv');

                const result = pipelineManager.resolveResourcePath(absolutePath, packagePath);
                assert.strictEqual(result, absolutePath);
            });
        });

        suite('File Watching', () => {
            test('should call refresh callback on package changes', function (done) {
                this.timeout(5000);

                pipelineManager.ensurePipelinesFolderExists();

                let callCount = 0;
                pipelineManager.watchPipelinesFolder(() => {
                    callCount++;
                    if (callCount === 1) {
                        done();
                    }
                });

                // Create a new pipeline package after watcher is set up
                setTimeout(async () => {
                    await pipelineManager.createPipeline('trigger-watch');
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
                packageName: 'test-pipeline',
                packagePath: '/path/to/test-pipeline',
                filePath: '/path/to/test-pipeline/pipeline.yaml',
                relativePath: '.vscode/pipelines/test-pipeline',
                name: 'Test Pipeline',
                description: 'A test pipeline',
                lastModified: new Date(),
                size: 1024,
                isValid: true,
                resourceFiles: [],
                source: PipelineSource.Workspace
            };

            const item = new PipelineItem(pipeline);

            assert.strictEqual(item.label, 'Test Pipeline');
            assert.strictEqual(item.description, 'test-pipeline');
            assert.strictEqual(item.contextValue, 'pipeline');
            assert.strictEqual(item.itemType, 'package');
        });

        test('should be collapsible when has resource files', () => {
            const pipeline: PipelineInfo = {
                packageName: 'with-resources',
                packagePath: '/path/to/with-resources',
                filePath: '/path/to/with-resources/pipeline.yaml',
                relativePath: '.vscode/pipelines/with-resources',
                name: 'With Resources',
                lastModified: new Date(),
                size: 1024,
                isValid: true,
                resourceFiles: [
                    {
                        fileName: 'input.csv',
                        filePath: '/path/to/with-resources/input.csv',
                        relativePath: 'input.csv',
                        size: 100,
                        fileType: 'csv'
                    }
                ],
                source: PipelineSource.Workspace
            };

            const item = new PipelineItem(pipeline);

            assert.strictEqual(item.collapsibleState, vscode.TreeItemCollapsibleState.Collapsed);
        });

        test('should not be collapsible when no resource files', () => {
            const pipeline: PipelineInfo = {
                packageName: 'no-resources',
                packagePath: '/path/to/no-resources',
                filePath: '/path/to/no-resources/pipeline.yaml',
                relativePath: '.vscode/pipelines/no-resources',
                name: 'No Resources',
                lastModified: new Date(),
                size: 1024,
                isValid: true,
                resourceFiles: [],
                source: PipelineSource.Workspace
            };

            const item = new PipelineItem(pipeline);

            assert.strictEqual(item.collapsibleState, vscode.TreeItemCollapsibleState.None);
        });

        test('should set correct context value for invalid pipeline', () => {
            const pipeline: PipelineInfo = {
                packageName: 'invalid',
                packagePath: '/path/to/invalid',
                filePath: '/path/to/invalid/pipeline.yaml',
                relativePath: '.vscode/pipelines/invalid',
                name: 'Invalid Pipeline',
                lastModified: new Date(),
                size: 100,
                isValid: false,
                validationErrors: ['Missing input field'],
                source: PipelineSource.Workspace
            };

            const item = new PipelineItem(pipeline);

            assert.strictEqual(item.contextValue, 'pipeline_invalid');
        });

        test('should set open command', () => {
            const pipeline: PipelineInfo = {
                packageName: 'pipeline',
                packagePath: '/path/to/pipeline',
                filePath: '/path/to/pipeline/pipeline.yaml',
                relativePath: '.vscode/pipelines/pipeline',
                name: 'Pipeline',
                lastModified: new Date(),
                size: 500,
                isValid: true,
                source: PipelineSource.Workspace
            };

            const item = new PipelineItem(pipeline);

            assert.ok(item.command);
            assert.strictEqual(item.command.command, 'vscode.open');
            assert.ok(item.command.arguments);
            assert.strictEqual(item.command.arguments.length, 1);
        });

        test('should have tooltip with package details', () => {
            const pipeline: PipelineInfo = {
                packageName: 'pipeline',
                packagePath: '/path/to/pipeline',
                filePath: '/path/to/pipeline/pipeline.yaml',
                relativePath: '.vscode/pipelines/pipeline',
                name: 'My Pipeline',
                description: 'This is a test pipeline',
                lastModified: new Date(),
                size: 2048,
                isValid: true,
                resourceFiles: [
                    { fileName: 'a.csv', filePath: '', relativePath: '', size: 10, fileType: 'csv' }
                ],
                source: PipelineSource.Workspace
            };

            const item = new PipelineItem(pipeline);
            assert.ok(item.tooltip);
            assert.ok(item.tooltip instanceof vscode.MarkdownString);
        });
    });

    suite('ResourceItem', () => {
        test('should create resource item with correct properties', () => {
            const pipeline: PipelineInfo = {
                packageName: 'test',
                packagePath: '/path/to/test',
                filePath: '/path/to/test/pipeline.yaml',
                relativePath: '.vscode/pipelines/test',
                name: 'Test',
                lastModified: new Date(),
                size: 100,
                isValid: true,
                source: PipelineSource.Workspace
            };

            const resource = {
                fileName: 'input.csv',
                filePath: '/path/to/test/input.csv',
                relativePath: 'input.csv',
                size: 256,
                fileType: 'csv' as const
            };

            const item = new ResourceItem(resource, pipeline);

            assert.strictEqual(item.label, 'input.csv');
            assert.strictEqual(item.contextValue, 'resource');
            assert.strictEqual(item.itemType, 'resource');
            assert.strictEqual(item.collapsibleState, vscode.TreeItemCollapsibleState.None);
        });

        test('should display nested path for nested resources', () => {
            const pipeline: PipelineInfo = {
                packageName: 'test',
                packagePath: '/path/to/test',
                filePath: '/path/to/test/pipeline.yaml',
                relativePath: '.vscode/pipelines/test',
                name: 'Test',
                lastModified: new Date(),
                size: 100,
                isValid: true,
                source: PipelineSource.Workspace
            };

            const resource = {
                fileName: 'files.csv',
                filePath: '/path/to/test/data/files.csv',
                relativePath: 'data/files.csv',
                size: 256,
                fileType: 'csv' as const
            };

            const item = new ResourceItem(resource, pipeline);

            assert.strictEqual(item.label, 'data/files.csv');
        });

        test('should set open command', () => {
            const pipeline: PipelineInfo = {
                packageName: 'test',
                packagePath: '/path/to/test',
                filePath: '/path/to/test/pipeline.yaml',
                relativePath: '.vscode/pipelines/test',
                name: 'Test',
                lastModified: new Date(),
                size: 100,
                isValid: true,
                source: PipelineSource.Workspace
            };

            const resource = {
                fileName: 'input.csv',
                filePath: '/path/to/test/input.csv',
                relativePath: 'input.csv',
                size: 256,
                fileType: 'csv' as const
            };

            const item = new ResourceItem(resource, pipeline);

            assert.ok(item.command);
            assert.strictEqual(item.command.command, 'vscode.open');
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

        test('should return category items when no pipeline packages', async () => {
            pipelineManager.ensurePipelinesFolderExists();
            const children = await treeDataProvider.getChildren();
            // Should have workspace category (folder exists)
            assert.ok(children.length >= 1);
            assert.ok(children.every(c => c.itemType === 'category'));
        });

        test('should return pipeline package items under workspace category', async () => {
            createPipelinePackage('package-1', validPipelineYAML('Pipeline 1'));
            createPipelinePackage('package-2', validPipelineYAML('Pipeline 2'));

            const categories = await treeDataProvider.getChildren();
            // Find workspace category
            const workspaceCategory = categories.find(c => 
                c.itemType === 'category' && (c as any).categoryType === 'workspace'
            );
            assert.ok(workspaceCategory, 'Should have workspace category');
            
            const pipelines = await treeDataProvider.getChildren(workspaceCategory);
            assert.strictEqual(pipelines.length, 2);
            assert.ok(pipelines.every(c => c instanceof PipelineItem));
        });

        test('should return resource items for pipeline children', async () => {
            createPipelinePackage('with-resources', validPipelineYAML('With Resources'), [
                { name: 'input.csv', content: 'id\n1' },
                { name: 'config.json', content: '{}' }
            ]);

            const categories = await treeDataProvider.getChildren();
            const workspaceCategory = categories.find(c => 
                c.itemType === 'category' && (c as any).categoryType === 'workspace'
            );
            const pipelines = await treeDataProvider.getChildren(workspaceCategory);
            const pipelineItem = pipelines[0] as PipelineItem;

            const resources = await treeDataProvider.getChildren(pipelineItem);
            assert.strictEqual(resources.length, 2);
            assert.ok(resources.every(r => r instanceof ResourceItem));
        });

        test('should return empty array for resource children', async () => {
            createPipelinePackage('with-resources', validPipelineYAML('With Resources'), [
                { name: 'input.csv', content: 'id\n1' }
            ]);

            const categories = await treeDataProvider.getChildren();
            const workspaceCategory = categories.find(c => 
                c.itemType === 'category' && (c as any).categoryType === 'workspace'
            );
            const pipelines = await treeDataProvider.getChildren(workspaceCategory);
            const pipelineItem = pipelines[0] as PipelineItem;
            const resources = await treeDataProvider.getChildren(pipelineItem);
            const resourceItem = resources[0] as ResourceItem;

            const resourceChildren = await treeDataProvider.getChildren(resourceItem);
            assert.strictEqual(resourceChildren.length, 0);
        });

        test('should fire change event on refresh', (done) => {
            const disposable = treeDataProvider.onDidChangeTreeData(() => {
                disposable.dispose();
                done();
            });

            treeDataProvider.refresh();
        });

        test('should filter pipelines by name', async () => {
            createPipelinePackage('apple-pipeline', validPipelineYAML('Apple Pipeline'));
            createPipelinePackage('banana-pipeline', validPipelineYAML('Banana Pipeline'));
            createPipelinePackage('cherry-pipeline', validPipelineYAML('Cherry Pipeline'));

            treeDataProvider.setFilter('banana');

            const categories = await treeDataProvider.getChildren();
            const workspaceCategory = categories.find(c => 
                c.itemType === 'category' && (c as any).categoryType === 'workspace'
            );
            assert.ok(workspaceCategory);
            const pipelines = await treeDataProvider.getChildren(workspaceCategory);
            assert.strictEqual(pipelines.length, 1);
            assert.strictEqual((pipelines[0] as PipelineItem).label, 'Banana Pipeline');
        });

        test('should filter pipelines by package name', async () => {
            createPipelinePackage('test-one', validPipelineYAML('Test One'));
            createPipelinePackage('test-two', validPipelineYAML('Test Two'));

            treeDataProvider.setFilter('test-one');

            const categories = await treeDataProvider.getChildren();
            const workspaceCategory = categories.find(c => 
                c.itemType === 'category' && (c as any).categoryType === 'workspace'
            );
            assert.ok(workspaceCategory);
            const pipelines = await treeDataProvider.getChildren(workspaceCategory);
            assert.strictEqual(pipelines.length, 1);
        });

        test('should clear filter', async () => {
            createPipelinePackage('package-1', validPipelineYAML('Pipeline 1'));
            createPipelinePackage('package-2', validPipelineYAML('Pipeline 2'));

            treeDataProvider.setFilter('1');
            let categories = await treeDataProvider.getChildren();
            let workspaceCategory = categories.find(c => 
                c.itemType === 'category' && (c as any).categoryType === 'workspace'
            );
            let pipelines = await treeDataProvider.getChildren(workspaceCategory);
            assert.strictEqual(pipelines.length, 1);

            treeDataProvider.clearFilter();
            categories = await treeDataProvider.getChildren();
            workspaceCategory = categories.find(c => 
                c.itemType === 'category' && (c as any).categoryType === 'workspace'
            );
            pipelines = await treeDataProvider.getChildren(workspaceCategory);
            assert.strictEqual(pipelines.length, 2);
        });

        test('should sort pipelines by name', async () => {
            createPipelinePackage('zebra', validPipelineYAML('Zebra'));
            createPipelinePackage('apple', validPipelineYAML('Apple'));
            createPipelinePackage('mango', validPipelineYAML('Mango'));

            const categories = await treeDataProvider.getChildren();
            const workspaceCategory = categories.find(c => 
                c.itemType === 'category' && (c as any).categoryType === 'workspace'
            );
            const pipelines = await treeDataProvider.getChildren(workspaceCategory);
            const names = pipelines.map(c => (c as PipelineItem).label);

            assert.strictEqual(names[0], 'Apple');
            assert.strictEqual(names[1], 'Mango');
            assert.strictEqual(names[2], 'Zebra');
        });

        test('should return tree item unchanged', () => {
            const pipeline: PipelineInfo = {
                packageName: 'test',
                packagePath: '/path/to/test',
                filePath: '/path/to/test/pipeline.yaml',
                relativePath: '.vscode/pipelines/test',
                name: 'Test',
                lastModified: new Date(),
                size: 100,
                isValid: true,
                source: PipelineSource.Workspace
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
        test('should complete full pipeline package lifecycle', async () => {
            // Create pipeline package
            const filePath = await pipelineManager.createPipeline('Lifecycle Pipeline');
            const packagePath = path.dirname(filePath);
            assert.ok(fs.existsSync(packagePath));

            // Verify in list
            let pipelines = await pipelineManager.getPipelines();
            assert.strictEqual(pipelines.length, 1);
            assert.strictEqual(pipelines[0].packageName, 'Lifecycle-Pipeline');

            // Validate pipeline
            const validation = await pipelineManager.validatePipeline(filePath);
            assert.strictEqual(validation.valid, true);

            // Rename pipeline package
            const renamedPath = await pipelineManager.renamePipeline(filePath, 'Renamed Pipeline');
            assert.ok(fs.existsSync(path.dirname(renamedPath)));

            // Verify rename
            pipelines = await pipelineManager.getPipelines();
            assert.strictEqual(pipelines.length, 1);
            assert.strictEqual(pipelines[0].name, 'Renamed Pipeline');

            // Delete pipeline package
            await pipelineManager.deletePipeline(renamedPath);
            pipelines = await pipelineManager.getPipelines();
            assert.strictEqual(pipelines.length, 0);
        });

        test('should tree provider reflect package hierarchy', async () => {
            const treeDataProvider = new PipelinesTreeDataProvider(pipelineManager);

            // Create package with resources
            createPipelinePackage('hierarchical', validPipelineYAML('Hierarchical'), [
                { name: 'input.csv', content: 'id\n1' },
                { name: 'data/nested.csv', content: 'col\nval' }
            ]);

            // Get root items (categories)
            const categories = await treeDataProvider.getChildren();
            assert.ok(categories.length >= 1);

            // Get workspace category and its pipelines
            const workspaceCategory = categories.find(c => 
                c.itemType === 'category' && (c as any).categoryType === 'workspace'
            );
            assert.ok(workspaceCategory);
            const pipelines = await treeDataProvider.getChildren(workspaceCategory);
            assert.strictEqual(pipelines.length, 1);

            // Get children (resources)
            const resources = await treeDataProvider.getChildren(pipelines[0]);
            assert.strictEqual(resources.length, 2);

            // Resources should have no children
            const noChildren = await treeDataProvider.getChildren(resources[0]);
            assert.strictEqual(noChildren.length, 0);

            treeDataProvider.dispose();
        });

        test('should handle shared resources directory', async () => {
            // Create a shared resources directory
            const pipelinesFolder = pipelineManager.getPipelinesFolder();
            fs.mkdirSync(pipelinesFolder, { recursive: true });

            const sharedDir = path.join(pipelinesFolder, 'shared');
            fs.mkdirSync(sharedDir);
            fs.writeFileSync(path.join(sharedDir, 'common.csv'), 'id,name\n1,shared');

            // Create pipeline that references shared resource
            createPipelinePackage('uses-shared', `
name: "Uses Shared"
input:
  type: csv
  path: "../shared/common.csv"
map:
  prompt: Test
  output:
    - result
reduce:
  type: json
`);

            const pipelines = await pipelineManager.getPipelines();
            assert.strictEqual(pipelines.length, 1);

            // Shared directory should not appear as a pipeline (no pipeline.yaml)
            const packageNames = pipelines.map(p => p.packageName);
            assert.ok(!packageNames.includes('shared'));
        });
    });

    suite('Pipeline Templates', () => {
        test('should have all expected template types defined', () => {
            assert.ok(PIPELINE_TEMPLATES['custom'], 'Custom template should exist');
            assert.ok(PIPELINE_TEMPLATES['data-fanout'], 'Data fanout template should exist');
            assert.ok(PIPELINE_TEMPLATES['model-fanout'], 'Model fanout template should exist');
        });

        test('should have correct template properties', () => {
            const customTemplate = PIPELINE_TEMPLATES['custom'];
            assert.strictEqual(customTemplate.type, 'custom');
            assert.ok(customTemplate.displayName.length > 0, 'Should have display name');
            assert.ok(customTemplate.description.length > 0, 'Should have description');
            assert.ok(customTemplate.sampleCSV.length > 0, 'Should have sample CSV');

            const dataFanoutTemplate = PIPELINE_TEMPLATES['data-fanout'];
            assert.strictEqual(dataFanoutTemplate.type, 'data-fanout');
            assert.ok(dataFanoutTemplate.displayName.includes('Data'), 'Data fanout should mention data');

            const modelFanoutTemplate = PIPELINE_TEMPLATES['model-fanout'];
            assert.strictEqual(modelFanoutTemplate.type, 'model-fanout');
            assert.ok(modelFanoutTemplate.displayName.includes('Model'), 'Model fanout should mention model');
        });

        test('should create pipeline with custom template (default)', async () => {
            const filePath = await pipelineManager.createPipeline('Custom Pipeline');

            assert.ok(fs.existsSync(filePath), 'Pipeline file should exist');

            const content = fs.readFileSync(filePath, 'utf8');
            assert.ok(content.includes('name: "Custom Pipeline"'), 'Should have pipeline name');
            assert.ok(content.includes('from:'), 'Should have input.from section');
            assert.ok(content.includes('type: csv'), 'Should have CSV input type');
        });

        test('should create pipeline with data-fanout template', async () => {
            const filePath = await pipelineManager.createPipelineFromTemplate('Data Pipeline', 'data-fanout');

            assert.ok(fs.existsSync(filePath), 'Pipeline file should exist');

            const content = fs.readFileSync(filePath, 'utf8');
            assert.ok(content.includes('name: "Data Pipeline"'), 'Should have pipeline name');
            assert.ok(content.includes('Template: Data Fanout'), 'Should have template comment');
            assert.ok(content.includes('parallel:'), 'Should have parallel setting');
            assert.ok(content.includes('themes'), 'Should have themes output field');
            assert.ok(content.includes('sentiment'), 'Should have sentiment output field');
            assert.ok(content.includes('executiveSummary'), 'Should have executiveSummary in reduce');
        });

        test('should create pipeline with model-fanout template', async () => {
            const filePath = await pipelineManager.createPipelineFromTemplate('Model Comparison', 'model-fanout');

            assert.ok(fs.existsSync(filePath), 'Pipeline file should exist');

            const content = fs.readFileSync(filePath, 'utf8');
            assert.ok(content.includes('name: "Model Comparison"'), 'Should have pipeline name');
            assert.ok(content.includes('Template: Model Fanout'), 'Should have template comment');
            assert.ok(content.includes('model: gpt-4'), 'Should have gpt-4 model');
            assert.ok(content.includes('model: claude-sonnet'), 'Should have claude-sonnet model');
            assert.ok(content.includes('model: gemini-pro'), 'Should have gemini-pro model');
            assert.ok(content.includes('parameters:'), 'Should have parameters section');
            assert.ok(content.includes('model: "{{model}}"'), 'Should have dynamic model reference');
            assert.ok(content.includes('consensus'), 'Should have consensus in reduce output');
            assert.ok(content.includes('conflicts'), 'Should have conflicts in reduce output');
        });

        test('should create correct sample CSV for data-fanout template', async () => {
            const filePath = await pipelineManager.createPipelineFromTemplate('Data Test', 'data-fanout');
            const packagePath = path.dirname(filePath);
            const csvPath = path.join(packagePath, 'input.csv');

            assert.ok(fs.existsSync(csvPath), 'input.csv should exist');

            const csvContent = fs.readFileSync(csvPath, 'utf8');
            assert.ok(csvContent.includes('id,title,content'), 'Should have correct headers');
            assert.ok(csvContent.includes('Document 1'), 'Should have sample data');
        });

        test('should create correct sample CSV for model-fanout template', async () => {
            const filePath = await pipelineManager.createPipelineFromTemplate('Model Test', 'model-fanout');
            const packagePath = path.dirname(filePath);
            const csvPath = path.join(packagePath, 'input.csv');

            assert.ok(fs.existsSync(csvPath), 'input.csv should exist');

            const csvContent = fs.readFileSync(csvPath, 'utf8');
            assert.ok(csvContent.includes('model'), 'Should have model header');
            assert.ok(csvContent.includes('gpt-4'), 'Should have gpt-4 model');
            assert.ok(csvContent.includes('claude-sonnet'), 'Should have claude-sonnet model');
        });

        test('should validate data-fanout pipeline as valid', async () => {
            const filePath = await pipelineManager.createPipelineFromTemplate('Valid Data Fanout', 'data-fanout');
            const validation = await pipelineManager.validatePipeline(filePath);

            assert.strictEqual(validation.valid, true, `Validation errors: ${validation.errors.join(', ')}`);
        });

        test('should validate model-fanout pipeline as valid', async () => {
            const filePath = await pipelineManager.createPipelineFromTemplate('Valid Model Fanout', 'model-fanout');
            const validation = await pipelineManager.validatePipeline(filePath);

            assert.strictEqual(validation.valid, true, `Validation errors: ${validation.errors.join(', ')}`);
        });

        test('should create pipeline with explicit custom template type', async () => {
            const filePath = await pipelineManager.createPipelineFromTemplate('Explicit Custom', 'custom');

            assert.ok(fs.existsSync(filePath), 'Pipeline file should exist');

            const content = fs.readFileSync(filePath, 'utf8');
            assert.ok(content.includes('name: "Explicit Custom"'), 'Should have pipeline name');
            // Custom template should NOT have the "Template:" comment
            assert.ok(!content.includes('Template: Data Fanout'), 'Should not have data fanout comment');
            assert.ok(!content.includes('Template: Model Fanout'), 'Should not have model fanout comment');
        });

        test('should throw error when creating duplicate pipeline from template', async () => {
            await pipelineManager.createPipelineFromTemplate('Duplicate Test', 'data-fanout');

            await assert.rejects(
                async () => await pipelineManager.createPipelineFromTemplate('Duplicate Test', 'model-fanout'),
                /already exists/i
            );
        });

        test('should sanitize pipeline name when creating from template', async () => {
            const filePath = await pipelineManager.createPipelineFromTemplate('Pipeline: With <Special> Chars!', 'data-fanout');
            const packagePath = path.dirname(filePath);
            const packageName = path.basename(packagePath);

            assert.ok(!packageName.includes(':'), 'Should not contain colon');
            assert.ok(!packageName.includes('<'), 'Should not contain <');
            assert.ok(!packageName.includes('>'), 'Should not contain >');
        });

        test('should handle all template types in a loop', async () => {
            const templateTypes: PipelineTemplateType[] = ['custom', 'data-fanout', 'model-fanout'];

            for (const templateType of templateTypes) {
                const name = `Loop Test ${templateType}`;
                const filePath = await pipelineManager.createPipelineFromTemplate(name, templateType);

                assert.ok(fs.existsSync(filePath), `Pipeline file should exist for ${templateType}`);

                const validation = await pipelineManager.validatePipeline(filePath);
                assert.strictEqual(validation.valid, true, `${templateType} should be valid: ${validation.errors.join(', ')}`);
            }
        });
    });

    suite('Edge Cases', () => {
        test('should handle empty pipeline package (only pipeline.yaml)', async () => {
            createPipelinePackage('empty-package', validPipelineYAML('Empty Package'));

            const pipelines = await pipelineManager.getPipelines();
            assert.strictEqual(pipelines.length, 1);
            assert.strictEqual(pipelines[0].resourceFiles?.length, 0);
        });

        test('should handle YAML with only comments', async () => {
            createPipelinePackage('comments-only', '# This is just a comment\n# Another comment');

            const pipelines = await pipelineManager.getPipelines();
            assert.strictEqual(pipelines.length, 1);
            assert.strictEqual(pipelines[0].isValid, false);
        });

        test('should use package name as fallback name for unparseable YAML', async () => {
            createPipelinePackage('bad-yaml', 'this: is: not: valid: yaml:');

            const pipelines = await pipelineManager.getPipelines();
            assert.strictEqual(pipelines.length, 1);
            assert.strictEqual(pipelines[0].name, 'bad-yaml');
        });

        test('should handle special characters in package name', async () => {
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

        test('should handle deeply nested resource files', async () => {
            createPipelinePackage('deeply-nested', validPipelineYAML('Deeply Nested'), [
                { name: 'a/b/c/d/deep.csv', content: 'id\n1' }
            ]);

            const pipelines = await pipelineManager.getPipelines();
            assert.strictEqual(pipelines.length, 1);

            const resources = pipelines[0].resourceFiles || [];
            assert.strictEqual(resources.length, 1);
            assert.ok(resources[0].relativePath.includes('a/b/c/d') || resources[0].relativePath.includes('a\\b\\c\\d'));
        });
    });
});
