import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  checkIdentity,
  checkMessage,
  createPathMatcher,
  globToRegExp,
  isProbablyBinary,
  scanSecrets,
} from './policy.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const policy = JSON.parse(readFileSync(join(here, '..', 'policy.json'), 'utf8'));
const matchForbidden = createPathMatcher(policy.forbiddenPaths);

describe('globToRegExp', () => {
  it('matches directory trees and any-depth basenames', () => {
    expect(globToRegExp('docs/**').test('docs/spec/00-overview.md')).toBe(true);
    expect(globToRegExp('docs/**').test('apps/docs/x.md')).toBe(false);
    expect(globToRegExp('dist/').test('packages/agent/dist/index.js')).toBe(true);
    expect(globToRegExp('dist/').test('packages/agent/src/dist.ts')).toBe(false);
    expect(globToRegExp('*.log').test('apps/agent/server.log')).toBe(true);
    expect(globToRegExp('**/AGENTS.md').test('AGENTS.md')).toBe(true);
    expect(globToRegExp('**/AGENTS.md').test('apps/web/AGENTS.md')).toBe(true);
    expect(globToRegExp('.env.*').test('apps/web/.env.local')).toBe(true);
    expect(globToRegExp('.env.*').test('apps/web/.environment.ts')).toBe(false);
  });
});

describe('forbidden paths', () => {
  it('rejects docs, agent files, build output and env files', () => {
    expect(matchForbidden('docs/PRD.md')).toBe('docs/**');
    expect(matchForbidden('apps/web/AGENTS.md')).toBe('**/AGENTS.md');
    expect(matchForbidden('apps/web/CLAUDE.md')).toBe('**/CLAUDE.md');
    expect(matchForbidden('.cursor/rules/x.mdc')).toBe('.cursor/');
    expect(matchForbidden('apps/web/.next/build-manifest.json')).toBe('.next/');
    expect(matchForbidden('node_modules/zod/index.js')).toBe('node_modules/');
    expect(matchForbidden('apps/agent/dist/server.js')).toBe('dist/');
    expect(matchForbidden('.env.local')).toBe('.env.*');
    expect(matchForbidden('apps/web/.env.production')).toBe('.env.*');
    expect(matchForbidden('chromedriver/win64/chromedriver.exe')).toBe('chromedriver/');
    expect(matchForbidden('apps/web/.edge-headless-profile-2/Default/Cookies')).toBe(
      '.edge-headless-profile*/',
    );
  });

  it('keeps allowed exceptions and normal source files', () => {
    expect(matchForbidden('.env.example')).toBeNull();
    expect(matchForbidden('apps/web/app/layout.tsx')).toBeNull();
    expect(matchForbidden('.githooks/lib/run.mjs')).toBeNull();
    expect(matchForbidden('README.md')).toBeNull();
    expect(matchForbidden('packages/agent/src/index.ts')).toBeNull();
  });
});

describe('checkIdentity', () => {
  it('accepts the single allowed author', () => {
    expect(checkIdentity(policy, { name: 'IvanCodesDev', email: 'ivan@example.com' })).toEqual([]);
  });

  it('rejects other humans, agents and empty config', () => {
    expect(checkIdentity(policy, { name: 'Someone Else', email: 'a@b.c' })).toHaveLength(1);
    expect(
      checkIdentity(policy, { name: 'Cursor Agent', email: 'cursoragent@cursor.com' }).length,
    ).toBeGreaterThan(1);
    expect(
      checkIdentity(policy, { name: 'Claude', email: 'noreply@anthropic.com' }).length,
    ).toBeGreaterThan(1);
    expect(checkIdentity(policy, { name: '', email: '' })).toEqual([
      'identity: user.name is not set',
      'identity: user.email is not set',
    ]);
  });

  it('flags an agent email even when the name is allowed', () => {
    expect(
      checkIdentity(policy, { name: 'IvanCodesDev', email: 'cursoragent@cursor.com' }),
    ).toEqual(['identity: email "cursoragent@cursor.com" looks like a coding agent / bot']);
  });
});

describe('checkMessage', () => {
  it('accepts an ordinary message', () => {
    expect(checkMessage(policy, 'feat(web): move cursor to end of input\n\nDetails.')).toEqual([]);
    expect(checkMessage(policy, 'fix: handle codex-style prompts', {})).toEqual([]);
  });

  it('rejects co-author trailers and agent attribution', () => {
    expect(
      checkMessage(policy, 'x\n\nCo-authored-by: Cursor Agent <cursoragent@cursor.com>'),
    ).toHaveLength(2);
    expect(
      checkMessage(policy, 'x\n\nCo-Authored-By: Claude <noreply@anthropic.com>'),
    ).toHaveLength(2);
    expect(
      checkMessage(policy, 'x\n\n🤖 Generated with [Claude Code](https://claude.ai/code)').length,
    ).toBeGreaterThan(0);
    expect(checkMessage(policy, 'x\n\nMade-with: Cursor')).toHaveLength(1);
    expect(
      checkMessage(policy, 'x\n\nSigned-off-by: Cursor Agent <cursoragent@cursor.com>').length,
    ).toBeGreaterThan(0);
    expect(checkMessage(policy, 'x\n\nSigned-off-by: IvanCodesDev <ivan@example.com>')).toEqual([]);
  });

  it('ignores git comment lines when asked', () => {
    const message = 'x\n# Co-authored-by: Cursor Agent <cursoragent@cursor.com>\n';
    expect(checkMessage(policy, message, { stripComments: true })).toEqual([]);
    expect(checkMessage(policy, message)).toHaveLength(1);
  });
});

describe('scanSecrets', () => {
  // Fixtures are assembled at runtime so this file itself never trips the pre-commit scan.
  const openaiLike = ['sk-', 'abcdefghijklmnopqrstuvwxyz0123456789'].join('');
  const googleLike = ['AIza', 'SyA1234567890abcdefghijklmnopqrstuvw'].join('');
  const pemHeader = ['-----BEGIN ', 'PRIVATE KEY-----'].join('');

  it('finds common provider keys and private keys', () => {
    const text = [
      `const a = "${openaiLike}";`,
      `const b = "${googleLike}";`,
      pemHeader,
      'const ok = "sk-short";',
    ].join('\n');
    expect(scanSecrets(policy, text).map((f) => f.line)).toEqual([1, 2, 3]);
  });

  it('skips lines carrying the allow marker', () => {
    const text = `const fixture = "${openaiLike}"; // ${policy.secretAllowMarker}`;
    expect(scanSecrets(policy, text)).toEqual([]);
  });

  it('treats images and NUL-containing content as binary', () => {
    expect(isProbablyBinary(policy, 'public/brand/logo.png', '')).toBe(true);
    expect(isProbablyBinary(policy, 'x.bin', 'abc\0def')).toBe(true);
    expect(isProbablyBinary(policy, 'x.ts', 'const a = 1;')).toBe(false);
  });
});
