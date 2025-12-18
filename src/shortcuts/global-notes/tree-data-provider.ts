import * as vscode from 'vscode';
import { ConfigurationManager } from '../configuration-manager';
import { NotificationManager } from '../notification-manager';
import { GlobalNoteItem } from '../tree-items';

/**
 * Tree data provider for the Global Notes view
 * Displays global notes that are not tied to any specific group
 */
export class GlobalNotesTreeDataProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<vscode.TreeItem | undefined | null | void> = new vscode.EventEmitter<vscode.TreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<vscode.TreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

    private configurationManager: ConfigurationManager;

    constructor(configurationManager: ConfigurationManager) {
        this.configurationManager = configurationManager;
    }

    /**
     * Get the tree item representation of an element
     */
    getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
        return element;
    }

    /**
     * Get the children of an element or root elements if no element is provided
     */
    async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
        try {
            if (!element) {
                // Return root level global notes
                return await this.getGlobalNotes();
            } else {
                // Global notes have no children
                return [];
            }
        } catch (error) {
            const err = error instanceof Error ? error : new Error('Unknown error');
            console.error('Error getting global notes:', err);
            NotificationManager.showError(`Error loading global notes: ${err.message}`);
            return [];
        }
    }

    /**
     * Refresh the tree view
     */
    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    /**
     * Get the configuration manager instance
     */
    getConfigurationManager(): ConfigurationManager {
        return this.configurationManager;
    }

    /**
     * Dispose of resources
     */
    dispose(): void {
        this._onDidChangeTreeData.dispose();
    }

    /**
     * Get global notes from configuration
     */
    private async getGlobalNotes(): Promise<vscode.TreeItem[]> {
        const config = await this.configurationManager.loadConfiguration();
        const items: vscode.TreeItem[] = [];

        if (!config.globalNotes || config.globalNotes.length === 0) {
            return items;
        }

        // Sort notes alphabetically
        const sortedNotes = [...config.globalNotes].sort((a, b) => a.name.localeCompare(b.name));

        for (const note of sortedNotes) {
            const noteItem = new GlobalNoteItem(note.name, note.noteId, note.icon);
            items.push(noteItem);
        }

        return items;
    }
}

