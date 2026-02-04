/**
 * CSV Reader
 *
 * Parses CSV files into pipeline items. Handles various CSV formats
 * and edge cases like quoted values, escaped characters, etc.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as fs from 'fs';
import * as path from 'path';
import { CSVParseOptions, CSVParseResult, PromptItem } from './types';
import {
    DEFAULT_CSV_DELIMITER,
    DEFAULT_CSV_HAS_HEADER
} from '../config/defaults';

/**
 * Default CSV parsing options
 */
export const DEFAULT_CSV_OPTIONS: Required<CSVParseOptions> = {
    delimiter: DEFAULT_CSV_DELIMITER,
    hasHeaders: DEFAULT_CSV_HAS_HEADER,
    encoding: 'utf-8'
};

/**
 * Error thrown for CSV parsing issues
 */
export class CSVParseError extends Error {
    constructor(
        message: string,
        public readonly lineNumber?: number,
        public readonly columnIndex?: number
    ) {
        super(message);
        this.name = 'CSVParseError';
    }
}

/**
 * Parse a CSV string into an array of pipeline items
 * @param content CSV content as string
 * @param options Parsing options
 * @returns Parsed CSV result with items and headers
 */
export function parseCSVContent(content: string, options?: CSVParseOptions): CSVParseResult {
    // Filter out undefined values from options before merging
    const filteredOptions = options ? Object.fromEntries(
        Object.entries(options).filter(([, v]) => v !== undefined)
    ) as CSVParseOptions : undefined;

    const opts = { ...DEFAULT_CSV_OPTIONS, ...filteredOptions };

    // Normalize line endings
    const normalizedContent = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

    // Parse into rows
    const rows = parseCSVRows(normalizedContent, opts.delimiter);

    if (rows.length === 0) {
        return {
            items: [],
            headers: [],
            rowCount: 0
        };
    }

    let headers: string[];
    let dataRows: string[][];

    if (opts.hasHeaders) {
        headers = rows[0].map(h => h.trim());
        dataRows = rows.slice(1);
    } else {
        // Generate default headers (col0, col1, etc.)
        const numCols = rows[0].length;
        headers = Array.from({ length: numCols }, (_, i) => `col${i}`);
        dataRows = rows;
    }

    // Validate headers are unique
    const headerSet = new Set<string>();
    for (const header of headers) {
        if (headerSet.has(header)) {
            throw new CSVParseError(`Duplicate header: "${header}"`);
        }
        headerSet.add(header);
    }

    // Convert rows to items
    const items: PromptItem[] = dataRows.map((row, rowIndex) => {
        const item: PromptItem = {};
        for (let i = 0; i < headers.length; i++) {
            item[headers[i]] = row[i] !== undefined ? row[i] : '';
        }
        return item;
    });

    return {
        items,
        headers,
        rowCount: items.length
    };
}

/**
 * Parse CSV content into rows (array of arrays)
 * Handles quoted values, escaped quotes, and multi-line values
 */
function parseCSVRows(content: string, delimiter: string): string[][] {
    const rows: string[][] = [];
    let currentRow: string[] = [];
    let currentCell = '';
    let inQuotes = false;
    let i = 0;

    while (i < content.length) {
        const char = content[i];
        const nextChar = content[i + 1];

        if (inQuotes) {
            if (char === '"') {
                if (nextChar === '"') {
                    // Escaped quote ""
                    currentCell += '"';
                    i += 2;
                } else {
                    // End of quoted field
                    inQuotes = false;
                    i++;
                }
            } else {
                // Character inside quotes (including newlines)
                currentCell += char;
                i++;
            }
        } else {
            if (char === '"') {
                // Start of quoted field
                inQuotes = true;
                i++;
            } else if (char === delimiter) {
                // End of cell
                currentRow.push(currentCell);
                currentCell = '';
                i++;
            } else if (char === '\n') {
                // End of row
                currentRow.push(currentCell);
                if (currentRow.length > 0 || currentRow.some(c => c.length > 0)) {
                    rows.push(currentRow);
                }
                currentRow = [];
                currentCell = '';
                i++;
            } else {
                currentCell += char;
                i++;
            }
        }
    }

    // Don't forget the last cell/row
    if (currentCell.length > 0 || currentRow.length > 0) {
        currentRow.push(currentCell);
        if (currentRow.length > 0) {
            rows.push(currentRow);
        }
    }

    return rows;
}

/**
 * Read and parse a CSV file
 * @param filePath Path to CSV file
 * @param options Parsing options
 * @returns Parsed CSV result
 */
export async function readCSVFile(
    filePath: string,
    options?: CSVParseOptions
): Promise<CSVParseResult> {
    // Filter out undefined values from options before merging
    const filteredOptions = options ? Object.fromEntries(
        Object.entries(options).filter(([, v]) => v !== undefined)
    ) as CSVParseOptions : undefined;

    const opts = { ...DEFAULT_CSV_OPTIONS, ...filteredOptions };

    try {
        const content = await fs.promises.readFile(filePath, { encoding: opts.encoding });
        return parseCSVContent(content, opts);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            throw new CSVParseError(`CSV file not found: ${filePath}`);
        }
        throw error;
    }
}

/**
 * Read and parse a CSV file synchronously
 * @param filePath Path to CSV file
 * @param options Parsing options
 * @returns Parsed CSV result
 */
export function readCSVFileSync(
    filePath: string,
    options?: CSVParseOptions
): CSVParseResult {
    // Filter out undefined values from options before merging
    const filteredOptions = options ? Object.fromEntries(
        Object.entries(options).filter(([, v]) => v !== undefined)
    ) as CSVParseOptions : undefined;

    const opts = { ...DEFAULT_CSV_OPTIONS, ...filteredOptions };

    try {
        const content = fs.readFileSync(filePath, { encoding: opts.encoding });
        return parseCSVContent(content, opts);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            throw new CSVParseError(`CSV file not found: ${filePath}`);
        }
        throw error;
    }
}

/**
 * Resolve a CSV file path relative to a base directory.
 * For pipeline packages, this should be the package directory (where pipeline.yaml lives).
 * 
 * @param csvPath Path from config (may be relative)
 * @param baseDirectory Base directory for resolution (typically the pipeline package directory)
 * @returns Absolute file path
 * 
 * @example
 * // Given packageDir = '/workspace/.vscode/pipelines/run-tests'
 * resolveCSVPath('input.csv', packageDir) // => '/workspace/.vscode/pipelines/run-tests/input.csv'
 * resolveCSVPath('data/files.csv', packageDir) // => '/workspace/.vscode/pipelines/run-tests/data/files.csv'
 * resolveCSVPath('../shared/common.csv', packageDir) // => '/workspace/.vscode/pipelines/shared/common.csv'
 * resolveCSVPath('/absolute/path.csv', packageDir) // => '/absolute/path.csv'
 */
export function resolveCSVPath(csvPath: string, baseDirectory: string): string {
    if (path.isAbsolute(csvPath)) {
        return csvPath;
    }
    return path.resolve(baseDirectory, csvPath);
}

/**
 * Validate CSV headers against expected columns
 * @param headers Actual headers from CSV
 * @param expectedColumns Expected column names
 * @returns Object with validation result and missing columns
 */
export function validateCSVHeaders(
    headers: string[],
    expectedColumns: string[]
): { valid: boolean; missingColumns: string[] } {
    const headerSet = new Set(headers);
    const missingColumns = expectedColumns.filter(col => !headerSet.has(col));

    return {
        valid: missingColumns.length === 0,
        missingColumns
    };
}

/**
 * Get a preview of CSV data (first N rows)
 * @param result CSV parse result
 * @param maxRows Maximum rows to preview (default: 5)
 * @returns Preview items
 */
export function getCSVPreview(
    result: CSVParseResult,
    maxRows: number = 5
): PromptItem[] {
    return result.items.slice(0, maxRows);
}
