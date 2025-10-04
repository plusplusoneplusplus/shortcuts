import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { runTests } from '@vscode/test-electron';

async function main() {
    try {
        // The folder containing the Extension Manifest package.json
        // Passed to `--extensionDevelopmentPath`
        const extensionDevelopmentPath = path.resolve(__dirname, '../../');

        // The path to test runner
        // Passed to --extensionTestsPath
        const extensionTestsPath = path.resolve(__dirname, './suite/index');

        // Prepare an isolated temporary workspace directory to avoid global state leakage
        const tempWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), 'shortcuts-e2e-workspace-'));
        const vscodeDir = path.join(tempWorkspace, '.vscode');
        fs.mkdirSync(vscodeDir, { recursive: true });
        // Pre-create a minimal workspace configuration so the extension never falls back to global config
        const configPath = path.join(vscodeDir, 'shortcuts.yaml');
        if (!fs.existsSync(configPath)) {
            fs.writeFileSync(configPath, 'logicalGroups: []\n', 'utf8');
        }

        // Download VS Code, unzip it and run the integration test with the isolated workspace
        await runTests({
            extensionDevelopmentPath,
            extensionTestsPath,
            launchArgs: [tempWorkspace]
        });
    } catch (err) {
        console.error('Failed to run tests');
        process.exit(1);
    }
}

main();