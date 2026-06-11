/**
 * OpenAPI Spec Validation Tests
 *
 * Validates that openapi.yaml is well-formed OpenAPI 3.1.0, all $ref pointers
 * resolve, and documented operations meet quality baseline.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import { describe, it, expect } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import * as yaml from 'js-yaml';
import * as SwaggerParser from '@readme/openapi-parser';

// Path to the source spec (not the dist copy)
const SPEC_PATH = path.resolve(__dirname, '../../src/server/openapi.yaml');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** HTTP methods that count as operations in OpenAPI */
const HTTP_METHODS = new Set([
  'get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace',
]);

/** Walk all operations in a parsed OpenAPI document */
function* walkOperations(
  paths: Record<string, any>
): Generator<{ path: string; method: string; operation: any }> {
  for (const [pathStr, pathItem] of Object.entries(paths || {})) {
    if (!pathItem || typeof pathItem !== 'object') continue;
    for (const [method, operation] of Object.entries(pathItem)) {
      if (HTTP_METHODS.has(method) && operation && typeof operation === 'object') {
        yield { path: pathStr, method, operation: operation as any };
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('OpenAPI spec validation', () => {
  // Pre-load raw YAML for structural checks that don't need parsing
  const rawYaml = fs.readFileSync(SPEC_PATH, 'utf-8');
  const rawSpec = yaml.load(rawYaml) as any;

  it('spec file exists and is valid YAML', () => {
    expect(rawSpec).toBeDefined();
    expect(rawSpec).toHaveProperty('openapi');
  });

  it('declares OpenAPI version 3.1.0', () => {
    expect(rawSpec.openapi).toBe('3.1.0');
  });

  it('has required info fields', () => {
    expect(rawSpec.info).toBeDefined();
    expect(rawSpec.info.title).toBeTruthy();
    expect(rawSpec.info.version).toBeTruthy();
  });

  it('parses as valid OpenAPI 3.1.0 (schema validation)', async () => {
    // SwaggerParser.validate() in @readme/openapi-parser returns { valid, warnings, specification }.
    // A thrown error means invalid spec; a false `valid` means schema violations.
    const result = await SwaggerParser.validate(SPEC_PATH);
    expect(result).toBeDefined();
    expect(result.valid).toBe(true);
    expect(result.warnings).toHaveLength(0);
  });

  it('resolves all $ref references without errors', async () => {
    // dereference() replaces every $ref with its resolved value.
    // If any $ref target is missing, this throws.
    const api = await SwaggerParser.dereference(SPEC_PATH);
    expect(api).toBeDefined();
    expect(api.paths).toBeDefined();
  });

  it('has at least 20 documented paths', () => {
    const pathCount = Object.keys(rawSpec.paths || {}).length;
    expect(pathCount).toBeGreaterThanOrEqual(20);
  });

  it('has at least 29 documented operations', () => {
    let count = 0;
    for (const _ of walkOperations(rawSpec.paths)) {
      count++;
    }
    expect(count).toBeGreaterThanOrEqual(29);
  });

  it('all operations have an operationId', () => {
    const missing: string[] = [];
    for (const { path: p, method, operation } of walkOperations(rawSpec.paths)) {
      if (!operation.operationId) {
        missing.push(`${method.toUpperCase()} ${p}`);
      }
    }
    expect(missing, `Operations missing operationId: ${missing.join(', ')}`).toHaveLength(0);
  });

  it('all operationIds are unique', () => {
    const seen = new Map<string, string>();
    const dupes: string[] = [];
    for (const { path: p, method, operation } of walkOperations(rawSpec.paths)) {
      const id = operation.operationId;
      if (!id) continue;
      const key = `${method.toUpperCase()} ${p}`;
      if (seen.has(id)) {
        dupes.push(`"${id}" used by both ${seen.get(id)} and ${key}`);
      } else {
        seen.set(id, key);
      }
    }
    expect(dupes, `Duplicate operationIds: ${dupes.join('; ')}`).toHaveLength(0);
  });

  it('all operations have at least one response', () => {
    const missing: string[] = [];
    for (const { path: p, method, operation } of walkOperations(rawSpec.paths)) {
      if (!operation.responses || Object.keys(operation.responses).length === 0) {
        missing.push(`${method.toUpperCase()} ${p}`);
      }
    }
    expect(missing, `Operations missing responses: ${missing.join(', ')}`).toHaveLength(0);
  });

  it('all operations have a summary or description', () => {
    const missing: string[] = [];
    for (const { path: p, method, operation } of walkOperations(rawSpec.paths)) {
      if (!operation.summary && !operation.description) {
        missing.push(`${method.toUpperCase()} ${p}`);
      }
    }
    expect(missing, `Operations missing summary/description: ${missing.join(', ')}`).toHaveLength(0);
  });

  it('all operations have tags', () => {
    const missing: string[] = [];
    for (const { path: p, method, operation } of walkOperations(rawSpec.paths)) {
      if (!operation.tags || operation.tags.length === 0) {
        missing.push(`${method.toUpperCase()} ${p}`);
      }
    }
    expect(missing, `Operations missing tags: ${missing.join(', ')}`).toHaveLength(0);
  });

  it('components/schemas section exists and is non-empty', () => {
    expect(rawSpec.components).toBeDefined();
    expect(rawSpec.components.schemas).toBeDefined();
    const schemaCount = Object.keys(rawSpec.components.schemas).length;
    expect(schemaCount).toBeGreaterThan(0);
  });

  it('documents long-context billing metadata on the model shape', () => {
    const schemas = rawSpec.components.schemas;
    expect(schemas.ModelBilling.properties.tokenPrices.$ref).toBe('#/components/schemas/ModelBillingTokenPrices');
    expect(schemas.ModelBillingTokenPrices.properties.longContext.$ref).toBe('#/components/schemas/ModelBillingTokenPricesLongContext');
    expect(schemas.ModelBillingTokenPricesLongContext.properties.contextMax.type).toBe('number');
    expect(schemas.ModelInfo.properties.billing.$ref).toBe('#/components/schemas/ModelBilling');
  });
});

// ---------------------------------------------------------------------------
// Route coverage (compares spec paths against registered routes)
// ---------------------------------------------------------------------------

describe('OpenAPI route coverage', () => {
  /**
   * Collect all route patterns registered in the server source code.
   * Scans *.ts files for `pattern: '/api/...'` literals.
   * This is a heuristic — not 100% complete — but catches obvious drift.
   */
  function collectRegisteredPatterns(): Set<string> {
    const serverDir = path.resolve(__dirname, '../../src/server');
    const patterns = new Set<string>();
    const patternRegex = /pattern:\s*['"]([^'"]+)['"]/g;

    function scanDir(dir: string) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          scanDir(full);
        } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
          const content = fs.readFileSync(full, 'utf-8');
          let m: RegExpExecArray | null;
          // String-literal patterns: pattern: '/api/...'
          while ((m = patternRegex.exec(content)) !== null) {
            patterns.add(m[1]);
          }
          // Regex-literal patterns: pattern: /^\/api\/.../$/
          // The alternation order matters: char-class handler must come before single-char handler
          // so that `[^/]+` inside patterns isn't terminated by the unescaped `/`.
          const regexLiteralRegex =
            /pattern:\s*\/((?:\[(?:[^\]\\]|\\.)*\]|[^/\\]|\\.)+)\//g;
          while ((m = regexLiteralRegex.exec(content)) !== null) {
            const inner = m[1]
              .replace(/^\^/, '') // strip leading anchor
              .replace(/\$$/, '') // strip trailing anchor
              .replace(/\\\//g, '/'); // un-escape \/ → /
            if (inner.startsWith('/api/')) {
              patterns.add(inner);
            }
          }
        }
      }
    }

    scanDir(serverDir);
    // Add built-in routes from router.ts that aren't in pattern: form
    patterns.add('/api/openapi.json');
    patterns.add('/api/docs');
    patterns.add('/api/health');
    return patterns;
  }

  /**
   * Convert OpenAPI path template to the regex pattern format used by the
   * server router (e.g., `/api/processes/{id}` → `/api/processes/([^/]+)`).
   */
  function specPathToRouterPattern(specPath: string): string {
    return specPath.replace(/\{[^}]+\}/g, '([^/]+)');
  }

  it('all documented spec paths correspond to registered route patterns', () => {
    const rawYaml = fs.readFileSync(SPEC_PATH, 'utf-8');
    const spec = yaml.load(rawYaml) as any;
    const registered = collectRegisteredPatterns();

    const unmatched: string[] = [];
    for (const specPath of Object.keys(spec.paths || {})) {
      const routerPattern = specPathToRouterPattern(specPath);
      if (!registered.has(routerPattern)) {
        unmatched.push(`${specPath} (expected pattern: ${routerPattern})`);
      }
    }

    expect(
      unmatched,
      `Spec documents paths not found in server source:\n  ${unmatched.join('\n  ')}`
    ).toHaveLength(0);
  });

  it('reports undocumented API routes (informational)', () => {
    const rawYaml = fs.readFileSync(SPEC_PATH, 'utf-8');
    const spec = yaml.load(rawYaml) as any;
    const registered = collectRegisteredPatterns();

    // Build set of documented patterns (converted from spec path templates)
    const documented = new Set<string>();
    for (const specPath of Object.keys(spec.paths || {})) {
      documented.add(specPathToRouterPattern(specPath));
    }

    const undocumented: string[] = [];
    for (const pattern of registered) {
      if (pattern.startsWith('/api/') && !documented.has(pattern)) {
        undocumented.push(pattern);
      }
    }

    // This is informational — we don't fail CI for undocumented routes,
    // but we log them so authors can decide whether to add them.
    if (undocumented.length > 0) {
      console.log(
        `\n📋 ${undocumented.length} registered API routes not yet in openapi.yaml:\n` +
          undocumented.sort().map((r) => `   - ${r}`).join('\n')
      );
    }

    // Soft assertion: spec must document at least some routes to catch a completely
    // empty spec slipping through. The threshold is intentionally low (5%) because
    // the spec is an incremental work-in-progress covering a subset of all routes.
    const coverageRatio = documented.size / (documented.size + undocumented.length);
    expect(coverageRatio).toBeGreaterThan(0.05);
  });
});
