/**
 * Command handlers for Skills installation
 */

import * as path from 'path';
import * as vscode from 'vscode';
import { detectSource, SourceDetectionErrors } from './source-detector';
import { scanForSkills } from './skill-scanner';
import { installSkills } from './skill-installer';
import { getBundledSkills, installBundledSkills } from './bundled-skills-provider';
import { DEFAULT_SKILLS_SETTINGS, DiscoveredSkill, SkillsSettings } from './types';
import { getExtensionLogger, LogCategory, getWorkspaceRoot } from '../shared';

/**
 * Command handlers for the Skills module
 */
export class SkillsCommands {
    private context: vscode.ExtensionContext | undefined;

    constructor() {}

    /**
     * Register all skills commands
     */
    registerCommands(context: vscode.ExtensionContext): vscode.Disposable[] {
        this.context = context;
        const disposables: vscode.Disposable[] = [];

        disposables.push(
            vscode.commands.registerCommand('skills.install', () => this.installSkillsCommand())
        );

        disposables.push(
            vscode.commands.registerCommand('skills.installBuiltIn', () => this.installBuiltInSkillsCommand())
        );

        return disposables;
    }

    /**
     * Get skills settings from configuration
     */
    private getSettings(): SkillsSettings {
        const config = vscode.workspace.getConfiguration('workspaceShortcuts.skills');
        return {
            installPath: config.get<string>('installPath', DEFAULT_SKILLS_SETTINGS.installPath)
        };
    }

    /**
     * Get the absolute install path
     */
    private getInstallPath(): string {
        const settings = this.getSettings();
        const workspaceRoot = getWorkspaceRoot();
        
        if (!workspaceRoot) {
            throw new Error('No workspace folder open');
        }

        if (path.isAbsolute(settings.installPath)) {
            return settings.installPath;
        }

        return path.join(workspaceRoot, settings.installPath);
    }

    /**
     * Main command: Skills: Install...
     * Shows a quick pick to choose between built-in skills and external sources
     */
    private async installSkillsCommand(): Promise<void> {
        const logger = getExtensionLogger();
        const workspaceRoot = getWorkspaceRoot();

        if (!workspaceRoot) {
            vscode.window.showErrorMessage('No workspace folder open. Please open a workspace first.');
            return;
        }

        // Show source selection
        const sourceChoice = await vscode.window.showQuickPick(
            [
                {
                    label: '$(package) Built-in Skills',
                    description: 'Install skills bundled with this extension',
                    id: 'builtin'
                },
                {
                    label: '$(github) GitHub or Local Path',
                    description: 'Install from GitHub repository or local directory',
                    id: 'external'
                }
            ],
            {
                placeHolder: 'Select skill source',
                title: 'Install Skills'
            }
        );

        if (!sourceChoice) {
            return; // User cancelled
        }

        if (sourceChoice.id === 'builtin') {
            await this.installBuiltInSkillsCommand();
        } else {
            await this.installFromExternalSource();
        }
    }

    /**
     * Install skills from external source (GitHub or local path)
     */
    private async installFromExternalSource(): Promise<void> {
        const logger = getExtensionLogger();
        const workspaceRoot = getWorkspaceRoot();

        if (!workspaceRoot) {
            vscode.window.showErrorMessage('No workspace folder open. Please open a workspace first.');
            return;
        }

        try {
            // Step 1: Get source from user
            const sourceInput = await vscode.window.showInputBox({
                prompt: 'Enter GitHub URL or local path',
                placeHolder: 'https://github.com/owner/repo/tree/main/skills or ~/my-skills',
                validateInput: (value) => {
                    if (!value || value.trim().length === 0) {
                        return 'Please enter a GitHub URL or local path';
                    }
                    return null;
                }
            });

            if (!sourceInput) {
                return; // User cancelled
            }

            // Step 2: Detect and parse source
            const detectResult = detectSource(sourceInput, workspaceRoot);
            if (!detectResult.success) {
                vscode.window.showErrorMessage(detectResult.error);
                return;
            }

            const source = detectResult.source;
            const installPath = this.getInstallPath();

            // Step 3: Scan for skills with progress
            let skills: DiscoveredSkill[] = [];
            
            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: 'Scanning for skills...',
                    cancellable: false
                },
                async () => {
                    const scanResult = await scanForSkills(source, installPath);
                    
                    if (!scanResult.success) {
                        throw new Error(scanResult.error);
                    }
                    
                    skills = scanResult.skills;
                }
            );

            if (skills.length === 0) {
                vscode.window.showWarningMessage('No valid skills found at this location.');
                return;
            }

            // Step 4: Show skill selection QuickPick
            const selectedSkills = await this.showSkillSelection(skills);
            
            if (!selectedSkills || selectedSkills.length === 0) {
                return; // User cancelled or selected nothing
            }

            // Step 5: Install selected skills with progress
            const result = await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: 'Installing skills...',
                    cancellable: false
                },
                async (progress) => {
                    return installSkills(
                        selectedSkills,
                        source,
                        installPath,
                        async (skillName) => {
                            // Handle conflict - ask user if they want to replace
                            const choice = await vscode.window.showWarningMessage(
                                `Skill '${skillName}' already exists. Replace?`,
                                { modal: true },
                                'Replace',
                                'Skip'
                            );
                            return choice === 'Replace';
                        }
                    );
                }
            );

            // Step 6: Show result
            this.showInstallResult(result.installed, result.skipped, result.failed);

            logger.info(LogCategory.EXTENSION, 'Skills installation completed', {
                installed: result.installed,
                skipped: result.skipped,
                failed: result.failed
            });

        } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            logger.error(LogCategory.EXTENSION, 'Skills installation failed', err);
            vscode.window.showErrorMessage(`Failed to install skills: ${err.message}`);
        }
    }

    /**
     * Command: Install built-in skills bundled with the extension
     */
    private async installBuiltInSkillsCommand(): Promise<void> {
        const logger = getExtensionLogger();
        const workspaceRoot = getWorkspaceRoot();

        if (!workspaceRoot) {
            vscode.window.showErrorMessage('No workspace folder open. Please open a workspace first.');
            return;
        }

        if (!this.context) {
            vscode.window.showErrorMessage('Extension context not available.');
            return;
        }

        try {
            const installPath = this.getInstallPath();

            // Get available bundled skills
            const skills = getBundledSkills(this.context, installPath);

            if (skills.length === 0) {
                vscode.window.showWarningMessage('No built-in skills available.');
                return;
            }

            // Show skill selection QuickPick
            const selectedSkills = await this.showSkillSelection(skills, 'Select built-in skills to install');
            
            if (!selectedSkills || selectedSkills.length === 0) {
                return; // User cancelled or selected nothing
            }

            // Install selected skills with progress
            const result = await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: 'Installing built-in skills...',
                    cancellable: false
                },
                async () => {
                    return installBundledSkills(
                        selectedSkills,
                        installPath,
                        async (skillName) => {
                            // Handle conflict - ask user if they want to replace
                            const choice = await vscode.window.showWarningMessage(
                                `Skill '${skillName}' already exists. Replace?`,
                                { modal: true },
                                'Replace',
                                'Skip'
                            );
                            return choice === 'Replace';
                        }
                    );
                }
            );

            // Show result
            this.showInstallResult(result.installed, result.skipped, result.failed);

            logger.info(LogCategory.EXTENSION, 'Built-in skills installation completed', {
                installed: result.installed,
                skipped: result.skipped,
                failed: result.failed
            });

        } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            logger.error(LogCategory.EXTENSION, 'Built-in skills installation failed', err);
            vscode.window.showErrorMessage(`Failed to install built-in skills: ${err.message}`);
        }
    }

    /**
     * Show QuickPick for skill selection
     */
    private async showSkillSelection(
        skills: DiscoveredSkill[],
        title: string = 'Select skills to install'
    ): Promise<DiscoveredSkill[] | undefined> {
        const items: vscode.QuickPickItem[] = skills.map(skill => ({
            label: skill.name,
            description: skill.description || '',
            detail: skill.alreadyExists ? '$(warning) Already exists - will be replaced' : undefined,
            picked: true // Pre-select all skills
        }));

        const selected = await vscode.window.showQuickPick(items, {
            canPickMany: true,
            placeHolder: `Found ${skills.length} skill${skills.length > 1 ? 's' : ''}`,
            title
        });

        if (!selected) {
            return undefined;
        }

        // Map selected items back to skills
        const selectedNames = new Set(selected.map(item => item.label));
        return skills.filter(skill => selectedNames.has(skill.name));
    }

    /**
     * Show installation result message
     */
    private showInstallResult(installed: number, skipped: number, failed: number): void {
        const total = installed + skipped + failed;
        
        if (failed === 0 && skipped === 0) {
            vscode.window.showInformationMessage(`Installed ${installed} skill${installed !== 1 ? 's' : ''}`);
        } else if (failed === 0) {
            vscode.window.showInformationMessage(
                `Installed ${installed} skill${installed !== 1 ? 's' : ''}, skipped ${skipped}`
            );
        } else {
            vscode.window.showWarningMessage(
                `Installed ${installed}, skipped ${skipped}, failed ${failed} of ${total} skills`
            );
        }
    }
}
