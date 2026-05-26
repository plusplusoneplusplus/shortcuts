/**
 * MemorySecurityScanner — stateless functions for scanning memory content
 * against injection/exfiltration threat patterns and invisible Unicode.
 *
 * Ported from Hermes Agent's _scan_memory_content and _MEMORY_THREAT_PATTERNS.
 */

export type ThreatPatternId =
    | 'prompt_injection'
    | 'role_hijack'
    | 'deception_hide'
    | 'sys_prompt_override'
    | 'disregard_rules'
    | 'bypass_restrictions'
    | 'exfil_curl'
    | 'exfil_wget'
    | 'read_secrets'
    | 'ssh_backdoor'
    | 'ssh_access'
    | 'hermes_env';

export interface MemoryScanResult {
    blocked: boolean;
    /** null if not blocked */
    reason: string | null;
    /** The matched pattern ID */
    patternId: ThreatPatternId | 'invisible_unicode' | null;
}

const THREAT_PATTERNS: Array<{ pattern: RegExp; id: ThreatPatternId }> = [
    // Prompt injection
    { pattern: /ignore\s+(previous|all|above|prior)\s+instructions/i, id: 'prompt_injection' },
    { pattern: /you\s+are\s+now\s+/i, id: 'role_hijack' },
    { pattern: /do\s+not\s+tell\s+the\s+user/i, id: 'deception_hide' },
    { pattern: /system\s+prompt\s+override/i, id: 'sys_prompt_override' },
    { pattern: /disregard\s+(your|all|any)\s+(instructions|rules|guidelines)/i, id: 'disregard_rules' },
    { pattern: /act\s+as\s+(if|though)\s+you\s+(have\s+no|don't\s+have)\s+(restrictions|limits|rules)/i, id: 'bypass_restrictions' },
    // Exfiltration
    { pattern: /curl\s+[^\n]*\$\{?\w*(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|API)/i, id: 'exfil_curl' },
    { pattern: /wget\s+[^\n]*\$\{?\w*(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|API)/i, id: 'exfil_wget' },
    { pattern: /cat\s+[^\n]*(\.env|credentials|\.netrc|\.pgpass|\.npmrc|\.pypirc)/i, id: 'read_secrets' },
    // Persistence
    { pattern: /authorized_keys/i, id: 'ssh_backdoor' },
    { pattern: /\$HOME\/\.ssh|~\/\.ssh/i, id: 'ssh_access' },
    { pattern: /\$HOME\/\.hermes\/\.env|~\/\.hermes\/\.env/i, id: 'hermes_env' },
];

/** Invisible Unicode characters that could be used for injection. */
const INVISIBLE_CHARS = new Set([
    '\u200b', '\u200c', '\u200d', '\u2060', '\ufeff',
    '\u202a', '\u202b', '\u202c', '\u202d', '\u202e',
]);

/**
 * Human-readable description of all blocked security patterns.
 * Exported for admin dashboard prompt inspection.
 */
export const SECURITY_PATTERNS_DESCRIPTION =
    'The memory security scanner blocks content matching these threat patterns:\n\n'
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
    + '- References to $HOME/.hermes/.env or ~/.hermes/.env\n\n'
    + '**Invisible Unicode:**\n'
    + '- Zero-width characters (U+200B, U+200C, U+200D, U+2060, U+FEFF)\n'
    + '- Bidirectional override characters (U+202A–U+202E)';

/** Scan content for injection/exfiltration threats. Pure function, no side effects. */
export function scanMemoryContent(content: string): MemoryScanResult {
    for (const char of content) {
        if (INVISIBLE_CHARS.has(char)) {
            return {
                blocked: true,
                reason: `Content contains invisible Unicode character (U+${char.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}).`,
                patternId: 'invisible_unicode',
            };
        }
    }

    for (const { pattern, id } of THREAT_PATTERNS) {
        if (pattern.test(content)) {
            return {
                blocked: true,
                reason: `Content matches threat pattern: ${id}.`,
                patternId: id,
            };
        }
    }

    return { blocked: false, reason: null, patternId: null };
}
