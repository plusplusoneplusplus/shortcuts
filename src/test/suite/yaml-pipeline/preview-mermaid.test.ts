/**
 * Pipeline Preview Mermaid Tests
 *
 * Tests for the mermaid diagram generation from pipeline configurations.
 */

import * as assert from 'assert';
import {
    generatePipelineMermaid,
    escapeMermaidLabel,
    truncateText,
    formatFileSize,
    extractTemplateVariables,
    validateTemplateVariables,
    estimateExecutionTime,
    generatePipelineTextDiagram
} from '../../../shortcuts/yaml-pipeline/ui/preview-mermaid';
import { PipelineConfig, CSVParseResult } from '@plusplusoneplusplus/pipeline-core';
import { ResourceFileInfo } from '../../../shortcuts/yaml-pipeline/ui/types';

suite('Pipeline Preview Mermaid Tests', () => {
    // Sample pipeline config for tests (using new format)
    const sampleConfig: PipelineConfig = {
        name: 'Test Pipeline',
        input: {
            from: {
                type: 'csv',
                path: 'input.csv'
            }
        },
        map: {
            prompt: 'Process: {{title}}\nDescription: {{description}}',
            output: ['result', 'score'],
            parallel: 3
        },
        reduce: {
            type: 'json'
        }
    };

    // Sample CSV info
    const sampleCsvInfo: CSVParseResult = {
        items: [
            { title: 'Item 1', description: 'Desc 1' },
            { title: 'Item 2', description: 'Desc 2' }
        ],
        headers: ['title', 'description'],
        rowCount: 2
    };

    // Sample resources
    const sampleResources: ResourceFileInfo[] = [
        {
            fileName: 'input.csv',
            filePath: '/path/to/input.csv',
            relativePath: 'input.csv',
            size: 1024,
            fileType: 'csv'
        },
        {
            fileName: 'rules.csv',
            filePath: '/path/to/rules.csv',
            relativePath: 'rules.csv',
            size: 512,
            fileType: 'csv'
        }
    ];

    suite('escapeMermaidLabel', () => {
        test('should escape double quotes', () => {
            const result = escapeMermaidLabel('Hello "World"');
            assert.strictEqual(result, 'Hello #quot;World#quot;');
        });

        test('should escape angle brackets', () => {
            const result = escapeMermaidLabel('<tag>content</tag>');
            assert.strictEqual(result, '&lt;tag&gt;content&lt;/tag&gt;');
        });

        test('should convert newlines to br tags', () => {
            const result = escapeMermaidLabel('Line 1\nLine 2');
            assert.strictEqual(result, 'Line 1<br/>Line 2');
        });

        test('should handle empty string', () => {
            const result = escapeMermaidLabel('');
            assert.strictEqual(result, '');
        });

        test('should handle multiple escapes', () => {
            const result = escapeMermaidLabel('Hello <"World">\nNew line');
            assert.strictEqual(result, 'Hello &lt;#quot;World#quot;&gt;<br/>New line');
        });
    });

    suite('truncateText', () => {
        test('should not truncate short text', () => {
            const result = truncateText('Short', 20);
            assert.strictEqual(result, 'Short');
        });

        test('should truncate long text with ellipsis', () => {
            const result = truncateText('This is a very long text that should be truncated', 20);
            assert.strictEqual(result, 'This is a very lo...');
            assert.strictEqual(result.length, 20);
        });

        test('should use default max length of 30', () => {
            const result = truncateText('This is a very long text that exceeds thirty');
            assert.strictEqual(result.length, 30);
        });

        test('should handle text exactly at max length', () => {
            const result = truncateText('12345678901234567890', 20);
            assert.strictEqual(result, '12345678901234567890');
        });

        test('should not truncate text within default 30-char limit', () => {
            const result = truncateText('category, summary, score');
            assert.strictEqual(result, 'category, summary, score');
        });

        test('should truncate text exceeding default 30-char limit', () => {
            const result = truncateText('category, summary, score, extra field');
            assert.strictEqual(result.length, 30);
            assert.ok(result.endsWith('...'));
        });
    });

    suite('formatFileSize', () => {
        test('should format bytes', () => {
            assert.strictEqual(formatFileSize(500), '500 B');
            assert.strictEqual(formatFileSize(0), '0 B');
        });

        test('should format kilobytes', () => {
            assert.strictEqual(formatFileSize(1024), '1.0 KB');
            assert.strictEqual(formatFileSize(2048), '2.0 KB');
            assert.strictEqual(formatFileSize(1536), '1.5 KB');
        });

        test('should format megabytes', () => {
            assert.strictEqual(formatFileSize(1024 * 1024), '1.0 MB');
            assert.strictEqual(formatFileSize(1024 * 1024 * 2.5), '2.5 MB');
        });
    });

    suite('extractTemplateVariables', () => {
        test('should extract single variable', () => {
            const result = extractTemplateVariables('Hello {{name}}');
            assert.deepStrictEqual(result, ['name']);
        });

        test('should extract multiple variables', () => {
            const result = extractTemplateVariables('{{title}}: {{description}}');
            assert.deepStrictEqual(result, ['title', 'description']);
        });

        test('should not duplicate variables', () => {
            const result = extractTemplateVariables('{{name}} and {{name}} again');
            assert.deepStrictEqual(result, ['name']);
        });

        test('should handle no variables', () => {
            const result = extractTemplateVariables('Plain text without variables');
            assert.deepStrictEqual(result, []);
        });

        test('should handle multiline prompts', () => {
            const result = extractTemplateVariables(`
                Title: {{title}}
                Description: {{description}}
                Extra: {{extra}}
            `);
            assert.deepStrictEqual(result, ['title', 'description', 'extra']);
        });
    });

    suite('validateTemplateVariables', () => {
        test('should return valid when all variables exist', () => {
            const result = validateTemplateVariables(
                '{{title}} - {{description}}',
                ['title', 'description', 'extra']
            );
            assert.strictEqual(result.valid, true);
            assert.deepStrictEqual(result.missingVariables, []);
        });

        test('should return invalid when variables missing', () => {
            const result = validateTemplateVariables(
                '{{title}} - {{missing}}',
                ['title', 'description']
            );
            assert.strictEqual(result.valid, false);
            assert.deepStrictEqual(result.missingVariables, ['missing']);
        });

        test('should handle empty headers', () => {
            const result = validateTemplateVariables('{{title}}', []);
            assert.strictEqual(result.valid, false);
            assert.deepStrictEqual(result.missingVariables, ['title']);
        });

        test('should handle no variables', () => {
            const result = validateTemplateVariables('Plain text', ['title']);
            assert.strictEqual(result.valid, true);
            assert.deepStrictEqual(result.missingVariables, []);
        });
    });

    suite('estimateExecutionTime', () => {
        test('should estimate seconds for small datasets', () => {
            const result = estimateExecutionTime(5, 5, 2);
            assert.strictEqual(result, '~2 seconds');
        });

        test('should estimate minutes for larger datasets', () => {
            const result = estimateExecutionTime(150, 5, 2);
            assert.strictEqual(result, '~1 minute');
        });

        test('should estimate minutes and seconds', () => {
            const result = estimateExecutionTime(200, 5, 2);
            assert.strictEqual(result, '~1m 20s');
        });

        test('should handle high parallelism', () => {
            const result = estimateExecutionTime(50, 10, 2);
            assert.strictEqual(result, '~10 seconds');
        });
    });

    suite('generatePipelineMermaid', () => {
        test('should generate basic flowchart structure', () => {
            const result = generatePipelineMermaid(sampleConfig);
            
            assert.ok(result.includes('graph LR'), 'Should start with graph LR');
            assert.ok(result.includes('INPUT['), 'Should have INPUT node');
            assert.ok(result.includes('MAP['), 'Should have MAP node');
            assert.ok(result.includes('REDUCE['), 'Should have REDUCE node');
        });

        test('should use left-to-right graph direction', () => {
            const result = generatePipelineMermaid(sampleConfig);
            
            assert.ok(result.startsWith('graph LR'), 'Should use LR direction for left-to-right flow');
            assert.ok(!result.includes('graph TB'), 'Should not use TB direction');
        });

        test('should include node connections', () => {
            const result = generatePipelineMermaid(sampleConfig);
            
            assert.ok(result.includes('INPUT -->'), 'Should have connection from INPUT');
            assert.ok(result.includes('| MAP'), 'Should have connection to MAP');
            assert.ok(result.includes('MAP -->'), 'Should have connection from MAP');
            assert.ok(result.includes('| REDUCE'), 'Should have connection to REDUCE');
        });

        test('should include click handlers', () => {
            const result = generatePipelineMermaid(sampleConfig);
            
            assert.ok(result.includes('click INPUT'), 'Should have INPUT click handler');
            assert.ok(result.includes('click MAP'), 'Should have MAP click handler');
            assert.ok(result.includes('click REDUCE'), 'Should have REDUCE click handler');
        });

        test('should include styling', () => {
            const result = generatePipelineMermaid(sampleConfig);
            
            assert.ok(result.includes('style INPUT fill:'), 'Should have INPUT styling');
            assert.ok(result.includes('style MAP fill:'), 'Should have MAP styling');
            assert.ok(result.includes('style REDUCE fill:'), 'Should have REDUCE styling');
        });

        test('should include CSV info when provided', () => {
            const result = generatePipelineMermaid(sampleConfig, sampleCsvInfo);
            
            assert.ok(result.includes('2 rows'), 'Should show row count');
            assert.ok(result.includes('2 columns'), 'Should show column count in link');
        });

        test('should include output field count', () => {
            const result = generatePipelineMermaid(sampleConfig, sampleCsvInfo);
            
            assert.ok(result.includes('2 fields'), 'Should show output field count');
        });

        test('should include parallel count', () => {
            const result = generatePipelineMermaid(sampleConfig);
            
            assert.ok(result.includes('3 parallel'), 'Should show parallel count');
        });

        test('should include reduce type', () => {
            const result = generatePipelineMermaid(sampleConfig);
            
            assert.ok(result.includes('Type: json'), 'Should show reduce type');
        });

        test('should add CSV_FILE node when CSV source is used', () => {
            const result = generatePipelineMermaid(
                sampleConfig,
                sampleCsvInfo,
                sampleResources,
                { includeResources: true }
            );
            
            // Should include CSV_FILE node for the input file
            assert.ok(result.includes('CSV_FILE['), 'Should have CSV_FILE node');
            assert.ok(result.includes('input.csv'), 'Should include input.csv filename');
        });

        test('should connect CSV_FILE to INPUT node', () => {
            const result = generatePipelineMermaid(
                sampleConfig,
                sampleCsvInfo,
                sampleResources,
                { includeResources: true }
            );
            
            // CSV_FILE should connect to INPUT, not directly to MAP
            assert.ok(result.includes('CSV_FILE -->'), 'Should have connection from CSV_FILE');
            assert.ok(result.includes('| INPUT'), 'Should connect to INPUT node');
        });

        test('should not include other resource files as separate nodes', () => {
            const result = generatePipelineMermaid(
                sampleConfig,
                sampleCsvInfo,
                sampleResources,
                { includeResources: true }
            );
            
            // Should NOT have RES0, RES1, etc. nodes anymore
            assert.ok(!result.includes('RES0'), 'Should not have RES0 node');
            // rules.csv should not appear as a separate node
            assert.ok(!result.includes('rules.csv'), 'Should not include other resource files');
        });

        test('should include click handler for CSV_FILE', () => {
            const result = generatePipelineMermaid(
                sampleConfig,
                sampleCsvInfo,
                sampleResources,
                { includeResources: true }
            );
            
            assert.ok(result.includes('click CSV_FILE'), 'Should have CSV_FILE click handler');
        });
    });

    suite('generatePipelineTextDiagram', () => {
        test('should generate text-based diagram', () => {
            const result = generatePipelineTextDiagram(sampleConfig);
            
            assert.ok(result.includes('Pipeline Flow:'), 'Should have title');
            assert.ok(result.includes('INPUT'), 'Should have INPUT');
            assert.ok(result.includes('MAP'), 'Should have MAP');
            assert.ok(result.includes('REDUCE'), 'Should have REDUCE');
            assert.ok(result.includes('CSV'), 'Should show input type');
        });

        test('should include row count when CSV info provided', () => {
            const result = generatePipelineTextDiagram(sampleConfig, sampleCsvInfo);
            
            assert.ok(result.includes('2'), 'Should show row count');
            assert.ok(result.includes('rows'), 'Should include rows label');
        });

        test('should show parallel count', () => {
            const result = generatePipelineTextDiagram(sampleConfig);
            
            // The text diagram shows "3  parallel" with spacing for alignment
            assert.ok(result.includes('3') && result.includes('parallel'), 'Should show parallel count');
        });

        test('should show reduce type', () => {
            const result = generatePipelineTextDiagram(sampleConfig);
            
            assert.ok(result.includes('json'), 'Should show reduce type');
        });
    });

    suite('Integration: Complete Pipeline Diagram', () => {
        test('should generate complete diagram with all options', () => {
            const config: PipelineConfig = {
                name: 'Complex Pipeline',
                input: {
                    from: {
                        type: 'csv',
                        path: 'data/input.csv',
                        delimiter: ';'
                    }
                },
                map: {
                    prompt: 'Process {{field1}} and {{field2}}',
                    output: ['result1', 'result2', 'result3'],
                    parallel: 10,
                    model: 'gpt-4'
                },
                reduce: {
                    type: 'json'
                }
            };

            const csvInfo: CSVParseResult = {
                items: Array(100).fill({ field1: 'a', field2: 'b' }),
                headers: ['field1', 'field2'],
                rowCount: 100
            };

            const resources: ResourceFileInfo[] = [
                {
                    fileName: 'template.txt',
                    filePath: '/path/to/template.txt',
                    relativePath: 'template.txt',
                    size: 256,
                    fileType: 'txt'
                }
            ];

            const result = generatePipelineMermaid(config, csvInfo, resources, {
                includeResources: true,
                showCounts: true,
                theme: 'dark'
            });

            // Verify structure
            assert.ok(result.includes('graph LR'));
            assert.ok(result.includes('100 rows'));
            assert.ok(result.includes('2 columns'));
            assert.ok(result.includes('3 fields'));
            assert.ok(result.includes('10 parallel'));
            assert.ok(result.includes('Type: json'));
            // CSV_FILE node should show the input file
            assert.ok(result.includes('CSV_FILE['), 'Should have CSV_FILE node');
            assert.ok(result.includes('data/input.csv') || result.includes('input.csv'), 'Should show input file');
            // Other resources (template.txt) should NOT be shown as separate nodes
            assert.ok(!result.includes('template.txt'), 'Should not show other resource files');
        });
    });

    suite('Generate Input Diagram', () => {
        // Sample generate config
        const generateConfig: PipelineConfig = {
            name: 'Generate Test Pipeline',
            input: {
                generate: {
                    prompt: 'Generate 10 test cases for user login validation',
                    schema: ['testName', 'input', 'expected']
                }
            },
            map: {
                prompt: 'Run test: {{testName}}\nInput: {{input}}\nExpected: {{expected}}',
                output: ['actual', 'passed'],
                parallel: 5
            },
            reduce: {
                type: 'table'
            }
        };

        test('should include GENERATE node for generate config', () => {
            const result = generatePipelineMermaid(generateConfig);
            
            assert.ok(result.includes('GENERATE'), 'Should have GENERATE node');
            assert.ok(result.includes('🤖'), 'Should have robot emoji for GENERATE');
            assert.ok(result.includes('AI Input'), 'Should show AI Input label');
        });

        test('should show schema field count in GENERATE node', () => {
            const result = generatePipelineMermaid(generateConfig);
            
            assert.ok(result.includes('3 fields'), 'Should show schema field count');
        });

        test('should connect GENERATE to INPUT node', () => {
            const result = generatePipelineMermaid(generateConfig);
            
            assert.ok(result.includes('GENERATE -->'), 'Should have connection from GENERATE');
            assert.ok(result.includes('AI generates'), 'Should have AI generates label');
        });

        test('should style GENERATE node with purple color', () => {
            const result = generatePipelineMermaid(generateConfig);
            
            assert.ok(result.includes('style GENERATE'), 'Should have GENERATE style');
            assert.ok(result.includes('#9C27B0'), 'Should use purple fill color');
        });

        test('should include click handler for GENERATE node', () => {
            const result = generatePipelineMermaid(generateConfig);
            
            assert.ok(result.includes('click GENERATE'), 'Should have click handler for GENERATE');
        });

        test('should show AI-GENERATED type in INPUT node', () => {
            const result = generatePipelineMermaid(generateConfig);
            
            assert.ok(result.includes('AI-GENERATED'), 'Should show AI-GENERATED in INPUT');
        });

        test('should not include GENERATE node for regular CSV config', () => {
            const result = generatePipelineMermaid(sampleConfig);
            
            assert.ok(!result.includes('GENERATE'), 'Should not have GENERATE node');
            assert.ok(!result.includes('🤖'), 'Should not have robot emoji');
        });

        test('should not include GENERATE node for inline items config', () => {
            const inlineConfig: PipelineConfig = {
                name: 'Inline Pipeline',
                input: {
                    items: [
                        { name: 'Item 1', value: '100' },
                        { name: 'Item 2', value: '200' }
                    ]
                },
                map: {
                    prompt: '{{name}}: {{value}}',
                    output: ['result']
                },
                reduce: { type: 'list' }
            };

            const result = generatePipelineMermaid(inlineConfig);
            
            assert.ok(!result.includes('GENERATE'), 'Should not have GENERATE node');
        });
    });

    suite('generatePipelineTextDiagram with Generate', () => {
        const generateConfig: PipelineConfig = {
            name: 'Generate Test Pipeline',
            input: {
                generate: {
                    prompt: 'Generate test cases',
                    schema: ['name', 'input', 'expected']
                }
            },
            map: {
                prompt: '{{name}}',
                output: ['result'],
                parallel: 5
            },
            reduce: { type: 'list' }
        };

        test('should include GENERATE node in text diagram', () => {
            const result = generatePipelineTextDiagram(generateConfig);
            
            assert.ok(result.includes('GENERATE'), 'Should have GENERATE in text diagram');
            assert.ok(result.includes('🤖'), 'Should have robot emoji');
            assert.ok(result.includes('AI Input'), 'Should show AI Input');
        });

        test('should show AI-GENERATED type in INPUT node', () => {
            const result = generatePipelineTextDiagram(generateConfig);
            
            assert.ok(result.includes('AI-GENERATED'), 'Should show AI-GENERATED type');
        });

        test('should show field count for generate config', () => {
            const result = generatePipelineTextDiagram(generateConfig);
            
            assert.ok(result.includes('3') && result.includes('fields'), 'Should show field count');
        });
    });

    suite('Job Mode Diagram', () => {
        const jobConfig: PipelineConfig = {
            name: 'git-fetch',
            job: {
                prompt: 'Run the command `git fetch` and report the output.'
            }
        };

        const jobConfigWithOutput: PipelineConfig = {
            name: 'Analyze Code',
            job: {
                prompt: 'Analyze the codebase',
                output: ['summary', 'issues', 'suggestions'],
                model: 'gpt-4'
            }
        };

        const jobConfigWithSkill: PipelineConfig = {
            name: 'Review PR',
            job: {
                prompt: 'Review this PR',
                skill: 'code-review'
            },
            parameters: [
                { name: 'repo', value: 'my-repo' },
                { name: 'pr', value: '42' }
            ]
        };

        test('should generate JOB node for job mode pipeline', () => {
            const result = generatePipelineMermaid(jobConfig);
            
            assert.ok(result.includes('graph LR'), 'Should start with graph LR');
            assert.ok(result.includes('JOB['), 'Should have JOB node');
            assert.ok(result.includes('🤖'), 'Should have robot emoji');
        });

        test('should include prompt preview in JOB node', () => {
            const result = generatePipelineMermaid(jobConfig);
            
            assert.ok(result.includes('Run the command'), 'Should include truncated prompt');
        });

        test('should include OUTPUT node when output fields exist', () => {
            const result = generatePipelineMermaid(jobConfigWithOutput);
            
            assert.ok(result.includes('OUTPUT['), 'Should have OUTPUT node');
            assert.ok(result.includes('📤'), 'Should have output emoji');
            assert.ok(result.includes('3 fields'), 'Should show field count in link');
        });

        test('should include model in JOB node when specified', () => {
            const result = generatePipelineMermaid(jobConfigWithOutput);
            
            assert.ok(result.includes('gpt-4'), 'Should show model name');
        });

        test('should not include OUTPUT node when no output fields', () => {
            const result = generatePipelineMermaid(jobConfig);
            
            assert.ok(!result.includes('OUTPUT['), 'Should not have OUTPUT node');
        });

        test('should include SKILL node when skill is specified', () => {
            const result = generatePipelineMermaid(jobConfigWithSkill);
            
            assert.ok(result.includes('SKILL['), 'Should have SKILL node');
            assert.ok(result.includes('📚'), 'Should have skill emoji');
            assert.ok(result.includes('code-review'), 'Should show skill name');
        });

        test('should include PARAMS node when parameters exist', () => {
            const result = generatePipelineMermaid(jobConfigWithSkill);
            
            assert.ok(result.includes('PARAMS['), 'Should have PARAMS node');
            assert.ok(result.includes('⚙️'), 'Should have gear emoji');
            assert.ok(result.includes('repo'), 'Should show param names');
        });

        test('should include click handlers for job nodes', () => {
            const result = generatePipelineMermaid(jobConfigWithSkill);
            
            assert.ok(result.includes('click JOB'), 'Should have JOB click handler');
            assert.ok(result.includes('click PARAMS'), 'Should have PARAMS click handler');
            assert.ok(result.includes('click SKILL'), 'Should have SKILL click handler');
        });

        test('should include styling for job nodes', () => {
            const result = generatePipelineMermaid(jobConfig);
            
            assert.ok(result.includes('style JOB fill:'), 'Should have JOB styling');
        });

        test('should not have INPUT/MAP/REDUCE nodes in job mode', () => {
            const result = generatePipelineMermaid(jobConfig);
            
            assert.ok(!result.includes('INPUT['), 'Should not have INPUT node');
            assert.ok(!result.includes('MAP['), 'Should not have MAP node');
            assert.ok(!result.includes('REDUCE['), 'Should not have REDUCE node');
        });
    });

    suite('Job Mode Text Diagram', () => {
        const jobConfig: PipelineConfig = {
            name: 'git-fetch',
            job: {
                prompt: 'Run git fetch'
            }
        };

        const jobConfigWithOutput: PipelineConfig = {
            name: 'Analyze',
            job: {
                prompt: 'Analyze code',
                output: ['summary', 'issues'],
                model: 'gpt-4'
            }
        };

        test('should generate job mode text diagram', () => {
            const result = generatePipelineTextDiagram(jobConfig);
            
            assert.ok(result.includes('Job Mode'), 'Should indicate job mode');
            assert.ok(result.includes('JOB'), 'Should have JOB label');
            assert.ok(result.includes('🤖'), 'Should have robot emoji');
        });

        test('should show inline prompt indicator', () => {
            const result = generatePipelineTextDiagram(jobConfig);
            
            assert.ok(result.includes('Inline prompt'), 'Should show inline prompt');
        });

        test('should show output section when output fields exist', () => {
            const result = generatePipelineTextDiagram(jobConfigWithOutput);
            
            assert.ok(result.includes('OUTPUT'), 'Should have OUTPUT');
            assert.ok(result.includes('2'), 'Should show field count');
        });

        test('should show model when specified', () => {
            const result = generatePipelineTextDiagram(jobConfigWithOutput);
            
            assert.ok(result.includes('gpt-4'), 'Should show model');
        });
    });
});
