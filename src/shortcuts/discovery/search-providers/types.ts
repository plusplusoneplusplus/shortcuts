/**
 * Types for search providers
 */

import { RawSearchResult, DiscoveryScope } from '../types';

/**
 * Search provider interface
 */
export interface ISearchProvider {
    /**
     * Search for items matching the given keywords
     * @param keywords Keywords to search for
     * @param scope Discovery scope configuration
     * @param repositoryRoot Root path for the repository
     * @returns Array of raw search results
     */
    search(
        keywords: string[],
        scope: DiscoveryScope,
        repositoryRoot: string
    ): Promise<RawSearchResult[]>;
}

/**
 * File type categories for search
 */
export type FileCategory = 'source' | 'doc' | 'config' | 'other';

/**
 * File extension to category mapping
 */
export const FILE_CATEGORY_MAP: Record<string, FileCategory> = {
    // Source files
    '.ts': 'source',
    '.tsx': 'source',
    '.js': 'source',
    '.jsx': 'source',
    '.mjs': 'source',
    '.cjs': 'source',
    '.py': 'source',
    '.pyw': 'source',
    '.java': 'source',
    '.kt': 'source',
    '.kts': 'source',
    '.scala': 'source',
    '.go': 'source',
    '.rs': 'source',
    '.rb': 'source',
    '.php': 'source',
    '.cs': 'source',
    '.fs': 'source',
    '.fsx': 'source',
    '.vb': 'source',
    '.cpp': 'source',
    '.cxx': 'source',
    '.cc': 'source',
    '.c': 'source',
    '.h': 'source',
    '.hpp': 'source',
    '.hxx': 'source',
    '.swift': 'source',
    '.m': 'source',
    '.mm': 'source',
    '.dart': 'source',
    '.lua': 'source',
    '.pl': 'source',
    '.pm': 'source',
    '.r': 'source',
    '.R': 'source',
    '.sh': 'source',
    '.bash': 'source',
    '.zsh': 'source',
    '.fish': 'source',
    '.ps1': 'source',
    '.bat': 'source',
    '.cmd': 'source',
    '.vue': 'source',
    '.svelte': 'source',
    '.astro': 'source',
    '.elm': 'source',
    '.ex': 'source',
    '.exs': 'source',
    '.erl': 'source',
    '.hrl': 'source',
    '.clj': 'source',
    '.cljs': 'source',
    '.cljc': 'source',
    '.hs': 'source',
    '.lhs': 'source',
    '.ml': 'source',
    '.mli': 'source',
    '.sql': 'source',
    
    // Documentation files
    '.md': 'doc',
    '.mdx': 'doc',
    '.txt': 'doc',
    '.rst': 'doc',
    '.adoc': 'doc',
    '.asciidoc': 'doc',
    '.org': 'doc',
    '.wiki': 'doc',
    '.textile': 'doc',
    '.pod': 'doc',
    '.rdoc': 'doc',
    
    // Configuration files
    '.json': 'config',
    '.yaml': 'config',
    '.yml': 'config',
    '.toml': 'config',
    '.ini': 'config',
    '.cfg': 'config',
    '.conf': 'config',
    '.config': 'config',
    '.env': 'config',
    '.properties': 'config',
    '.xml': 'config',
    '.plist': 'config'
};

/**
 * Known config file names (without extension checking)
 */
export const CONFIG_FILE_NAMES = new Set([
    'package.json',
    'tsconfig.json',
    'jsconfig.json',
    'webpack.config.js',
    'webpack.config.ts',
    'rollup.config.js',
    'rollup.config.ts',
    'vite.config.js',
    'vite.config.ts',
    'vitest.config.js',
    'vitest.config.ts',
    'jest.config.js',
    'jest.config.ts',
    'babel.config.js',
    'babel.config.json',
    '.babelrc',
    '.babelrc.json',
    '.eslintrc',
    '.eslintrc.js',
    '.eslintrc.json',
    '.eslintrc.yaml',
    '.eslintrc.yml',
    'eslint.config.js',
    'eslint.config.mjs',
    '.prettierrc',
    '.prettierrc.js',
    '.prettierrc.json',
    '.prettierrc.yaml',
    '.prettierrc.yml',
    'prettier.config.js',
    '.stylelintrc',
    '.stylelintrc.js',
    '.stylelintrc.json',
    'tailwind.config.js',
    'tailwind.config.ts',
    'postcss.config.js',
    'postcss.config.ts',
    '.editorconfig',
    '.gitignore',
    '.gitattributes',
    '.npmrc',
    '.nvmrc',
    '.node-version',
    'Dockerfile',
    'docker-compose.yml',
    'docker-compose.yaml',
    'Makefile',
    'CMakeLists.txt',
    'Cargo.toml',
    'Cargo.lock',
    'go.mod',
    'go.sum',
    'requirements.txt',
    'setup.py',
    'setup.cfg',
    'pyproject.toml',
    'Pipfile',
    'Pipfile.lock',
    'poetry.lock',
    'Gemfile',
    'Gemfile.lock',
    'composer.json',
    'composer.lock',
    'build.gradle',
    'build.gradle.kts',
    'settings.gradle',
    'settings.gradle.kts',
    'pom.xml',
    'project.clj',
    'mix.exs',
    'rebar.config'
]);

/**
 * Get the category for a file based on its name and extension
 * @param fileName File name
 * @returns File category
 */
export function getFileCategory(fileName: string): FileCategory {
    // Check known config file names first
    if (CONFIG_FILE_NAMES.has(fileName)) {
        return 'config';
    }
    
    // Check by extension
    const ext = fileName.includes('.') 
        ? '.' + fileName.split('.').pop()!.toLowerCase()
        : '';
    
    return FILE_CATEGORY_MAP[ext] || 'other';
}

/**
 * Check if a file should be included based on scope
 * @param fileName File name
 * @param scope Discovery scope
 * @returns Whether the file should be included
 */
export function shouldIncludeFile(fileName: string, scope: DiscoveryScope): boolean {
    const category = getFileCategory(fileName);
    
    switch (category) {
        case 'source':
            return scope.includeSourceFiles;
        case 'doc':
            return scope.includeDocs;
        case 'config':
            return scope.includeConfigFiles;
        default:
            return false;
    }
}

