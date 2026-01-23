import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

/**
 * Test the Copilot SDK with a user-provided prompt
 * Opens a new document with the response
 */
export async function testCopilotSDK(): Promise<void> {
    const prompt = await vscode.window.showInputBox({
        prompt: 'Enter your prompt for Copilot SDK',
        placeHolder: 'e.g., What is the capital of France?',
        ignoreFocusOut: true
    });

    if (!prompt) {
        return;
    }

    const outputChannel = vscode.window.createOutputChannel('Copilot SDK Test');
    outputChannel.show();
    outputChannel.appendLine('='.repeat(80));
    outputChannel.appendLine(`Prompt: ${prompt}`);
    outputChannel.appendLine('='.repeat(80));
    outputChannel.appendLine('');
    outputChannel.appendLine('Loading Copilot SDK...');
    outputChannel.appendLine(`__dirname: ${__dirname}`);

    let client: any;
    let session: any;

    try {
        // Find the SDK package root
        const possiblePaths = [
            // Development: running from dist/
            path.join(__dirname, '..', 'node_modules', '@github', 'copilot-sdk'),
            // Development: running from out/shortcuts/debug-panel
            path.join(__dirname, '..', '..', '..', 'node_modules', '@github', 'copilot-sdk'),
            // Packaged extension
            path.join(__dirname, 'node_modules', '@github', 'copilot-sdk'),
        ];

        let sdkRoot: string | undefined;
        for (const testPath of possiblePaths) {
            const indexPath = path.join(testPath, 'dist', 'index.js');
            outputChannel.appendLine(`Checking: ${indexPath}`);
            if (fs.existsSync(indexPath)) {
                sdkRoot = testPath;
                outputChannel.appendLine(`✓ Found SDK at: ${sdkRoot}`);
                break;
            }
        }

        if (!sdkRoot) {
            throw new Error('Could not locate @github/copilot-sdk module. Tried:\n' + possiblePaths.join('\n'));
        }

        // Directly import from the dist/index.js we already found
        const sdkIndexPath = path.join(sdkRoot, 'dist', 'index.js');
        outputChannel.appendLine(`SDK entry point: ${sdkIndexPath}`);

        // Import using file URL for ESM compatibility
        // Use Function constructor to bypass webpack's import() transformation
        const { pathToFileURL } = await import('url');
        const sdkUrl = pathToFileURL(sdkIndexPath).href;
        outputChannel.appendLine(`Importing from URL: ${sdkUrl}`);

        // Bypass webpack's import transformation using Function constructor
        // This is necessary because webpack transforms import() in ways that break ESM loading
        const dynamicImport = new Function('specifier', 'return import(specifier)');
        const sdk = await dynamicImport(sdkUrl);
        const CopilotClient = sdk.CopilotClient;
        
        outputChannel.appendLine('✓ SDK loaded');
        outputChannel.appendLine('Initializing Copilot client...');

        // Initialize the Copilot client
        client = new CopilotClient();
        outputChannel.appendLine('✓ Client initialized');

        // Create a session
        outputChannel.appendLine('Creating session...');
        session = await client.createSession();
        outputChannel.appendLine(`✓ Session created: ${session.sessionId}`);

        outputChannel.appendLine('Sending message to Copilot CLI...');
        outputChannel.appendLine('');

        // Send the message and wait for response
        const result = await session.sendAndWait({ prompt });
        const response = result?.data?.content || 'No response received';
        
        outputChannel.appendLine('='.repeat(80));
        outputChannel.appendLine('Response:');
        outputChannel.appendLine('='.repeat(80));
        outputChannel.appendLine(response);
        outputChannel.appendLine('');
        outputChannel.appendLine('='.repeat(80));
        outputChannel.appendLine('✓ Request completed successfully');

        // Also show in a new document for better readability
        const doc = await vscode.workspace.openTextDocument({
            content: `# Copilot SDK Test Result\n\n## Prompt\n${prompt}\n\n## Response\n${response}`,
            language: 'markdown'
        });
        await vscode.window.showTextDocument(doc, { preview: false });

        vscode.window.showInformationMessage('Copilot SDK test completed successfully!');

    } catch (error: any) {
        outputChannel.appendLine('');
        outputChannel.appendLine('='.repeat(80));
        outputChannel.appendLine('✗ ERROR');
        outputChannel.appendLine('='.repeat(80));
        
        const errorMessage = error?.message || String(error);
        outputChannel.appendLine(errorMessage);
        
        if (errorMessage.includes('copilot') && errorMessage.includes('not found')) {
            outputChannel.appendLine('');
            outputChannel.appendLine('It looks like the Copilot CLI is not installed or not in PATH.');
            outputChannel.appendLine('Please install it from: https://docs.github.com/en/copilot/using-github-copilot/using-github-copilot-in-the-command-line');
        }

        outputChannel.appendLine('');
        outputChannel.appendLine('Full error details:');
        outputChannel.appendLine(JSON.stringify(error, null, 2));

        vscode.window.showErrorMessage(
            `Copilot SDK test failed: ${errorMessage}`,
            'Show Details'
        ).then(selection => {
            if (selection === 'Show Details') {
                outputChannel.show();
            }
        });
    } finally {
        // Clean up session and client
        if (session) {
            try {
                await session.destroy();
                outputChannel.appendLine('✓ Session destroyed');
            } catch (destroyError) {
                outputChannel.appendLine(`Warning: Error destroying session: ${destroyError}`);
            }
        }
        if (client) {
            try {
                await client.stop();
                outputChannel.appendLine('✓ Client stopped');
            } catch (stopError) {
                outputChannel.appendLine(`Warning: Error stopping client: ${stopError}`);
            }
        }
    }
}
