import * as path from 'path';
import * as vscode from 'vscode';

/**
 * Abstract base class for all shortcut tree items
 * Extends vscode.TreeItem to provide common functionality for folders and files
 */
export abstract class ShortcutItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly resourceUri: vscode.Uri,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState
    ) {
        super(label, collapsibleState);
        this.resourceUri = resourceUri;
        this.tooltip = this.resourceUri.fsPath;
    }

    /**
     * Get the file system path for this item
     */
    get fsPath(): string {
        return this.resourceUri.fsPath;
    }

    /**
     * Get the display name for this item
     */
    get displayName(): string {
        return this.label;
    }

    /**
     * Check if this item represents a directory
     */
    abstract isDirectory(): boolean;

    /**
     * Get the appropriate icon for this item
     */
    abstract getIconPath(): vscode.ThemeIcon | { light: string; dark: string } | undefined;
}

/**
 * Tree item representing a folder shortcut
 * Supports expand/collapse functionality and shows appropriate folder icons
 */
export class FolderShortcutItem extends ShortcutItem {
    public readonly contextValue = 'folder';

    constructor(
        label: string,
        resourceUri: vscode.Uri,
        collapsibleState: vscode.TreeItemCollapsibleState = vscode.TreeItemCollapsibleState.Collapsed
    ) {
        super(label, resourceUri, collapsibleState);
        this.iconPath = this.getIconPath();
    }

    /**
     * Folders are always directories
     */
    isDirectory(): boolean {
        return true;
    }

    /**
     * Get folder icon based on collapsed/expanded state
     * Uses VS Code theme icons that automatically adapt to light/dark themes
     */
    getIconPath(): vscode.ThemeIcon {
        const folderName = path.basename(this.resourceUri.fsPath).toLowerCase();

        // Special folder icons for common directories
        const specialFolderIcons: { [key: string]: { collapsed: string; expanded: string } } = {
            'src': { collapsed: 'folder-library', expanded: 'folder-library-opened' },
            'source': { collapsed: 'folder-library', expanded: 'folder-library-opened' },
            'lib': { collapsed: 'folder-library', expanded: 'folder-library-opened' },
            'libs': { collapsed: 'folder-library', expanded: 'folder-library-opened' },
            'components': { collapsed: 'symbol-class', expanded: 'symbol-class' },
            'pages': { collapsed: 'browser', expanded: 'browser' },
            'views': { collapsed: 'browser', expanded: 'browser' },
            'assets': { collapsed: 'file-media', expanded: 'file-media' },
            'images': { collapsed: 'file-media', expanded: 'file-media' },
            'img': { collapsed: 'file-media', expanded: 'file-media' },
            'styles': { collapsed: 'symbol-color', expanded: 'symbol-color' },
            'css': { collapsed: 'symbol-color', expanded: 'symbol-color' },
            'scss': { collapsed: 'symbol-color', expanded: 'symbol-color' },
            'sass': { collapsed: 'symbol-color', expanded: 'symbol-color' },
            'tests': { collapsed: 'beaker', expanded: 'beaker' },
            'test': { collapsed: 'beaker', expanded: 'beaker' },
            '__tests__': { collapsed: 'beaker', expanded: 'beaker' },
            'spec': { collapsed: 'beaker', expanded: 'beaker' },
            'specs': { collapsed: 'beaker', expanded: 'beaker' },
            'docs': { collapsed: 'book', expanded: 'book' },
            'documentation': { collapsed: 'book', expanded: 'book' },
            'config': { collapsed: 'settings-gear', expanded: 'settings-gear' },
            'configuration': { collapsed: 'settings-gear', expanded: 'settings-gear' },
            'configs': { collapsed: 'settings-gear', expanded: 'settings-gear' },
            'utils': { collapsed: 'tools', expanded: 'tools' },
            'utilities': { collapsed: 'tools', expanded: 'tools' },
            'helpers': { collapsed: 'tools', expanded: 'tools' },
            'scripts': { collapsed: 'terminal', expanded: 'terminal' },
            'bin': { collapsed: 'terminal', expanded: 'terminal' },
            'build': { collapsed: 'package', expanded: 'package' },
            'dist': { collapsed: 'package', expanded: 'package' },
            'out': { collapsed: 'package', expanded: 'package' },
            'output': { collapsed: 'package', expanded: 'package' },
            'public': { collapsed: 'globe', expanded: 'globe' },
            'static': { collapsed: 'globe', expanded: 'globe' },
            'www': { collapsed: 'globe', expanded: 'globe' },
            'node_modules': { collapsed: 'library', expanded: 'library' },
            '.git': { collapsed: 'source-control', expanded: 'source-control' },
            '.vscode': { collapsed: 'settings', expanded: 'settings' },
            '.github': { collapsed: 'github', expanded: 'github' },
            'migrations': { collapsed: 'database', expanded: 'database' },
            'seeds': { collapsed: 'database', expanded: 'database' },
            'models': { collapsed: 'symbol-class', expanded: 'symbol-class' },
            'controllers': { collapsed: 'symbol-method', expanded: 'symbol-method' },
            'services': { collapsed: 'symbol-interface', expanded: 'symbol-interface' },
            'middleware': { collapsed: 'symbol-interface', expanded: 'symbol-interface' },
            'routes': { collapsed: 'symbol-namespace', expanded: 'symbol-namespace' },
            'api': { collapsed: 'cloud', expanded: 'cloud' },
            'graphql': { collapsed: 'symbol-object', expanded: 'symbol-object' },
            'schema': { collapsed: 'symbol-object', expanded: 'symbol-object' },
            'schemas': { collapsed: 'symbol-object', expanded: 'symbol-object' }
        };

        // Check if this is a special folder
        const specialIcon = specialFolderIcons[folderName];
        if (specialIcon) {
            const iconName = this.collapsibleState === vscode.TreeItemCollapsibleState.Expanded
                ? specialIcon.expanded
                : specialIcon.collapsed;
            return new vscode.ThemeIcon(iconName);
        }

        // Default folder icons based on state
        if (this.collapsibleState === vscode.TreeItemCollapsibleState.Expanded) {
            return new vscode.ThemeIcon('folder-opened');
        } else {
            return new vscode.ThemeIcon('folder');
        }
    }

    /**
     * Create a new folder item with expanded state
     */
    asExpanded(): FolderShortcutItem {
        return new FolderShortcutItem(
            this.label,
            this.resourceUri,
            vscode.TreeItemCollapsibleState.Expanded
        );
    }

    /**
     * Create a new folder item with collapsed state
     */
    asCollapsed(): FolderShortcutItem {
        return new FolderShortcutItem(
            this.label,
            this.resourceUri,
            vscode.TreeItemCollapsibleState.Collapsed
        );
    }
}

/**
 * Tree item representing a file shortcut
 * Configured to open the file when clicked and shows file type-specific icons
 */
export class FileShortcutItem extends ShortcutItem {
    public readonly contextValue = 'file';
    public readonly command: vscode.Command;

    constructor(label: string, resourceUri: vscode.Uri) {
        super(label, resourceUri, vscode.TreeItemCollapsibleState.None);

        // Configure command to open file when clicked
        this.command = {
            command: 'vscode.open',
            title: 'Open File',
            arguments: [this.resourceUri]
        };

        this.iconPath = this.getIconPath();
    }

    /**
     * Files are never directories
     */
    isDirectory(): boolean {
        return false;
    }

    /**
     * Get file type-specific icon based on file extension
     * Uses VS Code theme icons that automatically adapt to light/dark themes
     */
    getIconPath(): vscode.ThemeIcon {
        const extension = path.extname(this.resourceUri.fsPath).toLowerCase();
        const fileName = path.basename(this.resourceUri.fsPath).toLowerCase();

        // Map specific file names to icons (higher priority than extensions)
        const fileNameIconMap: { [key: string]: string } = {
            'package.json': 'package',
            'tsconfig.json': 'settings-gear',
            'webpack.config.js': 'settings-gear',
            'vite.config.js': 'settings-gear',
            'vite.config.ts': 'settings-gear',
            'rollup.config.js': 'settings-gear',
            'gulpfile.js': 'settings-gear',
            'gruntfile.js': 'settings-gear',
            'dockerfile': 'vm',
            'docker-compose.yml': 'vm',
            'docker-compose.yaml': 'vm',
            'readme.md': 'book',
            'changelog.md': 'history',
            'license': 'law',
            'license.md': 'law',
            'license.txt': 'law',
            '.gitignore': 'git-branch',
            '.gitattributes': 'git-branch',
            '.env': 'key',
            '.env.local': 'key',
            '.env.development': 'key',
            '.env.production': 'key'
        };

        // Check for specific file names first
        if (fileNameIconMap[fileName]) {
            return new vscode.ThemeIcon(fileNameIconMap[fileName]);
        }

        // Map common file extensions to VS Code theme icons
        const extensionIconMap: { [key: string]: string } = {
            // JavaScript/TypeScript
            '.js': 'symbol-method',
            '.mjs': 'symbol-method',
            '.cjs': 'symbol-method',
            '.ts': 'symbol-method',
            '.tsx': 'symbol-class',
            '.jsx': 'symbol-class',

            // Web technologies
            '.html': 'symbol-color',
            '.htm': 'symbol-color',
            '.css': 'symbol-color',
            '.scss': 'symbol-color',
            '.sass': 'symbol-color',
            '.less': 'symbol-color',
            '.styl': 'symbol-color',

            // Data formats
            '.json': 'symbol-object',
            '.xml': 'symbol-object',
            '.yaml': 'symbol-object',
            '.yml': 'symbol-object',
            '.toml': 'symbol-object',
            '.ini': 'symbol-object',
            '.cfg': 'symbol-object',
            '.conf': 'symbol-object',

            // Documentation
            '.md': 'book',
            '.mdx': 'book',
            '.txt': 'note',
            '.rtf': 'note',
            '.doc': 'note',
            '.docx': 'note',
            '.pdf': 'file-pdf',

            // Programming languages
            '.py': 'symbol-method',
            '.pyw': 'symbol-method',
            '.java': 'symbol-class',
            '.kt': 'symbol-class',
            '.scala': 'symbol-class',
            '.cpp': 'symbol-method',
            '.cxx': 'symbol-method',
            '.cc': 'symbol-method',
            '.c': 'symbol-method',
            '.h': 'symbol-interface',
            '.hpp': 'symbol-interface',
            '.hxx': 'symbol-interface',
            '.cs': 'symbol-class',
            '.vb': 'symbol-class',
            '.fs': 'symbol-method',
            '.fsx': 'symbol-method',
            '.go': 'symbol-method',
            '.rs': 'symbol-method',
            '.rb': 'symbol-method',
            '.php': 'symbol-method',
            '.pl': 'symbol-method',
            '.pm': 'symbol-method',
            '.r': 'symbol-method',
            '.R': 'symbol-method',
            '.m': 'symbol-method',
            '.mm': 'symbol-method',
            '.swift': 'symbol-class',
            '.dart': 'symbol-class',
            '.lua': 'symbol-method',
            '.sh': 'terminal',
            '.bash': 'terminal',
            '.zsh': 'terminal',
            '.fish': 'terminal',
            '.ps1': 'terminal',
            '.bat': 'terminal',
            '.cmd': 'terminal',

            // Images
            '.png': 'file-media',
            '.jpg': 'file-media',
            '.jpeg': 'file-media',
            '.gif': 'file-media',
            '.bmp': 'file-media',
            '.svg': 'symbol-color',
            '.ico': 'file-media',
            '.webp': 'file-media',

            // Archives
            '.zip': 'file-zip',
            '.rar': 'file-zip',
            '.7z': 'file-zip',
            '.tar': 'file-zip',
            '.gz': 'file-zip',
            '.bz2': 'file-zip',
            '.xz': 'file-zip',

            // Logs and temporary files
            '.log': 'output',
            '.tmp': 'file-submodule',
            '.temp': 'file-submodule',
            '.cache': 'file-submodule',

            // Lock files
            '.lock': 'lock',

            // Database
            '.sql': 'database',
            '.db': 'database',
            '.sqlite': 'database',
            '.sqlite3': 'database'
        };

        const iconName = extensionIconMap[extension] || 'file';
        return new vscode.ThemeIcon(iconName);
    }

    /**
     * Get the file extension
     */
    get extension(): string {
        return path.extname(this.resourceUri.fsPath);
    }

    /**
     * Get the file name without extension
     */
    get baseName(): string {
        return path.basename(this.resourceUri.fsPath, this.extension);
    }
}

/**
 * Tree item representing a command that can be executed
 */
export class CommandShortcutItem extends vscode.TreeItem {
    public readonly contextValue = 'command';
    public readonly commandId: string;
    public readonly commandArgs?: any[];

    constructor(
        label: string,
        commandId: string,
        commandArgs?: any[],
        iconName?: string
    ) {
        super(label, vscode.TreeItemCollapsibleState.None);
        this.commandId = commandId;
        this.commandArgs = commandArgs;
        this.tooltip = `Command: ${commandId}`;
        this.iconPath = this.getIconPath(iconName);

        // Set up the command to execute when clicked
        this.command = {
            command: 'shortcuts.executeCommandItem',
            title: 'Execute Command',
            arguments: [this]
        };
    }

    private getIconPath(iconName?: string): vscode.ThemeIcon {
        if (iconName) {
            return new vscode.ThemeIcon(iconName, new vscode.ThemeColor('terminal.ansiYellow'));
        }
        // Default to bolt/lightning icon for commands
        return new vscode.ThemeIcon('symbol-event', new vscode.ThemeColor('terminal.ansiYellow'));
    }
}

/**
 * Tree item representing a task that can be run
 */
export class TaskShortcutItem extends vscode.TreeItem {
    public readonly contextValue = 'task';
    public readonly taskName: string;

    constructor(
        label: string,
        taskName: string,
        iconName?: string
    ) {
        super(label, vscode.TreeItemCollapsibleState.None);
        this.taskName = taskName;
        this.tooltip = `Task: ${taskName}`;
        this.iconPath = this.getIconPath(iconName);

        // Set up the command to execute when clicked
        this.command = {
            command: 'shortcuts.executeTaskItem',
            title: 'Run Task',
            arguments: [this]
        };
    }

    private getIconPath(iconName?: string): vscode.ThemeIcon {
        if (iconName) {
            return new vscode.ThemeIcon(iconName, new vscode.ThemeColor('terminal.ansiGreen'));
        }
        // Default to play/run icon for tasks
        return new vscode.ThemeIcon('play', new vscode.ThemeColor('terminal.ansiGreen'));
    }
}

/**
 * Tree item representing a note/notepad
 */
export class NoteShortcutItem extends vscode.TreeItem {
    public readonly contextValue = 'note';
    public readonly noteId: string;
    public readonly parentGroup: string;

    constructor(
        label: string,
        noteId: string,
        parentGroup: string,
        iconName?: string
    ) {
        super(label, vscode.TreeItemCollapsibleState.None);
        this.noteId = noteId;
        this.parentGroup = parentGroup;
        this.tooltip = `Note: ${label}`;
        this.iconPath = this.getIconPath(iconName);

        // Set up the command to open note editor when clicked
        this.command = {
            command: 'shortcuts.editNote',
            title: 'Edit Note',
            arguments: [this]
        };
    }

    private getIconPath(iconName?: string): vscode.ThemeIcon {
        if (iconName) {
            return new vscode.ThemeIcon(iconName, new vscode.ThemeColor('editorWarning.foreground'));
        }
        // Default to note icon for notes
        return new vscode.ThemeIcon('note', new vscode.ThemeColor('editorWarning.foreground'));
    }
}

/**
 * Tree item representing a logical group
 * Can contain multiple folders and files organized by category
 */
export class LogicalGroupItem extends ShortcutItem {
    public readonly contextValue = 'logicalGroup';
    public readonly originalName: string; // Store the original name for configuration matching
    public readonly parentGroupPath?: string; // Path to parent group (e.g., "parent/child")

    constructor(
        label: string,
        public readonly description?: string,
        public readonly iconName?: string,
        collapsibleState: vscode.TreeItemCollapsibleState = vscode.TreeItemCollapsibleState.Collapsed,
        parentGroupPath?: string
    ) {
        // Use a visually distinct label and dummy URI for logical groups
        const groupPath = parentGroupPath ? `${parentGroupPath}/${label}` : label;
        super(`📂 ${label}`, vscode.Uri.parse(`logical://group/${encodeURIComponent(groupPath)}`), collapsibleState);

        this.originalName = label; // Store original name for configuration lookup
        this.parentGroupPath = parentGroupPath;
        this.description = description;
        this.iconPath = this.getIconPath();
        this.tooltip = description || `Logical group: ${label}`;
    }

    isDirectory(): boolean {
        return true; // Logical groups act like directories
    }

    getIconPath(): vscode.ThemeIcon {
        if (this.iconName) {
            // Use accent color for custom icons to make them stand out
            return new vscode.ThemeIcon(this.iconName, new vscode.ThemeColor('focusBorder'));
        }

        // Default logical group icons based on common names - use more distinctive icons
        const groupName = this.label.toLowerCase();
        const groupIconMap: { [key: string]: string } = {
            'projects': 'folder-library',
            'work': 'briefcase',
            'personal': 'person',
            'development': 'code',
            'documents': 'file-text',
            'tools': 'tools',
            'resources': 'library',
            'favorites': 'star-full',  // Use filled star for better visibility
            'recent': 'history',
            'archive': 'archive'
        };

        // Use a more distinctive default icon and accent color
        const iconName = groupIconMap[groupName] || 'tag';  // Use tag instead of folder for better distinction
        return new vscode.ThemeIcon(iconName, new vscode.ThemeColor('focusBorder'));
    }
}

/**
 * Tree item representing an item within a logical group
 * Can be either a folder or file reference
 */
export class LogicalGroupChildItem extends ShortcutItem {
    public readonly contextValue: string;
    public readonly command?: vscode.Command;

    constructor(
        label: string,
        resourceUri: vscode.Uri,
        public readonly itemType: 'folder' | 'file',
        public readonly parentGroup: string
    ) {
        super(
            label,
            resourceUri,
            itemType === 'folder'
                ? vscode.TreeItemCollapsibleState.Collapsed
                : vscode.TreeItemCollapsibleState.None
        );
        this.contextValue = `logicalGroupItem_${itemType}`;

        // Set up command for files to open them
        if (itemType === 'file') {
            this.command = {
                command: 'vscode.open',
                title: 'Open File',
                arguments: [this.resourceUri]
            };
        }

        this.iconPath = this.getIconPath();
    }

    isDirectory(): boolean {
        return this.itemType === 'folder';
    }

    getIconPath(): vscode.ThemeIcon {
        if (this.itemType === 'folder') {
            // Use same logic as FolderShortcutItem for folders
            const folderName = path.basename(this.resourceUri.fsPath).toLowerCase();
            // Simplified folder icon logic
            return new vscode.ThemeIcon('folder', new vscode.ThemeColor('symbolIcon.folderForeground'));
        } else {
            // Use same logic as FileShortcutItem for files
            const extension = path.extname(this.resourceUri.fsPath).toLowerCase();
            const fileName = path.basename(this.resourceUri.fsPath).toLowerCase();

            // Simplified file icon logic
            const iconMap: { [key: string]: string } = {
                '.js': 'symbol-method',
                '.ts': 'symbol-method',
                '.json': 'symbol-object',
                '.md': 'book',
                '.txt': 'note',
                '.py': 'symbol-method',
                '.html': 'symbol-color',
                '.css': 'symbol-color'
            };

            const iconName = iconMap[extension] || 'file';
            return new vscode.ThemeIcon(iconName);
        }
    }
}

/**
 * Search input tree item for embedded search functionality
 */
export class SearchTreeItem extends ShortcutItem {
    constructor(
        public readonly placeholder: string,
        public readonly currentValue: string = ''
    ) {
        // Create label that looks like an input box
        const label = currentValue ? `${currentValue}` : `${placeholder}`;

        // Create a fake URI for the search item
        super(label, vscode.Uri.file('search'), vscode.TreeItemCollapsibleState.None);

        this.id = `search-${Date.now()}`;
        this.contextValue = 'searchInput';

        // Style the description to look like an input box
        if (currentValue) {
            this.description = '🔍 Active search';
        } else {
            this.description = '🔍 Click to search';
        }

        this.tooltip = `${placeholder} - Click or press F2 to edit`;

        // Always show search icon, but with different style for active search
        this.iconPath = new vscode.ThemeIcon('search');

        // Add command to trigger editing on click
        this.command = {
            command: 'shortcuts.editSearchInput',
            title: 'Search',
            arguments: [this]
        };
    }

    // Implement required ShortcutItem properties
    get fsPath(): string {
        return 'search';
    }

    get displayName(): string {
        return this.label?.toString() || this.placeholder;
    }

    isDirectory(): boolean {
        return false;
    }

    getIconPath(): vscode.ThemeIcon {
        return this.iconPath as vscode.ThemeIcon;
    }
}

/**
 * Tree item representing the Global Notes section
 * A dedicated section for notes not tied to any logical group
 */
export class GlobalNotesSectionItem extends vscode.TreeItem {
    public readonly contextValue = 'globalNotesSection';

    constructor(
        collapsibleState: vscode.TreeItemCollapsibleState = vscode.TreeItemCollapsibleState.Expanded
    ) {
        super('📝 Global Notes', collapsibleState);

        this.tooltip = 'Notes accessible from anywhere - not tied to any specific group';
        this.iconPath = new vscode.ThemeIcon('note', new vscode.ThemeColor('charts.yellow'));
        this.description = 'Quick access notes';
    }
}

/**
 * Tree item representing a global note (not tied to any group)
 */
export class GlobalNoteItem extends vscode.TreeItem {
    public readonly contextValue = 'globalNote';
    public readonly noteId: string;

    constructor(
        label: string,
        noteId: string,
        iconName?: string
    ) {
        super(label, vscode.TreeItemCollapsibleState.None);
        this.noteId = noteId;
        this.tooltip = `Global Note: ${label}`;
        this.iconPath = this.getIconPath(iconName);

        // Set up the command to open note editor when clicked
        this.command = {
            command: 'shortcuts.editGlobalNote',
            title: 'Edit Note',
            arguments: [this]
        };
    }

    private getIconPath(iconName?: string): vscode.ThemeIcon {
        if (iconName) {
            return new vscode.ThemeIcon(iconName, new vscode.ThemeColor('editorWarning.foreground'));
        }
        // Default to note icon for notes
        return new vscode.ThemeIcon('note', new vscode.ThemeColor('editorWarning.foreground'));
    }
}