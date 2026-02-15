/**
 * Seed File Parser Tests
 *
 * Tests for parsing seed files in JSON and CSV formats.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { parseSeedFile } from '../../src/seeds/seed-file-parser';

describe('Seed File Parser', () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deep-wiki-seed-parser-test-'));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    describe('parseSeedFile', () => {
        it('should parse valid JSON seeds file', () => {
            const filePath = path.join(tmpDir, 'seeds.json');
            const content = JSON.stringify({
                version: '1.0.0',
                timestamp: 1234567890,
                repoPath: '/path/to/repo',
                themes: [
                    {
                        theme: 'authentication',
                        description: 'User authentication',
                        hints: ['auth', 'login'],
                    },
                    {
                        theme: 'database',
                        description: 'Database layer',
                        hints: ['db', 'sql'],
                    },
                ],
            });

            fs.writeFileSync(filePath, content, 'utf-8');

            const seeds = parseSeedFile(filePath);
            expect(seeds).toHaveLength(2);
            expect(seeds[0].theme).toBe('authentication');
            expect(seeds[1].theme).toBe('database');
        });

        it('should parse JSON file with direct themes array', () => {
            const filePath = path.join(tmpDir, 'seeds.json');
            const content = JSON.stringify([
                {
                    theme: 'auth',
                    description: 'Auth',
                    hints: ['hint'],
                },
            ]);

            fs.writeFileSync(filePath, content, 'utf-8');

            const seeds = parseSeedFile(filePath);
            expect(seeds).toHaveLength(1);
            expect(seeds[0].theme).toBe('auth');
        });

        it('should parse valid CSV seeds file', () => {
            const filePath = path.join(tmpDir, 'seeds.csv');
            const content = `theme,description,hints
authentication,User authentication,"auth,login"
database,Database layer,"db,sql"`;

            fs.writeFileSync(filePath, content, 'utf-8');

            const seeds = parseSeedFile(filePath);
            expect(seeds).toHaveLength(2);
            expect(seeds[0].theme).toBe('authentication');
            expect(seeds[0].description).toBe('User authentication');
            expect(seeds[0].hints).toEqual(['auth', 'login']);
        });

        it('should handle CSV with quoted hints containing commas', () => {
            const filePath = path.join(tmpDir, 'seeds.csv');
            const content = `theme,description,hints
auth,Authentication,"login,password,token"`;

            fs.writeFileSync(filePath, content, 'utf-8');

            const seeds = parseSeedFile(filePath);
            expect(seeds[0].hints).toEqual(['login', 'password', 'token']);
        });

        it('should normalize theme IDs to kebab-case', () => {
            const filePath = path.join(tmpDir, 'seeds.json');
            const content = JSON.stringify({
                themes: [
                    {
                        theme: 'API Gateway',
                        description: 'API gateway',
                        hints: ['api'],
                    },
                ],
            });

            fs.writeFileSync(filePath, content, 'utf-8');

            const seeds = parseSeedFile(filePath);
            expect(seeds[0].theme).toBe('api-gateway');
        });

        it('should throw error on non-existent file', () => {
            expect(() => parseSeedFile(path.join(tmpDir, 'nonexistent.json'))).toThrow('does not exist');
        });

        it('should throw error on invalid JSON', () => {
            const filePath = path.join(tmpDir, 'invalid.json');
            fs.writeFileSync(filePath, '{ invalid json }', 'utf-8');

            expect(() => parseSeedFile(filePath)).toThrow('Invalid JSON');
        });

        it('should throw error on empty file', () => {
            const filePath = path.join(tmpDir, 'empty.json');
            fs.writeFileSync(filePath, '', 'utf-8');

            expect(() => parseSeedFile(filePath)).toThrow('empty');
        });

        it('should throw error on missing theme field in JSON', () => {
            const filePath = path.join(tmpDir, 'seeds.json');
            const content = JSON.stringify({
                themes: [
                    {
                        description: 'Missing theme field',
                        hints: ['hint'],
                    },
                ],
            });

            fs.writeFileSync(filePath, content, 'utf-8');

            expect(() => parseSeedFile(filePath)).toThrow("missing or invalid 'theme' field");
        });

        it('should throw error on missing description field in JSON', () => {
            const filePath = path.join(tmpDir, 'seeds.json');
            const content = JSON.stringify({
                themes: [
                    {
                        theme: 'auth',
                        hints: ['hint'],
                    },
                ],
            });

            fs.writeFileSync(filePath, content, 'utf-8');

            expect(() => parseSeedFile(filePath)).toThrow("missing or invalid 'description' field");
        });

        it('should handle hints as comma-separated string in JSON', () => {
            const filePath = path.join(tmpDir, 'seeds.json');
            const content = JSON.stringify({
                themes: [
                    {
                        theme: 'auth',
                        description: 'Auth',
                        hints: 'login,password,token',
                    },
                ],
            });

            fs.writeFileSync(filePath, content, 'utf-8');

            const seeds = parseSeedFile(filePath);
            expect(seeds[0].hints).toEqual(['login', 'password', 'token']);
        });

        it('should default hints to theme name if missing in JSON', () => {
            const filePath = path.join(tmpDir, 'seeds.json');
            const content = JSON.stringify({
                themes: [
                    {
                        theme: 'auth',
                        description: 'Auth',
                    },
                ],
            });

            fs.writeFileSync(filePath, content, 'utf-8');

            const seeds = parseSeedFile(filePath);
            expect(seeds[0].hints).toEqual(['auth']);
        });

        it('should throw error on CSV missing theme column', () => {
            const filePath = path.join(tmpDir, 'seeds.csv');
            const content = `description,hints
Auth,"auth,login"`;

            fs.writeFileSync(filePath, content, 'utf-8');

            expect(() => parseSeedFile(filePath)).toThrow("missing 'theme' column");
        });

        it('should throw error on CSV missing description column', () => {
            const filePath = path.join(tmpDir, 'seeds.csv');
            const content = `theme,hints
auth,"auth,login"`;

            fs.writeFileSync(filePath, content, 'utf-8');

            expect(() => parseSeedFile(filePath)).toThrow("missing 'description' column");
        });

        it('should handle CSV with desc column instead of description', () => {
            const filePath = path.join(tmpDir, 'seeds.csv');
            const content = `theme,desc,hints
auth,Authentication,"login,password"`;

            fs.writeFileSync(filePath, content, 'utf-8');

            const seeds = parseSeedFile(filePath);
            expect(seeds[0].description).toBe('Authentication');
        });

        it('should handle CSV with hint column instead of hints', () => {
            const filePath = path.join(tmpDir, 'seeds.csv');
            const content = `theme,description,hint
auth,Authentication,"login,password"`;

            fs.writeFileSync(filePath, content, 'utf-8');

            const seeds = parseSeedFile(filePath);
            expect(seeds[0].hints).toEqual(['login', 'password']);
        });
    });
});
