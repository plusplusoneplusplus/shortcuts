import * as fs from 'fs';
import * as yaml from 'js-yaml';
import * as path from 'path';
import { ShortcutsConfig } from '../../shortcuts/types';

/**
 * Available test fixtures
 */
export enum Fixture {
    SIMPLE_WORKSPACE = 'simple-workspace',
    NESTED_GROUPS = 'nested-groups',
    MULTI_REPO = 'multi-repo',
    EMPTY_WORKSPACE = 'empty-workspace'
}

/**
 * Get the absolute path to a fixture directory
 */
export function getFixturePath(fixture: Fixture): string {
    return path.resolve(__dirname, '..', 'fixtures', fixture);
}

/**
 * Load the shortcuts configuration from a fixture
 */
export function loadFixtureConfig(fixture: Fixture): ShortcutsConfig {
    const fixturePath = getFixturePath(fixture);
    const configPath = path.join(fixturePath, '.vscode', 'shortcuts.yaml');

    if (!fs.existsSync(configPath)) {
        throw new Error(`Fixture config not found: ${configPath}`);
    }

    const configContent = fs.readFileSync(configPath, 'utf8');
    const config = yaml.load(configContent) as ShortcutsConfig;

    return config;
}

/**
 * Copy a fixture to a temporary directory for testing
 */
export function copyFixture(fixture: Fixture, targetDir: string): void {
    const fixturePath = getFixturePath(fixture);

    if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
    }

    copyDirRecursive(fixturePath, targetDir);
}

/**
 * Recursively copy directory contents
 */
function copyDirRecursive(source: string, target: string): void {
    if (!fs.existsSync(target)) {
        fs.mkdirSync(target, { recursive: true });
    }

    const entries = fs.readdirSync(source, { withFileTypes: true });

    for (const entry of entries) {
        const sourcePath = path.join(source, entry.name);
        const targetPath = path.join(target, entry.name);

        if (entry.isDirectory()) {
            copyDirRecursive(sourcePath, targetPath);
        } else {
            fs.copyFileSync(sourcePath, targetPath);
        }
    }
}

/**
 * Get list of files in a fixture
 */
export function getFixtureFiles(fixture: Fixture): string[] {
    const fixturePath = getFixturePath(fixture);
    const files: string[] = [];

    function collectFiles(dir: string, relativePath: string = ''): void {
        const entries = fs.readdirSync(dir, { withFileTypes: true });

        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            const relPath = path.join(relativePath, entry.name);

            if (entry.isDirectory()) {
                collectFiles(fullPath, relPath);
            } else {
                files.push(relPath);
            }
        }
    }

    collectFiles(fixturePath);
    return files;
}

/**
 * Verify a file exists in the workspace
 */
export function fileExistsInWorkspace(workspaceRoot: string, filePath: string): boolean {
    const fullPath = path.isAbsolute(filePath)
        ? filePath
        : path.join(workspaceRoot, filePath);
    return fs.existsSync(fullPath);
}

/**
 * Create a test file in the workspace
 */
export function createTestFile(workspaceRoot: string, filePath: string, content: string = ''): string {
    const fullPath = path.join(workspaceRoot, filePath);
    const dir = path.dirname(fullPath);

    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(fullPath, content, 'utf8');
    return fullPath;
}

/**
 * Create a test folder in the workspace
 */
export function createTestFolder(workspaceRoot: string, folderPath: string): string {
    const fullPath = path.join(workspaceRoot, folderPath);

    if (!fs.existsSync(fullPath)) {
        fs.mkdirSync(fullPath, { recursive: true });
    }

    return fullPath;
}

