import * as vscode from 'vscode';
import { getCopilotSDKService } from '@plusplusoneplusplus/pipeline-core';
import { IAIProcessManager } from '../ai-service';
import { getExtensionLogger, LogCategory } from '../shared/extension-logger';
import { DEFAULT_AI_TIMEOUT_MS } from '../shared/ai-timeouts';

/**
 * Test the Copilot SDK with a user-provided prompt.
 * 
 * This function uses the CopilotSDKService for SDK interaction and registers
 * the process with AIProcessManager so it appears in the AI Processes panel.
 * 
 * @param aiProcessManager The AI process manager for tracking the request
 */
export async function testCopilotSDK(aiProcessManager?: IAIProcessManager): Promise<void> {
    const logger = getExtensionLogger();
    
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

    // Get the workspace root for working directory context
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

    // Register the process with AIProcessManager if available
    let processId: string | undefined;
    if (aiProcessManager) {
        processId = aiProcessManager.registerTypedProcess(
            prompt,
            {
                type: 'sdk-test',
                idPrefix: 'sdk-test',
                metadata: {
                    type: 'sdk-test',
                    source: 'debug-panel',
                    workingDirectory: workspaceRoot
                }
            }
        );
        logger.debug(LogCategory.AI, `Registered SDK test process: ${processId}`);
        outputChannel.appendLine(`Process registered: ${processId}`);
    }

    try {
        // Get the CopilotSDKService singleton
        const sdkService = getCopilotSDKService();
        
        outputChannel.appendLine('Checking SDK availability...');
        const availability = await sdkService.isAvailable();
        
        if (!availability.available) {
            throw new Error(availability.error || 'Copilot SDK is not available');
        }
        
        outputChannel.appendLine(`✓ SDK available at: ${availability.sdkPath}`);
        outputChannel.appendLine('');
        outputChannel.appendLine('Sending message to Copilot...');
        outputChannel.appendLine('');

        // Send the message using the SDK service
        const result = await sdkService.sendMessage({
            prompt,
            workingDirectory: workspaceRoot,
            timeoutMs: DEFAULT_AI_TIMEOUT_MS
        });

        if (!result.success) {
            throw new Error(result.error || 'Unknown error occurred');
        }

        const response = result.response || 'No response received';
        
        outputChannel.appendLine('='.repeat(80));
        outputChannel.appendLine('Response:');
        outputChannel.appendLine('='.repeat(80));
        outputChannel.appendLine(response);
        outputChannel.appendLine('');
        outputChannel.appendLine('='.repeat(80));
        outputChannel.appendLine('✓ Request completed successfully');

        if (result.sessionId) {
            outputChannel.appendLine(`Session ID: ${result.sessionId}`);
            
            // Attach session metadata for potential resume functionality
            if (aiProcessManager && processId) {
                aiProcessManager.attachSdkSessionId(processId, result.sessionId);
                aiProcessManager.attachSessionMetadata(processId, 'copilot-sdk', workspaceRoot);
            }
        }

        // Also show in a new document for better readability
        const doc = await vscode.workspace.openTextDocument({
            content: `# Copilot SDK Test Result\n\n## Prompt\n${prompt}\n\n## Response\n${response}`,
            language: 'markdown'
        });
        await vscode.window.showTextDocument(doc, { preview: false });

        // Complete the process successfully
        if (aiProcessManager && processId) {
            aiProcessManager.completeProcess(processId, response);
            logger.debug(LogCategory.AI, `Completed SDK test process: ${processId}`);
        }

        vscode.window.showInformationMessage('Copilot SDK test completed successfully!');

    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        
        outputChannel.appendLine('');
        outputChannel.appendLine('='.repeat(80));
        outputChannel.appendLine('✗ ERROR');
        outputChannel.appendLine('='.repeat(80));
        outputChannel.appendLine(errorMessage);
        
        if (errorMessage.includes('copilot') && errorMessage.includes('not found')) {
            outputChannel.appendLine('');
            outputChannel.appendLine('It looks like the Copilot CLI is not installed or not in PATH.');
            outputChannel.appendLine('Please install it from: https://docs.github.com/en/copilot/using-github-copilot/using-github-copilot-in-the-command-line');
        }

        outputChannel.appendLine('');
        outputChannel.appendLine('Full error details:');
        try {
            outputChannel.appendLine(JSON.stringify(error, null, 2));
        } catch {
            outputChannel.appendLine(String(error));
        }

        // Fail the process
        if (aiProcessManager && processId) {
            aiProcessManager.failProcess(processId, errorMessage);
            logger.debug(LogCategory.AI, `Failed SDK test process: ${processId} - ${errorMessage}`);
        }

        vscode.window.showErrorMessage(
            `Copilot SDK test failed: ${errorMessage}`,
            'Show Details'
        ).then(selection => {
            if (selection === 'Show Details') {
                outputChannel.show();
            }
        });
    }
}
