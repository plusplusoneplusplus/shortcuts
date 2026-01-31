import * as vscode from 'vscode';
import { LogCategory } from '../shared';
import { BaseTreeDataProvider } from '../shared/base-tree-data-provider';
import { TaskManager } from './task-manager';
import { TaskItem } from './task-item';
import { TaskGroupItem } from './task-group-item';
import { TaskDocumentGroupItem } from './task-document-group-item';
import { TaskDocumentItem } from './task-document-item';
import { TaskFolderItem } from './task-folder-item';
import { RelatedItemsSectionItem, RelatedCategoryItem, RelatedFileItem, RelatedCommitItem } from './related-items-tree-items';
import { ReviewStatusManager } from './review-status-manager';
import { Task, TaskDocument, TaskDocumentGroup, TaskFolder, RelatedItem, ReviewStatus } from './types';

/**
 * Tree data provider for the Tasks Viewer
 * Displays task markdown files from the configured tasks folder with hierarchical folder support
 * Groups tasks into Active/Archived sections when Show Archived is enabled
 */
export class TasksTreeDataProvider extends BaseTreeDataProvider<vscode.TreeItem> {
    private cachedTasks: Task[] = [];
    private tasksByGroup: Map<'active' | 'archived', Task[]> = new Map();
    private cachedDocumentGroups: TaskDocumentGroup[] = [];
    private cachedSingleDocuments: TaskDocument[] = [];
    private documentsByArchiveStatus: Map<'active' | 'archived', { groups: TaskDocumentGroup[]; singles: TaskDocument[] }> = new Map();
    private cachedFolderHierarchy?: TaskFolder;
    private reviewStatusManager?: ReviewStatusManager;
    private reviewStatusChangeDisposable?: vscode.Disposable;

    constructor(private taskManager: TaskManager) {
        super();
    }

    /**
     * Set the review status manager for status tracking
     */
    setReviewStatusManager(manager: ReviewStatusManager): void {
        // Dispose previous listener if any
        this.reviewStatusChangeDisposable?.dispose();
        
        this.reviewStatusManager = manager;
        
        // Listen for status changes and refresh the tree
        this.reviewStatusChangeDisposable = manager.onDidChangeStatus(() => {
            this.refresh();
        });
    }

    /**
     * Get the review status manager
     */
    getReviewStatusManager(): ReviewStatusManager | undefined {
        return this.reviewStatusManager;
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
            // Return root level - either groups or flat list
            return await this.getRootItems();
        } else if (element instanceof TaskGroupItem) {
            // Return tasks for this group (active/archived)
            return this.getGroupTasks(element.groupType);
        } else if (element instanceof TaskDocumentGroupItem) {
            // Return documents within this document group
            return this.getDocumentGroupChildren(element);
        } else if (element instanceof TaskFolderItem) {
            // Return children of this folder (subfolders and tasks)
            return this.getFolderChildren(element.folder);
        } else if (element instanceof RelatedItemsSectionItem) {
            // Return related items (either grouped by category or flat)
            return this.getRelatedItemsChildren(element);
        } else if (element instanceof RelatedCategoryItem) {
            // Return items within a category
            return this.getRelatedCategoryChildren(element);
        } else {
            // Tasks, documents, and individual related items have no children
            return [];
        }
    }

    /**
     * Get the parent of an element
     */
    getParent(element: vscode.TreeItem): vscode.ProviderResult<vscode.TreeItem> {
        // TaskGroupItems have no parent (they are root items)
        if (element instanceof TaskGroupItem) {
            return undefined;
        }
        // TaskItems might have a TaskGroupItem parent when showArchived is enabled
        // But since we don't store the parent reference, return undefined
        return undefined;
    }

    /**
     * Get the task manager instance
     */
    getTaskManager(): TaskManager {
        return this.taskManager;
    }

    /**
     * Override to use TASKS log category
     */
    protected getLogCategory(): LogCategory {
        return LogCategory.TASKS;
    }

    /**
     * Get root items - either groups or flat list based on settings
     */
    private async getRootItems(): Promise<vscode.TreeItem[]> {
        const settings = this.taskManager.getSettings();

        // Use document grouping when enabled
        if (settings.groupRelatedDocuments) {
            return this.getRootItemsWithDocumentGroups();
        }

        // Legacy behavior - flat list of tasks
        const tasks = await this.taskManager.getTasks();

        // Cache tasks for group children
        this.cachedTasks = tasks;

        // When showArchived is enabled, use grouped view
        if (settings.showArchived) {
            return this.getGroupedRootItems(tasks);
        }

        // Otherwise, return flat list (only active tasks)
        return this.getFlatTaskItems(tasks);
    }

    /**
     * Get root items with document grouping enabled
     */
    private async getRootItemsWithDocumentGroups(): Promise<vscode.TreeItem[]> {
        const settings = this.taskManager.getSettings();
        
        // Build folder hierarchy
        const rootFolder = await this.taskManager.getTaskFolderHierarchy();

        this.cachedFolderHierarchy = rootFolder;
        
        // When showArchived is enabled, use active/archived grouping at root
        if (settings.showArchived) {
            // Split hierarchy into active and archived
            const { activeFolder, archivedFolder } = this.splitFolderByArchiveStatus(rootFolder);
            
            const activeCount = this.countFolderItems(activeFolder);
            const archivedCount = this.countFolderItems(archivedFolder);
            
            return [
                new TaskGroupItem('active', activeCount),
                new TaskGroupItem('archived', archivedCount)
            ];
        }

        // Flat hierarchical view (show all folders/items at root)
        return this.getFolderChildren(rootFolder);
    }

    /**
     * Split a folder hierarchy into active and archived portions
     */
    private splitFolderByArchiveStatus(folder: TaskFolder): { activeFolder: TaskFolder; archivedFolder: TaskFolder } {
        const activeFolder: TaskFolder = {
            ...folder,
            children: [],
            documentGroups: folder.documentGroups.filter(g => !g.isArchived),
            singleDocuments: folder.singleDocuments.filter(d => !d.isArchived),
            tasks: folder.tasks.filter(t => !t.isArchived)
        };

        const archivedFolder: TaskFolder = {
            ...folder,
            children: [],
            documentGroups: folder.documentGroups.filter(g => g.isArchived),
            singleDocuments: folder.singleDocuments.filter(d => d.isArchived),
            tasks: folder.tasks.filter(t => t.isArchived)
        };

        // Recursively split child folders - include all non-archived folders (including empty ones)
        for (const child of folder.children) {
            const { activeFolder: activeChild, archivedFolder: archivedChild } = this.splitFolderByArchiveStatus(child);
            
            // Always include non-archived folders to show empty folders
            if (!child.isArchived) {
                activeFolder.children.push(activeChild);
            }
            // Only include archived folders if they have content
            if (child.isArchived && (this.countFolderItems(archivedChild) > 0 || archivedChild.children.length > 0)) {
                archivedFolder.children.push(archivedChild);
            }
        }

        return { activeFolder, archivedFolder };
    }

    /**
     * Count total items in a folder (recursively)
     */
    private countFolderItems(folder: TaskFolder): number {
        let count = folder.documentGroups.length + folder.singleDocuments.length + folder.tasks.length;
        for (const child of folder.children) {
            count += this.countFolderItems(child);
        }
        return count;
    }

    /**
     * Get grouped root items for document view (Active/Archived headers)
     */
    private getGroupedDocumentRootItems(
        groups: TaskDocumentGroup[],
        singles: TaskDocument[]
    ): vscode.TreeItem[] {
        const activeGroups = groups.filter(g => !g.isArchived);
        const activeSingles = singles.filter(s => !s.isArchived);
        const archivedGroups = groups.filter(g => g.isArchived);
        const archivedSingles = singles.filter(s => s.isArchived);

        // Cache by archive status for getChildren
        this.documentsByArchiveStatus.set('active', { 
            groups: this.sortDocumentGroups(activeGroups), 
            singles: this.sortDocuments(activeSingles) 
        });
        this.documentsByArchiveStatus.set('archived', { 
            groups: this.sortDocumentGroups(archivedGroups), 
            singles: this.sortDocuments(archivedSingles) 
        });

        const activeCount = activeGroups.length + activeSingles.length;
        const archivedCount = archivedGroups.length + archivedSingles.length;

        return [
            new TaskGroupItem('active', activeCount),
            new TaskGroupItem('archived', archivedCount)
        ];
    }

    /**
     * Get flat document items (groups + singles sorted together)
     */
    private getFlatDocumentItems(
        groups: TaskDocumentGroup[],
        singles: TaskDocument[]
    ): vscode.TreeItem[] {
        const items: vscode.TreeItem[] = [];
        const settings = this.taskManager.getSettings();

        // Create combined list with sort key
        type SortableItem = { 
            type: 'group' | 'single'; 
            name: string; 
            modifiedTime: Date; 
            item: TaskDocumentGroup | TaskDocument 
        };

        const sortable: SortableItem[] = [
            ...groups.map(g => ({ 
                type: 'group' as const, 
                name: g.baseName, 
                modifiedTime: g.latestModifiedTime, 
                item: g 
            })),
            ...singles.map(s => ({ 
                type: 'single' as const, 
                name: s.baseName, 
                modifiedTime: s.modifiedTime, 
                item: s 
            }))
        ];

        // Sort
        sortable.sort((a, b) => {
            if (settings.sortBy === 'name') {
                return a.name.localeCompare(b.name);
            } else {
                return b.modifiedTime.getTime() - a.modifiedTime.getTime();
            }
        });

        // Convert to tree items
        for (const s of sortable) {
            if (s.type === 'group') {
                const group = s.item as TaskDocumentGroup;
                const groupItem = new TaskDocumentGroupItem(group.baseName, group.documents, group.isArchived);
                this.applyGroupReviewStatus(groupItem);
                items.push(groupItem);
            } else {
                const doc = s.item as TaskDocument;
                // For singles, use TaskItem to maintain backward compatibility
                const taskItem = new TaskItem({
                    name: doc.fileName.replace(/\.md$/i, ''),
                    filePath: doc.filePath,
                    modifiedTime: doc.modifiedTime,
                    isArchived: doc.isArchived
                });
                this.applyReviewStatus(taskItem);
                items.push(taskItem);
            }
        }

        return items;
    }

    /**
     * Get children for a document group (the individual documents)
     */
    private getDocumentGroupChildren(groupItem: TaskDocumentGroupItem): TaskDocumentItem[] {
        let documents = [...groupItem.documents];

        // Sort documents
        documents.sort((a, b) => {
            // Sort by docType name for consistency
            const aType = a.docType || '';
            const bType = b.docType || '';
            return aType.localeCompare(bType);
        });

        return documents.map(doc => {
            const item = new TaskDocumentItem(doc);
            this.applyReviewStatus(item);
            return item;
        });
    }

    /**
     * Apply review status to a TaskItem
     */
    private applyReviewStatus(item: TaskItem | TaskDocumentItem): void {
        if (!this.reviewStatusManager || !this.reviewStatusManager.isInitialized()) {
            return;
        }
        const status = this.reviewStatusManager.getStatus(item.filePath);
        item.setReviewStatus(status);
    }

    /**
     * Apply aggregate review status to a TaskDocumentGroupItem
     */
    private applyGroupReviewStatus(groupItem: TaskDocumentGroupItem): void {
        if (!this.reviewStatusManager || !this.reviewStatusManager.isInitialized()) {
            return;
        }
        
        const statusMap = new Map<string, ReviewStatus>();
        for (const doc of groupItem.documents) {
            const status = this.reviewStatusManager.getStatus(doc.filePath);
            statusMap.set(doc.filePath, status);
        }
        groupItem.setGroupReviewStatus(statusMap);
    }

    /**
     * Get children of a folder (subfolders, document groups, and single documents)
     */
    private getFolderChildren(folder: TaskFolder): vscode.TreeItem[] {
        const items: vscode.TreeItem[] = [];
        const settings = this.taskManager.getSettings();

        // Add subfolders
        const sortedFolders = [...folder.children].sort((a, b) => {
            if (settings.sortBy === 'name') {
                return a.name.localeCompare(b.name);
            } else {
                // For folders, we could use latest modified time of contents
                // For simplicity, sort by name when using modifiedDate sort
                return a.name.localeCompare(b.name);
            }
        });

        for (const subfolder of sortedFolders) {
            items.push(new TaskFolderItem(subfolder));
        }

        // Add document groups
        const sortedGroups = this.sortDocumentGroups(folder.documentGroups);
        for (const group of sortedGroups) {
            const groupItem = new TaskDocumentGroupItem(group.baseName, group.documents, group.isArchived);
            this.applyGroupReviewStatus(groupItem);
            items.push(groupItem);
        }

        // Add single documents
        const sortedDocs = this.sortDocuments(folder.singleDocuments);
        for (const doc of sortedDocs) {
            const taskItem = new TaskItem({
                name: doc.fileName.replace(/\.md$/i, ''),
                filePath: doc.filePath,
                modifiedTime: doc.modifiedTime,
                isArchived: doc.isArchived,
                relativePath: doc.relativePath
            });
            this.applyReviewStatus(taskItem);
            items.push(taskItem);
        }

        // Add Related Items section if present
        if (folder.relatedItems && folder.relatedItems.items.length > 0 && settings.discovery.showRelatedInTree) {
            items.push(new RelatedItemsSectionItem(folder.folderPath, folder.relatedItems));
        }

        return items;
    }

    /**
     * Get children for the Related Items section
     */
    private getRelatedItemsChildren(sectionItem: RelatedItemsSectionItem): vscode.TreeItem[] {
        const settings = this.taskManager.getSettings();
        const items = sectionItem.config.items;
        const workspaceRoot = this.taskManager.getWorkspaceRoot();

        if (settings.discovery.groupByCategory) {
            // Group by category
            const categoryMap = new Map<string, RelatedItem[]>();
            
            for (const item of items) {
                const category = item.category;
                if (!categoryMap.has(category)) {
                    categoryMap.set(category, []);
                }
                categoryMap.get(category)!.push(item);
            }

            // Sort categories in a specific order
            const categoryOrder = ['source', 'test', 'doc', 'config', 'commit'];
            const sortedCategories = [...categoryMap.keys()].sort((a, b) => {
                const aIndex = categoryOrder.indexOf(a);
                const bIndex = categoryOrder.indexOf(b);
                return (aIndex === -1 ? 999 : aIndex) - (bIndex === -1 ? 999 : bIndex);
            });

            return sortedCategories.map(category => 
                new RelatedCategoryItem(category, categoryMap.get(category)!, sectionItem.folderPath)
            );
        } else {
            // Flat list sorted by relevance
            const sortedItems = [...items].sort((a, b) => b.relevance - a.relevance);
            return sortedItems.map(item => this.createRelatedItemTreeItem(item, sectionItem.folderPath, workspaceRoot));
        }
    }

    /**
     * Get children for a Related Category
     */
    private getRelatedCategoryChildren(categoryItem: RelatedCategoryItem): vscode.TreeItem[] {
        const workspaceRoot = this.taskManager.getWorkspaceRoot();
        
        // Sort items by relevance
        const sortedItems = [...categoryItem.items].sort((a, b) => b.relevance - a.relevance);
        return sortedItems.map(item => this.createRelatedItemTreeItem(item, categoryItem.folderPath, workspaceRoot));
    }

    /**
     * Create a tree item for a related item
     */
    private createRelatedItemTreeItem(item: RelatedItem, folderPath: string, workspaceRoot: string): vscode.TreeItem {
        if (item.type === 'commit') {
            return new RelatedCommitItem(item, folderPath, workspaceRoot);
        } else {
            return new RelatedFileItem(item, folderPath, workspaceRoot);
        }
    }

    /**
     * Sort document groups
     */
    private sortDocumentGroups(groups: TaskDocumentGroup[]): TaskDocumentGroup[] {
        const settings = this.taskManager.getSettings();
        return [...groups].sort((a, b) => {
            if (settings.sortBy === 'name') {
                return a.baseName.localeCompare(b.baseName);
            } else {
                return b.latestModifiedTime.getTime() - a.latestModifiedTime.getTime();
            }
        });
    }

    /**
     * Sort documents
     */
    private sortDocuments(docs: TaskDocument[]): TaskDocument[] {
        const settings = this.taskManager.getSettings();
        return [...docs].sort((a, b) => {
            if (settings.sortBy === 'name') {
                return a.baseName.localeCompare(b.baseName);
            } else {
                return b.modifiedTime.getTime() - a.modifiedTime.getTime();
            }
        });
    }

    /**
     * Get grouped root items (Active Tasks / Archived Tasks headers)
     */
    private getGroupedRootItems(tasks: Task[]): vscode.TreeItem[] {
        const activeTasks = tasks.filter(t => !t.isArchived);
        const archivedTasks = tasks.filter(t => t.isArchived);

        // Cache tasks by group for getChildren
        this.tasksByGroup.set('active', this.sortTasks(activeTasks));
        this.tasksByGroup.set('archived', this.sortTasks(archivedTasks));

        const items: vscode.TreeItem[] = [];

        // Always show Active Tasks group (even if empty)
        items.push(new TaskGroupItem('active', activeTasks.length));

        // Always show Archived Tasks group (even if empty)
        items.push(new TaskGroupItem('archived', archivedTasks.length));

        return items;
    }

    /**
     * Get flat task items (when showArchived is disabled)
     */
    private getFlatTaskItems(tasks: Task[]): TaskItem[] {
        // Sort tasks
        tasks = this.sortTasks(tasks);
        return tasks.map(task => {
            const item = new TaskItem(task);
            this.applyReviewStatus(item);
            return item;
        });
    }

    /**
     * Get tasks for a specific group
     */
    private getGroupTasks(groupType: 'active' | 'archived'): vscode.TreeItem[] {
        const settings = this.taskManager.getSettings();

        // If document grouping is enabled and we have cached hierarchy
        if (settings.groupRelatedDocuments && this.cachedFolderHierarchy) {
            const { activeFolder, archivedFolder } = this.splitFolderByArchiveStatus(this.cachedFolderHierarchy);
            const folder = groupType === 'active' ? activeFolder : archivedFolder;
            return this.getFolderChildren(folder);
        }

        // Legacy behavior - document grouping without hierarchy
        if (settings.groupRelatedDocuments) {
            const cached = this.documentsByArchiveStatus.get(groupType);
            if (cached) {
                return this.getFlatDocumentItems(cached.groups, cached.singles);
            }
            return [];
        }

        // Legacy behavior - flat task list
        const tasks = this.tasksByGroup.get(groupType) || [];
        return tasks.map(task => {
            const item = new TaskItem(task);
            this.applyReviewStatus(item);
            return item;
        });
    }

    /**
     * Sort tasks according to settings
     */
    private sortTasks(tasks: Task[]): Task[] {
        const settings = this.taskManager.getSettings();

        return [...tasks].sort((a, b) => {
            if (settings.sortBy === 'name') {
                return a.name.localeCompare(b.name);
            } else {
                // modifiedDate - newest first
                return b.modifiedTime.getTime() - a.modifiedTime.getTime();
            }
        });
    }
}
