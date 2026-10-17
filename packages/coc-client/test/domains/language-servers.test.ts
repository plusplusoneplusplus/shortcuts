import { describe, expect, it } from 'vitest';
import { CocApiError, LanguageServersClient, parseLanguageServerRejection } from '../../src';
import type { LanguageServerDefinition } from '../../src';
import { createMockAdapter } from './helpers';

function definition(overrides: Partial<LanguageServerDefinition> = {}): LanguageServerDefinition {
  return {
    id: 'fixture',
    displayName: 'Fixture',
    languageIds: ['plaintext'],
    filePatterns: ['**/*.txt'],
    command: 'fixture-server',
    args: ['--stdio'],
    rootMarkers: ['.git'],
    ...overrides,
  };
}

describe('LanguageServersClient', () => {
  it('addresses every call by workspace id with an encoded path segment', async () => {
    const adapter = createMockAdapter({ definitions: [] });
    const client = new LanguageServersClient(adapter);
    const definitions = [definition()];

    await client.get('repo/a space/雪%done');
    await client.replace('repo/a space/雪%done', { definitions });
    await client.update('repo/a space/雪%done', { definitions: [] });
    await client.retry('repo/a space/雪%done', 'session-key');

    const encoded = '/workspaces/repo%2Fa%20space%2F%E9%9B%AA%25done/language-servers';
    expect(adapter.calls).toMatchObject([
      { path: encoded, options: undefined },
      { path: encoded, options: { method: 'PUT', body: { definitions } } },
      { path: encoded, options: { method: 'PATCH', body: { definitions: [] } } },
      { path: `${encoded}/retry`, options: { method: 'POST', body: { sessionId: 'session-key' } } },
    ]);
  });

  it('copies the update body so later caller mutations do not reach the request', async () => {
    const adapter = createMockAdapter({});
    const client = new LanguageServersClient(adapter);
    const update = { definitions: [] as LanguageServerDefinition[] };

    await client.update('repo-a', update);
    update.definitions = [definition()];

    expect(adapter.calls[0].options?.body).toEqual({ definitions: [] });
  });

  it('sends an empty patch without replacing definitions', async () => {
    const adapter = createMockAdapter({});
    const client = new LanguageServersClient(adapter);

    await client.update('repo-a', {});

    expect(adapter.calls[0].options?.body).not.toHaveProperty('definitions');
  });
});

describe('parseLanguageServerRejection', () => {
  function rejection(body: unknown, status = 400): CocApiError {
    return new CocApiError({ status, statusText: 'Bad Request', url: '/x', message: 'nope', body });
  }

  it('returns field errors and the stored config from a rejected write', () => {
    const stored = { definitions: [definition({ id: 'kept' })] };
    const result = parseLanguageServerRejection(rejection({
      error: 'Invalid language-server configuration',
      errors: [{ field: 'definitions.0.command', message: 'command is required' }],
      config: stored,
    }));

    expect(result).toEqual({
      errors: [{ field: 'definitions.0.command', message: 'command is required' }],
      config: stored,
    });
  });

  it('returns errors alone when the response carries no stored config', () => {
    const result = parseLanguageServerRejection(rejection({
      errors: [{ field: 'definitions', message: 'definitions must be an array' }],
    }));

    expect(result).toEqual({ errors: [{ field: 'definitions', message: 'definitions must be an array' }] });
  });

  it('drops malformed error entries instead of handing them to the form', () => {
    const result = parseLanguageServerRejection(rejection({
      errors: [null, 'command is required', { field: 'command' }, { field: 'args.0', message: 'bad' }],
    }));

    expect(result).toEqual({ errors: [{ field: 'args.0', message: 'bad' }] });
  });

  it('ignores a non-boolean enabled in the echoed config', () => {
    const result = parseLanguageServerRejection(rejection({
      errors: [],
      config: { enabled: 'yes', definitions: [] },
    }));

    expect(result?.config).toEqual({ definitions: [] });
  });

  it('returns null for statuses, bodies, and errors it cannot interpret', () => {
    expect(parseLanguageServerRejection(new Error('offline'))).toBeNull();
    expect(parseLanguageServerRejection(rejection({ errors: [] }, 500))).toBeNull();
    expect(parseLanguageServerRejection(rejection('Bad Request'))).toBeNull();
    expect(parseLanguageServerRejection(rejection({ error: 'boom' }))).toBeNull();
    expect(parseLanguageServerRejection(rejection(undefined))).toBeNull();
  });
});
