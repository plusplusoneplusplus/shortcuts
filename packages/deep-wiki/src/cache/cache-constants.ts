/**
 * Central location for cache directory names, file names, and version constants.
 * Used by all domain-specific cache modules to avoid duplication.
 */

import * as path from 'path';

export const CACHE_DIR_NAME = '.wiki-cache';

export const GRAPH_CACHE_FILE = 'component-graph.json';

export const ANALYSES_DIR = 'analyses';

export const ARTICLES_DIR = 'articles';

export const CONSOLIDATED_GRAPH_FILE = 'consolidated-graph.json';

export const ANALYSES_METADATA_FILE = '_metadata.json';

export const REDUCE_METADATA_FILE = '_reduce-metadata.json';

export const REDUCE_ARTICLE_PREFIX = '_reduce-';

export const THEMES_DIR = 'themes';

export const CACHE_VERSION = '1.0.0';

export function getCacheDir(outputDir: string): string {
    return path.join(path.resolve(outputDir), CACHE_DIR_NAME);
}
