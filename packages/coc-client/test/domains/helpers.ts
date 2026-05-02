import type { CocRequestOptions, RequestAdapter } from '../../src';

export interface RequestCall {
  path: string;
  options?: CocRequestOptions;
}

export function createMockAdapter(result: unknown = {}): RequestAdapter & { calls: RequestCall[] } {
  const calls: RequestCall[] = [];
  return {
    calls,
    request: async (path, options) => {
      calls.push({ path, options });
      return result as never;
    },
  };
}
