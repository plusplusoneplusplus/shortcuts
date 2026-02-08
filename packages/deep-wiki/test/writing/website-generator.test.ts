/**
 * Website Generator Tests
 *
 * Comprehensive tests for the website generation phase:
 *   - Data embedding with special characters and deterministic output
 *   - HTML template generation with theme/search/title options
 *   - Module graph reading and markdown file reading
 *   - Full website generation flow
 *   - Custom template support
 *   - Flat and hierarchical layout support
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
    generateWebsite,
    generateEmbeddedData,
    generateHtmlTemplate,
    readModuleGraph,
    readMarkdownFiles,
    stableStringify,
} from '../../src/writing/website-generator';
import type { ModuleGraph, WebsiteOptions } from '../../src/types';

// ============================================================================
// Test Helpers
// ============================================================================

let tempDir: string;

beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deep-wiki-website-test-'));
});

afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
});

function createTestModuleGraph(): ModuleGraph {
    return {
        project: {
            name: 'TestProject',
            description: 'A test project for wiki generation',
            language: 'TypeScript',
            buildSystem: 'npm + webpack',
            entryPoints: ['src/index.ts'],
        },
        modules: [
            {
                id: 'auth',
                name: 'Auth Module',
                path: 'src/auth/',
                purpose: 'Handles authentication',
                keyFiles: ['src/auth/index.ts', 'src/auth/login.ts'],
                dependencies: ['database'],
                dependents: ['api'],
                complexity: 'high',
                category: 'core',
            },
            {
                id: 'database',
                name: 'Database Module',
                path: 'src/database/',
                purpose: 'Database access layer',
                keyFiles: ['src/database/index.ts'],
                dependencies: [],
                dependents: ['auth'],
                complexity: 'medium',
                category: 'core',
            },
            {
                id: 'utils',
                name: 'Utilities',
                path: 'src/utils/',
                purpose: 'Shared utility functions',
                keyFiles: ['src/utils/index.ts'],
                dependencies: [],
                dependents: [],
                complexity: 'low',
                category: 'utility',
            },
        ],
        categories: [
            { name: 'core', description: 'Core functionality' },
            { name: 'utility', description: 'Utility modules' },
        ],
        architectureNotes: 'Layered architecture with core and utility modules.',
    };
}

function setupWikiDir(moduleGraph: ModuleGraph, markdownFiles?: Record<string, string>): string {
    const wikiDir = path.join(tempDir, 'wiki');
    const modulesDir = path.join(wikiDir, 'modules');
    fs.mkdirSync(modulesDir, { recursive: true });

    // Write module-graph.json
    fs.writeFileSync(
        path.join(wikiDir, 'module-graph.json'),
        JSON.stringify(moduleGraph, null, 2),
        'utf-8'
    );

    // Write markdown files
    const defaultMarkdown: Record<string, string> = {
        auth: '# Auth Module\n\nHandles authentication.\n\n## API\n\n```typescript\nlogin(user: string): Promise<Token>\n```',
        database: '# Database Module\n\nDatabase access layer.\n\n```mermaid\ngraph TD\n  A[App] --> B[Database]\n```',
        utils: '# Utilities\n\nShared utility functions.',
    };

    const files = markdownFiles || defaultMarkdown;
    for (const [id, content] of Object.entries(files)) {
        if (id.startsWith('__')) {
            // Top-level file
            const filename = id.replace(/^__/, '') + '.md';
            fs.writeFileSync(path.join(wikiDir, filename), content, 'utf-8');
        } else {
            fs.writeFileSync(path.join(modulesDir, `${id}.md`), content, 'utf-8');
        }
    }

    return wikiDir;
}

// ============================================================================
// stableStringify
// ============================================================================

describe('stableStringify', () => {
    it('should produce deterministic output with sorted keys', () => {
        const obj1 = { b: 2, a: 1, c: 3 };
        const obj2 = { c: 3, a: 1, b: 2 };
        expect(stableStringify(obj1)).toBe(stableStringify(obj2));
    });

    it('should handle nested objects', () => {
        const obj = { z: { b: 2, a: 1 }, a: { d: 4, c: 3 } };
        const parsed = JSON.parse(stableStringify(obj));
        expect(Object.keys(parsed)).toEqual(['a', 'z']);
        expect(Object.keys(parsed.z)).toEqual(['a', 'b']);
    });

    it('should preserve arrays in order', () => {
        const obj = { items: [3, 1, 2] };
        const result = stableStringify(obj);
        const parsed = JSON.parse(result);
        // Array order should be preserved (not sorted)
        expect(parsed.items).toEqual([3, 1, 2]);
    });

    it('should handle null values', () => {
        const obj = { a: null, b: 'hello' };
        const result = stableStringify(obj);
        const parsed = JSON.parse(result);
        expect(parsed.a).toBeNull();
        expect(parsed.b).toBe('hello');
    });

    it('should handle empty objects', () => {
        expect(stableStringify({})).toBe('{}');
    });

    it('should produce valid JSON', () => {
        const moduleGraph = createTestModuleGraph();
        const result = stableStringify(moduleGraph);
        expect(() => JSON.parse(result)).not.toThrow();
    });
});

// ============================================================================
// generateEmbeddedData
// ============================================================================

describe('generateEmbeddedData', () => {
    it('should produce valid JavaScript with MODULE_GRAPH and MARKDOWN_DATA', () => {
        const graph = createTestModuleGraph();
        const markdown = { auth: '# Auth', database: '# Database' };

        const result = generateEmbeddedData(graph, markdown);

        expect(result).toContain('const MODULE_GRAPH =');
        expect(result).toContain('const MARKDOWN_DATA =');
        expect(result).toContain('"TestProject"');
        expect(result).toContain('"# Auth"');
    });

    it('should handle special characters in markdown', () => {
        const graph = createTestModuleGraph();
        const markdown = {
            test: '# Test\n\n`code` with <html> & "quotes" and \'apostrophes\'',
        };

        const result = generateEmbeddedData(graph, markdown);

        // Should be valid JS (no unescaped characters breaking the string)
        expect(result).toContain('const MARKDOWN_DATA =');
        // JSON.stringify handles escaping
        expect(result).toContain('<html>');
    });

    it('should handle unicode content', () => {
        const graph = createTestModuleGraph();
        const markdown = { test: '# 日本語テスト\n\ncafé 🚀 emoji' };

        const result = generateEmbeddedData(graph, markdown);

        expect(result).toContain('日本語テスト');
        expect(result).toContain('café');
    });

    it('should handle empty markdown data', () => {
        const graph = createTestModuleGraph();
        const result = generateEmbeddedData(graph, {});

        expect(result).toContain('const MARKDOWN_DATA = {}');
    });

    it('should produce deterministic output', () => {
        const graph = createTestModuleGraph();
        const markdown = { b: '# B', a: '# A' };

        const result1 = generateEmbeddedData(graph, markdown);
        const result2 = generateEmbeddedData(graph, markdown);

        expect(result1).toBe(result2);
    });

    it('should sort keys for deterministic output', () => {
        const graph = createTestModuleGraph();
        const markdown = { z: '# Z', a: '# A', m: '# M' };

        const result = generateEmbeddedData(graph, markdown);

        const aIdx = result.indexOf('"a"');
        const mIdx = result.indexOf('"m"');
        const zIdx = result.indexOf('"z"');
        expect(aIdx).toBeLessThan(mIdx);
        expect(mIdx).toBeLessThan(zIdx);
    });

    it('should start with auto-generated comment', () => {
        const graph = createTestModuleGraph();
        const result = generateEmbeddedData(graph, {});
        expect(result).toMatch(/^\/\/ Auto-generated by deep-wiki/);
    });

    it('should handle backslash content in markdown', () => {
        const graph = createTestModuleGraph();
        const markdown = { test: 'Windows path: C:\\Users\\test\\file.ts' };

        const result = generateEmbeddedData(graph, markdown);
        // JSON.stringify escapes backslashes to \\
        expect(result).toContain('C:\\\\Users\\\\test\\\\file.ts');
    });

    it('should handle backtick content in markdown', () => {
        const graph = createTestModuleGraph();
        const markdown = { test: '```typescript\nconst x = `hello ${world}`;\n```' };

        const result = generateEmbeddedData(graph, markdown);
        expect(result).toContain('const MARKDOWN_DATA =');
        // Should be valid JSON
        const match = result.match(/const MARKDOWN_DATA = ([\s\S]+?);\n$/);
        expect(match).not.toBeNull();
        expect(() => JSON.parse(match![1])).not.toThrow();
    });
});

// ============================================================================
// generateHtmlTemplate
// ============================================================================

describe('generateHtmlTemplate', () => {
    it('should generate valid HTML with doctype', () => {
        const html = generateHtmlTemplate({ theme: 'auto', title: 'Test', enableSearch: true });
        expect(html).toMatch(/^<!DOCTYPE html>/);
        expect(html).toContain('</html>');
    });

    it('should include title in the page', () => {
        const html = generateHtmlTemplate({ theme: 'auto', title: 'My Project', enableSearch: true });
        expect(html).toContain('<title>My Project — Wiki</title>');
        expect(html).toContain('My Project');
    });

    it('should escape HTML in title', () => {
        const html = generateHtmlTemplate({ theme: 'auto', title: '<script>alert("xss")</script>', enableSearch: true });
        expect(html).not.toContain('<script>alert("xss")</script>');
        expect(html).toContain('&lt;script&gt;');
    });

    it('should include highlight.js CDN links', () => {
        const html = generateHtmlTemplate({ theme: 'auto', title: 'Test', enableSearch: true });
        expect(html).toContain('highlight.js');
        expect(html).toContain('hljs-light');
        expect(html).toContain('hljs-dark');
    });

    it('should include mermaid CDN link', () => {
        const html = generateHtmlTemplate({ theme: 'auto', title: 'Test', enableSearch: true });
        expect(html).toContain('mermaid');
    });

    it('should include marked.js CDN link', () => {
        const html = generateHtmlTemplate({ theme: 'auto', title: 'Test', enableSearch: true });
        expect(html).toContain('marked');
    });

    it('should include embedded-data.js script reference', () => {
        const html = generateHtmlTemplate({ theme: 'auto', title: 'Test', enableSearch: true });
        expect(html).toContain('src="embedded-data.js"');
    });

    it('should include search box when enableSearch is true', () => {
        const html = generateHtmlTemplate({ theme: 'auto', title: 'Test', enableSearch: true });
        expect(html).toContain('id="search"');
        expect(html).toContain('Search modules');
    });

    it('should exclude search box when enableSearch is false', () => {
        const html = generateHtmlTemplate({ theme: 'auto', title: 'Test', enableSearch: false });
        expect(html).not.toContain('id="search"');
    });

    it('should set auto theme correctly', () => {
        const html = generateHtmlTemplate({ theme: 'auto', title: 'Test', enableSearch: true });
        expect(html).toContain('data-theme="auto"');
        expect(html).toContain('color-scheme');
    });

    it('should set dark theme correctly', () => {
        const html = generateHtmlTemplate({ theme: 'dark', title: 'Test', enableSearch: true });
        expect(html).toContain('data-theme="dark"');
        expect(html).toContain('class="dark-theme"');
    });

    it('should set light theme correctly', () => {
        const html = generateHtmlTemplate({ theme: 'light', title: 'Test', enableSearch: true });
        expect(html).toContain('data-theme="light"');
        expect(html).toContain('class="light-theme"');
    });

    it('should include theme toggle button', () => {
        const html = generateHtmlTemplate({ theme: 'auto', title: 'Test', enableSearch: true });
        expect(html).toContain('id="theme-toggle"');
        expect(html).toContain('Toggle theme');
    });

    it('should include sidebar toggle button', () => {
        const html = generateHtmlTemplate({ theme: 'auto', title: 'Test', enableSearch: true });
        expect(html).toContain('id="sidebar-toggle"');
        expect(html).toContain('Toggle sidebar');
    });

    it('should include copy button functionality', () => {
        const html = generateHtmlTemplate({ theme: 'auto', title: 'Test', enableSearch: true });
        expect(html).toContain('addCopyButton');
        expect(html).toContain('copy-btn');
    });

    it('should include heading anchor functionality', () => {
        const html = generateHtmlTemplate({ theme: 'auto', title: 'Test', enableSearch: true });
        expect(html).toContain('heading-anchor');
    });

    it('should include mermaid initialization', () => {
        const html = generateHtmlTemplate({ theme: 'auto', title: 'Test', enableSearch: true });
        expect(html).toContain('initMermaid');
        expect(html).toContain('mermaid.initialize');
    });

    it('should include responsive styles', () => {
        const html = generateHtmlTemplate({ theme: 'auto', title: 'Test', enableSearch: true });
        expect(html).toContain('@media (max-width: 768px)');
    });
});

// ============================================================================
// Mermaid Diagram Styling
// ============================================================================

describe('generateHtmlTemplate — mermaid diagram styling', () => {
    it('should include mermaid-specific CSS for transparent background', () => {
        const html = generateHtmlTemplate({ theme: 'auto', title: 'Test', enableSearch: true });
        expect(html).toContain('pre.mermaid');
        expect(html).toContain('background: transparent');
    });

    it('should include mermaid-specific CSS to remove code block border', () => {
        const html = generateHtmlTemplate({ theme: 'auto', title: 'Test', enableSearch: true });
        expect(html).toContain('pre.mermaid');
        expect(html).toContain('border: none');
    });

    it('should include mermaid SVG sizing styles', () => {
        const html = generateHtmlTemplate({ theme: 'auto', title: 'Test', enableSearch: true });
        expect(html).toContain('pre.mermaid svg');
        expect(html).toContain('height: auto');
    });

    it('should configure mermaid flowchart with useMaxWidth false', () => {
        const html = generateHtmlTemplate({ theme: 'auto', title: 'Test', enableSearch: true });
        expect(html).toContain('useMaxWidth: false');
    });

    it('should configure mermaid with font size', () => {
        const html = generateHtmlTemplate({ theme: 'auto', title: 'Test', enableSearch: true });
        expect(html).toContain('fontSize: 14');
    });

    it('should configure mermaid flowchart with nodeSpacing and rankSpacing', () => {
        const html = generateHtmlTemplate({ theme: 'auto', title: 'Test', enableSearch: true });
        expect(html).toContain('nodeSpacing: 50');
        expect(html).toContain('rankSpacing: 50');
    });

    it('should configure mermaid flowchart with htmlLabels enabled', () => {
        const html = generateHtmlTemplate({ theme: 'auto', title: 'Test', enableSearch: true });
        expect(html).toContain('htmlLabels: true');
    });

    it('should set mermaid padding to remove code block padding', () => {
        const html = generateHtmlTemplate({ theme: 'auto', title: 'Test', enableSearch: true });
        expect(html).toMatch(/pre\.mermaid\s*\{[^}]*padding:\s*0/);
    });

    it('mermaid styles should be present across all themes', () => {
        const themes: Array<'auto' | 'dark' | 'light'> = ['auto', 'dark', 'light'];
        for (const theme of themes) {
            const html = generateHtmlTemplate({ theme, title: 'Test', enableSearch: true });
            expect(html).toContain('pre.mermaid');
            expect(html).toContain('.mermaid-container');
            expect(html).toContain('useMaxWidth: false');
        }
    });
});

// ============================================================================
// Mermaid Zoom & Pan
// ============================================================================

describe('generateHtmlTemplate — mermaid zoom and pan', () => {
    // --- Container structure ---
    it('should include mermaid-container class in CSS', () => {
        const html = generateHtmlTemplate({ theme: 'auto', title: 'Test', enableSearch: true });
        expect(html).toContain('.mermaid-container');
    });

    it('should build mermaid-container DOM in script', () => {
        const html = generateHtmlTemplate({ theme: 'auto', title: 'Test', enableSearch: true });
        expect(html).toContain("container.className = 'mermaid-container'");
    });

    // --- Toolbar ---
    it('should include mermaid-toolbar with label', () => {
        const html = generateHtmlTemplate({ theme: 'auto', title: 'Test', enableSearch: true });
        expect(html).toContain('mermaid-toolbar');
        expect(html).toContain('mermaid-toolbar-label');
    });

    it('should include zoom in button', () => {
        const html = generateHtmlTemplate({ theme: 'auto', title: 'Test', enableSearch: true });
        expect(html).toContain('mermaid-zoom-in');
        expect(html).toContain('Zoom in');
    });

    it('should include zoom out button', () => {
        const html = generateHtmlTemplate({ theme: 'auto', title: 'Test', enableSearch: true });
        expect(html).toContain('mermaid-zoom-out');
        expect(html).toContain('Zoom out');
    });

    it('should include zoom reset button', () => {
        const html = generateHtmlTemplate({ theme: 'auto', title: 'Test', enableSearch: true });
        expect(html).toContain('mermaid-zoom-reset');
        expect(html).toContain('Reset view');
    });

    it('should include zoom level display', () => {
        const html = generateHtmlTemplate({ theme: 'auto', title: 'Test', enableSearch: true });
        expect(html).toContain('mermaid-zoom-level');
        expect(html).toContain('100%');
    });

    // --- Zoom button CSS ---
    it('should style zoom buttons with hover and active states', () => {
        const html = generateHtmlTemplate({ theme: 'auto', title: 'Test', enableSearch: true });
        expect(html).toContain('.mermaid-zoom-btn');
        expect(html).toContain('.mermaid-zoom-btn:hover');
        expect(html).toContain('.mermaid-zoom-btn:active');
    });

    it('should style zoom level display', () => {
        const html = generateHtmlTemplate({ theme: 'auto', title: 'Test', enableSearch: true });
        expect(html).toContain('.mermaid-zoom-level');
        expect(html).toContain('min-width: 42px');
    });

    // --- Viewport & SVG wrapper ---
    it('should include mermaid-viewport class with grab cursor', () => {
        const html = generateHtmlTemplate({ theme: 'auto', title: 'Test', enableSearch: true });
        expect(html).toContain('.mermaid-viewport');
        expect(html).toContain('cursor: grab');
    });

    it('should include mermaid-svg-wrapper with transform-origin', () => {
        const html = generateHtmlTemplate({ theme: 'auto', title: 'Test', enableSearch: true });
        expect(html).toContain('.mermaid-svg-wrapper');
        expect(html).toContain('transform-origin: 0 0');
    });

    it('should disable transition during drag', () => {
        const html = generateHtmlTemplate({ theme: 'auto', title: 'Test', enableSearch: true });
        expect(html).toContain('.mermaid-dragging .mermaid-svg-wrapper');
        expect(html).toContain('transition: none');
    });

    it('should change cursor to grabbing during drag', () => {
        const html = generateHtmlTemplate({ theme: 'auto', title: 'Test', enableSearch: true });
        expect(html).toContain('.mermaid-viewport.mermaid-dragging');
        expect(html).toContain('cursor: grabbing');
    });

    // --- Zoom/Pan JS logic ---
    it('should define zoom constants', () => {
        const html = generateHtmlTemplate({ theme: 'auto', title: 'Test', enableSearch: true });
        expect(html).toContain('MERMAID_MIN_ZOOM = 0.25');
        expect(html).toContain('MERMAID_MAX_ZOOM = 4');
        expect(html).toContain('MERMAID_ZOOM_STEP = 0.25');
    });

    it('should define initMermaidZoom function', () => {
        const html = generateHtmlTemplate({ theme: 'auto', title: 'Test', enableSearch: true });
        expect(html).toContain('function initMermaidZoom()');
    });

    it('should call initMermaidZoom after mermaid rendering', () => {
        const html = generateHtmlTemplate({ theme: 'auto', title: 'Test', enableSearch: true });
        expect(html).toContain('initMermaid().then(function() { initMermaidZoom(); })');
    });

    it('should implement applyTransform with translate and scale', () => {
        const html = generateHtmlTemplate({ theme: 'auto', title: 'Test', enableSearch: true });
        expect(html).toContain('applyTransform');
        expect(html).toContain("'translate('");
        expect(html).toContain("'px) scale('");
    });

    it('should implement ctrl/cmd + wheel zoom', () => {
        const html = generateHtmlTemplate({ theme: 'auto', title: 'Test', enableSearch: true });
        expect(html).toContain('e.ctrlKey');
        expect(html).toContain('e.metaKey');
        expect(html).toContain("'wheel'");
        expect(html).toContain('passive: false');
    });

    it('should implement mouse drag panning', () => {
        const html = generateHtmlTemplate({ theme: 'auto', title: 'Test', enableSearch: true });
        expect(html).toContain("'mousedown'");
        expect(html).toContain("'mousemove'");
        expect(html).toContain("'mouseup'");
        expect(html).toContain('isDragging');
    });

    it('should clamp zoom in to MAX_ZOOM', () => {
        const html = generateHtmlTemplate({ theme: 'auto', title: 'Test', enableSearch: true });
        expect(html).toContain('Math.min(MERMAID_MAX_ZOOM');
    });

    it('should clamp zoom out to MIN_ZOOM', () => {
        const html = generateHtmlTemplate({ theme: 'auto', title: 'Test', enableSearch: true });
        expect(html).toContain('Math.max(MERMAID_MIN_ZOOM');
    });

    it('should implement zoom-toward-cursor for wheel zoom', () => {
        const html = generateHtmlTemplate({ theme: 'auto', title: 'Test', enableSearch: true });
        // Zoom toward cursor uses getBoundingClientRect and adjusts translate
        expect(html).toContain('getBoundingClientRect');
        expect(html).toContain('e.clientX - rect.left');
        expect(html).toContain('e.clientY - rect.top');
    });

    it('should reset zoom to scale 1 and translate 0 on reset button', () => {
        const html = generateHtmlTemplate({ theme: 'auto', title: 'Test', enableSearch: true });
        expect(html).toContain('state.scale = 1');
        expect(html).toContain('state.translateX = 0');
        expect(html).toContain('state.translateY = 0');
    });

    it('should add and remove mermaid-dragging class during drag', () => {
        const html = generateHtmlTemplate({ theme: 'auto', title: 'Test', enableSearch: true });
        expect(html).toContain("viewport.classList.add('mermaid-dragging')");
        expect(html).toContain("viewport.classList.remove('mermaid-dragging')");
    });

    it('should return Promise.resolve from initMermaid when no blocks', () => {
        const html = generateHtmlTemplate({ theme: 'auto', title: 'Test', enableSearch: true });
        expect(html).toContain('return Promise.resolve()');
    });

    it('should return mermaid.run promise from initMermaid', () => {
        const html = generateHtmlTemplate({ theme: 'auto', title: 'Test', enableSearch: true });
        expect(html).toContain('return mermaid.run(');
    });

    // --- Responsive ---
    it('should include responsive mermaid-container styles for mobile', () => {
        const html = generateHtmlTemplate({ theme: 'auto', title: 'Test', enableSearch: true });
        expect(html).toContain('.mermaid-container');
        expect(html).toContain('@media (max-width: 768px)');
    });

    // --- Cross-theme ---
    it('zoom/pan should be present across all themes', () => {
        const themes: Array<'auto' | 'dark' | 'light'> = ['auto', 'dark', 'light'];
        for (const theme of themes) {
            const html = generateHtmlTemplate({ theme, title: 'Test', enableSearch: true });
            expect(html).toContain('mermaid-container');
            expect(html).toContain('initMermaidZoom');
            expect(html).toContain('MERMAID_ZOOM_STEP');
        }
    });
});

// ============================================================================
// readModuleGraph
// ============================================================================

describe('readModuleGraph', () => {
    it('should read and parse module-graph.json', () => {
        const graph = createTestModuleGraph();
        const wikiDir = setupWikiDir(graph);

        const result = readModuleGraph(wikiDir);

        expect(result.project.name).toBe('TestProject');
        expect(result.modules).toHaveLength(3);
    });

    it('should throw when module-graph.json is missing', () => {
        const wikiDir = path.join(tempDir, 'empty-wiki');
        fs.mkdirSync(wikiDir, { recursive: true });

        expect(() => readModuleGraph(wikiDir)).toThrow('module-graph.json not found');
    });

    it('should throw on invalid JSON', () => {
        const wikiDir = path.join(tempDir, 'bad-wiki');
        fs.mkdirSync(wikiDir, { recursive: true });
        fs.writeFileSync(path.join(wikiDir, 'module-graph.json'), 'not json', 'utf-8');

        expect(() => readModuleGraph(wikiDir)).toThrow();
    });
});

// ============================================================================
// readMarkdownFiles
// ============================================================================

describe('readMarkdownFiles', () => {
    it('should read markdown files from modules/ directory', () => {
        const graph = createTestModuleGraph();
        const wikiDir = setupWikiDir(graph);

        const result = readMarkdownFiles(wikiDir, graph);

        expect(result['auth']).toContain('# Auth Module');
        expect(result['database']).toContain('# Database Module');
        expect(result['utils']).toContain('# Utilities');
    });

    it('should read top-level markdown files', () => {
        const graph = createTestModuleGraph();
        const wikiDir = setupWikiDir(graph, {
            auth: '# Auth',
            __index: '# Project Index',
            '__getting-started': '# Getting Started',
            __architecture: '# Architecture',
        });

        const result = readMarkdownFiles(wikiDir, graph);

        expect(result['__index']).toContain('# Project Index');
        expect(result['__getting-started']).toContain('# Getting Started');
        expect(result['__architecture']).toContain('# Architecture');
    });

    it('should handle missing modules directory gracefully', () => {
        const wikiDir = path.join(tempDir, 'no-modules');
        fs.mkdirSync(wikiDir, { recursive: true });
        fs.writeFileSync(
            path.join(wikiDir, 'module-graph.json'),
            JSON.stringify(createTestModuleGraph()),
            'utf-8'
        );

        const graph = createTestModuleGraph();
        const result = readMarkdownFiles(wikiDir, graph);

        expect(Object.keys(result)).toHaveLength(0);
    });

    it('should handle empty modules directory', () => {
        const graph = createTestModuleGraph();
        const wikiDir = path.join(tempDir, 'empty-modules');
        const modulesDir = path.join(wikiDir, 'modules');
        fs.mkdirSync(modulesDir, { recursive: true });
        fs.writeFileSync(
            path.join(wikiDir, 'module-graph.json'),
            JSON.stringify(graph),
            'utf-8'
        );

        const result = readMarkdownFiles(wikiDir, graph);

        expect(Object.keys(result)).toHaveLength(0);
    });

    it('should map file slugs to module IDs', () => {
        const graph = createTestModuleGraph();
        const wikiDir = setupWikiDir(graph);

        const result = readMarkdownFiles(wikiDir, graph);

        // 'auth.md' should map to module ID 'auth'
        expect(result).toHaveProperty('auth');
        expect(result).toHaveProperty('database');
    });

    it('should read hierarchical area layout', () => {
        const graph: ModuleGraph = {
            ...createTestModuleGraph(),
            areas: [
                { id: 'core', name: 'Core', path: 'src/core/', description: 'Core modules', modules: ['auth'] },
            ],
        };

        // Set up area structure
        const wikiDir = path.join(tempDir, 'hierarchical-wiki');
        const areaModulesDir = path.join(wikiDir, 'areas', 'core', 'modules');
        fs.mkdirSync(areaModulesDir, { recursive: true });
        fs.writeFileSync(
            path.join(wikiDir, 'module-graph.json'),
            JSON.stringify(graph),
            'utf-8'
        );
        fs.writeFileSync(path.join(areaModulesDir, 'auth.md'), '# Area Auth', 'utf-8');
        fs.writeFileSync(path.join(wikiDir, 'areas', 'core', 'index.md'), '# Core Index', 'utf-8');
        fs.writeFileSync(path.join(wikiDir, 'areas', 'core', 'architecture.md'), '# Core Arch', 'utf-8');

        const result = readMarkdownFiles(wikiDir, graph);

        expect(result['auth']).toContain('# Area Auth');
        expect(result['__area_core_index']).toContain('# Core Index');
        expect(result['__area_core_architecture']).toContain('# Core Arch');
    });

    it('should ignore non-md files in modules directory', () => {
        const graph = createTestModuleGraph();
        const wikiDir = setupWikiDir(graph);

        // Add a non-md file
        fs.writeFileSync(path.join(wikiDir, 'modules', 'readme.txt'), 'not markdown', 'utf-8');

        const result = readMarkdownFiles(wikiDir, graph);

        expect(result).not.toHaveProperty('readme');
    });
});

// ============================================================================
// generateWebsite — Full Integration
// ============================================================================

describe('generateWebsite', () => {
    it('should generate index.html and embedded-data.js', () => {
        const graph = createTestModuleGraph();
        const wikiDir = setupWikiDir(graph);

        const files = generateWebsite(wikiDir);

        expect(files).toHaveLength(2);
        expect(fs.existsSync(path.join(wikiDir, 'index.html'))).toBe(true);
        expect(fs.existsSync(path.join(wikiDir, 'embedded-data.js'))).toBe(true);
    });

    it('should embed module graph data in embedded-data.js', () => {
        const graph = createTestModuleGraph();
        const wikiDir = setupWikiDir(graph);

        generateWebsite(wikiDir);

        const embeddedData = fs.readFileSync(path.join(wikiDir, 'embedded-data.js'), 'utf-8');
        expect(embeddedData).toContain('MODULE_GRAPH');
        expect(embeddedData).toContain('MARKDOWN_DATA');
        expect(embeddedData).toContain('TestProject');
    });

    it('should embed markdown content in embedded-data.js', () => {
        const graph = createTestModuleGraph();
        const wikiDir = setupWikiDir(graph);

        generateWebsite(wikiDir);

        const embeddedData = fs.readFileSync(path.join(wikiDir, 'embedded-data.js'), 'utf-8');
        expect(embeddedData).toContain('Auth Module');
        expect(embeddedData).toContain('Database Module');
    });

    it('should generate valid HTML', () => {
        const graph = createTestModuleGraph();
        const wikiDir = setupWikiDir(graph);

        generateWebsite(wikiDir);

        const html = fs.readFileSync(path.join(wikiDir, 'index.html'), 'utf-8');
        expect(html).toContain('<!DOCTYPE html>');
        expect(html).toContain('</html>');
        expect(html).toContain('src="embedded-data.js"');
    });

    it('should use project name as title by default', () => {
        const graph = createTestModuleGraph();
        const wikiDir = setupWikiDir(graph);

        generateWebsite(wikiDir);

        const html = fs.readFileSync(path.join(wikiDir, 'index.html'), 'utf-8');
        expect(html).toContain('TestProject');
    });

    it('should use custom title when provided', () => {
        const graph = createTestModuleGraph();
        const wikiDir = setupWikiDir(graph);

        generateWebsite(wikiDir, { title: 'Custom Wiki Title' });

        const html = fs.readFileSync(path.join(wikiDir, 'index.html'), 'utf-8');
        expect(html).toContain('Custom Wiki Title');
    });

    it('should apply dark theme', () => {
        const graph = createTestModuleGraph();
        const wikiDir = setupWikiDir(graph);

        generateWebsite(wikiDir, { theme: 'dark' });

        const html = fs.readFileSync(path.join(wikiDir, 'index.html'), 'utf-8');
        expect(html).toContain('data-theme="dark"');
    });

    it('should apply light theme', () => {
        const graph = createTestModuleGraph();
        const wikiDir = setupWikiDir(graph);

        generateWebsite(wikiDir, { theme: 'light' });

        const html = fs.readFileSync(path.join(wikiDir, 'index.html'), 'utf-8');
        expect(html).toContain('data-theme="light"');
    });

    it('should default to auto theme', () => {
        const graph = createTestModuleGraph();
        const wikiDir = setupWikiDir(graph);

        generateWebsite(wikiDir);

        const html = fs.readFileSync(path.join(wikiDir, 'index.html'), 'utf-8');
        expect(html).toContain('data-theme="auto"');
    });

    it('should include search when noSearch is not set', () => {
        const graph = createTestModuleGraph();
        const wikiDir = setupWikiDir(graph);

        generateWebsite(wikiDir);

        const html = fs.readFileSync(path.join(wikiDir, 'index.html'), 'utf-8');
        expect(html).toContain('id="search"');
    });

    it('should exclude search when noSearch is true', () => {
        const graph = createTestModuleGraph();
        const wikiDir = setupWikiDir(graph);

        generateWebsite(wikiDir, { noSearch: true });

        const html = fs.readFileSync(path.join(wikiDir, 'index.html'), 'utf-8');
        expect(html).not.toContain('id="search"');
    });

    it('should throw when module-graph.json is missing', () => {
        const wikiDir = path.join(tempDir, 'empty');
        fs.mkdirSync(wikiDir, { recursive: true });

        expect(() => generateWebsite(wikiDir)).toThrow('module-graph.json not found');
    });

    it('should handle wiki with no markdown files', () => {
        const graph = createTestModuleGraph();
        const wikiDir = path.join(tempDir, 'no-md');
        fs.mkdirSync(wikiDir, { recursive: true });
        fs.writeFileSync(
            path.join(wikiDir, 'module-graph.json'),
            JSON.stringify(graph),
            'utf-8'
        );

        const files = generateWebsite(wikiDir);

        expect(files).toHaveLength(2);
        const embeddedData = fs.readFileSync(path.join(wikiDir, 'embedded-data.js'), 'utf-8');
        expect(embeddedData).toContain('MARKDOWN_DATA = {}');
    });

    it('should use custom template when provided', () => {
        const graph = createTestModuleGraph();
        const wikiDir = setupWikiDir(graph);

        // Create a custom template
        const templatePath = path.join(tempDir, 'custom.html');
        fs.writeFileSync(templatePath, '<html><body>Custom Template</body></html>', 'utf-8');

        generateWebsite(wikiDir, { customTemplate: templatePath });

        const html = fs.readFileSync(path.join(wikiDir, 'index.html'), 'utf-8');
        expect(html).toContain('Custom Template');
    });

    it('should throw when custom template does not exist', () => {
        const graph = createTestModuleGraph();
        const wikiDir = setupWikiDir(graph);

        expect(() =>
            generateWebsite(wikiDir, { customTemplate: '/nonexistent/template.html' })
        ).toThrow('Custom template not found');
    });

    it('should overwrite existing index.html', () => {
        const graph = createTestModuleGraph();
        const wikiDir = setupWikiDir(graph);

        // Create existing index.html
        fs.writeFileSync(path.join(wikiDir, 'index.html'), 'old content', 'utf-8');

        generateWebsite(wikiDir);

        const html = fs.readFileSync(path.join(wikiDir, 'index.html'), 'utf-8');
        expect(html).not.toBe('old content');
        expect(html).toContain('<!DOCTYPE html>');
    });

    it('should overwrite existing embedded-data.js', () => {
        const graph = createTestModuleGraph();
        const wikiDir = setupWikiDir(graph);

        // Create existing embedded-data.js
        fs.writeFileSync(path.join(wikiDir, 'embedded-data.js'), 'old data', 'utf-8');

        generateWebsite(wikiDir);

        const data = fs.readFileSync(path.join(wikiDir, 'embedded-data.js'), 'utf-8');
        expect(data).not.toBe('old data');
        expect(data).toContain('MODULE_GRAPH');
    });

    it('should produce deterministic output', () => {
        const graph = createTestModuleGraph();
        const wikiDir1 = setupWikiDir(graph);
        generateWebsite(wikiDir1);

        // Set up second wiki dir
        const wikiDir2 = path.join(tempDir, 'wiki2');
        const modulesDir2 = path.join(wikiDir2, 'modules');
        fs.mkdirSync(modulesDir2, { recursive: true });
        fs.writeFileSync(
            path.join(wikiDir2, 'module-graph.json'),
            JSON.stringify(graph, null, 2),
            'utf-8'
        );
        // Write the same markdown files
        for (const [id, content] of Object.entries({
            auth: '# Auth Module\n\nHandles authentication.\n\n## API\n\n```typescript\nlogin(user: string): Promise<Token>\n```',
            database: '# Database Module\n\nDatabase access layer.\n\n```mermaid\ngraph TD\n  A[App] --> B[Database]\n```',
            utils: '# Utilities\n\nShared utility functions.',
        })) {
            fs.writeFileSync(path.join(modulesDir2, `${id}.md`), content, 'utf-8');
        }
        generateWebsite(wikiDir2);

        const data1 = fs.readFileSync(path.join(wikiDir1, 'embedded-data.js'), 'utf-8');
        const data2 = fs.readFileSync(path.join(wikiDir2, 'embedded-data.js'), 'utf-8');
        expect(data1).toBe(data2);
    });

    it('should handle markdown with special characters', () => {
        const graph = createTestModuleGraph();
        const wikiDir = setupWikiDir(graph, {
            auth: '# Auth <Module>\n\n"Special" & \'characters\' `code`\n\nLine with $dollar and \\backslash',
        });

        // Should not throw
        const files = generateWebsite(wikiDir);
        expect(files).toHaveLength(2);

        const data = fs.readFileSync(path.join(wikiDir, 'embedded-data.js'), 'utf-8');
        expect(data).toContain('Auth <Module>');
    });

    it('should use UTF-8 encoding for generated files', () => {
        const graph: ModuleGraph = {
            ...createTestModuleGraph(),
            project: {
                ...createTestModuleGraph().project,
                name: 'プロジェクト',
                description: 'Résumé of café',
            },
        };
        const wikiDir = setupWikiDir(graph, {
            auth: '# 認証モジュール\n\n日本語テスト 🎉',
        });

        generateWebsite(wikiDir);

        const html = fs.readFileSync(path.join(wikiDir, 'index.html'), 'utf-8');
        const data = fs.readFileSync(path.join(wikiDir, 'embedded-data.js'), 'utf-8');

        expect(html).toContain('プロジェクト');
        expect(data).toContain('認証モジュール');
        expect(data).toContain('日本語テスト');
    });

    it('should return paths as absolute paths', () => {
        const graph = createTestModuleGraph();
        const wikiDir = setupWikiDir(graph);

        const files = generateWebsite(wikiDir);

        for (const filePath of files) {
            expect(path.isAbsolute(filePath)).toBe(true);
            expect(fs.existsSync(filePath)).toBe(true);
        }
    });
});

// ============================================================================
// Website generation with hierarchical layout
// ============================================================================

describe('generateWebsite — hierarchical layout', () => {
    it('should handle areas with module files', () => {
        const graph: ModuleGraph = {
            project: {
                name: 'LargeProject',
                description: 'A large project',
                language: 'TypeScript',
                buildSystem: 'npm',
                entryPoints: ['src/index.ts'],
            },
            modules: [
                {
                    id: 'core-auth',
                    name: 'Core Auth',
                    path: 'src/core/auth/',
                    purpose: 'Auth in core',
                    keyFiles: [],
                    dependencies: [],
                    dependents: [],
                    complexity: 'high',
                    category: 'core',
                    area: 'core',
                },
            ],
            categories: [{ name: 'core', description: 'Core' }],
            architectureNotes: '',
            areas: [
                { id: 'core', name: 'Core', path: 'src/core/', description: 'Core area', modules: ['core-auth'] },
            ],
        };

        const wikiDir = path.join(tempDir, 'hierarchical');
        const areaModulesDir = path.join(wikiDir, 'areas', 'core', 'modules');
        fs.mkdirSync(areaModulesDir, { recursive: true });
        fs.writeFileSync(
            path.join(wikiDir, 'module-graph.json'),
            JSON.stringify(graph),
            'utf-8'
        );
        fs.writeFileSync(
            path.join(areaModulesDir, 'core-auth.md'),
            '# Core Auth Module',
            'utf-8'
        );

        const files = generateWebsite(wikiDir);
        expect(files).toHaveLength(2);

        const data = fs.readFileSync(path.join(wikiDir, 'embedded-data.js'), 'utf-8');
        expect(data).toContain('Core Auth Module');
    });
});

// ============================================================================
// CLI integration (generate command Phase 4)
// ============================================================================

describe('generateWebsite — options combinations', () => {
    it('should accept all options simultaneously', () => {
        const graph = createTestModuleGraph();
        const wikiDir = setupWikiDir(graph);

        const options: WebsiteOptions = {
            theme: 'dark',
            title: 'Custom Title',
            noSearch: true,
        };

        const files = generateWebsite(wikiDir, options);
        expect(files).toHaveLength(2);

        const html = fs.readFileSync(path.join(wikiDir, 'index.html'), 'utf-8');
        expect(html).toContain('Custom Title');
        expect(html).toContain('data-theme="dark"');
        expect(html).not.toContain('id="search"');
    });

    it('should use defaults when no options provided', () => {
        const graph = createTestModuleGraph();
        const wikiDir = setupWikiDir(graph);

        const files = generateWebsite(wikiDir);
        expect(files).toHaveLength(2);

        const html = fs.readFileSync(path.join(wikiDir, 'index.html'), 'utf-8');
        expect(html).toContain('data-theme="auto"');
        expect(html).toContain('id="search"');
        expect(html).toContain('TestProject');
    });

    it('should use undefined options as defaults', () => {
        const graph = createTestModuleGraph();
        const wikiDir = setupWikiDir(graph);

        const files = generateWebsite(wikiDir, {});
        expect(files).toHaveLength(2);

        const html = fs.readFileSync(path.join(wikiDir, 'index.html'), 'utf-8');
        expect(html).toContain('data-theme="auto"');
    });
});

// ============================================================================
// Internal Link Interception
// ============================================================================

describe('generateHtmlTemplate — internal link interception', () => {
    // --- Delegated click handler ---
    it('should add a delegated click handler on the content container', () => {
        const html = generateHtmlTemplate({ theme: 'auto', title: 'Test', enableSearch: true });
        expect(html).toContain("container.addEventListener('click'");
    });

    it('should detect clicks on <a> tags by walking up the DOM', () => {
        const html = generateHtmlTemplate({ theme: 'auto', title: 'Test', enableSearch: true });
        expect(html).toContain("target.tagName === 'A'");
    });

    it('should check for .md file extension in href', () => {
        const html = generateHtmlTemplate({ theme: 'auto', title: 'Test', enableSearch: true });
        expect(html).toContain('.md');
        // Check the regex that matches .md links
        expect(html).toContain("getAttribute('href')");
    });

    it('should not intercept external http/https links', () => {
        const html = generateHtmlTemplate({ theme: 'auto', title: 'Test', enableSearch: true });
        expect(html).toContain('https?:\\/\\/');
    });

    it('should call preventDefault on intercepted links', () => {
        const html = generateHtmlTemplate({ theme: 'auto', title: 'Test', enableSearch: true });
        expect(html).toContain('e.preventDefault()');
    });

    // --- Slug extraction ---
    it('should strip leading relative paths from href', () => {
        const html = generateHtmlTemplate({ theme: 'auto', title: 'Test', enableSearch: true });
        // Strips ./ and ../ prefixes — template literal resolves escapes
        expect(html).toContain("replace(/^(\\.\\/|\\.\\.\\/)*/, '')");
    });

    it('should strip modules/ prefix from href', () => {
        const html = generateHtmlTemplate({ theme: 'auto', title: 'Test', enableSearch: true });
        expect(html).toContain("replace(/^modules\\//, '')");
    });

    it('should strip .md extension from slug', () => {
        const html = generateHtmlTemplate({ theme: 'auto', title: 'Test', enableSearch: true });
        expect(html).toContain("replace(/\\.md$/, '')");
    });

    // --- Special page handling ---
    it('should recognize index.md as a special page', () => {
        const html = generateHtmlTemplate({ theme: 'auto', title: 'Test', enableSearch: true });
        expect(html).toContain("'index': { key: '__index', title: 'Index' }");
    });

    it('should recognize architecture.md as a special page', () => {
        const html = generateHtmlTemplate({ theme: 'auto', title: 'Test', enableSearch: true });
        expect(html).toContain("'architecture': { key: '__architecture', title: 'Architecture' }");
    });

    it('should recognize getting-started.md as a special page', () => {
        const html = generateHtmlTemplate({ theme: 'auto', title: 'Test', enableSearch: true });
        expect(html).toContain("'getting-started': { key: '__getting-started', title: 'Getting Started' }");
    });

    it('should call loadSpecialPage for special page slugs', () => {
        const html = generateHtmlTemplate({ theme: 'auto', title: 'Test', enableSearch: true });
        expect(html).toContain('loadSpecialPage(specialPages[slug].key, specialPages[slug].title)');
    });

    // --- Module matching ---
    it('should define findModuleIdBySlugClient function', () => {
        const html = generateHtmlTemplate({ theme: 'auto', title: 'Test', enableSearch: true });
        expect(html).toContain('function findModuleIdBySlugClient(slug)');
    });

    it('should normalize slug with lowercase and hyphen replacement', () => {
        const html = generateHtmlTemplate({ theme: 'auto', title: 'Test', enableSearch: true });
        // The client-side function normalizes slugs same as server-side
        expect(html).toContain("slug.toLowerCase().replace(/[^a-z0-9]+/g, '-')");
    });

    it('should call loadModule for matched module IDs', () => {
        const html = generateHtmlTemplate({ theme: 'auto', title: 'Test', enableSearch: true });
        expect(html).toContain('loadModule(matchedId)');
    });

    it('should call findModuleIdBySlugClient with extracted slug', () => {
        const html = generateHtmlTemplate({ theme: 'auto', title: 'Test', enableSearch: true });
        expect(html).toContain('findModuleIdBySlugClient(slug)');
    });

    // --- Hash fragment handling ---
    it('should handle hash fragments in .md links', () => {
        const html = generateHtmlTemplate({ theme: 'auto', title: 'Test', enableSearch: true });
        expect(html).toContain("href.indexOf('#')");
        expect(html).toContain('hashPart');
    });

    it('should scroll to hash target after module load', () => {
        const html = generateHtmlTemplate({ theme: 'auto', title: 'Test', enableSearch: true });
        expect(html).toContain('scrollIntoView');
    });

    // --- Cross-theme ---
    it('link interception should be present across all themes', () => {
        const themes: Array<'auto' | 'dark' | 'light'> = ['auto', 'dark', 'light'];
        for (const theme of themes) {
            const html = generateHtmlTemplate({ theme, title: 'Test', enableSearch: true });
            expect(html).toContain('findModuleIdBySlugClient');
            expect(html).toContain("container.addEventListener('click'");
        }
    });

    // --- Integration with full website ---
    it('link interception should be present in generated website', () => {
        const graph = createTestModuleGraph();
        const wikiDir = setupWikiDir(graph);
        generateWebsite(wikiDir);

        const html = fs.readFileSync(path.join(wikiDir, 'index.html'), 'utf-8');
        expect(html).toContain('findModuleIdBySlugClient');
        expect(html).toContain("container.addEventListener('click'");
    });
});

// ============================================================================
// Browser History Management (pushState/popstate)
// ============================================================================

describe('generateHtmlTemplate — browser history management', () => {
    // --- pushState in showHome ---
    it('should call history.pushState in showHome', () => {
        const html = generateHtmlTemplate({ theme: 'auto', title: 'Test', enableSearch: true });
        expect(html).toContain("history.pushState({ type: 'home' }");
    });

    it('showHome should accept skipHistory parameter', () => {
        const html = generateHtmlTemplate({ theme: 'auto', title: 'Test', enableSearch: true });
        expect(html).toContain('function showHome(skipHistory)');
    });

    it('showHome should skip pushState when skipHistory is true', () => {
        const html = generateHtmlTemplate({ theme: 'auto', title: 'Test', enableSearch: true });
        // The pattern: if (!skipHistory) { history.pushState... }
        expect(html).toContain('if (!skipHistory)');
    });

    // --- pushState in loadModule ---
    it('should call history.pushState in loadModule with module state', () => {
        const html = generateHtmlTemplate({ theme: 'auto', title: 'Test', enableSearch: true });
        expect(html).toContain("history.pushState({ type: 'module', id: moduleId }");
    });

    it('loadModule should accept skipHistory parameter', () => {
        const html = generateHtmlTemplate({ theme: 'auto', title: 'Test', enableSearch: true });
        expect(html).toContain('function loadModule(moduleId, skipHistory)');
    });

    it('loadModule pushState should include module ID in hash', () => {
        const html = generateHtmlTemplate({ theme: 'auto', title: 'Test', enableSearch: true });
        expect(html).toContain("'#module-' + encodeURIComponent(moduleId)");
    });

    // --- pushState in loadSpecialPage ---
    it('should call history.pushState in loadSpecialPage with special state', () => {
        const html = generateHtmlTemplate({ theme: 'auto', title: 'Test', enableSearch: true });
        expect(html).toContain("history.pushState({ type: 'special', key: key, title: title }");
    });

    it('loadSpecialPage should accept skipHistory parameter', () => {
        const html = generateHtmlTemplate({ theme: 'auto', title: 'Test', enableSearch: true });
        expect(html).toContain('function loadSpecialPage(key, title, skipHistory)');
    });

    // --- replaceState for initial load ---
    it('should use history.replaceState for initial page load', () => {
        const html = generateHtmlTemplate({ theme: 'auto', title: 'Test', enableSearch: true });
        expect(html).toContain("history.replaceState({ type: 'home' }");
    });

    it('initial showHome should pass true to skip pushState', () => {
        const html = generateHtmlTemplate({ theme: 'auto', title: 'Test', enableSearch: true });
        expect(html).toContain('showHome(true)');
    });

    // --- popstate listener ---
    it('should add a popstate event listener', () => {
        const html = generateHtmlTemplate({ theme: 'auto', title: 'Test', enableSearch: true });
        expect(html).toContain("window.addEventListener('popstate'");
    });

    it('popstate handler should handle home state', () => {
        const html = generateHtmlTemplate({ theme: 'auto', title: 'Test', enableSearch: true });
        expect(html).toContain("state.type === 'home'");
    });

    it('popstate handler should handle module state', () => {
        const html = generateHtmlTemplate({ theme: 'auto', title: 'Test', enableSearch: true });
        expect(html).toContain("state.type === 'module' && state.id");
    });

    it('popstate handler should handle special page state', () => {
        const html = generateHtmlTemplate({ theme: 'auto', title: 'Test', enableSearch: true });
        expect(html).toContain("state.type === 'special' && state.key && state.title");
    });

    it('popstate handler should call loadModule with skipHistory=true', () => {
        const html = generateHtmlTemplate({ theme: 'auto', title: 'Test', enableSearch: true });
        expect(html).toContain('loadModule(state.id, true)');
    });

    it('popstate handler should call loadSpecialPage with skipHistory=true', () => {
        const html = generateHtmlTemplate({ theme: 'auto', title: 'Test', enableSearch: true });
        expect(html).toContain('loadSpecialPage(state.key, state.title, true)');
    });

    it('popstate handler should fall back to showHome when state is null', () => {
        const html = generateHtmlTemplate({ theme: 'auto', title: 'Test', enableSearch: true });
        // When state is null/falsy, showHome(true) is called
        expect(html).toContain('if (!state)');
    });

    it('popstate handler should fall back to showHome for unknown state types', () => {
        const html = generateHtmlTemplate({ theme: 'auto', title: 'Test', enableSearch: true });
        // The else clause falls back to showHome(true)
        expect(html).toContain('} else {\n                showHome(true)');
    });

    // --- Cross-theme ---
    it('history management should be present across all themes', () => {
        const themes: Array<'auto' | 'dark' | 'light'> = ['auto', 'dark', 'light'];
        for (const theme of themes) {
            const html = generateHtmlTemplate({ theme, title: 'Test', enableSearch: true });
            expect(html).toContain('history.pushState');
            expect(html).toContain('history.replaceState');
            expect(html).toContain("window.addEventListener('popstate'");
        }
    });

    // --- Integration with full website ---
    it('history management should be present in generated website', () => {
        const graph = createTestModuleGraph();
        const wikiDir = setupWikiDir(graph);
        generateWebsite(wikiDir);

        const html = fs.readFileSync(path.join(wikiDir, 'index.html'), 'utf-8');
        expect(html).toContain('history.pushState');
        expect(html).toContain('history.replaceState');
        expect(html).toContain("window.addEventListener('popstate'");
    });

    it('history should work with search disabled', () => {
        const html = generateHtmlTemplate({ theme: 'auto', title: 'Test', enableSearch: false });
        expect(html).toContain('history.pushState');
        expect(html).toContain('history.replaceState');
        expect(html).toContain("window.addEventListener('popstate'");
        expect(html).toContain('findModuleIdBySlugClient');
    });
});
