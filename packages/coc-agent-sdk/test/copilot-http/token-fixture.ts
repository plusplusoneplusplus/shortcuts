type TokenFamily = 'gho' | 'ghu' | 'ghp' | 'ghs' | 'github_pat';

export function testCopilotToken(family: TokenFamily, label: string): string {
    return [family, 'not_a_real_token', label].join('_');
}
