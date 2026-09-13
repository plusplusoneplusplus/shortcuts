/**
 * Default AI request timeouts for provider SDK sessions.
 *
 * These live in their own module because both {@link RequestRunner} and the
 * provider services need them, and `@plusplusoneplusplus/forge` (which carries
 * the matching constants for pipelines and queue tasks) depends on this
 * package, so the value cannot be imported from there.
 */

/**
 * Default wall-clock cap for a single AI request (8 hours).
 *
 * This is a hard cap: when it fires the session is force-disconnected and the
 * request rejects, regardless of how much progress the agent was making. Long
 * autonomous loops that run inside one request are bounded by this value.
 */
export const DEFAULT_AI_TIMEOUT_MS = 8 * 60 * 60 * 1000; // 8 hours

/**
 * Default idle timeout for a single AI request (1 hour).
 *
 * Resets on each streaming event, and is suppressed while a tool call is in
 * flight. Independent of {@link DEFAULT_AI_TIMEOUT_MS} — whichever fires first
 * ends the session.
 */
export const DEFAULT_AI_IDLE_TIMEOUT_MS = 60 * 60 * 1000; // 1 hour
