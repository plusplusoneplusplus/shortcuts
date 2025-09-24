import * as vscode from 'vscode';

/**
 * Manages theming integration for the shortcuts panel
 * Ensures proper appearance across different VS Code themes
 */
export class ThemeManager {
    private themeChangeListener?: vscode.Disposable;
    private onThemeChangeCallback?: () => void;

    /**
     * Initialize theme management
     * @param onThemeChange Callback to execute when theme changes
     */
    initialize(onThemeChange?: () => void): void {
        this.onThemeChangeCallback = onThemeChange;
        this.setupThemeChangeListener();
    }

    /**
     * Get the current color theme information
     */
    getCurrentTheme(): {
        kind: vscode.ColorThemeKind;
        name: string;
        isDark: boolean;
        isLight: boolean;
        isHighContrast: boolean;
    } {
        const colorTheme = vscode.window.activeColorTheme;

        return {
            kind: colorTheme.kind,
            name: 'Current Theme', // ColorTheme doesn't have a name property
            isDark: colorTheme.kind === vscode.ColorThemeKind.Dark,
            isLight: colorTheme.kind === vscode.ColorThemeKind.Light,
            isHighContrast: colorTheme.kind === vscode.ColorThemeKind.HighContrast ||
                             colorTheme.kind === vscode.ColorThemeKind.HighContrastLight
        };
    }

    /**
     * Get theme-appropriate colors for UI elements
     */
    getThemeColors(): {
        foreground: vscode.ThemeColor;
        background: vscode.ThemeColor;
        border: vscode.ThemeColor;
        selection: vscode.ThemeColor;
        hover: vscode.ThemeColor;
        focus: vscode.ThemeColor;
        error: vscode.ThemeColor;
        warning: vscode.ThemeColor;
        info: vscode.ThemeColor;
    } {
        return {
            foreground: new vscode.ThemeColor('foreground'),
            background: new vscode.ThemeColor('editor.background'),
            border: new vscode.ThemeColor('panel.border'),
            selection: new vscode.ThemeColor('list.activeSelectionBackground'),
            hover: new vscode.ThemeColor('list.hoverBackground'),
            focus: new vscode.ThemeColor('list.focusBackground'),
            error: new vscode.ThemeColor('errorForeground'),
            warning: new vscode.ThemeColor('warningForeground'),
            info: new vscode.ThemeColor('notificationsForeground')
        };
    }

    /**
     * Get theme-appropriate icon colors
     */
    getIconColors(): {
        folder: vscode.ThemeColor;
        file: vscode.ThemeColor;
        special: vscode.ThemeColor;
        muted: vscode.ThemeColor;
    } {
        return {
            folder: new vscode.ThemeColor('symbolIcon.folderForeground'),
            file: new vscode.ThemeColor('symbolIcon.fileForeground'),
            special: new vscode.ThemeColor('symbolIcon.keywordForeground'),
            muted: new vscode.ThemeColor('descriptionForeground')
        };
    }

    /**
     * Get theme-appropriate semantic colors for different file types
     */
    getFileTypeColors(): Map<string, vscode.ThemeColor> {
        const theme = this.getCurrentTheme();
        const colors = new Map<string, vscode.ThemeColor>();

        // JavaScript/TypeScript files
        colors.set('js', new vscode.ThemeColor('symbolIcon.functionForeground'));
        colors.set('ts', new vscode.ThemeColor('symbolIcon.functionForeground'));
        colors.set('jsx', new vscode.ThemeColor('symbolIcon.classForeground'));
        colors.set('tsx', new vscode.ThemeColor('symbolIcon.classForeground'));

        // Styles
        colors.set('css', new vscode.ThemeColor('symbolIcon.colorForeground'));
        colors.set('scss', new vscode.ThemeColor('symbolIcon.colorForeground'));
        colors.set('sass', new vscode.ThemeColor('symbolIcon.colorForeground'));
        colors.set('less', new vscode.ThemeColor('symbolIcon.colorForeground'));

        // Data files
        colors.set('json', new vscode.ThemeColor('symbolIcon.objectForeground'));
        colors.set('yaml', new vscode.ThemeColor('symbolIcon.objectForeground'));
        colors.set('yml', new vscode.ThemeColor('symbolIcon.objectForeground'));
        colors.set('xml', new vscode.ThemeColor('symbolIcon.objectForeground'));

        // Documentation
        colors.set('md', new vscode.ThemeColor('symbolIcon.stringForeground'));
        colors.set('txt', new vscode.ThemeColor('symbolIcon.stringForeground'));

        // Programming languages
        colors.set('py', new vscode.ThemeColor('symbolIcon.functionForeground'));
        colors.set('java', new vscode.ThemeColor('symbolIcon.classForeground'));
        colors.set('cpp', new vscode.ThemeColor('symbolIcon.functionForeground'));
        colors.set('c', new vscode.ThemeColor('symbolIcon.functionForeground'));
        colors.set('h', new vscode.ThemeColor('symbolIcon.interfaceForeground'));

        // Shell scripts
        colors.set('sh', new vscode.ThemeColor('terminal.foreground'));
        colors.set('bash', new vscode.ThemeColor('terminal.foreground'));
        colors.set('ps1', new vscode.ThemeColor('terminal.foreground'));

        return colors;
    }

    /**
     * Create themed icons with appropriate colors
     */
    createThemedIcon(iconName: string, color?: vscode.ThemeColor): vscode.ThemeIcon {
        if (color) {
            return new vscode.ThemeIcon(iconName, color);
        }
        return new vscode.ThemeIcon(iconName);
    }

    /**
     * Get theme-appropriate folder icons based on folder type
     */
    getFolderIcon(folderName: string, isExpanded: boolean): vscode.ThemeIcon {
        const theme = this.getCurrentTheme();
        const folderType = this.getFolderType(folderName.toLowerCase());

        // Special handling for high contrast themes
        if (theme.isHighContrast) {
            return new vscode.ThemeIcon(
                isExpanded ? 'folder-opened' : 'folder',
                new vscode.ThemeColor('symbolIcon.folderForeground')
            );
        }

        // Get appropriate icon based on folder type
        const iconConfig = this.getFolderIconConfig(folderType);
        const iconName = isExpanded ? iconConfig.expanded : iconConfig.collapsed;

        return new vscode.ThemeIcon(iconName, iconConfig.color);
    }

    /**
     * Get theme-appropriate file icons
     */
    getFileIcon(fileName: string, extension: string): vscode.ThemeIcon {
        const theme = this.getCurrentTheme();
        const fileTypeColors = this.getFileTypeColors();

        // Check for special file name patterns first
        const specialIcon = this.getSpecialFileIcon(fileName.toLowerCase());
        if (specialIcon) {
            return specialIcon;
        }

        // Get icon based on file extension
        const iconName = this.getFileIconName(extension);
        const color = fileTypeColors.get(extension.toLowerCase().substring(1));

        // High contrast theme handling
        if (theme.isHighContrast) {
            return new vscode.ThemeIcon(iconName, new vscode.ThemeColor('symbolIcon.fileForeground'));
        }

        return new vscode.ThemeIcon(iconName, color);
    }

    /**
     * Set up theme change listener
     */
    private setupThemeChangeListener(): void {
        this.themeChangeListener = vscode.window.onDidChangeActiveColorTheme((colorTheme) => {
            console.log(`Theme changed to kind: ${colorTheme.kind}`);

            if (this.onThemeChangeCallback) {
                this.onThemeChangeCallback();
            }
        });
    }

    /**
     * Get folder type based on name
     */
    private getFolderType(folderName: string): string {
        const typeMap: { [key: string]: string } = {
            'src': 'source',
            'source': 'source',
            'lib': 'source',
            'libs': 'source',
            'components': 'component',
            'pages': 'page',
            'views': 'page',
            'assets': 'asset',
            'images': 'asset',
            'img': 'asset',
            'styles': 'style',
            'css': 'style',
            'scss': 'style',
            'sass': 'style',
            'tests': 'test',
            'test': 'test',
            '__tests__': 'test',
            'spec': 'test',
            'specs': 'test',
            'docs': 'docs',
            'documentation': 'docs',
            'config': 'config',
            'configuration': 'config',
            'configs': 'config',
            'utils': 'util',
            'utilities': 'util',
            'helpers': 'util',
            'scripts': 'script',
            'bin': 'script',
            'build': 'build',
            'dist': 'build',
            'out': 'build',
            'output': 'build',
            'public': 'public',
            'static': 'public',
            'www': 'public',
            'node_modules': 'dependency',
            '.git': 'git',
            '.vscode': 'vscode',
            '.github': 'github'
        };

        return typeMap[folderName] || 'default';
    }

    /**
     * Get folder icon configuration
     */
    private getFolderIconConfig(folderType: string): {
        collapsed: string;
        expanded: string;
        color?: vscode.ThemeColor;
    } {
        const configs: { [key: string]: { collapsed: string; expanded: string; color?: vscode.ThemeColor } } = {
            'source': {
                collapsed: 'folder-library',
                expanded: 'folder-library-opened',
                color: new vscode.ThemeColor('symbolIcon.functionForeground')
            },
            'component': {
                collapsed: 'symbol-class',
                expanded: 'symbol-class',
                color: new vscode.ThemeColor('symbolIcon.classForeground')
            },
            'page': {
                collapsed: 'browser',
                expanded: 'browser',
                color: new vscode.ThemeColor('symbolIcon.moduleForeground')
            },
            'asset': {
                collapsed: 'file-media',
                expanded: 'file-media',
                color: new vscode.ThemeColor('symbolIcon.colorForeground')
            },
            'style': {
                collapsed: 'symbol-color',
                expanded: 'symbol-color',
                color: new vscode.ThemeColor('symbolIcon.colorForeground')
            },
            'test': {
                collapsed: 'beaker',
                expanded: 'beaker',
                color: new vscode.ThemeColor('testing.iconFailed')
            },
            'docs': {
                collapsed: 'book',
                expanded: 'book',
                color: new vscode.ThemeColor('symbolIcon.stringForeground')
            },
            'config': {
                collapsed: 'settings-gear',
                expanded: 'settings-gear',
                color: new vscode.ThemeColor('symbolIcon.keywordForeground')
            },
            'util': {
                collapsed: 'tools',
                expanded: 'tools',
                color: new vscode.ThemeColor('symbolIcon.functionForeground')
            },
            'script': {
                collapsed: 'terminal',
                expanded: 'terminal',
                color: new vscode.ThemeColor('terminal.foreground')
            },
            'build': {
                collapsed: 'package',
                expanded: 'package',
                color: new vscode.ThemeColor('symbolIcon.packageForeground')
            },
            'public': {
                collapsed: 'globe',
                expanded: 'globe',
                color: new vscode.ThemeColor('symbolIcon.namespaceForeground')
            },
            'dependency': {
                collapsed: 'library',
                expanded: 'library',
                color: new vscode.ThemeColor('symbolIcon.packageForeground')
            },
            'git': {
                collapsed: 'source-control',
                expanded: 'source-control',
                color: new vscode.ThemeColor('gitDecoration.modifiedResourceForeground')
            },
            'vscode': {
                collapsed: 'settings',
                expanded: 'settings',
                color: new vscode.ThemeColor('symbolIcon.keywordForeground')
            },
            'github': {
                collapsed: 'github',
                expanded: 'github',
                color: new vscode.ThemeColor('symbolIcon.namespaceForeground')
            }
        };

        return configs[folderType] || {
            collapsed: 'folder',
            expanded: 'folder-opened',
            color: new vscode.ThemeColor('symbolIcon.folderForeground')
        };
    }

    /**
     * Get special file icons for known file names
     */
    private getSpecialFileIcon(fileName: string): vscode.ThemeIcon | null {
        const specialFiles: { [key: string]: { icon: string; color: vscode.ThemeColor } } = {
            'package.json': {
                icon: 'package',
                color: new vscode.ThemeColor('symbolIcon.packageForeground')
            },
            'tsconfig.json': {
                icon: 'settings-gear',
                color: new vscode.ThemeColor('symbolIcon.keywordForeground')
            },
            'webpack.config.js': {
                icon: 'settings-gear',
                color: new vscode.ThemeColor('symbolIcon.keywordForeground')
            },
            'dockerfile': {
                icon: 'vm',
                color: new vscode.ThemeColor('symbolIcon.classForeground')
            },
            'readme.md': {
                icon: 'book',
                color: new vscode.ThemeColor('symbolIcon.stringForeground')
            },
            '.gitignore': {
                icon: 'git-branch',
                color: new vscode.ThemeColor('gitDecoration.ignoredResourceForeground')
            },
            '.env': {
                icon: 'key',
                color: new vscode.ThemeColor('symbolIcon.keywordForeground')
            }
        };

        const config = specialFiles[fileName];
        return config ? new vscode.ThemeIcon(config.icon, config.color) : null;
    }

    /**
     * Get file icon name based on extension
     */
    private getFileIconName(extension: string): string {
        const ext = extension.toLowerCase();

        const iconMap: { [key: string]: string } = {
            '.js': 'symbol-method',
            '.ts': 'symbol-method',
            '.jsx': 'symbol-class',
            '.tsx': 'symbol-class',
            '.json': 'symbol-object',
            '.css': 'symbol-color',
            '.scss': 'symbol-color',
            '.html': 'symbol-color',
            '.md': 'book',
            '.txt': 'note',
            '.py': 'symbol-method',
            '.java': 'symbol-class',
            '.cpp': 'symbol-method',
            '.c': 'symbol-method',
            '.h': 'symbol-interface',
            '.sh': 'terminal',
            '.png': 'file-media',
            '.jpg': 'file-media',
            '.svg': 'symbol-color',
            '.zip': 'file-zip',
            '.log': 'output',
            '.sql': 'database'
        };

        return iconMap[ext] || 'file';
    }

    /**
     * Dispose of theme manager resources
     */
    dispose(): void {
        this.themeChangeListener?.dispose();
        this.themeChangeListener = undefined;
        this.onThemeChangeCallback = undefined;
    }
}