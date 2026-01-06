/**
 * Tests for ExtensionLogger - Shared logging framework for the Shortcuts extension
 * 
 * This is the centralized logging system used across all extension features.
 * 
 * Covers:
 * - Log levels (DEBUG, INFO, WARN, ERROR)
 * - Log categories (AI, Git, Config, Markdown, etc.)
 * - Category and level filtering
 * - Cross-platform compatibility (Windows, macOS, Linux)
 * - Error handling and stack traces
 * - Log history management
 * - Backward compatibility with AIServiceLogger
 */

import * as assert from 'assert';
import {
    LogLevel,
    ExtensionLogger,
    getExtensionLogger,
    LogCategory,
    // Backward compatibility aliases (deprecated)
    AILogLevel,
    AIServiceLogger,
    getAIServiceLogger
} from '../../shortcuts/shared/extension-logger';

suite('ExtensionLogger - Shared Logging Framework', () => {
    let logger: ExtensionLogger;

    setup(() => {
        // Get fresh logger instance and clear any previous state
        logger = getExtensionLogger();
        logger.clear();
    });

    teardown(() => {
        // Clean up logger state after each test
        logger.clear();
    });

    suite('Singleton Pattern', () => {
        test('should return the same instance on multiple calls', () => {
            const instance1 = getExtensionLogger();
            const instance2 = getExtensionLogger();
            assert.strictEqual(instance1, instance2, 'Should return same instance');
        });

        test('should return same instance from static method', () => {
            const instance1 = ExtensionLogger.getInstance();
            const instance2 = ExtensionLogger.getInstance();
            assert.strictEqual(instance1, instance2, 'Static method should return same instance');
        });

        test('should return same instance from both access methods', () => {
            const fromFunction = getExtensionLogger();
            const fromStatic = ExtensionLogger.getInstance();
            assert.strictEqual(fromFunction, fromStatic, 'Both methods should return same instance');
        });

        test('should return same instance from backward-compatible aliases', () => {
            const fromNew = getExtensionLogger();
            const fromOld = getAIServiceLogger();
            assert.strictEqual(fromNew, fromOld, 'Backward-compatible alias should return same instance');
        });
    });

    suite('Logging Methods', () => {
        test('should log debug messages with category', () => {
            logger.debug(LogCategory.AI, 'Test debug message');
            const logs = logger.getRecentLogs(1);
            assert.strictEqual(logs.length, 1);
            assert.strictEqual(logs[0].level, LogLevel.DEBUG);
            assert.strictEqual(logs[0].category, LogCategory.AI);
            assert.strictEqual(logs[0].message, 'Test debug message');
        });

        test('should log info messages with category', () => {
            logger.info(LogCategory.CONFIG, 'Test info message');
            const logs = logger.getRecentLogs(1);
            assert.strictEqual(logs.length, 1);
            assert.strictEqual(logs[0].level, LogLevel.INFO);
            assert.strictEqual(logs[0].category, LogCategory.CONFIG);
            assert.strictEqual(logs[0].message, 'Test info message');
        });

        test('should log warning messages with category', () => {
            logger.warn(LogCategory.GIT, 'Test warning message');
            const logs = logger.getRecentLogs(1);
            assert.strictEqual(logs.length, 1);
            assert.strictEqual(logs[0].level, LogLevel.WARN);
            assert.strictEqual(logs[0].category, LogCategory.GIT);
            assert.strictEqual(logs[0].message, 'Test warning message');
        });

        test('should log error messages with category', () => {
            logger.error(LogCategory.FILESYSTEM, 'Test error message');
            const logs = logger.getRecentLogs(1);
            assert.strictEqual(logs.length, 1);
            assert.strictEqual(logs[0].level, LogLevel.ERROR);
            assert.strictEqual(logs[0].category, LogCategory.FILESYSTEM);
            assert.strictEqual(logs[0].message, 'Test error message');
        });

        test('should log error with Error object', () => {
            const testError = new Error('Test error details');
            logger.error(LogCategory.AI, 'Test error message', testError);
            const logs = logger.getRecentLogs(1);
            assert.strictEqual(logs.length, 1);
            assert.strictEqual(logs[0].error, testError);
            assert.strictEqual(logs[0].error?.message, 'Test error details');
        });

        test('should log with context object', () => {
            logger.info(LogCategory.EXTENSION, 'Test with context', { key: 'value', num: 42 });
            const logs = logger.getRecentLogs(1);
            assert.strictEqual(logs.length, 1);
            assert.deepStrictEqual(logs[0].context, { key: 'value', num: 42 });
        });

        test('should accept custom category strings', () => {
            logger.info('CustomCategory', 'Test with custom category');
            const logs = logger.getRecentLogs(1);
            assert.strictEqual(logs.length, 1);
            assert.strictEqual(logs[0].category, 'CustomCategory');
        });
    });

    suite('AI Process Logging Methods (Convenience)', () => {
        test('should log process launch', () => {
            logger.logAIProcessLaunch('Test prompt content', '/workspace/src', 'copilot -p "test"');
            const logs = logger.getRecentLogs(1);
            assert.strictEqual(logs.length, 1);
            assert.strictEqual(logs[0].level, LogLevel.INFO);
            assert.strictEqual(logs[0].category, LogCategory.AI);
            assert.ok(logs[0].message.includes('Launching AI process'));
            assert.ok(logs[0].context?.workingDirectory === '/workspace/src');
        });

        test('should truncate long prompts in process launch log', () => {
            const longPrompt = 'x'.repeat(200);
            logger.logAIProcessLaunch(longPrompt, '/workspace');
            const logs = logger.getRecentLogs(1);
            const promptPreview = logs[0].context?.promptPreview as string;
            assert.ok(promptPreview.length <= 103); // 100 chars + '...'
        });

        test('should log process launch failure', () => {
            const error = new Error('Launch failed');
            logger.logAIProcessLaunchFailure('CLI not found', error, { path: '/usr/bin' });
            const logs = logger.getRecentLogs(1);
            assert.strictEqual(logs.length, 1);
            assert.strictEqual(logs[0].level, LogLevel.ERROR);
            assert.strictEqual(logs[0].category, LogCategory.AI);
            assert.ok(logs[0].message.includes('AI process launch failed'));
            assert.ok(logs[0].message.includes('CLI not found'));
            assert.strictEqual(logs[0].error, error);
        });

        test('should include platform info in process launch failure', () => {
            logger.logAIProcessLaunchFailure('Test failure');
            const logs = logger.getRecentLogs(1);
            assert.ok(logs[0].context?.platform === process.platform);
        });

        test('should log process completion - success', () => {
            logger.logAIProcessComplete('process-123', 5000, true);
            const logs = logger.getRecentLogs(1);
            assert.strictEqual(logs.length, 1);
            assert.strictEqual(logs[0].level, LogLevel.INFO);
            assert.strictEqual(logs[0].category, LogCategory.AI);
            assert.ok(logs[0].message.includes('completed'));
            assert.strictEqual(logs[0].context?.processId, 'process-123');
            assert.strictEqual(logs[0].context?.durationMs, 5000);
            assert.strictEqual(logs[0].context?.success, true);
        });

        test('should log process completion - failure', () => {
            logger.logAIProcessComplete('process-456', 3000, false);
            const logs = logger.getRecentLogs(1);
            assert.strictEqual(logs[0].level, LogLevel.WARN);
            assert.ok(logs[0].message.includes('failed'));
            assert.strictEqual(logs[0].context?.success, false);
        });

        test('should log process cancellation', () => {
            logger.logAIProcessCancelled('process-789', 'User cancelled');
            const logs = logger.getRecentLogs(1);
            assert.strictEqual(logs.length, 1);
            assert.strictEqual(logs[0].level, LogLevel.INFO);
            assert.strictEqual(logs[0].category, LogCategory.AI);
            assert.ok(logs[0].message.includes('cancelled'));
            assert.strictEqual(logs[0].context?.processId, 'process-789');
            assert.strictEqual(logs[0].context?.reason, 'User cancelled');
        });

        test('should log program check - found', () => {
            logger.logProgramCheck('copilot', true, '/usr/local/bin/copilot');
            const logs = logger.getRecentLogs(1);
            assert.strictEqual(logs.length, 1);
            assert.strictEqual(logs[0].level, LogLevel.DEBUG);
            assert.strictEqual(logs[0].category, LogCategory.AI);
            assert.ok(logs[0].message.includes('copilot'));
            assert.ok(logs[0].message.includes('found'));
        });

        test('should log program check - not found', () => {
            logger.logProgramCheck('copilot', false, undefined, 'Not installed');
            const logs = logger.getRecentLogs(1);
            assert.strictEqual(logs.length, 1);
            assert.strictEqual(logs[0].level, LogLevel.WARN);
            assert.strictEqual(logs[0].category, LogCategory.AI);
            assert.ok(logs[0].message.includes('copilot'));
            assert.ok(logs[0].message.includes('not found'));
        });
    });

    suite('Generic Operation Logging Methods', () => {
        test('should log operation start', () => {
            logger.logOperationStart(LogCategory.GIT, 'fetch commits', { branch: 'main' });
            const logs = logger.getRecentLogs(1);
            assert.strictEqual(logs.length, 1);
            assert.strictEqual(logs[0].level, LogLevel.INFO);
            assert.strictEqual(logs[0].category, LogCategory.GIT);
            assert.ok(logs[0].message.includes('Starting'));
            assert.ok(logs[0].message.includes('fetch commits'));
        });

        test('should log operation complete with duration', () => {
            logger.logOperationComplete(LogCategory.CONFIG, 'load configuration', 150, { source: 'workspace' });
            const logs = logger.getRecentLogs(1);
            assert.strictEqual(logs.length, 1);
            assert.strictEqual(logs[0].level, LogLevel.INFO);
            assert.strictEqual(logs[0].category, LogCategory.CONFIG);
            assert.ok(logs[0].message.includes('Completed'));
            assert.strictEqual(logs[0].context?.durationMs, 150);
        });

        test('should log operation failed with error', () => {
            const error = new Error('Connection timeout');
            logger.logOperationFailed(LogCategory.SYNC, 'sync settings', error, { provider: 'vscode' });
            const logs = logger.getRecentLogs(1);
            assert.strictEqual(logs.length, 1);
            assert.strictEqual(logs[0].level, LogLevel.ERROR);
            assert.strictEqual(logs[0].category, LogCategory.SYNC);
            assert.ok(logs[0].message.includes('Failed'));
            assert.strictEqual(logs[0].error, error);
            assert.ok(logs[0].context?.platform === process.platform);
        });
    });

    suite('Log History Management', () => {
        test('should retrieve recent logs', () => {
            logger.info(LogCategory.EXTENSION, 'Message 1');
            logger.info(LogCategory.EXTENSION, 'Message 2');
            logger.info(LogCategory.EXTENSION, 'Message 3');
            
            const logs = logger.getRecentLogs(2);
            assert.strictEqual(logs.length, 2);
            assert.strictEqual(logs[0].message, 'Message 2');
            assert.strictEqual(logs[1].message, 'Message 3');
        });

        test('should clear log history', () => {
            logger.info(LogCategory.EXTENSION, 'Test message');
            assert.strictEqual(logger.getRecentLogs().length, 1);
            
            logger.clear();
            assert.strictEqual(logger.getRecentLogs().length, 0);
        });

        test('should limit history size', () => {
            // Log more than max history size
            for (let i = 0; i < 1100; i++) {
                logger.debug(LogCategory.EXTENSION, `Message ${i}`);
            }
            
            const logs = logger.getRecentLogs(2000);
            assert.ok(logs.length <= 1000, 'History should be limited to max size');
        });

        test('should return default 50 logs when count not specified', () => {
            for (let i = 0; i < 100; i++) {
                logger.debug(LogCategory.EXTENSION, `Message ${i}`);
            }
            
            const logs = logger.getRecentLogs();
            assert.strictEqual(logs.length, 50);
        });

        test('should filter logs by category', () => {
            logger.info(LogCategory.AI, 'AI message');
            logger.info(LogCategory.GIT, 'Git message');
            logger.info(LogCategory.AI, 'Another AI message');
            
            const aiLogs = logger.getLogsByCategory(LogCategory.AI);
            assert.strictEqual(aiLogs.length, 2);
            assert.ok(aiLogs.every(log => log.category === LogCategory.AI));
        });

        test('should filter logs by level', () => {
            logger.debug(LogCategory.EXTENSION, 'Debug message');
            logger.info(LogCategory.EXTENSION, 'Info message');
            logger.warn(LogCategory.EXTENSION, 'Warn message');
            logger.error(LogCategory.EXTENSION, 'Error message');
            
            const errorLogs = logger.getLogsByLevel(LogLevel.ERROR);
            assert.strictEqual(errorLogs.length, 1);
            assert.strictEqual(errorLogs[0].level, LogLevel.ERROR);
        });
    });

    suite('Log Entry Structure', () => {
        test('should include timestamp in log entries', () => {
            const before = new Date();
            logger.info(LogCategory.EXTENSION, 'Test message');
            const after = new Date();
            
            const logs = logger.getRecentLogs(1);
            assert.ok(logs[0].timestamp >= before);
            assert.ok(logs[0].timestamp <= after);
        });

        test('should include all required fields', () => {
            logger.info(LogCategory.EXTENSION, 'Test message', { testKey: 'testValue' });
            
            const logs = logger.getRecentLogs(1);
            const entry = logs[0];
            
            assert.ok('level' in entry);
            assert.ok('category' in entry);
            assert.ok('message' in entry);
            assert.ok('timestamp' in entry);
            assert.ok('context' in entry);
        });

        test('should handle undefined context', () => {
            logger.info(LogCategory.EXTENSION, 'Test message');
            
            const logs = logger.getRecentLogs(1);
            assert.strictEqual(logs[0].context, undefined);
        });

        test('should handle empty context object', () => {
            logger.info(LogCategory.EXTENSION, 'Test message', {});
            
            const logs = logger.getRecentLogs(1);
            assert.deepStrictEqual(logs[0].context, {});
        });
    });

    suite('Cross-Platform Compatibility', () => {
        test('should work on current platform', () => {
            // This test verifies basic functionality on whatever platform tests are running
            assert.ok(['win32', 'darwin', 'linux'].includes(process.platform));
            
            logger.info(LogCategory.EXTENSION, 'Cross-platform test', { platform: process.platform });
            const logs = logger.getRecentLogs(1);
            assert.strictEqual(logs[0].context?.platform, process.platform);
        });

        test('should handle Windows-style paths in context', () => {
            logger.info(LogCategory.FILESYSTEM, 'Windows path test', { 
                path: 'C:\\Users\\test\\project\\src' 
            });
            const logs = logger.getRecentLogs(1);
            assert.strictEqual(logs[0].context?.path, 'C:\\Users\\test\\project\\src');
        });

        test('should handle Unix-style paths in context', () => {
            logger.info(LogCategory.FILESYSTEM, 'Unix path test', { 
                path: '/Users/test/project/src' 
            });
            const logs = logger.getRecentLogs(1);
            assert.strictEqual(logs[0].context?.path, '/Users/test/project/src');
        });

        test('should handle mixed path separators', () => {
            logger.info(LogCategory.FILESYSTEM, 'Mixed path test', { 
                path: 'C:/Users\\test/project\\src' 
            });
            const logs = logger.getRecentLogs(1);
            assert.strictEqual(logs[0].context?.path, 'C:/Users\\test/project\\src');
        });

        test('should handle newlines in messages across platforms', () => {
            const message = 'Line 1\nLine 2\r\nLine 3';
            logger.info(LogCategory.EXTENSION, message);
            const logs = logger.getRecentLogs(1);
            assert.strictEqual(logs[0].message, message);
        });
    });

    suite('Error Handling', () => {
        test('should handle Error with stack trace', () => {
            const error = new Error('Test error');
            logger.error(LogCategory.EXTENSION, 'Error occurred', error);
            
            const logs = logger.getRecentLogs(1);
            assert.ok(logs[0].error?.stack);
            assert.ok(logs[0].error?.stack?.includes('Error: Test error'));
        });

        test('should handle Error without stack trace', () => {
            const error = new Error('Test error');
            error.stack = undefined;
            logger.error(LogCategory.EXTENSION, 'Error occurred', error);
            
            const logs = logger.getRecentLogs(1);
            assert.strictEqual(logs[0].error?.message, 'Test error');
        });

        test('should handle null/undefined gracefully in context', () => {
            logger.info(LogCategory.EXTENSION, 'Test message', { 
                nullValue: null, 
                undefinedValue: undefined 
            });
            const logs = logger.getRecentLogs(1);
            assert.strictEqual(logs[0].context?.nullValue, null);
            assert.strictEqual(logs[0].context?.undefinedValue, undefined);
        });

        test('should handle complex nested context', () => {
            const complexContext = {
                level1: {
                    level2: {
                        level3: 'deep value'
                    }
                },
                array: [1, 2, 3],
                mixed: { arr: [{ key: 'value' }] }
            };
            
            logger.info(LogCategory.EXTENSION, 'Complex context test', complexContext);
            const logs = logger.getRecentLogs(1);
            assert.deepStrictEqual(logs[0].context, complexContext);
        });
    });

    suite('Command Sanitization', () => {
        test('should sanitize commands with prompt content', () => {
            // Test that sensitive prompt content is not exposed in logs
            logger.logAIProcessLaunch(
                'This is a secret prompt with API keys',
                '/workspace',
                'copilot -p "This is a secret prompt with API keys"'
            );
            
            const logs = logger.getRecentLogs(1);
            // The command should be sanitized to hide prompt content
            const command = logs[0].context?.command as string | undefined;
            if (command) {
                assert.ok(
                    !command.includes('secret') ||
                    command.includes('<prompt content hidden>'),
                    'Prompt content should be sanitized'
                );
            }
        });
    });

    suite('Initialization State', () => {
        test('should report initialization status', () => {
            // Logger may or may not be initialized depending on test order
            // Just verify the method works
            const isInit = logger.isInitialized();
            assert.ok(typeof isInit === 'boolean');
        });

        test('should work even without explicit initialization', () => {
            // Logger should work for basic operations even without output channel
            logger.info(LogCategory.EXTENSION, 'Test without init');
            const logs = logger.getRecentLogs(1);
            assert.strictEqual(logs.length, 1);
        });
    });

    suite('Category Filtering', () => {
        test('should filter logs by category when filter is set', () => {
            logger.setCategoryFilter([LogCategory.AI]);
            
            logger.info(LogCategory.AI, 'AI message should appear');
            logger.info(LogCategory.GIT, 'Git message should be filtered');
            
            const logs = logger.getRecentLogs(10);
            assert.strictEqual(logs.length, 1);
            assert.strictEqual(logs[0].category, LogCategory.AI);
            
            // Clear filter for other tests
            logger.setCategoryFilter([]);
        });

        test('should show all logs when filter is empty', () => {
            logger.setCategoryFilter([]);
            
            logger.info(LogCategory.AI, 'AI message');
            logger.info(LogCategory.GIT, 'Git message');
            
            const logs = logger.getRecentLogs(10);
            assert.strictEqual(logs.length, 2);
        });

        test('should support multiple category filters', () => {
            logger.setCategoryFilter([LogCategory.AI, LogCategory.GIT]);
            
            logger.info(LogCategory.AI, 'AI message');
            logger.info(LogCategory.GIT, 'Git message');
            logger.info(LogCategory.CONFIG, 'Config message - filtered');
            
            const logs = logger.getRecentLogs(10);
            assert.strictEqual(logs.length, 2);
            
            // Clear filter for other tests
            logger.setCategoryFilter([]);
        });
    });

    suite('Log Level Filtering', () => {
        test('should filter logs below minimum level', () => {
            logger.setMinLevel(LogLevel.WARN);
            
            logger.debug(LogCategory.EXTENSION, 'Debug - filtered');
            logger.info(LogCategory.EXTENSION, 'Info - filtered');
            logger.warn(LogCategory.EXTENSION, 'Warn - shown');
            logger.error(LogCategory.EXTENSION, 'Error - shown');
            
            const logs = logger.getRecentLogs(10);
            assert.strictEqual(logs.length, 2);
            assert.ok(logs.every(log => 
                log.level === LogLevel.WARN || log.level === LogLevel.ERROR
            ));
            
            // Reset for other tests
            logger.setMinLevel(LogLevel.DEBUG);
        });
    });
});

suite('ExtensionLogger - LogLevel Enum', () => {
    test('should have all expected log levels', () => {
        assert.strictEqual(LogLevel.DEBUG, 'DEBUG');
        assert.strictEqual(LogLevel.INFO, 'INFO');
        assert.strictEqual(LogLevel.WARN, 'WARN');
        assert.strictEqual(LogLevel.ERROR, 'ERROR');
    });

    test('should have exactly 4 log levels', () => {
        const levels = Object.keys(LogLevel);
        assert.strictEqual(levels.length, 4);
    });

    test('backward compatibility: AILogLevel should equal LogLevel', () => {
        assert.strictEqual(AILogLevel.DEBUG, LogLevel.DEBUG);
        assert.strictEqual(AILogLevel.INFO, LogLevel.INFO);
        assert.strictEqual(AILogLevel.WARN, LogLevel.WARN);
        assert.strictEqual(AILogLevel.ERROR, LogLevel.ERROR);
    });
});

suite('ExtensionLogger - LogCategory Enum', () => {
    test('should have all expected categories', () => {
        assert.strictEqual(LogCategory.AI, 'AI Service');
        assert.strictEqual(LogCategory.GIT, 'Git');
        assert.strictEqual(LogCategory.CONFIG, 'Configuration');
        assert.strictEqual(LogCategory.MARKDOWN, 'Markdown Comments');
        assert.strictEqual(LogCategory.DIFF_COMMENTS, 'Diff Comments');
        assert.strictEqual(LogCategory.DISCOVERY, 'Discovery');
        assert.strictEqual(LogCategory.SYNC, 'Sync');
        assert.strictEqual(LogCategory.TASKS, 'Tasks');
        assert.strictEqual(LogCategory.EXTENSION, 'Extension');
        assert.strictEqual(LogCategory.FILESYSTEM, 'FileSystem');
    });
});

suite('ExtensionLogger - Backward Compatibility (AIServiceLogger)', () => {
    test('AIServiceLogger should be alias for ExtensionLogger', () => {
        assert.strictEqual(AIServiceLogger, ExtensionLogger);
    });

    test('getAIServiceLogger should return same instance as getExtensionLogger', () => {
        const fromOld = getAIServiceLogger();
        const fromNew = getExtensionLogger();
        assert.strictEqual(fromOld, fromNew);
    });
});

