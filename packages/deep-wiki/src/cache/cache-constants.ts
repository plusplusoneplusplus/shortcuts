/**
 * Cache Layer — Shared Constants
 *
 * Central location for cache directory names, file names, and version constants.
 * Used by all domain-specific cache modules to avoid duplication.
 */

import * as path from 'path';

/** Name of the cache directory */
export const CACHE_DIR_NAME = '.wiki-cache';

/** Name of the cached module graph file */
export const GRAPH_CACHE_FILE = 'module-graph.json';

/** Subdirectory for per-module analysis cache */
export const ANALYSES_DIR = 'analyses';

/** Subdirectory for per-module article cache */
export const ARTICLES_DIR = 'articles';

/** Name of the cached consolidated graph file */
export const CONSOLIDATED_GRAPH_FILE = 'consolidated-graph.json';

/** Metadata file for the analyses cache */
export const ANALYSES_METADATA_FILE = '_metadata.json';

/** Metadata file for reduce-phase article cache */
export const REDUCE_METADATA_FILE = '_reduce-metadata.json';

/** Prefix for reduce article cache files */
export const REDUCE_ARTICLE_PREFIX = '_reduce-';

/** Current version for cache metadata */
export const CACHE_VERSION = '1.0.0';

/**
 * Get the cache directory path.
 *
 * @param outputDir - Output directory (the cache is stored inside it)
 * @returns Absolute path to the cache directory
 */
export function getCacheDir(outputDir: string): string {
    return path.join(path.resolve(outputDir), CACHE_DIR_NAME);
}
