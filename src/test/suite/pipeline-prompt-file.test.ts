import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  parsePipelineYAML,
  parsePipelineYAMLSync,
  PipelineExecutionError
} from '../../shortcuts/yaml-pipeline';

suite('Pipeline Prompt File Integration Tests', () => {
  let tempDir: string;
  let pipelineDir: string;
  let pipelinesRoot: string;

  setup(() => {
    // Create temporary directory structure
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shortcuts-pipeline-prompt-test-'));
    pipelinesRoot = path.join(tempDir, '.vscode', 'pipelines');
    pipelineDir = path.join(pipelinesRoot, 'test-pipeline');

    // Create directory structure
    fs.mkdirSync(path.join(pipelineDir, 'prompts'), { recursive: true });

    // Create prompt files
    fs.writeFileSync(
      path.join(pipelineDir, 'analyze.prompt.md'),
      'Analyze {{title}}: {{description}}\n\nReturn JSON with severity.',
      'utf8'
    );

    fs.writeFileSync(
      path.join(pipelineDir, 'prompts', 'map.prompt.md'),
      'Map prompt: {{item}}',
      'utf8'
    );

    fs.writeFileSync(
      path.join(pipelineDir, 'prompts', 'reduce.prompt.md'),
      'Summarize {{COUNT}} results:\n{{RESULTS}}',
      'utf8'
    );
  });

  teardown(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  suite('YAML Parsing with promptFile', () => {
    test('should parse pipeline with map.promptFile', async () => {
      const yaml = `
name: "Test Pipeline"
input:
  items:
    - title: "Bug 1"
      description: "Description 1"
map:
  promptFile: "analyze.prompt.md"
  output:
    - severity
reduce:
  type: json
`;
      const config = await parsePipelineYAML(yaml);

      assert.strictEqual(config.name, 'Test Pipeline');
      assert.strictEqual(config.map.promptFile, 'analyze.prompt.md');
      assert.strictEqual(config.map.prompt, undefined);
    });

    test('should parse pipeline with map.prompt (inline)', async () => {
      const yaml = `
name: "Test Pipeline"
input:
  items:
    - title: "Bug 1"
map:
  prompt: "Analyze {{title}}"
  output:
    - result
reduce:
  type: json
`;
      const config = await parsePipelineYAML(yaml);

      assert.strictEqual(config.map.prompt, 'Analyze {{title}}');
      assert.strictEqual(config.map.promptFile, undefined);
    });

    test('should parse pipeline with reduce.promptFile for AI reduce', async () => {
      const yaml = `
name: "Test Pipeline"
input:
  items:
    - item: "test"
map:
  prompt: "Process {{item}}"
  output:
    - result
reduce:
  type: ai
  promptFile: "prompts/reduce.prompt.md"
  output:
    - summary
`;
      const config = await parsePipelineYAML(yaml);

      assert.strictEqual(config.reduce.type, 'ai');
      assert.strictEqual(config.reduce.promptFile, 'prompts/reduce.prompt.md');
      assert.strictEqual(config.reduce.prompt, undefined);
    });

    test('should reject pipeline with both map.prompt and map.promptFile', async () => {
      const yaml = `
name: "Test Pipeline"
input:
  items:
    - title: "Bug 1"
map:
  prompt: "Inline prompt"
  promptFile: "analyze.prompt.md"
  output:
    - result
reduce:
  type: json
`;
      await assert.rejects(
        async () => await parsePipelineYAML(yaml),
        (error: PipelineExecutionError) => {
          assert.ok(error.message.includes('cannot have both'));
          return true;
        }
      );
    });

    test('should reject pipeline with neither map.prompt nor map.promptFile', async () => {
      const yaml = `
name: "Test Pipeline"
input:
  items:
    - title: "Bug 1"
map:
  output:
    - result
reduce:
  type: json
`;
      await assert.rejects(
        async () => await parsePipelineYAML(yaml),
        (error: PipelineExecutionError) => {
          assert.ok(error.message.includes('must have either'));
          return true;
        }
      );
    });

    test('should reject AI reduce with both prompt and promptFile', async () => {
      const yaml = `
name: "Test Pipeline"
input:
  items:
    - item: "test"
map:
  prompt: "Process {{item}}"
  output:
    - result
reduce:
  type: ai
  prompt: "Inline reduce prompt"
  promptFile: "prompts/reduce.prompt.md"
  output:
    - summary
`;
      await assert.rejects(
        async () => await parsePipelineYAML(yaml),
        (error: PipelineExecutionError) => {
          assert.ok(error.message.includes('cannot have both'));
          return true;
        }
      );
    });

    test('should reject AI reduce with neither prompt nor promptFile', async () => {
      const yaml = `
name: "Test Pipeline"
input:
  items:
    - item: "test"
map:
  prompt: "Process {{item}}"
  output:
    - result
reduce:
  type: ai
  output:
    - summary
`;
      await assert.rejects(
        async () => await parsePipelineYAML(yaml),
        (error: PipelineExecutionError) => {
          assert.ok(error.message.includes('must have either'));
          return true;
        }
      );
    });

    test('should allow non-AI reduce without prompt or promptFile', async () => {
      const yaml = `
name: "Test Pipeline"
input:
  items:
    - item: "test"
map:
  prompt: "Process {{item}}"
  output:
    - result
reduce:
  type: json
`;
      const config = await parsePipelineYAML(yaml);
      assert.strictEqual(config.reduce.type, 'json');
      assert.strictEqual(config.reduce.prompt, undefined);
      assert.strictEqual(config.reduce.promptFile, undefined);
    });
  });

  suite('Synchronous YAML Parsing', () => {
    test('should parse pipeline with promptFile synchronously', () => {
      const yaml = `
name: "Test Pipeline"
input:
  items:
    - title: "Bug 1"
map:
  promptFile: "analyze.prompt.md"
  output:
    - severity
reduce:
  type: json
`;
      const config = parsePipelineYAMLSync(yaml);

      assert.strictEqual(config.map.promptFile, 'analyze.prompt.md');
    });

    test('should reject invalid config synchronously', () => {
      const yaml = `
name: "Test Pipeline"
input:
  items:
    - title: "Bug 1"
map:
  prompt: "Inline"
  promptFile: "file.md"
  output:
    - result
reduce:
  type: json
`;
      assert.throws(
        () => parsePipelineYAMLSync(yaml),
        (error: PipelineExecutionError) => {
          assert.ok(error.message.includes('cannot have both'));
          return true;
        }
      );
    });
  });

  suite('Pipeline Configuration Examples', () => {
    test('should parse simple promptFile in same folder', async () => {
      const yaml = `
name: "Run Tests Pipeline"
input:
  from:
    type: csv
    path: "test-suite.csv"
map:
  promptFile: "run-test.prompt.md"
  output:
    - status
    - passed
    - failed
reduce:
  type: list
`;
      const config = await parsePipelineYAML(yaml);
      assert.strictEqual(config.map.promptFile, 'run-test.prompt.md');
    });

    test('should parse promptFile with prompts subfolder', async () => {
      const yaml = `
name: "Analysis Pipeline"
input:
  items:
    - data: "test"
map:
  promptFile: "prompts/analyze.prompt.md"
  output:
    - result
reduce:
  type: ai
  promptFile: "prompts/summarize.prompt.md"
  output:
    - summary
`;
      const config = await parsePipelineYAML(yaml);
      assert.strictEqual(config.map.promptFile, 'prompts/analyze.prompt.md');
      assert.strictEqual(config.reduce.promptFile, 'prompts/summarize.prompt.md');
    });

    test('should parse promptFile using shared prompts', async () => {
      const yaml = `
name: "Code Review Pipeline"
input:
  items:
    - file: "test.ts"
map:
  promptFile: "../shared/prompts/code-review.prompt.md"
  output:
    - issues
reduce:
  type: json
`;
      const config = await parsePipelineYAML(yaml);
      assert.strictEqual(config.map.promptFile, '../shared/prompts/code-review.prompt.md');
    });
  });

  suite('Edge Cases', () => {
    test('should handle promptFile with special characters in path', async () => {
      const yaml = `
name: "Test Pipeline"
input:
  items:
    - item: "test"
map:
  promptFile: "prompts/my-special_prompt.v2.prompt.md"
  output:
    - result
reduce:
  type: json
`;
      const config = await parsePipelineYAML(yaml);
      assert.strictEqual(config.map.promptFile, 'prompts/my-special_prompt.v2.prompt.md');
    });

    test('should handle empty output array with promptFile', async () => {
      const yaml = `
name: "Text Mode Pipeline"
input:
  items:
    - item: "test"
map:
  promptFile: "analyze.prompt.md"
  output: []
reduce:
  type: text
`;
      const config = await parsePipelineYAML(yaml);
      assert.strictEqual(config.map.promptFile, 'analyze.prompt.md');
      assert.deepStrictEqual(config.map.output, []);
    });

    test('should handle promptFile without output (text mode)', async () => {
      const yaml = `
name: "Text Mode Pipeline"
input:
  items:
    - item: "test"
map:
  promptFile: "analyze.prompt.md"
reduce:
  type: text
`;
      const config = await parsePipelineYAML(yaml);
      assert.strictEqual(config.map.promptFile, 'analyze.prompt.md');
      assert.strictEqual(config.map.output, undefined);
    });
  });
});
