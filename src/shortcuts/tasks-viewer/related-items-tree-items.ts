/**
 * Tree item representing the "Related Items" section in a feature folder
 */

import * as vscode from 'vscode';
import { RelatedItem, RelatedItemsConfig } from './types';

/**
 * Tree item for the "Related Items (N)" collapsible section
 */
export class RelatedItemsSectionItem extends vscode.TreeItem {
    public readonly contextValue = 'relatedItemsSection';
    public readonly folderPath: string;
    public readonly config: RelatedItemsConfig;

    constructor(folderPath: string, config: RelatedItemsConfig) {
        const itemCount = config.items.length;
        super(`Related Items (${itemCount})`, vscode.TreeItemCollapsibleState.Collapsed);
        
        this.folderPath = folderPath;
        this.config = config;
        this.tooltip = config.description || 'Discovered related items';
        this.iconPath = new vscode.ThemeIcon('references');
    }
}

/**
 * Tree item for a category grouping (Source, Tests, Commits, etc.)
 */
export class RelatedCategoryItem extends vscode.TreeItem {
    public readonly contextValue = 'relatedCategory';
    public readonly category: string;
    public readonly items: RelatedItem[];
    public readonly folderPath: string;

    constructor(category: string, items: RelatedItem[], folderPath: string) {
        const categoryLabels: Record<string, string> = {
            'source': 'Source',
            'test': 'Tests',
            'doc': 'Documentation',
            'config': 'Config',
            'commit': 'Commits'
        };
        
        const categoryIcons: Record<string, string> = {
            'source': 'file-code',
            'test': 'beaker',
            'doc': 'book',
            'config': 'gear',
            'commit': 'git-commit'
        };
        
        const label = categoryLabels[category] || category;
        super(`${label} (${items.length})`, vscode.TreeItemCollapsibleState.Collapsed);
        
        this.category = category;
        this.items = items;
        this.folderPath = folderPath;
        this.iconPath = new vscode.ThemeIcon(categoryIcons[category] || 'folder');
    }
}

/**
 * Tree item for an individual related file
 */
export class RelatedFileItem extends vscode.TreeItem {
    public readonly contextValue = 'relatedFile';
    public readonly relatedItem: RelatedItem;
    public readonly folderPath: string;

    constructor(item: RelatedItem, folderPath: string, workspaceRoot: string) {
        super(item.name, vscode.TreeItemCollapsibleState.None);
        
        this.relatedItem = item;
        this.folderPath = folderPath;
        
        // Set tooltip with reason and relevance
        this.tooltip = `${item.reason}\nRelevance: ${item.relevance}%`;
        
        // Set description (show path)
        if (item.path) {
            this.description = item.path;
        }
        
        // Set icon based on category
        const categoryIcons: Record<string, string> = {
            'source': 'file-code',
            'test': 'beaker',
            'doc': 'file-text',
            'config': 'settings-gear'
        };
        this.iconPath = new vscode.ThemeIcon(categoryIcons[item.category] || 'file');
        
        // Make clickable to open the file
        if (item.path) {
            const filePath = vscode.Uri.file(
                item.path.startsWith('/') ? item.path : `${workspaceRoot}/${item.path}`
            );
            this.command = {
                command: 'vscode.open',
                title: 'Open File',
                arguments: [filePath]
            };
            this.resourceUri = filePath;
        }
    }
}

/**
 * Tree item for an individual related commit
 */
export class RelatedCommitItem extends vscode.TreeItem {
    public readonly contextValue = 'relatedCommit';
    public readonly relatedItem: RelatedItem;
    public readonly folderPath: string;
    public readonly repositoryRoot: string;

    constructor(item: RelatedItem, folderPath: string, repositoryRoot: string) {
        // Show short hash and commit message
        const shortHash = item.hash ? item.hash.substring(0, 7) : '';
        super(`${shortHash} - ${item.name}`, vscode.TreeItemCollapsibleState.None);
        
        this.relatedItem = item;
        this.folderPath = folderPath;
        this.repositoryRoot = repositoryRoot;
        
        // Set tooltip with reason and relevance
        this.tooltip = `${item.reason}\nRelevance: ${item.relevance}%`;
        
        // Set description
        this.description = `${item.relevance}%`;
        
        this.iconPath = new vscode.ThemeIcon('git-commit');
        
        // Make clickable to view commit
        if (item.hash) {
            this.command = {
                command: 'tasksViewer.viewRelatedCommit',
                title: 'View Commit',
                arguments: [item.hash, repositoryRoot]
            };
        }
    }
}
