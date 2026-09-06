#!/usr/bin/env node
/**
 * Points this clone at the versioned hooks: `git config core.hooksPath .githooks`.
 * Runs automatically from the root `prepare` script (pnpm install) and via `pnpm hooks:install`.
 * A repository-local core.hooksPath takes precedence over any global one, so the policy applies
 * even on machines with their own global hooks directory.
 */
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const HOOKS = ['pre-commit', 'commit-msg', 'pre-push', 'post-commit'];

function git(args) {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

let insideRepo = false;
try {
  insideRepo = git(['rev-parse', '--is-inside-work-tree']) === 'true';
} catch {
  insideRepo = false;
}
if (!insideRepo || !existsSync(join(root, '.githooks'))) {
  console.log('[hooks] not a git checkout — skipping hook installation');
  process.exit(0);
}

for (const name of HOOKS) {
  try {
    chmodSync(join(here, name), 0o755);
  } catch {
    // Windows has no executable bit; git runs hooks through sh regardless.
  }
}

let current = '';
try {
  current = git(['config', '--local', '--get', 'core.hooksPath']);
} catch {
  current = '';
}
if (current !== '.githooks') {
  git(['config', 'core.hooksPath', '.githooks']);
  console.log('[hooks] core.hooksPath set to .githooks');
} else {
  console.log('[hooks] core.hooksPath already .githooks');
}
console.log(`[hooks] active: ${HOOKS.join(', ')} (policy: .githooks/policy.json)`);
