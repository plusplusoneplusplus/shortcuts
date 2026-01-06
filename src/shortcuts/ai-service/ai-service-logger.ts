/**
 * AIServiceLogger - Backward compatibility module
 * 
 * This module re-exports the shared ExtensionLogger with AI-specific aliases
 * for backward compatibility. New code should use the shared logger directly:
 * 
 *   import { getExtensionLogger, LogCategory } from '../shared';
 *   const logger = getExtensionLogger();
 *   logger.info(LogCategory.AI, 'message');
 * 
 * @deprecated Use shared/extension-logger.ts instead
 */

// Re-export everything from the shared logger with backward-compatible names
export {
    AILogLevel,
    AIServiceLogger,
    getAIServiceLogger,
    LogLevel,
    ExtensionLogger,
    getExtensionLogger,
    LogCategory
} from '../shared/extension-logger';

export type { LogEntry as AILogEntry } from '../shared/extension-logger';

