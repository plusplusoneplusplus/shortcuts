/**
 * Seeds Phase — Seed File Parser
 *
 * Parses seed files in JSON or CSV format into TopicSeed arrays.
 * Supports both SeedsOutput JSON format and CSV with topic,description,hints columns.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as fs from 'fs';
import * as path from 'path';
import type { TopicSeed, SeedsOutput } from '../types';
import { normalizeComponentId } from '../schemas';
import { getErrorMessage } from '../utils/error-utils';

// ============================================================================
// Seed File Parsing
// ============================================================================

/**
 * Parse a seed file (JSON or CSV) into an array of TopicSeed objects.
 *
 * @param filePath - Path to the seed file
 * @returns Array of TopicSeed objects
 * @throws Error if file doesn't exist, is empty, or has invalid format
 */
export function parseSeedFile(filePath: string): TopicSeed[] {
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

    // Detect format by extension or content
    const ext = path.extname(absolutePath).toLowerCase();
    if (ext === '.json' || content.trim().startsWith('{')) {
        return parseJsonSeedFile(content, absolutePath);
    } else if (ext === '.csv' || content.includes(',')) {
        return parseCsvSeedFile(content, absolutePath);
    } else {
        // Try JSON first, fall back to CSV
        try {
            return parseJsonSeedFile(content, absolutePath);
        } catch {
            return parseCsvSeedFile(content, absolutePath);
        }
    }
}

// ============================================================================
// JSON Parsing
// ============================================================================

/**
 * Parse a JSON seed file (SeedsOutput format).
 */
function parseJsonSeedFile(content: string, filePath: string): TopicSeed[] {
    let parsed: unknown;
    try {
        parsed = JSON.parse(content);
    } catch (error) {
        throw new Error(`Invalid JSON in seed file ${filePath}: ${getErrorMessage(error)}`);
    }

    if (typeof parsed !== 'object' || parsed === null) {
        throw new Error(`Seed file ${filePath} does not contain a JSON object`);
    }

    const obj = parsed as Record<string, unknown>;

    // Check if it's a SeedsOutput format (has topics array)
    if ('topics' in obj && Array.isArray(obj.topics)) {
        return parseTopicsArray(obj.topics, filePath);
    }

    // Otherwise, assume it's a direct array of topics
    if (Array.isArray(parsed)) {
        return parseTopicsArray(parsed, filePath);
    }

    throw new Error(`Seed file ${filePath} must contain a 'topics' array or be an array of topics`);
}

/**
 * Parse an array of topic objects into TopicSeed array.
 */
function parseTopicsArray(raw: unknown[], filePath: string): TopicSeed[] {
    const seeds: TopicSeed[] = [];

    for (let i = 0; i < raw.length; i++) {
        const item = raw[i];
        if (typeof item !== 'object' || item === null) {
            throw new Error(`Invalid topic at index ${i} in ${filePath}: not an object`);
        }

        const obj = item as Record<string, unknown>;

        // Validate required fields
        if (typeof obj.topic !== 'string' || !obj.topic) {
            throw new Error(`Invalid topic at index ${i} in ${filePath}: missing or invalid 'topic' field`);
        }

        if (typeof obj.description !== 'string' || !obj.description) {
            throw new Error(`Invalid topic at index ${i} in ${filePath}: missing or invalid 'description' field`);
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
            hints = [normalizeComponentId(String(obj.topic))];
        }

        if (hints.length === 0) {
            hints = [normalizeComponentId(String(obj.topic))];
        }

        seeds.push({
            topic: normalizeComponentId(String(obj.topic)),
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
 * Parse a CSV seed file with columns: topic,description,hints
 */
function parseCsvSeedFile(content: string, filePath: string): TopicSeed[] {
    const lines = content.split('\n').map(line => line.trim()).filter(line => line.length > 0);

    if (lines.length === 0) {
        throw new Error(`CSV seed file ${filePath} is empty`);
    }

    // Parse header
    const headerLine = lines[0];
    const headers = parseCsvLine(headerLine);

    // Find column indices
    const topicIdx = headers.findIndex(h => h.toLowerCase() === 'topic');
    const descIdx = headers.findIndex(h => h.toLowerCase() === 'description' || h.toLowerCase() === 'desc');
    const hintsIdx = headers.findIndex(h => h.toLowerCase() === 'hints' || h.toLowerCase() === 'hint');

    if (topicIdx === -1) {
        throw new Error(`CSV seed file ${filePath} missing 'topic' column`);
    }
    if (descIdx === -1) {
        throw new Error(`CSV seed file ${filePath} missing 'description' column`);
    }

    // Parse data rows
    const seeds: TopicSeed[] = [];
    for (let i = 1; i < lines.length; i++) {
        const row = parseCsvLine(lines[i]);

        if (row.length <= Math.max(topicIdx, descIdx)) {
            throw new Error(`CSV seed file ${filePath} row ${i + 1} has insufficient columns`);
        }

        const topic = normalizeComponentId(row[topicIdx].trim());
        const description = row[descIdx].trim();

        if (!topic || !description) {
            throw new Error(`CSV seed file ${filePath} row ${i + 1} has empty topic or description`);
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
            hints = [topic];
        }

        seeds.push({
            topic,
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
