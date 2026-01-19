import * as vscode from 'vscode';
import { ConfigurationManager } from '../configuration-manager';
import { GlobalNoteItem } from '../tree-items';
import { BaseTreeDataProvider } from '../shared/base-tree-data-provider';

/**
 * Tree data provider for the Global Notes view
 * Displays global notes that are not tied to any specific group
 */
export class GlobalNotesTreeDataProvider extends BaseTreeDataProvider<vscode.TreeItem> {
    private configurationManager: ConfigurationManager;

    constructor(configurationManager: ConfigurationManager) {
        super();
        this.configurationManager = configurationManager;
    }

    /**
     * Get the tree item representation of an element
     */
    getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
        return element;
    }

    /**
     * Implementation of getChildren logic
     */
    protected async getChildrenImpl(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
        if (!element) {
            // Return root level global notes
            return await this.getGlobalNotes();
        } else {
            // Global notes have no children
            return [];
        }
    }

    /**
     * Get the configuration manager instance
     */
    getConfigurationManager(): ConfigurationManager {
        return this.configurationManager;
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

