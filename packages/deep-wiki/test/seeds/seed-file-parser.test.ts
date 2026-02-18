/**
 * Seed File Parser Tests
 *
 * Tests for parsing seed files in YAML and CSV formats.
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
        it('should parse valid YAML seeds file', () => {
            const filePath = path.join(tmpDir, 'seeds.yaml');
            const content = `version: "1.0.0"
timestamp: 1234567890
repoPath: /path/to/repo
themes:
  - theme: authentication
    description: User authentication
    hints:
      - auth
      - login
  - theme: database
    description: Database layer
    hints:
      - db
      - sql
`;

            fs.writeFileSync(filePath, content, 'utf-8');

            const seeds = parseSeedFile(filePath);
            expect(seeds).toHaveLength(2);
            expect(seeds[0].theme).toBe('authentication');
            expect(seeds[0].description).toBe('User authentication');
            expect(seeds[0].hints).toEqual(['auth', 'login']);
            expect(seeds[1].theme).toBe('database');
            expect(seeds[1].description).toBe('Database layer');
            expect(seeds[1].hints).toEqual(['db', 'sql']);
        });

        it('should normalize theme IDs to kebab-case', () => {
            const filePath = path.join(tmpDir, 'seeds.yaml');
            const content = `themes:
  - theme: API Gateway
    description: API gateway
    hints:
      - api
`;

            fs.writeFileSync(filePath, content, 'utf-8');

            const seeds = parseSeedFile(filePath);
            expect(seeds[0].theme).toBe('api-gateway');
        });

        it('should throw error on invalid YAML', () => {
            const filePath = path.join(tmpDir, 'invalid.yaml');
            fs.writeFileSync(filePath, 'key: [unclosed', 'utf-8');

            expect(() => parseSeedFile(filePath)).toThrow('Invalid YAML');
        });

        it('should throw error on empty file', () => {
            const filePath = path.join(tmpDir, 'empty.yaml');
            fs.writeFileSync(filePath, '', 'utf-8');

            expect(() => parseSeedFile(filePath)).toThrow('empty');
        });

        it('should throw error on missing theme field in YAML', () => {
            const filePath = path.join(tmpDir, 'seeds.yaml');
            const content = `themes:
  - description: Missing theme field
    hints:
      - hint
`;

            fs.writeFileSync(filePath, content, 'utf-8');

            expect(() => parseSeedFile(filePath)).toThrow("missing or invalid 'theme' field");
        });

        it('should throw error on missing description field in YAML', () => {
            const filePath = path.join(tmpDir, 'seeds.yaml');
            const content = `themes:
  - theme: auth
    hints:
      - hint
`;

            fs.writeFileSync(filePath, content, 'utf-8');

            expect(() => parseSeedFile(filePath)).toThrow("missing or invalid 'description' field");
        });

        it('should handle hints as comma-separated string in YAML', () => {
            const filePath = path.join(tmpDir, 'seeds.yaml');
            const content = `themes:
  - theme: auth
    description: Auth
    hints: "login,password,token"
`;

            fs.writeFileSync(filePath, content, 'utf-8');

            const seeds = parseSeedFile(filePath);
            expect(seeds[0].hints).toEqual(['login', 'password', 'token']);
        });

        it('should default hints to theme name if missing in YAML', () => {
            const filePath = path.join(tmpDir, 'seeds.yaml');
            const content = `themes:
  - theme: auth
    description: Auth
`;

            fs.writeFileSync(filePath, content, 'utf-8');

            const seeds = parseSeedFile(filePath);
            expect(seeds[0].hints).toEqual(['auth']);
        });

        it('should throw error on non-existent file', () => {
            expect(() => parseSeedFile(path.join(tmpDir, 'nonexistent.yaml'))).toThrow('does not exist');
        });

        it('should throw error on unsupported file extension', () => {
            const filePath = path.join(tmpDir, 'seeds.json');
            fs.writeFileSync(filePath, '{}', 'utf-8');

            expect(() => parseSeedFile(filePath)).toThrow("Unsupported seed file extension");
        });

        it('should parse .yml extension', () => {
            const filePath = path.join(tmpDir, 'seeds.yml');
            const content = `themes:
  - theme: auth
    description: Auth
    hints:
      - login
`;

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
