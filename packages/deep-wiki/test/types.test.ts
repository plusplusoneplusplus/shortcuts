/**
 * Tests for type validation, schema helpers, and module ID normalization.
 */

import { describe, it, expect } from 'vitest';
import { isValidComponentId, normalizeComponentId, COMPONENT_GRAPH_REQUIRED_FIELDS, PROJECT_INFO_REQUIRED_FIELDS, COMPONENT_INFO_REQUIRED_FIELDS, VALID_COMPLEXITY_VALUES, COMPONENT_GRAPH_SCHEMA, STRUCTURAL_SCAN_SCHEMA } from '../src/schemas';
describe('Types and Schemas', () => {
    // ========================================================================
    // Module ID Validation
    // ========================================================================

    describe('isValidComponentId', () => {
        it('should accept simple lowercase IDs', () => {
            expect(isValidComponentId('auth')).toBe(true);
            expect(isValidComponentId('database')).toBe(true);
            expect(isValidComponentId('api')).toBe(true);
        });

        it('should accept kebab-case IDs', () => {
            expect(isValidComponentId('auth-service')).toBe(true);
            expect(isValidComponentId('database-layer')).toBe(true);
            expect(isValidComponentId('my-long-module-name')).toBe(true);
        });

        it('should accept IDs with numbers', () => {
            expect(isValidComponentId('module1')).toBe(true);
            expect(isValidComponentId('v2-api')).toBe(true);
            expect(isValidComponentId('auth-v3')).toBe(true);
        });

        it('should reject IDs starting with numbers', () => {
            expect(isValidComponentId('123')).toBe(false);
            expect(isValidComponentId('1module')).toBe(false);
        });

        it('should reject IDs with uppercase letters', () => {
            expect(isValidComponentId('Auth')).toBe(false);
            expect(isValidComponentId('AUTH')).toBe(false);
            expect(isValidComponentId('myModule')).toBe(false);
        });

        it('should reject IDs with special characters', () => {
            expect(isValidComponentId('auth_service')).toBe(false);
            expect(isValidComponentId('auth.service')).toBe(false);
            expect(isValidComponentId('auth/service')).toBe(false);
            expect(isValidComponentId('auth service')).toBe(false);
        });

        it('should reject IDs with leading or trailing hyphens', () => {
            expect(isValidComponentId('-auth')).toBe(false);
            expect(isValidComponentId('auth-')).toBe(false);
            expect(isValidComponentId('-auth-')).toBe(false);
        });

        it('should reject IDs with consecutive hyphens', () => {
            expect(isValidComponentId('auth--service')).toBe(false);
        });

        it('should reject empty strings', () => {
            expect(isValidComponentId('')).toBe(false);
        });
    });

    // ========================================================================
    // Module ID Normalization
    // ========================================================================

    describe('normalizeComponentId', () => {
        it('should lowercase the input', () => {
            expect(normalizeComponentId('Auth')).toBe('auth');
            expect(normalizeComponentId('AUTH')).toBe('auth');
            expect(normalizeComponentId('MyModule')).toBe('mymodule');
        });

        it('should replace special characters with hyphens', () => {
            expect(normalizeComponentId('auth_service')).toBe('auth-service');
            expect(normalizeComponentId('auth.service')).toBe('auth-service');
            expect(normalizeComponentId('auth/service')).toBe('auth-service');
            expect(normalizeComponentId('auth service')).toBe('auth-service');
        });

        it('should trim leading/trailing hyphens', () => {
            expect(normalizeComponentId('-auth-')).toBe('auth');
            expect(normalizeComponentId('--auth--')).toBe('auth');
        });

        it('should collapse consecutive hyphens', () => {
            expect(normalizeComponentId('auth--service')).toBe('auth-service');
            expect(normalizeComponentId('a___b')).toBe('a-b');
        });

        it('should return "unknown" for empty/invalid input', () => {
            expect(normalizeComponentId('')).toBe('unknown');
            expect(normalizeComponentId('---')).toBe('unknown');
            expect(normalizeComponentId('...')).toBe('unknown');
        });

        it('should handle complex paths', () => {
            expect(normalizeComponentId('src/auth/')).toBe('src-auth');
            expect(normalizeComponentId('packages/core/src')).toBe('packages-core-src');
        });
    });

    // ========================================================================
    // Required Fields Constants
    // ========================================================================

    describe('Required field constants', () => {
        it('should define COMPONENT_GRAPH_REQUIRED_FIELDS', () => {
            expect(COMPONENT_GRAPH_REQUIRED_FIELDS).toContain('project');
            expect(COMPONENT_GRAPH_REQUIRED_FIELDS).toContain('components');
            expect(COMPONENT_GRAPH_REQUIRED_FIELDS).toContain('categories');
        });

        it('should define PROJECT_INFO_REQUIRED_FIELDS', () => {
            expect(PROJECT_INFO_REQUIRED_FIELDS).toContain('name');
            expect(PROJECT_INFO_REQUIRED_FIELDS).toContain('language');
        });

        it('should define COMPONENT_INFO_REQUIRED_FIELDS', () => {
            expect(COMPONENT_INFO_REQUIRED_FIELDS).toContain('id');
            expect(COMPONENT_INFO_REQUIRED_FIELDS).toContain('name');
            expect(COMPONENT_INFO_REQUIRED_FIELDS).toContain('path');
        });

        it('should define VALID_COMPLEXITY_VALUES', () => {
            expect(VALID_COMPLEXITY_VALUES).toEqual(['low', 'medium', 'high']);
        });
    });

    // ========================================================================
    // Schema Strings
    // ========================================================================

    describe('Schema strings', () => {
        it('should define COMPONENT_GRAPH_SCHEMA as a non-empty string', () => {
            expect(typeof COMPONENT_GRAPH_SCHEMA).toBe('string');
            expect(COMPONENT_GRAPH_SCHEMA.length).toBeGreaterThan(100);
            expect(COMPONENT_GRAPH_SCHEMA).toContain('project');
            expect(COMPONENT_GRAPH_SCHEMA).toContain('components');
            expect(COMPONENT_GRAPH_SCHEMA).toContain('categories');
            expect(COMPONENT_GRAPH_SCHEMA).toContain('architectureNotes');
        });

        it('should define STRUCTURAL_SCAN_SCHEMA as a non-empty string', () => {
            expect(typeof STRUCTURAL_SCAN_SCHEMA).toBe('string');
            expect(STRUCTURAL_SCAN_SCHEMA.length).toBeGreaterThan(50);
            expect(STRUCTURAL_SCAN_SCHEMA).toContain('fileCount');
            expect(STRUCTURAL_SCAN_SCHEMA).toContain('domains');
            expect(STRUCTURAL_SCAN_SCHEMA).toContain('projectInfo');
        });

        // Feature-focus schema hint tests
        it('should include feature-focused guidance in COMPONENT_GRAPH_SCHEMA id field', () => {
            expect(COMPONENT_GRAPH_SCHEMA).toContain('describing the FEATURE');
            expect(COMPONENT_GRAPH_SCHEMA).toContain('NOT the file/directory path');
        });

        it('should include feature-focused guidance in COMPONENT_GRAPH_SCHEMA name field', () => {
            expect(COMPONENT_GRAPH_SCHEMA).toContain('what this module DOES for users/system');
            expect(COMPONENT_GRAPH_SCHEMA).toContain('NOT the file name');
        });

        it('should include feature-focused guidance in COMPONENT_GRAPH_SCHEMA purpose field', () => {
            expect(COMPONENT_GRAPH_SCHEMA).toContain('what this module does for users or the system');
        });

        it('should include feature-focused guidance in STRUCTURAL_SCAN_SCHEMA domain name', () => {
            expect(STRUCTURAL_SCAN_SCHEMA).toContain('FUNCTIONALITY');
        });

        it('should include feature-focused guidance in STRUCTURAL_SCAN_SCHEMA domain description', () => {
            expect(STRUCTURAL_SCAN_SCHEMA).toContain('what this domain DOES');
        });
    });
});
