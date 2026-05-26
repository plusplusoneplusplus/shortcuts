/**
 * Memory Safety Scanner
 *
 * Stateless functions that scan memory content for security threats before
 * any fact or episode is persisted.  Extended from the forge implementation
 * with additional credential-detection patterns required by AC-07.
 *
 * All functions are pure — no side effects, no I/O.
 */

// ---------------------------------------------------------------------------
// Threat pattern ID union
// ---------------------------------------------------------------------------

export type ThreatPatternId =
    // Prompt injection
    | 'prompt_injection'
    | 'role_hijack'
    | 'deception_hide'
    | 'sys_prompt_override'
    | 'disregard_rules'
    | 'bypass_restrictions'
    // Exfiltration
    | 'exfil_curl'
    | 'exfil_wget'
    | 'read_secrets'
    // Persistence / SSH
    | 'ssh_backdoor'
    | 'ssh_access'
    | 'hermes_env'
    | 'coc_env'
    // Credentials
    | 'api_key_pattern'
    | 'token_pattern'
    | 'password_pattern'
    | 'connection_string'
    // Invisible Unicode
    | 'invisible_unicode';

// ---------------------------------------------------------------------------
// Scan result
// ---------------------------------------------------------------------------

export interface MemoryScanResult {
    blocked: boolean;
    /** null when not blocked */
    reason: string | null;
    /** The matched pattern id, null when not blocked */
    patternId: ThreatPatternId | null;
}

// ---------------------------------------------------------------------------
// Threat patterns
// ---------------------------------------------------------------------------

const THREAT_PATTERNS: Array<{ pattern: RegExp; id: ThreatPatternId }> = [
    // Prompt injection
    { pattern: /ignore\s+(previous|all|above|prior)\s+instructions/i, id: 'prompt_injection' },
    { pattern: /you\s+are\s+now\s+/i, id: 'role_hijack' },
    { pattern: /do\s+not\s+tell\s+the\s+user/i, id: 'deception_hide' },
    { pattern: /system\s+prompt\s+override/i, id: 'sys_prompt_override' },
    { pattern: /disregard\s+(your|all|any)\s+(instructions|rules|guidelines)/i, id: 'disregard_rules' },
    {
        pattern: /act\s+as\s+(if|though)\s+you\s+(have\s+no|don't\s+have)\s+(restrictions|limits|rules)/i,
        id: 'bypass_restrictions',
    },
    // Exfiltration
    { pattern: /curl\s+[^\n]*\$\{?\w*(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|API)/i, id: 'exfil_curl' },
    { pattern: /wget\s+[^\n]*\$\{?\w*(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|API)/i, id: 'exfil_wget' },
    { pattern: /cat\s+[^\n]*(\.env|credentials|\.netrc|\.pgpass|\.npmrc|\.pypirc)/i, id: 'read_secrets' },
    // Persistence
    { pattern: /authorized_keys/i, id: 'ssh_backdoor' },
    { pattern: /\$HOME\/\.ssh|~\/\.ssh/i, id: 'ssh_access' },
    { pattern: /\$HOME\/\.hermes\/\.env|~\/\.hermes\/\.env/i, id: 'hermes_env' },
    { pattern: /\$HOME\/\.coc\/\.env|~\/\.coc\/\.env/i, id: 'coc_env' },
    // Credential patterns (raw secrets)
    {
        // Matches common API key patterns: sk-..., ghp_..., xoxb-..., etc.
        pattern: /\b(sk-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{36,}|xoxb-[0-9A-Za-z-]{40,}|AIza[0-9A-Za-z-_]{35})\b/,
        id: 'api_key_pattern',
    },
    {
        // Bearer/Basic token literals
        pattern: /\b(Bearer|Basic)\s+[A-Za-z0-9+/]{20,}={0,2}\b/i,
        id: 'token_pattern',
    },
    {
        // Password=... or password: '...' style assignments
        pattern: /\b(password|passwd|pwd)\s*[:=]\s*['"]?[^\s'"]{8,}/i,
        id: 'password_pattern',
    },
    {
        // JDBC/ODBC/MongoDB connection strings that embed credentials
        pattern: /(jdbc:|mongodb(\+srv)?:|postgresql:|mysql:\/\/)[^\s]*:[^\s@]+@/i,
        id: 'connection_string',
    },
];

/** Invisible Unicode characters that could be used for prompt injection */
const INVISIBLE_CHARS = new Set([
    '\u200b', '\u200c', '\u200d', '\u2060', '\ufeff',
    '\u202a', '\u202b', '\u202c', '\u202d', '\u202e',
]);

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Scan content for injection, exfiltration, credential, and invisible-Unicode
 * threats.  Returns a result with `blocked: true` on the first match found.
 *
 * Pure function — no side effects.
 */
export function scanMemoryContent(content: string): MemoryScanResult {
    for (const char of content) {
        if (INVISIBLE_CHARS.has(char)) {
            return {
                blocked: true,
                reason: `Content contains invisible Unicode character (U+${char
                    .codePointAt(0)!
                    .toString(16)
                    .toUpperCase()
                    .padStart(4, '0')}).`,
                patternId: 'invisible_unicode',
            };
        }
    }

    for (const { pattern, id } of THREAT_PATTERNS) {
        if (pattern.test(content)) {
            return {
                blocked: true,
                reason: `Content matches security threat pattern: ${id}.`,
                patternId: id,
            };
        }
    }

    return { blocked: false, reason: null, patternId: null };
}

/**
 * Attempt to redact sensitive-looking values while preserving context.
 * Returns the redacted string and a boolean indicating whether anything was
 * redacted.  Used before placing a low-confidence candidate in the review
 * queue so the reviewer sees context without raw secrets.
 */
export function redactSensitiveValues(content: string): { redacted: string; changed: boolean } {
    const REDACT_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
        {
            pattern: /\b(sk-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{36,}|xoxb-[0-9A-Za-z-]{40,}|AIza[0-9A-Za-z-_]{35})\b/g,
            replacement: '[REDACTED_API_KEY]',
        },
        {
            pattern: /\b(Bearer|Basic)\s+[A-Za-z0-9+/]{20,}={0,2}\b/gi,
            replacement: '[REDACTED_TOKEN]',
        },
        {
            pattern: /(\b(password|passwd|pwd)\s*[:=]\s*['"]?)[^\s'"]{8,}/gi,
            replacement: '$1[REDACTED_PASSWORD]',
        },
        {
            pattern: /((jdbc:|mongodb(\+srv)?:|postgresql:|mysql:\/\/)[^\s]*:)[^\s@]+(@)/gi,
            replacement: '$1[REDACTED_PASSWORD]$4',
        },
    ];

    let redacted = content;
    let changed = false;
    for (const { pattern, replacement } of REDACT_PATTERNS) {
        const next = redacted.replace(pattern, replacement);
        if (next !== redacted) {
            changed = true;
            redacted = next;
        }
    }
    return { redacted, changed };
}

/**
 * Human-readable description of all blocked security patterns.
 * Exported for display in the admin dashboard.
 */
export const SECURITY_PATTERNS_DESCRIPTION =
    'The memory safety scanner blocks content matching these threat patterns:\n\n'
    + '**Prompt Injection:**\n'
    + '- "ignore previous/all/above/prior instructions"\n'
    + '- "you are now ..." (role hijacking)\n'
    + '- "do not tell the user" (deception)\n'
    + '- "system prompt override"\n'
    + '- "disregard your/all/any instructions/rules/guidelines"\n'
    + '- "act as if you have no restrictions/limits/rules" (bypass)\n\n'
    + '**Exfiltration:**\n'
    + '- curl/wget commands referencing KEY, TOKEN, SECRET, PASSWORD, CREDENTIAL, or API variables\n'
    + '- cat commands targeting .env, credentials, .netrc, .pgpass, .npmrc, .pypirc\n\n'
    + '**Persistence:**\n'
    + '- References to authorized_keys (SSH backdoor)\n'
    + '- References to $HOME/.ssh or ~/.ssh\n'
    + '- References to $HOME/.hermes/.env or ~/.hermes/.env\n'
    + '- References to $HOME/.coc/.env or ~/.coc/.env\n\n'
    + '**Credentials:**\n'
    + '- API key literals (sk-..., ghp_..., xoxb-..., AIza...)\n'
    + '- Bearer/Basic token literals\n'
    + '- password= or password: assignments with a non-trivial value\n'
    + '- Connection strings embedding credentials (JDBC, MongoDB, PostgreSQL, MySQL)\n\n'
    + '**Invisible Unicode:**\n'
    + '- Zero-width characters (U+200B, U+200C, U+200D, U+2060, U+FEFF)\n'
    + '- Bidirectional override characters (U+202A–U+202E)';
