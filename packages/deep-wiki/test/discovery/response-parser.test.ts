/**
 * Response Parser Tests
 *
 * Tests for JSON parsing, validation, normalization, and error recovery
 * of AI responses into ModuleGraph and StructuralScanResult structures.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { parseModuleGraphResponse, parseStructuralScanResponse, normalizePath } from '../../src/discovery/response-parser';

// Capture stderr warnings during tests
let stderrOutput: string;
const originalStderrWrite = process.stderr.write;

beforeEach(() => {
    stderrOutput = '';
    process.stderr.write = ((chunk: string | Uint8Array) => {
        stderrOutput += typeof chunk === 'string' ? chunk : chunk.toString();
        return true;
    }) as typeof process.stderr.write;
});

afterEach(() => {
    process.stderr.write = originalStderrWrite;
});

describe('parseModuleGraphResponse', () => {
    // ========================================================================
    // Valid Module Graph Parsing
    // ========================================================================

    describe('valid module graph', () => {
        it('should parse a valid JSON module graph', () => {
            const json = JSON.stringify({
                project: {
                    name: 'test-project',
                    description: 'A test project',
                    language: 'TypeScript',
                    buildSystem: 'npm + webpack',
                    entryPoints: ['src/index.ts'],
                },
                modules: [
                    {
                        id: 'core',
                        name: 'Core Module',
                        path: 'src/core/',
                        purpose: 'Core logic',
                        keyFiles: ['src/core/index.ts'],
                        dependencies: [],
                        dependents: [],
                        complexity: 'medium',
                        category: 'core',
                    },
                ],
                categories: [
                    { name: 'core', description: 'Core modules' },
                ],
                architectureNotes: 'Layered architecture',
            });

            const result = parseModuleGraphResponse(json);
            expect(result.project.name).toBe('test-project');
            expect(result.project.language).toBe('TypeScript');
            expect(result.modules).toHaveLength(1);
            expect(result.modules[0].id).toBe('core');
            expect(result.categories).toHaveLength(1);
            expect(result.architectureNotes).toBe('Layered architecture');
        });

        it('should parse a module graph with multiple modules and dependencies', () => {
            const json = JSON.stringify({
                project: {
                    name: 'multi-module',
                    description: 'Multi-module project',
                    language: 'Go',
                    buildSystem: 'go modules',
                    entryPoints: ['cmd/main.go'],
                },
                modules: [
                    {
                        id: 'auth',
                        name: 'Auth',
                        path: 'pkg/auth/',
                        purpose: 'Authentication',
                        keyFiles: ['pkg/auth/auth.go'],
                        dependencies: ['database'],
                        dependents: ['api'],
                        complexity: 'high',
                        category: 'core',
                    },
                    {
                        id: 'database',
                        name: 'Database',
                        path: 'pkg/db/',
                        purpose: 'Database layer',
                        keyFiles: ['pkg/db/db.go'],
                        dependencies: [],
                        dependents: ['auth'],
                        complexity: 'medium',
                        category: 'infra',
                    },
                    {
                        id: 'api',
                        name: 'API',
                        path: 'pkg/api/',
                        purpose: 'REST API',
                        keyFiles: ['pkg/api/router.go'],
                        dependencies: ['auth'],
                        dependents: [],
                        complexity: 'medium',
                        category: 'core',
                    },
                ],
                categories: [
                    { name: 'core', description: 'Core modules' },
                    { name: 'infra', description: 'Infrastructure' },
                ],
                architectureNotes: 'Clean architecture with DI',
            });

            const result = parseModuleGraphResponse(json);
            expect(result.modules).toHaveLength(3);
            expect(result.modules[0].dependencies).toEqual(['database']);
            expect(result.modules[0].dependents).toEqual(['api']);
        });
    });

    // ========================================================================
    // JSON in Markdown Code Block Extraction
    // ========================================================================

    describe('JSON in markdown code blocks', () => {
        it('should extract JSON from ```json code block', () => {
            const response = `Here is the module graph:

\`\`\`json
{
  "project": {"name": "test", "description": "", "language": "JS", "buildSystem": "npm", "entryPoints": []},
  "modules": [],
  "categories": [],
  "architectureNotes": ""
}
\`\`\`

That's the result.`;

            const result = parseModuleGraphResponse(response);
            expect(result.project.name).toBe('test');
        });

        it('should extract JSON from plain ``` code block', () => {
            const response = `\`\`\`
{
  "project": {"name": "test2", "description": "", "language": "Python", "buildSystem": "pip", "entryPoints": []},
  "modules": [],
  "categories": [],
  "architectureNotes": ""
}
\`\`\``;

            const result = parseModuleGraphResponse(response);
            expect(result.project.name).toBe('test2');
        });
    });

    // ========================================================================
    // Malformed JSON Handling
    // ========================================================================

    describe('malformed JSON handling', () => {
        it('should throw on completely invalid input', () => {
            expect(() => parseModuleGraphResponse('not json at all')).toThrow();
        });

        it('should throw on empty input', () => {
            expect(() => parseModuleGraphResponse('')).toThrow('Empty or invalid response');
        });

        it('should throw on null input', () => {
            expect(() => parseModuleGraphResponse(null as unknown as string)).toThrow('Empty or invalid response');
        });

        it('should throw when JSON is an array', () => {
            expect(() => parseModuleGraphResponse('[1, 2, 3]')).toThrow('not a JSON object');
        });

        it('should throw when JSON is a primitive', () => {
            expect(() => parseModuleGraphResponse('"hello"')).toThrow();
        });
    });

    // ========================================================================
    // Missing Required Fields
    // ========================================================================

    describe('missing required fields', () => {
        it('should throw when project is missing', () => {
            const json = JSON.stringify({
                modules: [],
                categories: [],
                architectureNotes: '',
            });
            expect(() => parseModuleGraphResponse(json)).toThrow("Missing required field 'project'");
        });

        it('should throw when modules is missing', () => {
            const json = JSON.stringify({
                project: { name: 'test', language: 'TS' },
                categories: [],
                architectureNotes: '',
            });
            expect(() => parseModuleGraphResponse(json)).toThrow("Missing required field 'modules'");
        });

        it('should default categories to empty array when missing', () => {
            const json = JSON.stringify({
                project: { name: 'test', language: 'TS' },
                modules: [],
                architectureNotes: '',
            });
            const result = parseModuleGraphResponse(json);
            expect(result.categories).toEqual([]);
            expect(stderrOutput).toContain('Missing');
        });

        it('should default project.name to unknown when missing', () => {
            const json = JSON.stringify({
                project: { description: 'test', language: 'TS', buildSystem: 'npm', entryPoints: [] },
                modules: [],
                categories: [],
            });
            const result = parseModuleGraphResponse(json);
            expect(result.project.name).toBe('unknown');
        });

        it('should default architectureNotes to empty string', () => {
            const json = JSON.stringify({
                project: { name: 'test', language: 'TS' },
                modules: [],
                categories: [],
            });
            const result = parseModuleGraphResponse(json);
            expect(result.architectureNotes).toBe('');
        });
    });

    // ========================================================================
    // Path Normalization
    // ========================================================================

    describe('path normalization', () => {
        it('should normalize module paths', () => {
            const json = JSON.stringify({
                project: { name: 'test', language: 'TS' },
                modules: [
                    {
                        id: 'core',
                        name: 'Core',
                        path: './src/core/',
                        purpose: 'Core',
                        keyFiles: ['./src/core/index.ts'],
                        dependencies: [],
                        dependents: [],
                        complexity: 'low',
                        category: 'core',
                    },
                ],
                categories: [{ name: 'core', description: '' }],
            });

            const result = parseModuleGraphResponse(json);
            expect(result.modules[0].path).toBe('src/core/');
            expect(result.modules[0].keyFiles[0]).toBe('src/core/index.ts');
        });

        it('should convert backslashes to forward slashes', () => {
            const json = JSON.stringify({
                project: { name: 'test', language: 'TS' },
                modules: [
                    {
                        id: 'core',
                        name: 'Core',
                        path: 'src\\core\\',
                        purpose: 'Core',
                        keyFiles: ['src\\core\\index.ts'],
                        dependencies: [],
                        dependents: [],
                        complexity: 'low',
                        category: 'core',
                    },
                ],
                categories: [{ name: 'core', description: '' }],
            });

            const result = parseModuleGraphResponse(json);
            expect(result.modules[0].path).toBe('src/core/');
            expect(result.modules[0].keyFiles[0]).toBe('src/core/index.ts');
        });
    });

    // ========================================================================
    // Module ID Normalization
    // ========================================================================

    describe('module ID normalization', () => {
        it('should normalize invalid module IDs', () => {
            const json = JSON.stringify({
                project: { name: 'test', language: 'TS' },
                modules: [
                    {
                        id: 'MyModule',
                        name: 'My Module',
                        path: 'src/my-module/',
                        purpose: 'Test',
                        keyFiles: [],
                        dependencies: [],
                        dependents: [],
                        complexity: 'low',
                        category: 'core',
                    },
                ],
                categories: [{ name: 'core', description: '' }],
            });

            const result = parseModuleGraphResponse(json);
            expect(result.modules[0].id).toBe('mymodule');
            expect(stderrOutput).toContain('Normalized module ID');
        });
    });

    // ========================================================================
    // Invalid Complexity Handling
    // ========================================================================

    describe('invalid complexity handling', () => {
        it('should default invalid complexity to medium', () => {
            const json = JSON.stringify({
                project: { name: 'test', language: 'TS' },
                modules: [
                    {
                        id: 'core',
                        name: 'Core',
                        path: 'src/',
                        purpose: 'Core',
                        keyFiles: [],
                        dependencies: [],
                        dependents: [],
                        complexity: 'extreme',
                        category: 'core',
                    },
                ],
                categories: [{ name: 'core', description: '' }],
            });

            const result = parseModuleGraphResponse(json);
            expect(result.modules[0].complexity).toBe('medium');
        });
    });

    // ========================================================================
    // Dependency Validation
    // ========================================================================

    describe('dependency validation', () => {
        it('should remove references to non-existent modules', () => {
            const json = JSON.stringify({
                project: { name: 'test', language: 'TS' },
                modules: [
                    {
                        id: 'core',
                        name: 'Core',
                        path: 'src/',
                        purpose: 'Core',
                        keyFiles: [],
                        dependencies: ['nonexistent'],
                        dependents: ['also-nonexistent'],
                        complexity: 'low',
                        category: 'core',
                    },
                ],
                categories: [{ name: 'core', description: '' }],
            });

            const result = parseModuleGraphResponse(json);
            expect(result.modules[0].dependencies).toEqual([]);
            expect(result.modules[0].dependents).toEqual([]);
            expect(stderrOutput).toContain('unknown dependency');
            expect(stderrOutput).toContain('unknown dependent');
        });
    });

    // ========================================================================
    // Deduplication
    // ========================================================================

    describe('module deduplication', () => {
        it('should deduplicate modules by ID', () => {
            const json = JSON.stringify({
                project: { name: 'test', language: 'TS' },
                modules: [
                    { id: 'core', name: 'Core', path: 'src/core/', purpose: 'First', keyFiles: [], dependencies: [], dependents: [], complexity: 'low', category: 'core' },
                    { id: 'core', name: 'Core Duplicate', path: 'src/core2/', purpose: 'Second', keyFiles: [], dependencies: [], dependents: [], complexity: 'high', category: 'core' },
                ],
                categories: [{ name: 'core', description: '' }],
            });

            const result = parseModuleGraphResponse(json);
            expect(result.modules).toHaveLength(1);
            expect(result.modules[0].purpose).toBe('First');
            expect(stderrOutput).toContain('Duplicate module ID');
        });
    });

    // ========================================================================
    // Auto-Generated Categories
    // ========================================================================

    describe('auto-generated categories', () => {
        it('should auto-add missing categories from modules', () => {
            const json = JSON.stringify({
                project: { name: 'test', language: 'TS' },
                modules: [
                    { id: 'core', name: 'Core', path: 'src/', purpose: 'Core', keyFiles: [], dependencies: [], dependents: [], complexity: 'low', category: 'my-custom-category' },
                ],
                categories: [],
            });

            const result = parseModuleGraphResponse(json);
            expect(result.categories).toHaveLength(1);
            expect(result.categories[0].name).toBe('my-custom-category');
            expect(stderrOutput).toContain("Auto-added missing category 'my-custom-category'");
        });
    });
});

// ============================================================================
// Structural Scan Response
// ============================================================================

describe('parseStructuralScanResponse', () => {
    it('should parse a valid structural scan response', () => {
        const json = JSON.stringify({
            fileCount: 5000,
            areas: [
                { name: 'src', path: 'src/', description: 'Source code' },
                { name: 'packages', path: 'packages/', description: 'Sub-packages' },
            ],
            projectInfo: {
                name: 'test-project',
                language: 'TypeScript',
                buildSystem: 'npm',
            },
        });

        const result = parseStructuralScanResponse(json);
        expect(result.fileCount).toBe(5000);
        expect(result.areas).toHaveLength(2);
        expect(result.areas[0].name).toBe('src');
        expect(result.projectInfo.name).toBe('test-project');
    });

    it('should default fileCount to 0 if missing', () => {
        const json = JSON.stringify({
            areas: [],
            projectInfo: {},
        });

        const result = parseStructuralScanResponse(json);
        expect(result.fileCount).toBe(0);
    });

    it('should handle missing areas gracefully', () => {
        const json = JSON.stringify({
            fileCount: 100,
            projectInfo: { name: 'test' },
        });

        const result = parseStructuralScanResponse(json);
        expect(result.areas).toEqual([]);
    });

    it('should handle missing projectInfo gracefully', () => {
        const json = JSON.stringify({
            fileCount: 100,
            areas: [],
        });

        const result = parseStructuralScanResponse(json);
        expect(result.projectInfo).toEqual({});
    });

    it('should throw on empty input', () => {
        expect(() => parseStructuralScanResponse('')).toThrow('Empty or invalid response');
    });

    it('should throw on non-JSON input', () => {
        expect(() => parseStructuralScanResponse('not json')).toThrow();
    });

    it('should extract JSON from markdown code blocks', () => {
        const response = `\`\`\`json
{
  "fileCount": 200,
  "areas": [{"name": "src", "path": "src/", "description": "Source"}],
  "projectInfo": {"name": "test"}
}
\`\`\``;

        const result = parseStructuralScanResponse(response);
        expect(result.fileCount).toBe(200);
    });
});

// ============================================================================
// normalizePath
// ============================================================================

describe('normalizePath', () => {
    it('should remove leading ./', () => {
        expect(normalizePath('./src/index.ts')).toBe('src/index.ts');
    });

    it('should convert backslashes to forward slashes', () => {
        expect(normalizePath('src\\core\\index.ts')).toBe('src/core/index.ts');
    });

    it('should collapse multiple slashes', () => {
        expect(normalizePath('src//core///index.ts')).toBe('src/core/index.ts');
    });

    it('should handle empty string', () => {
        expect(normalizePath('')).toBe('');
    });

    it('should handle already-normalized paths', () => {
        expect(normalizePath('src/core/index.ts')).toBe('src/core/index.ts');
    });

    it('should handle Windows-style paths', () => {
        expect(normalizePath('.\\src\\core\\')).toBe('src/core/');
    });
});
