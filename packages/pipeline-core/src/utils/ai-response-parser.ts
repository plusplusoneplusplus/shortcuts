/**
 * AI Response Parser - Shared Utilities
 * 
 * Comprehensive edge case handling for parsing AI responses into structured data.
 * Handles JSON in various formats, malformed responses, and natural language fallbacks.
 * 
 * Used by both yaml-pipeline and map-reduce jobs.
 */

/**
 * Configuration for bracket matching operations
 */
interface BracketConfig {
    open: string;   // Opening bracket character: '{' or '['
    close: string;  // Closing bracket character: '}' or ']'
    name: string;   // Type name for error messages: 'object' or 'array'
}

/** Configuration for JSON object extraction */
const OBJECT_BRACKET_CONFIG: BracketConfig = { open: '{', close: '}', name: 'object' };

/** Configuration for JSON array extraction */
const ARRAY_BRACKET_CONFIG: BracketConfig = { open: '[', close: ']', name: 'array' };

/**
 * Check if a string has balanced brackets for the given configuration
 */
function hasBalanced(str: string, config: BracketConfig): boolean {
    let depth = 0;
    for (const char of str) {
        if (char === config.open) depth++;
        else if (char === config.close) depth--;
        if (depth < 0) return false;
    }
    return depth === 0;
}

/**
 * Find all matching bracket positions for the given configuration
 */
function findAllBracketPositions(str: string, config: BracketConfig): Array<{start: number, end: number}> {
    const positions: Array<{start: number, end: number}> = [];
    let depth = 0;
    let start = -1;

    for (let i = 0; i < str.length; i++) {
        if (str[i] === config.open) {
            if (depth === 0) start = i;
            depth++;
        } else if (str[i] === config.close) {
            depth--;
            if (depth === 0 && start !== -1) {
                positions.push({ start, end: i });
                start = -1;
            }
        }
    }
    return positions;
}

/**
 * Try to extract a JSON structure (object or array) from text
 * @param text Text to search in
 * @param config Bracket configuration
 * @param additionalValidation Optional additional validation (e.g., objects must contain ':')
 */
function tryExtractStructure(
    text: string,
    config: BracketConfig,
    additionalValidation?: (candidate: string) => boolean
): string | null {
    const pattern = new RegExp(`\\${config.open}[\\s\\S]*\\${config.close}`);
    const match = text.match(pattern);
    if (match) {
        const candidate = match[0];
        try {
            JSON.parse(candidate);
            return candidate;
        } catch {
            // Try to find valid JSON by checking all bracket pairs
            const positions = findAllBracketPositions(text, config);
            for (let i = positions.length - 1; i >= 0; i--) {
                const {start, end} = positions[i];
                const subCandidate = text.substring(start, end + 1);
                try {
                    JSON.parse(subCandidate);
                    return subCandidate;
                } catch {
                    continue;
                }
            }
            // Return candidate if balanced (and passes additional validation if provided)
            if (hasBalanced(candidate, config) && (!additionalValidation || additionalValidation(candidate))) {
                return candidate;
            }
        }
    }
    return null;
}

/**
 * Extract JSON from a response string with comprehensive edge case handling
 * Handles JSON in markdown code blocks, inline, malformed responses, and various AI quirks
 * @param response Response string from AI
 * @returns Extracted JSON string or null if no valid JSON found
 */
export function extractJSON(response: string): string | null {
    if (!response || typeof response !== 'string') {
        return null;
    }

    response = response.trim();

    // Try markdown code block first (with various language tags)
    const codeBlockPatterns = [
        /```json\s*([\s\S]*?)```/,
        /```javascript\s*([\s\S]*?)```/,
        /```js\s*([\s\S]*?)```/,
        /```\s*([\s\S]*?)```/
    ];

    for (const pattern of codeBlockPatterns) {
        const match = response.match(pattern);
        if (match) {
            const extracted = match[1].trim();
            if (extracted && (extracted.startsWith('{') || extracted.startsWith('['))) {
                return extracted;
            }
        }
    }

    // Find first occurrence of { and [ to determine which type to try first
    const firstBrace = response.indexOf('{');
    const firstBracket = response.indexOf('[');

    // Object extraction requires colon to look like JSON
    const tryExtractObject = () => tryExtractStructure(response, OBJECT_BRACKET_CONFIG, c => c.includes(':'));
    const tryExtractArray = () => tryExtractStructure(response, ARRAY_BRACKET_CONFIG);

    // Try to extract based on which comes first in the string
    // This ensures that top-level arrays are detected before embedded arrays in objects
    if (firstBracket !== -1 && (firstBrace === -1 || firstBracket < firstBrace)) {
        // Array appears first - try array then object
        const arrayResult = tryExtractArray();
        if (arrayResult) return arrayResult;
        const objectResult = tryExtractObject();
        if (objectResult) return objectResult;
    } else if (firstBrace !== -1) {
        // Object appears first - try object then array
        const objectResult = tryExtractObject();
        if (objectResult) return objectResult;
        const arrayResult = tryExtractArray();
        if (arrayResult) return arrayResult;
    }

    // Try to extract key-value pairs from plain text
    const kvPairs = extractKeyValuePairs(response);
    if (kvPairs) {
        return kvPairs;
    }

    return null;
}

/**
 * Parse AI response and extract only the declared output fields
 * Includes comprehensive error recovery, type coercion, and natural language fallback
 * @param response AI response string
 * @param outputFields Expected field names
 * @returns Object with extracted fields (missing fields become null)
 */
export function parseAIResponse(
    response: string,
    outputFields: string[]
): Record<string, unknown> {
    const jsonStr = extractJSON(response);
    
    if (!jsonStr) {
        // Last resort: extract from natural language
        const extracted = extractFieldsFromNaturalLanguage(response, outputFields);
        if (extracted) {
            return extracted;
        }
        throw new Error('No JSON found in AI response');
    }

    let parsed: Record<string, unknown>;
    try {
        parsed = JSON.parse(jsonStr);
    } catch {
        // Try to fix common JSON errors
        const fixed = attemptJSONFix(jsonStr);
        if (fixed) {
            try {
                parsed = JSON.parse(fixed);
            } catch {
                throw new Error(`Invalid JSON in AI response: ${jsonStr.substring(0, 100)}...`);
            }
        } else {
            throw new Error(`Invalid JSON in AI response: ${jsonStr.substring(0, 100)}...`);
        }
    }

    // Handle array responses
    if (Array.isArray(parsed)) {
        if (parsed.length === 1 && typeof parsed[0] === 'object' && parsed[0] !== null) {
            parsed = parsed[0] as Record<string, unknown>;
        } else {
            const obj: Record<string, unknown> = {};
            let reconstructed = false;
            for (const item of parsed) {
                if (typeof item === 'object' && item !== null) {
                    if ('field' in item && 'value' in item) {
                        obj[String(item.field)] = item.value;
                        reconstructed = true;
                    } else if ('key' in item && 'value' in item) {
                        obj[String(item.key)] = item.value;
                        reconstructed = true;
                    }
                }
            }
            if (reconstructed) {
                parsed = obj;
            } else {
                throw new Error('AI returned array instead of object');
            }
        }
    }

    // Extract fields with case-insensitive matching
    const result: Record<string, unknown> = {};
    for (const field of outputFields) {
        if (field in parsed) {
            result[field] = coerceValue(parsed[field]);
        } else {
            const lowerField = field.toLowerCase();
            const matchingKey = Object.keys(parsed).find(k => k.toLowerCase() === lowerField);
            if (matchingKey) {
                result[field] = coerceValue(parsed[matchingKey]);
            } else {
                result[field] = null;
            }
        }
    }
    return result;
}

/**
 * Extract key-value pairs from plain text response and convert to JSON
 * Handles cases where AI returns "field: value" format instead of JSON
 */
function extractKeyValuePairs(response: string): string | null {
    const lines = response.split('\n');
    const kvPairs: Record<string, string> = {};
    let foundAny = false;

    for (const line of lines) {
        const kvMatch = line.match(/^\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*[:=\-]\s*(.+?)\s*$/);
        if (kvMatch) {
            const key = kvMatch[1].trim();
            let value = kvMatch[2].trim().replace(/[,;]$/, '');
            if ((value.startsWith('"') && value.endsWith('"')) || 
                (value.startsWith("'") && value.endsWith("'"))) {
                value = value.slice(1, -1);
            }
            kvPairs[key] = value;
            foundAny = true;
        }
    }

    return foundAny ? JSON.stringify(kvPairs) : null;
}

/**
 * Attempt to fix common JSON formatting errors
 */
function attemptJSONFix(jsonStr: string): string | null {
    try {
        let fixed = jsonStr.replace(/'/g, '"');
        fixed = fixed.replace(/([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g, '$1"$2":');
        fixed = fixed.replace(/,(\s*[}\]])/g, '$1');
        fixed = fixed.replace(/"\s*\n\s*"/g, '",\n"');
        JSON.parse(fixed);
        return fixed;
    } catch {
        return null;
    }
}

/**
 * Coerce values to appropriate types (convert strings to numbers/booleans where obvious)
 */
function coerceValue(value: unknown): unknown {
    if (value === null || value === undefined) return null;
    if (typeof value !== 'string') return value;
    
    const str = (value as string).toLowerCase().trim();
    
    if (str === 'true' || str === 'yes') return true;
    if (str === 'false' || str === 'no') return false;
    if (str === 'null' || str === 'none' || str === 'n/a' || str === '') return null;
    
    if (/^-?\d+\.?\d*$/.test(str)) {
        const num = parseFloat(str);
        if (!isNaN(num)) return num;
    }
    
    return value;
}

/**
 * Extract field values from natural language response (last resort)
 * Handles cases where AI completely ignores JSON format instruction
 */
function extractFieldsFromNaturalLanguage(response: string, outputFields: string[]): Record<string, unknown> | null {
    const result: Record<string, unknown> = {};
    let foundAny = false;

    for (const field of outputFields) {
        // Patterns ordered from most specific to least specific
        // Use word boundary or limited capture to avoid over-matching
        // Note: Using (?:\n|$) to match end of line OR end of string
        const patterns = [
            // Quoted value after colon/equals: field: "value" or field = 'value'
            new RegExp(`${field}\\s*[:=]\\s*["']([^"']+)["']`, 'i'),
            // Markdown bold: **field**: value
            new RegExp(`\\*\\*${field}\\*\\*\\s*[:=]\\s*([^\\n,;]+?)(?:\\s+and\\s+|\\s*[,;]|\\s*\\n|\\s*$)`, 'i'),
            // field: value (stop at "and", comma, semicolon, newline, or end of string)
            new RegExp(`${field}\\s*[:=]\\s*([^\\n,;]+?)(?:\\s+and\\s+|\\s*[,;]|\\s*\\n|\\s*$)`, 'i'),
            // field is value (stop at "and", comma, period, newline, or end of string)
            new RegExp(`${field}\\s+is\\s+([^\\n,;.]+?)(?:\\s+and\\s+|\\s*[,;.]|\\s*\\n|\\s*$)`, 'i'),
            // field - value
            new RegExp(`${field}\\s*-\\s*([^\\n,;]+?)(?:\\s+and\\s+|\\s*[,;]|\\s*\\n|\\s*$)`, 'i'),
        ];

        for (const pattern of patterns) {
            const match = response.match(pattern);
            if (match) {
                let value = match[1].trim();
                // Clean up markdown formatting and quotes
                value = value.replace(/[*_`]/g, '').replace(/^["']|["']$/g, '');
                result[field] = coerceValue(value);
                foundAny = true;
                break;
            }
        }

        if (!(field in result)) {
            result[field] = null;
        }
    }

    return foundAny ? result : null;
}
