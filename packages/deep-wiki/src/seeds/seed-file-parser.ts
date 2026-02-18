/**
 * Seeds Phase — Seed File Parser
 *
 * Parses seed files in YAML or CSV format into ThemeSeed arrays.
 * Supports YAML format with a 'themes' array and CSV with theme,description,hints columns.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import type { ThemeSeed } from '../types';
import { normalizeComponentId } from '../schemas';
import { getErrorMessage } from '../utils/error-utils';

// ============================================================================
// Seed File Parsing
// ============================================================================

/**
 * Parse a seed file (YAML or CSV) into an array of ThemeSeed objects.
 *
 * @param filePath - Path to the seed file
 * @returns Array of ThemeSeed objects
 * @throws Error if file doesn't exist, is empty, or has invalid format
 */
export function parseSeedFile(filePath: string): ThemeSeed[] {
    const absolutePath = path.resolve(filePath);

    // Check file exists
    if (!fs.existsSync(absolutePath)) {
        throw new Error(`Seed file does not exist: ${absolutePath}`);
    }

    const stats = fs.statSync(absolutePath);
    if (!stats.isFile()) {
        throw new Error(`Seed file path is not a file: ${absolutePath}`);
    }

    // Read file content
    const content = fs.readFileSync(absolutePath, 'utf-8').trim();
    if (!content) {
        throw new Error(`Seed file is empty: ${absolutePath}`);
    }

    // Detect format by extension
    const ext = path.extname(absolutePath).toLowerCase();
    if (ext === '.yaml' || ext === '.yml') {
        return parseYamlSeedFile(content, absolutePath);
    } else if (ext === '.csv') {
        return parseCsvSeedFile(content, absolutePath);
    } else {
        throw new Error(`Unsupported seed file extension '${ext}': ${absolutePath}. Use .yaml, .yml, or .csv`);
    }
}

// ============================================================================
// YAML Parsing
// ============================================================================

/**
 * Parse a YAML seed file.
 */
function parseYamlSeedFile(content: string, filePath: string): ThemeSeed[] {
    let parsed: unknown;
    try {
        parsed = yaml.load(content);
    } catch (error) {
        throw new Error(`Invalid YAML in seed file ${filePath}: ${getErrorMessage(error)}`);
    }

    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new Error(`Seed file ${filePath} does not contain a YAML mapping`);
    }

    const obj = parsed as Record<string, unknown>;

    if (!('themes' in obj) || !Array.isArray(obj.themes)) {
        throw new Error(`Seed file ${filePath} must contain a 'themes' array`);
    }

    return parseThemesArray(obj.themes, filePath);
}

/**
 * Parse an array of theme objects into ThemeSeed array.
 */
function parseThemesArray(raw: unknown[], filePath: string): ThemeSeed[] {
    const seeds: ThemeSeed[] = [];

    for (let i = 0; i < raw.length; i++) {
        const item = raw[i];
        if (typeof item !== 'object' || item === null) {
            throw new Error(`Invalid theme at index ${i} in ${filePath}: not an object`);
        }

        const obj = item as Record<string, unknown>;

        // Validate required fields
        if (typeof obj.theme !== 'string' || !obj.theme) {
            throw new Error(`Invalid theme at index ${i} in ${filePath}: missing or invalid 'theme' field`);
        }

        if (typeof obj.description !== 'string' || !obj.description) {
            throw new Error(`Invalid theme at index ${i} in ${filePath}: missing or invalid 'description' field`);
        }

        // Parse hints (can be array or comma-separated string)
        let hints: string[] = [];
        if (Array.isArray(obj.hints)) {
            hints = obj.hints
                .filter(h => typeof h === 'string')
                .map(h => String(h).trim())
                .filter(h => h.length > 0);
        } else if (typeof obj.hints === 'string') {
            hints = obj.hints
                .split(',')
                .map(h => h.trim())
                .filter(h => h.length > 0);
        } else {
            hints = [normalizeComponentId(String(obj.theme))];
        }

        if (hints.length === 0) {
            hints = [normalizeComponentId(String(obj.theme))];
        }

        seeds.push({
            theme: normalizeComponentId(String(obj.theme)),
            description: String(obj.description).trim(),
            hints,
        });
    }

    return seeds;
}

// ============================================================================
// CSV Parsing
// ============================================================================

/**
 * Parse a CSV seed file with columns: theme,description,hints
 */
function parseCsvSeedFile(content: string, filePath: string): ThemeSeed[] {
    const lines = content.split('\n').map(line => line.trim()).filter(line => line.length > 0);

    if (lines.length === 0) {
        throw new Error(`CSV seed file ${filePath} is empty`);
    }

    // Parse header
    const headerLine = lines[0];
    const headers = parseCsvLine(headerLine);

    // Find column indices
    const themeIdx = headers.findIndex(h => h.toLowerCase() === 'theme');
    const descIdx = headers.findIndex(h => h.toLowerCase() === 'description' || h.toLowerCase() === 'desc');
    const hintsIdx = headers.findIndex(h => h.toLowerCase() === 'hints' || h.toLowerCase() === 'hint');

    if (themeIdx === -1) {
        throw new Error(`CSV seed file ${filePath} missing 'theme' column`);
    }
    if (descIdx === -1) {
        throw new Error(`CSV seed file ${filePath} missing 'description' column`);
    }

    // Parse data rows
    const seeds: ThemeSeed[] = [];
    for (let i = 1; i < lines.length; i++) {
        const row = parseCsvLine(lines[i]);

        if (row.length <= Math.max(themeIdx, descIdx)) {
            throw new Error(`CSV seed file ${filePath} row ${i + 1} has insufficient columns`);
        }

        const theme = normalizeComponentId(row[themeIdx].trim());
        const description = row[descIdx].trim();

        if (!theme || !description) {
            throw new Error(`CSV seed file ${filePath} row ${i + 1} has empty theme or description`);
        }

        // Parse hints (comma-separated in CSV)
        let hints: string[] = [];
        if (hintsIdx !== -1 && row[hintsIdx]) {
            hints = row[hintsIdx]
                .split(',')
                .map(h => h.trim())
                .filter(h => h.length > 0);
        }

        if (hints.length === 0) {
            hints = [theme];
        }

        seeds.push({
            theme,
            description,
            hints,
        });
    }

    return seeds;
}

/**
 * Parse a CSV line, handling quoted fields with commas.
 */
function parseCsvLine(line: string): string[] {
    const fields: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        const nextChar = line[i + 1];

        if (char === '"') {
            if (inQuotes && nextChar === '"') {
                // Escaped quote
                current += '"';
                i++; // Skip next quote
            } else {
                // Toggle quote state
                inQuotes = !inQuotes;
            }
        } else if (char === ',' && !inQuotes) {
            // Field separator
            fields.push(current);
            current = '';
        } else {
            current += char;
        }
    }

    // Add last field
    fields.push(current);

    return fields;
}
