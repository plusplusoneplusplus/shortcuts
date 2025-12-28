/**
 * Tests for Search Providers
 */

import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    getFileCategory,
    shouldIncludeFile,
    FILE_CATEGORY_MAP,
    CONFIG_FILE_NAMES
} from '../../shortcuts/discovery/search-providers/types';
import { DEFAULT_DISCOVERY_SCOPE } from '../../shortcuts/discovery/types';

suite('Search Providers Tests', () => {
    suite('File Category Detection', () => {
        test('should categorize TypeScript files as source', () => {
            assert.strictEqual(getFileCategory('component.ts'), 'source');
            assert.strictEqual(getFileCategory('component.tsx'), 'source');
        });

        test('should categorize JavaScript files as source', () => {
            assert.strictEqual(getFileCategory('app.js'), 'source');
            assert.strictEqual(getFileCategory('app.jsx'), 'source');
            assert.strictEqual(getFileCategory('app.mjs'), 'source');
            assert.strictEqual(getFileCategory('app.cjs'), 'source');
        });

        test('should categorize Python files as source', () => {
            assert.strictEqual(getFileCategory('script.py'), 'source');
            assert.strictEqual(getFileCategory('script.pyw'), 'source');
        });

        test('should categorize other language files as source', () => {
            assert.strictEqual(getFileCategory('Main.java'), 'source');
            assert.strictEqual(getFileCategory('main.go'), 'source');
            assert.strictEqual(getFileCategory('lib.rs'), 'source');
            assert.strictEqual(getFileCategory('app.rb'), 'source');
            assert.strictEqual(getFileCategory('index.php'), 'source');
            assert.strictEqual(getFileCategory('Program.cs'), 'source');
        });

        test('should categorize markdown files as doc', () => {
            assert.strictEqual(getFileCategory('README.md'), 'doc');
            assert.strictEqual(getFileCategory('CHANGELOG.md'), 'doc');
            assert.strictEqual(getFileCategory('docs.mdx'), 'doc');
        });

        test('should categorize text files as doc', () => {
            assert.strictEqual(getFileCategory('notes.txt'), 'doc');
            assert.strictEqual(getFileCategory('guide.rst'), 'doc');
        });

        test('should categorize JSON files as config', () => {
            assert.strictEqual(getFileCategory('data.json'), 'config');
        });

        test('should categorize YAML files as config', () => {
            assert.strictEqual(getFileCategory('config.yaml'), 'config');
            assert.strictEqual(getFileCategory('config.yml'), 'config');
        });

        test('should categorize known config files correctly', () => {
            assert.strictEqual(getFileCategory('package.json'), 'config');
            assert.strictEqual(getFileCategory('tsconfig.json'), 'config');
            assert.strictEqual(getFileCategory('webpack.config.js'), 'config');
            assert.strictEqual(getFileCategory('Dockerfile'), 'config');
            assert.strictEqual(getFileCategory('.eslintrc'), 'config');
            assert.strictEqual(getFileCategory('.gitignore'), 'config');
        });

        test('should return other for unknown extensions', () => {
            assert.strictEqual(getFileCategory('image.png'), 'other');
            assert.strictEqual(getFileCategory('video.mp4'), 'other');
            assert.strictEqual(getFileCategory('archive.zip'), 'other');
        });

        test('should handle files without extensions', () => {
            // Known config files without extensions
            assert.strictEqual(getFileCategory('Makefile'), 'config');
            assert.strictEqual(getFileCategory('Dockerfile'), 'config');
        });
    });

    suite('shouldIncludeFile', () => {
        test('should include source files when scope allows', () => {
            const scope = { ...DEFAULT_DISCOVERY_SCOPE, includeSourceFiles: true };
            
            assert.strictEqual(shouldIncludeFile('app.ts', scope), true);
            assert.strictEqual(shouldIncludeFile('main.py', scope), true);
        });

        test('should exclude source files when scope disallows', () => {
            const scope = { ...DEFAULT_DISCOVERY_SCOPE, includeSourceFiles: false };
            
            assert.strictEqual(shouldIncludeFile('app.ts', scope), false);
            assert.strictEqual(shouldIncludeFile('main.py', scope), false);
        });

        test('should include docs when scope allows', () => {
            const scope = { ...DEFAULT_DISCOVERY_SCOPE, includeDocs: true };
            
            assert.strictEqual(shouldIncludeFile('README.md', scope), true);
            assert.strictEqual(shouldIncludeFile('guide.txt', scope), true);
        });

        test('should exclude docs when scope disallows', () => {
            const scope = { ...DEFAULT_DISCOVERY_SCOPE, includeDocs: false };
            
            assert.strictEqual(shouldIncludeFile('README.md', scope), false);
        });

        test('should include config files when scope allows', () => {
            const scope = { ...DEFAULT_DISCOVERY_SCOPE, includeConfigFiles: true };
            
            assert.strictEqual(shouldIncludeFile('package.json', scope), true);
            assert.strictEqual(shouldIncludeFile('tsconfig.json', scope), true);
        });

        test('should exclude config files when scope disallows', () => {
            const scope = { ...DEFAULT_DISCOVERY_SCOPE, includeConfigFiles: false };
            
            assert.strictEqual(shouldIncludeFile('package.json', scope), false);
        });

        test('should always exclude other file types', () => {
            const scope = {
                ...DEFAULT_DISCOVERY_SCOPE,
                includeSourceFiles: true,
                includeDocs: true,
                includeConfigFiles: true
            };
            
            assert.strictEqual(shouldIncludeFile('image.png', scope), false);
            assert.strictEqual(shouldIncludeFile('video.mp4', scope), false);
        });
    });

    suite('FILE_CATEGORY_MAP', () => {
        test('should have entries for common source file extensions', () => {
            const sourceExtensions = ['.ts', '.tsx', '.js', '.jsx', '.py', '.java', '.go', '.rs'];
            
            for (const ext of sourceExtensions) {
                assert.strictEqual(FILE_CATEGORY_MAP[ext], 'source', `Expected ${ext} to be source`);
            }
        });

        test('should have entries for common doc extensions', () => {
            const docExtensions = ['.md', '.mdx', '.txt', '.rst'];
            
            for (const ext of docExtensions) {
                assert.strictEqual(FILE_CATEGORY_MAP[ext], 'doc', `Expected ${ext} to be doc`);
            }
        });

        test('should have entries for common config extensions', () => {
            const configExtensions = ['.json', '.yaml', '.yml', '.toml', '.ini'];
            
            for (const ext of configExtensions) {
                assert.strictEqual(FILE_CATEGORY_MAP[ext], 'config', `Expected ${ext} to be config`);
            }
        });
    });

    suite('CONFIG_FILE_NAMES', () => {
        test('should include common JavaScript/TypeScript config files', () => {
            assert.ok(CONFIG_FILE_NAMES.has('package.json'));
            assert.ok(CONFIG_FILE_NAMES.has('tsconfig.json'));
            assert.ok(CONFIG_FILE_NAMES.has('webpack.config.js'));
            assert.ok(CONFIG_FILE_NAMES.has('vite.config.ts'));
        });

        test('should include linter config files', () => {
            assert.ok(CONFIG_FILE_NAMES.has('.eslintrc'));
            assert.ok(CONFIG_FILE_NAMES.has('.eslintrc.js'));
            assert.ok(CONFIG_FILE_NAMES.has('.prettierrc'));
        });

        test('should include Docker files', () => {
            assert.ok(CONFIG_FILE_NAMES.has('Dockerfile'));
            assert.ok(CONFIG_FILE_NAMES.has('docker-compose.yml'));
            assert.ok(CONFIG_FILE_NAMES.has('docker-compose.yaml'));
        });

        test('should include build tool configs', () => {
            assert.ok(CONFIG_FILE_NAMES.has('Makefile'));
            assert.ok(CONFIG_FILE_NAMES.has('Cargo.toml'));
            assert.ok(CONFIG_FILE_NAMES.has('go.mod'));
            assert.ok(CONFIG_FILE_NAMES.has('requirements.txt'));
        });

        test('should include git-related files', () => {
            assert.ok(CONFIG_FILE_NAMES.has('.gitignore'));
            assert.ok(CONFIG_FILE_NAMES.has('.gitattributes'));
        });
    });
});

suite('Git Search Provider Tests', () => {
    let tempDir: string;

    setup(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'discovery-git-test-'));
    });

    teardown(() => {
        if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    // Note: Full git search tests require a real git repository
    // These tests verify the module imports and basic structure

    test('should import GitSearchProvider without errors', () => {
        const { GitSearchProvider } = require('../../shortcuts/discovery/search-providers/git-search-provider');
        assert.ok(GitSearchProvider);
    });

    test('should create GitSearchProvider instance', () => {
        const { GitSearchProvider } = require('../../shortcuts/discovery/search-providers/git-search-provider');
        const provider = new GitSearchProvider();
        assert.ok(provider);
        assert.ok(typeof provider.search === 'function');
    });

    test('should detect non-git directory correctly', () => {
        const { GitSearchProvider } = require('../../shortcuts/discovery/search-providers/git-search-provider');
        
        // tempDir is not a git repository
        const isGitRepo = GitSearchProvider.isGitRepository(tempDir);
        assert.strictEqual(isGitRepo, false);
    });
});

suite('File Search Provider Tests', () => {
    let tempDir: string;

    setup(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'discovery-file-test-'));
        
        // Create test files
        fs.writeFileSync(path.join(tempDir, 'auth.ts'), 'export function authenticate() {}');
        fs.writeFileSync(path.join(tempDir, 'user.ts'), 'export class User {}');
        fs.writeFileSync(path.join(tempDir, 'README.md'), '# Authentication Guide');
        fs.mkdirSync(path.join(tempDir, 'src'));
        fs.writeFileSync(path.join(tempDir, 'src', 'service.ts'), 'export class AuthService {}');
    });

    teardown(() => {
        if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    test('should import FileSearchProvider without errors', () => {
        const { FileSearchProvider } = require('../../shortcuts/discovery/search-providers/file-search-provider');
        assert.ok(FileSearchProvider);
    });

    test('should create FileSearchProvider instance', () => {
        const { FileSearchProvider } = require('../../shortcuts/discovery/search-providers/file-search-provider');
        const provider = new FileSearchProvider();
        assert.ok(provider);
        assert.ok(typeof provider.search === 'function');
    });

    // Note: Full file search tests require VS Code workspace API
    // which is not available in unit tests
});

