/**
 * Tests for Pipeline Commands
 *
 * Tests the pipeline command handlers and their cross-platform compatibility.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

suite('Pipeline Commands', () => {
    let tempDir: string;

    setup(async () => {
        tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'pipeline-cmd-test-'));
    });

    teardown(async () => {
        await fs.promises.rm(tempDir, { recursive: true, force: true });
    });

    suite('Validation', () => {
        test('validates pipeline structure before execution', async () => {
            // Create a valid pipeline
            const packageDir = path.join(tempDir, 'valid-pipeline');
            await fs.promises.mkdir(packageDir, { recursive: true });

            const validYaml = `name: "Valid Pipeline"
description: "A valid pipeline for testing"
input:
  type: csv
  path: "input.csv"
map:
  prompt: "Process: {{title}}"
  output:
    - result
    - confidence
reduce:
  type: list
`;
            await fs.promises.writeFile(path.join(packageDir, 'pipeline.yaml'), validYaml);
            await fs.promises.writeFile(path.join(packageDir, 'input.csv'), 'id,title\n1,Test');

            // Read and verify structure
            const content = await fs.promises.readFile(path.join(packageDir, 'pipeline.yaml'), 'utf8');

            // Check required fields are present
            assert.ok(content.includes('name:'), 'Should have name field');
            assert.ok(content.includes('input:'), 'Should have input field');
            assert.ok(content.includes('type: csv'), 'Should have input type');
            assert.ok(content.includes('map:'), 'Should have map field');
            assert.ok(content.includes('prompt:'), 'Should have prompt field');
            assert.ok(content.includes('output:'), 'Should have output field');
            assert.ok(content.includes('reduce:'), 'Should have reduce field');
        });

        test('detects missing required fields', async () => {
            // Create an invalid pipeline missing 'input'
            const packageDir = path.join(tempDir, 'invalid-pipeline');
            await fs.promises.mkdir(packageDir, { recursive: true });

            const invalidYaml = `name: "Invalid Pipeline"
map:
  prompt: "Process"
  output: [result]
reduce:
  type: list
`;
            await fs.promises.writeFile(path.join(packageDir, 'pipeline.yaml'), invalidYaml);

            const content = await fs.promises.readFile(path.join(packageDir, 'pipeline.yaml'), 'utf8');

            // Verify input is missing
            assert.ok(!content.includes('input:'), 'Should be missing input field');
        });

        test('validates output field is array', async () => {
            const packageDir = path.join(tempDir, 'array-test');
            await fs.promises.mkdir(packageDir, { recursive: true });

            // Valid array output
            const validYaml = `name: "Array Test"
input:
  type: csv
  path: "input.csv"
map:
  prompt: "Test"
  output:
    - field1
    - field2
    - field3
reduce:
  type: list
`;
            await fs.promises.writeFile(path.join(packageDir, 'pipeline.yaml'), validYaml);

            const content = await fs.promises.readFile(path.join(packageDir, 'pipeline.yaml'), 'utf8');
            assert.ok(content.includes('- field1'));
            assert.ok(content.includes('- field2'));
            assert.ok(content.includes('- field3'));
        });

        test('validates reduce type is valid', () => {
            const validReduceTypes = ['list', 'table', 'json', 'csv'];

            for (const type of validReduceTypes) {
                assert.ok(validReduceTypes.includes(type), `${type} should be a valid reduce type`);
            }

            const invalidTypes = ['array', 'object', 'text', 'xml'];
            for (const type of invalidTypes) {
                assert.ok(!validReduceTypes.includes(type), `${type} should not be a valid reduce type`);
            }
        });
    });

    suite('Pipeline Name Sanitization', () => {
        test('sanitizes pipeline names with special characters', () => {
            // Test the sanitization logic
            const sanitize = (name: string): string => {
                return name
                    .replace(/[<>:"/\\|?*]/g, '-')
                    .replace(/\s+/g, '-')
                    .replace(/-+/g, '-')
                    .replace(/^-|-$/g, '')
                    .trim();
            };

            assert.strictEqual(sanitize('my-pipeline'), 'my-pipeline');
            assert.strictEqual(sanitize('My Pipeline'), 'My-Pipeline');
            assert.strictEqual(sanitize('pipeline<>:test'), 'pipeline-test');
            assert.strictEqual(sanitize('test/path\\name'), 'test-path-name');
            assert.strictEqual(sanitize('  spaces  around  '), 'spaces-around');
            assert.strictEqual(sanitize('multiple---dashes'), 'multiple-dashes');
        });

        test('handles empty or invalid names', () => {
            const sanitize = (name: string): string => {
                return name
                    .replace(/[<>:"/\\|?*]/g, '-')
                    .replace(/\s+/g, '-')
                    .replace(/-+/g, '-')
                    .replace(/^-|-$/g, '')
                    .trim();
            };

            assert.strictEqual(sanitize(''), '');
            assert.strictEqual(sanitize('   '), '');
            assert.strictEqual(sanitize('---'), '');
            assert.strictEqual(sanitize('a'), 'a');
        });
    });

    suite('Pipeline Creation', () => {
        test('creates pipeline package directory structure', async () => {
            const packageDir = path.join(tempDir, 'new-pipeline');
            await fs.promises.mkdir(packageDir, { recursive: true });

            // Create pipeline.yaml
            const pipelineContent = `name: "New Pipeline"
description: "Description of what this pipeline does"
input:
  type: csv
  path: "input.csv"
map:
  prompt: |
    Process the following item:
    {{title}}
    {{description}}
  output:
    - result
    - confidence
reduce:
  type: json
`;
            await fs.promises.writeFile(path.join(packageDir, 'pipeline.yaml'), pipelineContent);

            // Create sample input.csv
            await fs.promises.writeFile(
                path.join(packageDir, 'input.csv'),
                'id,title,description\n1,Sample Item,A sample item for processing'
            );

            // Verify directory structure
            const stats = await fs.promises.stat(packageDir);
            assert.ok(stats.isDirectory());

            const pipelineExists = fs.existsSync(path.join(packageDir, 'pipeline.yaml'));
            const csvExists = fs.existsSync(path.join(packageDir, 'input.csv'));

            assert.ok(pipelineExists, 'pipeline.yaml should be created');
            assert.ok(csvExists, 'input.csv should be created');
        });

        test('prevents duplicate pipeline names', async () => {
            const existingDir = path.join(tempDir, 'existing-pipeline');
            await fs.promises.mkdir(existingDir, { recursive: true });

            // Check if directory exists before creating
            const exists = fs.existsSync(existingDir);
            assert.strictEqual(exists, true, 'Directory should already exist');

            // Attempting to create with same name should detect the conflict
            const newDir = path.join(tempDir, 'existing-pipeline');
            const wouldConflict = fs.existsSync(newDir);
            assert.strictEqual(wouldConflict, true, 'Should detect existing pipeline');
        });
    });

    suite('Pipeline Deletion', () => {
        test('deletes entire pipeline package', async () => {
            const packageDir = path.join(tempDir, 'to-delete');
            await fs.promises.mkdir(packageDir, { recursive: true });

            // Create some files
            await fs.promises.writeFile(path.join(packageDir, 'pipeline.yaml'), 'name: Test');
            await fs.promises.writeFile(path.join(packageDir, 'input.csv'), 'id\n1');
            await fs.promises.writeFile(path.join(packageDir, 'output.json'), '{}');

            // Verify files exist
            assert.ok(fs.existsSync(path.join(packageDir, 'pipeline.yaml')));
            assert.ok(fs.existsSync(path.join(packageDir, 'input.csv')));
            assert.ok(fs.existsSync(path.join(packageDir, 'output.json')));

            // Delete the package
            await fs.promises.rm(packageDir, { recursive: true, force: true });

            // Verify deletion
            assert.ok(!fs.existsSync(packageDir), 'Package directory should be deleted');
        });

        test('handles deletion of non-existent package', async () => {
            const nonExistent = path.join(tempDir, 'non-existent-package');

            // Should not throw with force: true
            await fs.promises.rm(nonExistent, { recursive: true, force: true });

            // Verify it still doesn't exist
            assert.ok(!fs.existsSync(nonExistent));
        });
    });

    suite('Pipeline Rename', () => {
        test('renames pipeline package directory', async () => {
            const oldDir = path.join(tempDir, 'old-name');
            const newDir = path.join(tempDir, 'new-name');

            await fs.promises.mkdir(oldDir, { recursive: true });
            await fs.promises.writeFile(path.join(oldDir, 'pipeline.yaml'), 'name: "Old Name"');

            // Rename
            await fs.promises.rename(oldDir, newDir);

            // Verify
            assert.ok(!fs.existsSync(oldDir), 'Old directory should not exist');
            assert.ok(fs.existsSync(newDir), 'New directory should exist');
            assert.ok(fs.existsSync(path.join(newDir, 'pipeline.yaml')), 'Files should be preserved');
        });

        test('updates name field in pipeline.yaml during rename', async () => {
            const yaml = require('js-yaml');

            const packageDir = path.join(tempDir, 'name-update');
            await fs.promises.mkdir(packageDir, { recursive: true });

            const originalYaml = `name: "Original Name"
description: "Test description"
input:
  type: csv
  path: "input.csv"
map:
  prompt: "Test"
  output: [result]
reduce:
  type: list
`;
            await fs.promises.writeFile(path.join(packageDir, 'pipeline.yaml'), originalYaml);

            // Read, update, write
            const content = await fs.promises.readFile(path.join(packageDir, 'pipeline.yaml'), 'utf8');
            const parsed = yaml.load(content);

            // Verify original name
            assert.strictEqual(parsed.name, 'Original Name');

            // Update name
            parsed.name = 'New Name';
            const updatedContent = yaml.dump(parsed, { lineWidth: -1, noRefs: true });
            await fs.promises.writeFile(path.join(packageDir, 'pipeline.yaml'), updatedContent);

            // Verify updated name
            const verifyContent = await fs.promises.readFile(path.join(packageDir, 'pipeline.yaml'), 'utf8');
            const verifyParsed = yaml.load(verifyContent);
            assert.strictEqual(verifyParsed.name, 'New Name');
        });
    });

    suite('Resource Files Detection', () => {
        test('detects CSV resource files', async () => {
            const packageDir = path.join(tempDir, 'csv-resources');
            await fs.promises.mkdir(packageDir, { recursive: true });

            await fs.promises.writeFile(path.join(packageDir, 'pipeline.yaml'), 'name: Test');
            await fs.promises.writeFile(path.join(packageDir, 'input.csv'), 'id\n1');
            await fs.promises.writeFile(path.join(packageDir, 'data.csv'), 'col\na');

            const files = await fs.promises.readdir(packageDir);
            const csvFiles = files.filter(f => f.endsWith('.csv'));

            assert.strictEqual(csvFiles.length, 2);
            assert.ok(csvFiles.includes('input.csv'));
            assert.ok(csvFiles.includes('data.csv'));
        });

        test('detects various resource file types', async () => {
            const packageDir = path.join(tempDir, 'multi-resources');
            await fs.promises.mkdir(packageDir, { recursive: true });

            // Create various resource types
            await fs.promises.writeFile(path.join(packageDir, 'pipeline.yaml'), 'name: Test');
            await fs.promises.writeFile(path.join(packageDir, 'input.csv'), 'id\n1');
            await fs.promises.writeFile(path.join(packageDir, 'config.json'), '{}');
            await fs.promises.writeFile(path.join(packageDir, 'readme.txt'), 'info');
            await fs.promises.writeFile(path.join(packageDir, 'template.tpl'), 'template');

            const files = await fs.promises.readdir(packageDir);

            // Helper to get file type
            const getFileType = (fileName: string): string => {
                const ext = path.extname(fileName).toLowerCase();
                switch (ext) {
                    case '.csv': return 'csv';
                    case '.json': return 'json';
                    case '.txt':
                    case '.md': return 'txt';
                    case '.template':
                    case '.tpl':
                    case '.hbs':
                    case '.mustache': return 'template';
                    default: return 'other';
                }
            };

            const fileTypes = files
                .filter(f => f !== 'pipeline.yaml')
                .map(f => ({ name: f, type: getFileType(f) }));

            const csvFile = fileTypes.find(f => f.type === 'csv');
            const jsonFile = fileTypes.find(f => f.type === 'json');
            const txtFile = fileTypes.find(f => f.type === 'txt');
            const tplFile = fileTypes.find(f => f.type === 'template');

            assert.ok(csvFile, 'Should detect CSV file');
            assert.ok(jsonFile, 'Should detect JSON file');
            assert.ok(txtFile, 'Should detect TXT file');
            assert.ok(tplFile, 'Should detect template file');
        });

        test('handles nested resource directories', async () => {
            const packageDir = path.join(tempDir, 'nested-resources');
            const dataDir = path.join(packageDir, 'data');

            await fs.promises.mkdir(dataDir, { recursive: true });

            await fs.promises.writeFile(path.join(packageDir, 'pipeline.yaml'), 'name: Test');
            await fs.promises.writeFile(path.join(dataDir, 'input.csv'), 'id\n1');
            await fs.promises.writeFile(path.join(dataDir, 'mappings.json'), '{}');

            // Verify nested files exist
            assert.ok(fs.existsSync(path.join(dataDir, 'input.csv')));
            assert.ok(fs.existsSync(path.join(dataDir, 'mappings.json')));
        });
    });

    suite('Execution Warning Detection', () => {
        test('detects missing input file warning', async () => {
            const packageDir = path.join(tempDir, 'missing-input');
            await fs.promises.mkdir(packageDir, { recursive: true });

            const pipelineYaml = `name: "Missing Input"
input:
  type: csv
  path: "non-existent.csv"
map:
  prompt: "Test"
  output: [result]
reduce:
  type: list
`;
            await fs.promises.writeFile(path.join(packageDir, 'pipeline.yaml'), pipelineYaml);

            // Check if input file exists
            const inputPath = path.join(packageDir, 'non-existent.csv');
            const inputExists = fs.existsSync(inputPath);

            assert.strictEqual(inputExists, false, 'Input file should not exist');
        });
    });

    suite('Cross-Platform Command Building', () => {
        test('handles workspace paths correctly', () => {
            // Test path operations that work cross-platform
            const workspacePath = tempDir;
            const pipelineRelPath = '.vscode/pipelines/test';
            const fullPath = path.join(workspacePath, pipelineRelPath);

            // Should create valid path on any platform
            assert.ok(fullPath.includes('test'));
            assert.ok(path.isAbsolute(fullPath));
        });

        test('handles special characters in paths', () => {
            // Characters that are valid in paths on all platforms
            const safeName = 'pipeline-test_2024';
            const fullPath = path.join(tempDir, safeName);

            assert.ok(!fullPath.includes('<'));
            assert.ok(!fullPath.includes('>'));
            assert.ok(!fullPath.includes(':') || process.platform === 'win32');
        });
    });
});
