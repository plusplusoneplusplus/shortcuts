/**
 * Tests for MCP Config Loader
 *
 * Comprehensive tests for loading MCP server configuration from ~/.copilot/mcp-config.json.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
    getHomeDirectory,
    getMcpConfigPath,
    loadDefaultMcpConfig,
    loadDefaultMcpConfigAsync,
    mergeMcpConfigs,
    clearMcpConfigCache,
    mcpConfigExists,
    getCachedMcpConfig,
    setHomeDirectoryOverride,
    MCPConfigFile
} from '../../src/ai/mcp-config-loader';
import { MCPServerConfig, MCPLocalServerConfig, MCPRemoteServerConfig } from '../../src/ai/copilot-sdk-service';

describe('MCP Config Loader', () => {
    let tempDir: string;
    let mockCopilotDir: string;
    let mockConfigPath: string;

    beforeEach(() => {
        // Create a temp directory for testing
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-config-test-'));
        mockCopilotDir = path.join(tempDir, '.copilot');
        mockConfigPath = path.join(mockCopilotDir, 'mcp-config.json');

        // Set the home directory override to our temp directory
        setHomeDirectoryOverride(tempDir);

        // Clear the config cache before each test
        clearMcpConfigCache();
    });

    afterEach(() => {
        // Reset home directory override
        setHomeDirectoryOverride(null);

        // Clean up temp directory
        if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }

        // Clear cache after each test
        clearMcpConfigCache();
    });

    describe('getHomeDirectory', () => {
        it('returns the home directory from os.homedir()', () => {
            const home = getHomeDirectory();
            expect(home).toBe(tempDir);
        });
    });

    describe('getMcpConfigPath', () => {
        it('returns the correct config path', () => {
            const configPath = getMcpConfigPath();
            expect(configPath).toBe(path.join(tempDir, '.copilot', 'mcp-config.json'));
        });

        it('uses platform-specific path separators', () => {
            const configPath = getMcpConfigPath();
            // Should contain the correct separator for the platform
            expect(configPath).toContain(path.sep);
        });
    });

    describe('mcpConfigExists', () => {
        it('returns false when config file does not exist', () => {
            expect(mcpConfigExists()).toBe(false);
        });

        it('returns true when config file exists', () => {
            // Create the config file
            fs.mkdirSync(mockCopilotDir, { recursive: true });
            fs.writeFileSync(mockConfigPath, '{}');

            expect(mcpConfigExists()).toBe(true);
        });
    });

    describe('loadDefaultMcpConfig', () => {
        describe('when config file does not exist', () => {
            it('returns success with empty mcpServers', () => {
                const result = loadDefaultMcpConfig();

                expect(result.success).toBe(true);
                expect(result.mcpServers).toEqual({});
                expect(result.fileExists).toBe(false);
                expect(result.error).toBeUndefined();
            });

            it('returns the correct config path', () => {
                const result = loadDefaultMcpConfig();
                expect(result.configPath).toBe(mockConfigPath);
            });
        });

        describe('when config file exists', () => {
            it('loads a valid config with local server', () => {
                const config: MCPConfigFile = {
                    mcpServers: {
                        'local-server': {
                            type: 'local',
                            command: 'my-mcp-server',
                            args: ['--port', '8080'],
                            tools: ['*']
                        } as MCPLocalServerConfig
                    }
                };

                fs.mkdirSync(mockCopilotDir, { recursive: true });
                fs.writeFileSync(mockConfigPath, JSON.stringify(config));

                const result = loadDefaultMcpConfig();

                expect(result.success).toBe(true);
                expect(result.fileExists).toBe(true);
                expect(Object.keys(result.mcpServers)).toHaveLength(1);
                expect(result.mcpServers['local-server']).toEqual(config.mcpServers!['local-server']);
            });

            it('loads a valid config with remote SSE server', () => {
                const config: MCPConfigFile = {
                    mcpServers: {
                        'mcp-server': {
                            type: 'sse',
                            url: 'http://0.0.0.0:8000/sse',
                            headers: {},
                            tools: ['*']
                        } as MCPRemoteServerConfig
                    }
                };

                fs.mkdirSync(mockCopilotDir, { recursive: true });
                fs.writeFileSync(mockConfigPath, JSON.stringify(config));

                const result = loadDefaultMcpConfig();

                expect(result.success).toBe(true);
                expect(result.fileExists).toBe(true);
                expect(result.mcpServers['mcp-server']).toEqual({
                    type: 'sse',
                    url: 'http://0.0.0.0:8000/sse',
                    headers: {},
                    tools: ['*']
                });
            });

            it('loads a config with multiple servers', () => {
                const config: MCPConfigFile = {
                    mcpServers: {
                        'local-server': {
                            type: 'local',
                            command: 'server1',
                            tools: ['*']
                        } as MCPLocalServerConfig,
                        'remote-server': {
                            type: 'http',
                            url: 'http://localhost:3000',
                            tools: ['tool1', 'tool2']
                        } as MCPRemoteServerConfig
                    }
                };

                fs.mkdirSync(mockCopilotDir, { recursive: true });
                fs.writeFileSync(mockConfigPath, JSON.stringify(config));

                const result = loadDefaultMcpConfig();

                expect(result.success).toBe(true);
                expect(Object.keys(result.mcpServers)).toHaveLength(2);
            });

            it('handles config with empty mcpServers', () => {
                const config: MCPConfigFile = {
                    mcpServers: {}
                };

                fs.mkdirSync(mockCopilotDir, { recursive: true });
                fs.writeFileSync(mockConfigPath, JSON.stringify(config));

                const result = loadDefaultMcpConfig();

                expect(result.success).toBe(true);
                expect(result.mcpServers).toEqual({});
            });

            it('handles config without mcpServers key', () => {
                const config = {};

                fs.mkdirSync(mockCopilotDir, { recursive: true });
                fs.writeFileSync(mockConfigPath, JSON.stringify(config));

                const result = loadDefaultMcpConfig();

                expect(result.success).toBe(true);
                expect(result.mcpServers).toEqual({});
            });
        });

        describe('when config file is invalid', () => {
            it('returns error for invalid JSON', () => {
                fs.mkdirSync(mockCopilotDir, { recursive: true });
                fs.writeFileSync(mockConfigPath, 'not valid json {{{');

                const result = loadDefaultMcpConfig();

                expect(result.success).toBe(false);
                expect(result.fileExists).toBe(true);
                expect(result.mcpServers).toEqual({});
                expect(result.error).toContain('Failed to parse MCP config');
            });

            it('returns error for truncated JSON', () => {
                fs.mkdirSync(mockCopilotDir, { recursive: true });
                fs.writeFileSync(mockConfigPath, '{"mcpServers": {');

                const result = loadDefaultMcpConfig();

                expect(result.success).toBe(false);
                expect(result.error).toBeDefined();
            });
        });

        describe('caching behavior', () => {
            it('caches the result after first load', () => {
                const config: MCPConfigFile = {
                    mcpServers: {
                        'server1': {
                            type: 'sse',
                            url: 'http://localhost:8000/sse',
                            tools: ['*']
                        } as MCPRemoteServerConfig
                    }
                };

                fs.mkdirSync(mockCopilotDir, { recursive: true });
                fs.writeFileSync(mockConfigPath, JSON.stringify(config));

                // First load
                const result1 = loadDefaultMcpConfig();
                expect(result1.success).toBe(true);

                // Modify the file
                const newConfig: MCPConfigFile = {
                    mcpServers: {
                        'server2': {
                            type: 'http',
                            url: 'http://localhost:9000',
                            tools: ['*']
                        } as MCPRemoteServerConfig
                    }
                };
                fs.writeFileSync(mockConfigPath, JSON.stringify(newConfig));

                // Second load should return cached result
                const result2 = loadDefaultMcpConfig();
                expect(result2.mcpServers).toHaveProperty('server1');
                expect(result2.mcpServers).not.toHaveProperty('server2');
            });

            it('reloads when forceReload is true', () => {
                const config: MCPConfigFile = {
                    mcpServers: {
                        'server1': {
                            type: 'sse',
                            url: 'http://localhost:8000/sse',
                            tools: ['*']
                        } as MCPRemoteServerConfig
                    }
                };

                fs.mkdirSync(mockCopilotDir, { recursive: true });
                fs.writeFileSync(mockConfigPath, JSON.stringify(config));

                // First load
                loadDefaultMcpConfig();

                // Modify the file
                const newConfig: MCPConfigFile = {
                    mcpServers: {
                        'server2': {
                            type: 'http',
                            url: 'http://localhost:9000',
                            tools: ['*']
                        } as MCPRemoteServerConfig
                    }
                };
                fs.writeFileSync(mockConfigPath, JSON.stringify(newConfig));

                // Force reload
                const result = loadDefaultMcpConfig(true);
                expect(result.mcpServers).toHaveProperty('server2');
                expect(result.mcpServers).not.toHaveProperty('server1');
            });
        });
    });

    describe('loadDefaultMcpConfigAsync', () => {
        it('returns the same result as sync version', async () => {
            const config: MCPConfigFile = {
                mcpServers: {
                    'async-server': {
                        type: 'sse',
                        url: 'http://localhost:8000/sse',
                        tools: ['*']
                    } as MCPRemoteServerConfig
                }
            };

            fs.mkdirSync(mockCopilotDir, { recursive: true });
            fs.writeFileSync(mockConfigPath, JSON.stringify(config));

            clearMcpConfigCache();
            const asyncResult = await loadDefaultMcpConfigAsync();
            
            clearMcpConfigCache();
            const syncResult = loadDefaultMcpConfig();

            expect(asyncResult.success).toBe(syncResult.success);
            expect(asyncResult.mcpServers).toEqual(syncResult.mcpServers);
        });
    });

    describe('mergeMcpConfigs', () => {
        const defaultServers: Record<string, MCPServerConfig> = {
            'default-server': {
                type: 'sse',
                url: 'http://localhost:8000/sse',
                tools: ['*']
            } as MCPRemoteServerConfig
        };

        it('returns default config when explicit is undefined', () => {
            const result = mergeMcpConfigs(defaultServers, undefined);
            expect(result).toEqual(defaultServers);
        });

        it('returns empty object when explicit is empty object', () => {
            const result = mergeMcpConfigs(defaultServers, {});
            expect(result).toEqual({});
        });

        it('merges configs with explicit taking precedence', () => {
            const explicitServers: Record<string, MCPServerConfig> = {
                'explicit-server': {
                    type: 'http',
                    url: 'http://localhost:9000',
                    tools: ['tool1']
                } as MCPRemoteServerConfig
            };

            const result = mergeMcpConfigs(defaultServers, explicitServers);

            expect(Object.keys(result)).toHaveLength(2);
            expect(result['default-server']).toEqual(defaultServers['default-server']);
            expect(result['explicit-server']).toEqual(explicitServers['explicit-server']);
        });

        it('explicit config overrides same-named default server', () => {
            const explicitServers: Record<string, MCPServerConfig> = {
                'default-server': {
                    type: 'http',
                    url: 'http://localhost:9999',
                    tools: ['override']
                } as MCPRemoteServerConfig
            };

            const result = mergeMcpConfigs(defaultServers, explicitServers);

            expect(Object.keys(result)).toHaveLength(1);
            expect(result['default-server']).toEqual(explicitServers['default-server']);
        });

        it('handles empty default config', () => {
            const explicitServers: Record<string, MCPServerConfig> = {
                'explicit-server': {
                    type: 'local',
                    command: 'server',
                    tools: ['*']
                } as MCPLocalServerConfig
            };

            const result = mergeMcpConfigs({}, explicitServers);

            expect(result).toEqual(explicitServers);
        });
    });

    describe('clearMcpConfigCache', () => {
        it('clears the cached config', () => {
            const config: MCPConfigFile = {
                mcpServers: {
                    'server': {
                        type: 'sse',
                        url: 'http://localhost:8000/sse',
                        tools: ['*']
                    } as MCPRemoteServerConfig
                }
            };

            fs.mkdirSync(mockCopilotDir, { recursive: true });
            fs.writeFileSync(mockConfigPath, JSON.stringify(config));

            // Load to populate cache
            loadDefaultMcpConfig();
            expect(getCachedMcpConfig()).not.toBeNull();

            // Clear cache
            clearMcpConfigCache();
            expect(getCachedMcpConfig()).toBeNull();
        });
    });

    describe('getCachedMcpConfig', () => {
        it('returns null when no config has been loaded', () => {
            expect(getCachedMcpConfig()).toBeNull();
        });

        it('returns cached config after loading', () => {
            fs.mkdirSync(mockCopilotDir, { recursive: true });
            fs.writeFileSync(mockConfigPath, '{}');

            loadDefaultMcpConfig();

            const cached = getCachedMcpConfig();
            expect(cached).not.toBeNull();
            expect(cached?.success).toBe(true);
        });
    });

    describe('cross-platform compatibility', () => {
        it('handles paths with spaces', () => {
            // This test verifies that path.join handles spaces correctly
            const pathWithSpaces = path.join(tempDir, 'path with spaces', '.copilot', 'mcp-config.json');
            expect(pathWithSpaces).toContain('path with spaces');
        });

        it('handles Unicode characters in paths', () => {
            // Create a directory with Unicode characters
            const unicodeDir = path.join(tempDir, '日本語');
            fs.mkdirSync(unicodeDir, { recursive: true });
            
            // Verify it was created
            expect(fs.existsSync(unicodeDir)).toBe(true);
        });
    });

    describe('MCPServerConfig type compatibility', () => {
        it('accepts local server config', () => {
            const localConfig: MCPLocalServerConfig = {
                type: 'local',
                command: 'my-server',
                args: ['--arg1', 'value1'],
                env: { 'KEY': 'value' },
                cwd: '/path/to/dir',
                tools: ['*'],
                timeout: 30000
            };

            const config: MCPConfigFile = {
                mcpServers: {
                    'local': localConfig
                }
            };

            fs.mkdirSync(mockCopilotDir, { recursive: true });
            fs.writeFileSync(mockConfigPath, JSON.stringify(config));

            const result = loadDefaultMcpConfig();
            expect(result.success).toBe(true);
            expect(result.mcpServers['local']).toEqual(localConfig);
        });

        it('accepts stdio server config', () => {
            const stdioConfig: MCPLocalServerConfig = {
                type: 'stdio',
                command: 'stdio-server',
                tools: ['tool1', 'tool2']
            };

            const config: MCPConfigFile = {
                mcpServers: {
                    'stdio': stdioConfig
                }
            };

            fs.mkdirSync(mockCopilotDir, { recursive: true });
            fs.writeFileSync(mockConfigPath, JSON.stringify(config));

            const result = loadDefaultMcpConfig();
            expect(result.success).toBe(true);
            expect(result.mcpServers['stdio'].type).toBe('stdio');
        });

        it('accepts HTTP server config', () => {
            const httpConfig: MCPRemoteServerConfig = {
                type: 'http',
                url: 'http://api.example.com/mcp',
                headers: { 'Authorization': 'Bearer token' },
                tools: ['*'],
                timeout: 60000
            };

            const config: MCPConfigFile = {
                mcpServers: {
                    'http': httpConfig
                }
            };

            fs.mkdirSync(mockCopilotDir, { recursive: true });
            fs.writeFileSync(mockConfigPath, JSON.stringify(config));

            const result = loadDefaultMcpConfig();
            expect(result.success).toBe(true);
            expect(result.mcpServers['http']).toEqual(httpConfig);
        });

        it('accepts SSE server config', () => {
            const sseConfig: MCPRemoteServerConfig = {
                type: 'sse',
                url: 'http://localhost:8000/sse',
                headers: {},
                tools: ['*']
            };

            const config: MCPConfigFile = {
                mcpServers: {
                    'sse': sseConfig
                }
            };

            fs.mkdirSync(mockCopilotDir, { recursive: true });
            fs.writeFileSync(mockConfigPath, JSON.stringify(config));

            const result = loadDefaultMcpConfig();
            expect(result.success).toBe(true);
            expect(result.mcpServers['sse'].type).toBe('sse');
        });

        it('accepts mixed server types', () => {
            const config: MCPConfigFile = {
                mcpServers: {
                    'local': {
                        type: 'local',
                        command: 'local-server',
                        tools: ['*']
                    } as MCPLocalServerConfig,
                    'remote': {
                        type: 'sse',
                        url: 'http://localhost:8000/sse',
                        tools: ['*']
                    } as MCPRemoteServerConfig
                }
            };

            fs.mkdirSync(mockCopilotDir, { recursive: true });
            fs.writeFileSync(mockConfigPath, JSON.stringify(config));

            const result = loadDefaultMcpConfig();
            expect(result.success).toBe(true);
            expect(Object.keys(result.mcpServers)).toHaveLength(2);
        });
    });
});
