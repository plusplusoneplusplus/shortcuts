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
    const adapter = createMockAdapter({ enabled: false, definitions: [] });
    const client = new LanguageServersClient(adapter);
    const definitions = [definition()];

    await client.get('repo/a space/雪%done');
    await client.replace('repo/a space/雪%done', { enabled: true, definitions });
    await client.update('repo/a space/雪%done', { enabled: false });
    await client.retry('repo/a space/雪%done', 'session-key');

    const encoded = '/workspaces/repo%2Fa%20space%2F%E9%9B%AA%25done/language-servers';
    expect(adapter.calls).toMatchObject([
      { path: encoded, options: undefined },
      { path: encoded, options: { method: 'PUT', body: { enabled: true, definitions } } },
      { path: encoded, options: { method: 'PATCH', body: { enabled: false } } },
      { path: `${encoded}/retry`, options: { method: 'POST', body: { sessionId: 'session-key' } } },
    ]);
  });

  it('copies the update body so later caller mutations do not reach the request', async () => {
    const adapter = createMockAdapter({});
    const client = new LanguageServersClient(adapter);
    const update = { enabled: true };

    await client.update('repo-a', update);
    update.enabled = false;

    expect(adapter.calls[0].options?.body).toEqual({ enabled: true });
  });

  it('sends a patch without definitions when only the enable flag changes', async () => {
    const adapter = createMockAdapter({});
    const client = new LanguageServersClient(adapter);

    await client.update('repo-a', { enabled: true });

    expect(adapter.calls[0].options?.body).not.toHaveProperty('definitions');
  });
});

describe('parseLanguageServerRejection', () => {
  function rejection(body: unknown, status = 400): CocApiError {
    return new CocApiError({ status, statusText: 'Bad Request', url: '/x', message: 'nope', body });
  }

  it('returns field errors and the stored config from a rejected write', () => {
    const stored = { enabled: true, definitions: [definition({ id: 'kept' })] };
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
      errors: [{ field: 'enabled', message: 'enabled must be a boolean' }],
    }));

    expect(result).toEqual({ errors: [{ field: 'enabled', message: 'enabled must be a boolean' }] });
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

    expect(result?.config).toEqual({ enabled: false, definitions: [] });
  });

  it('returns null for statuses, bodies, and errors it cannot interpret', () => {
    expect(parseLanguageServerRejection(new Error('offline'))).toBeNull();
    expect(parseLanguageServerRejection(rejection({ errors: [] }, 500))).toBeNull();
    expect(parseLanguageServerRejection(rejection('Bad Request'))).toBeNull();
    expect(parseLanguageServerRejection(rejection({ error: 'boom' }))).toBeNull();
    expect(parseLanguageServerRejection(rejection(undefined))).toBeNull();
  });
});
