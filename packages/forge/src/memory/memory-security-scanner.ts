/**
 * MemorySecurityScanner — stateless functions for scanning memory content
 * against injection/exfiltration threat patterns and invisible Unicode.
 *
 * Ported from Hermes Agent's _scan_memory_content and _MEMORY_THREAT_PATTERNS.
 */
import type { MemoryScanResult, ThreatPatternId } from './bounded-memory-types';

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
