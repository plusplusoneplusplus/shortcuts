/**
 * Server Index Tests
 *
 * Tests for the createServer function and WikiServer lifecycle.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as http from 'http';
import { createServer, type WikiServer } from '../../src/server';
import type { ComponentGraph } from '../../src/types';

// ============================================================================
// Test Helpers
// ============================================================================

let tempDir: string;
let server: WikiServer | null = null;

beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deep-wiki-server-test-'));
});

afterEach(async () => {
    if (server) {
        await server.close();
        server = null;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
});

function createTestModuleGraph(): ComponentGraph {
    return {
        project: {
            name: 'TestProject',
            description: 'A test project',
            language: 'TypeScript',
            buildSystem: 'npm',
            entryPoints: ['src/index.ts'],
        },
        components: [
            {
                id: 'auth',
                name: 'Auth Module',
                path: 'src/auth/',
                purpose: 'Handles authentication',
                keyFiles: ['src/auth/index.ts'],
                dependencies: [],
                dependents: [],
                complexity: 'high',
                category: 'core',
            },
        ],
        categories: [
            { name: 'core', description: 'Core functionality' },
        ],
        architectureNotes: 'Simple architecture.',
    };
}

function setupWikiDir(): string {
    const wikiDir = path.join(tempDir, 'wiki');
    const componentsDir = path.join(wikiDir, 'components');
    fs.mkdirSync(componentsDir, { recursive: true });

    fs.writeFileSync(
        path.join(wikiDir, 'component-graph.json'),
        JSON.stringify(createTestModuleGraph(), null, 2),
        'utf-8'
    );
    fs.writeFileSync(path.join(componentsDir, 'auth.md'), '# Auth Module', 'utf-8');

    return wikiDir;
}

// ============================================================================
// Server Creation
// ============================================================================

describe('createServer', () => {
    it('should create and start a server', async () => {
        const wikiDir = setupWikiDir();
        server = await createServer({ wikiDir, port: 0, host: 'localhost' });

        expect(server).toBeDefined();
        expect(server.port).toBeGreaterThan(0);
        expect(server.host).toBe('localhost');
        expect(server.url).toContain('http://localhost:');
    });

    it('should load wiki data on creation', async () => {
        const wikiDir = setupWikiDir();
        server = await createServer({ wikiDir, port: 0, host: 'localhost' });

        expect(server.wikiData.isLoaded).toBe(true);
        expect(server.wikiData.graph.project.name).toBe('TestProject');
    });

    it('should use custom title when provided', async () => {
        const wikiDir = setupWikiDir();
        server = await createServer({
            wikiDir, port: 0, host: 'localhost',
            title: 'Custom Title',
        });

        const html = await fetchText(`${server.url}/`);
        expect(html).toContain('Custom Title');
    });

    it('should use project name as default title', async () => {
        const wikiDir = setupWikiDir();
        server = await createServer({ wikiDir, port: 0, host: 'localhost' });

        const html = await fetchText(`${server.url}/`);
        expect(html).toContain('TestProject');
    });

    it('should throw when wiki dir has no component-graph.json', async () => {
        const emptyDir = path.join(tempDir, 'empty');
        fs.mkdirSync(emptyDir, { recursive: true });

        await expect(createServer({ wikiDir: emptyDir, port: 0 }))
            .rejects.toThrow('component-graph.json not found');
    });
});

// ============================================================================
// Server Lifecycle
// ============================================================================

describe('WikiServer lifecycle', () => {
    it('should respond to HTTP requests', async () => {
        const wikiDir = setupWikiDir();
        server = await createServer({ wikiDir, port: 0, host: 'localhost' });

        const html = await fetchText(`${server.url}/`);
        expect(html).toContain('<!DOCTYPE html>');
    });

    it('should close cleanly', async () => {
        const wikiDir = setupWikiDir();
        server = await createServer({ wikiDir, port: 0, host: 'localhost' });

        await server.close();

        // After close, requests should fail
        await expect(fetchText(`${server.url}/`))
            .rejects.toThrow();

        server = null; // Prevent afterEach from closing again
    });

    it('should expose the underlying http.Server', async () => {
        const wikiDir = setupWikiDir();
        server = await createServer({ wikiDir, port: 0, host: 'localhost' });

        expect(server.server).toBeInstanceOf(http.Server);
    });
});

// ============================================================================
// Theme Configuration
// ============================================================================

describe('createServer — themes', () => {
    it('should apply auto theme by default', async () => {
        const wikiDir = setupWikiDir();
        server = await createServer({ wikiDir, port: 0, host: 'localhost' });

        const html = await fetchText(`${server.url}/`);
        expect(html).toContain('data-theme="auto"');
    });

    it('should apply dark theme when specified', async () => {
        const wikiDir = setupWikiDir();
        server = await createServer({
            wikiDir, port: 0, host: 'localhost',
            theme: 'dark',
        });

        const html = await fetchText(`${server.url}/`);
        expect(html).toContain('data-theme="dark"');
    });

    it('should apply light theme when specified', async () => {
        const wikiDir = setupWikiDir();
        server = await createServer({
            wikiDir, port: 0, host: 'localhost',
            theme: 'light',
        });

        const html = await fetchText(`${server.url}/`);
        expect(html).toContain('data-theme="light"');
    });
});

// ============================================================================
// AI Configuration
// ============================================================================

describe('createServer — AI configuration', () => {
    it('should disable AI features by default', async () => {
        const wikiDir = setupWikiDir();
        server = await createServer({ wikiDir, port: 0, host: 'localhost' });

        const html = await fetchText(`${server.url}/`);
        expect(html).not.toContain('id="ask-widget"');
    });

    it('should enable AI features when aiEnabled is true', async () => {
        const wikiDir = setupWikiDir();
        server = await createServer({
            wikiDir, port: 0, host: 'localhost',
            aiEnabled: true,
        });

        const html = await fetchText(`${server.url}/`);
        expect(html).toContain('id="ask-widget"');
    });
});

// ============================================================================
// Helpers
// ============================================================================

function fetchText(url: string): Promise<string> {
    return new Promise((resolve, reject) => {
        http.get(url, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => resolve(data));
        }).on('error', reject);
    });
}
