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