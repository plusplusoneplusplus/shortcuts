/**
 * Shared utilities module
 * 
 * This module contains shared utilities used by multiple features:
 * - markdown-comments
 * - git-diff-comments
 * 
 * Extracting common code here reduces duplication and ensures
 * consistent behavior across features.
 */

// HTML line splitting utilities
export * from './highlighted-html-lines';

// Text matching utilities for anchor systems
export * from './text-matching';

