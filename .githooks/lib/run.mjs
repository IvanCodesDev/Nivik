#!/usr/bin/env node
/**
 * Hook dispatcher: `node run.mjs <hook> [args...]`. Invoked by the thin shell scripts in the
 * parent directory. Exit code 1 blocks the git operation (except post-commit, which only warns).
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  checkIdentity,
  checkMessage,
  createPathMatcher,
  isProbablyBinary,
  scanSecrets,
} from './policy.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const policy = JSON.parse(readFileSync(join(here, '..', 'policy.json'), 'utf8'));
const matchForbidden = createPathMatcher(policy.forbiddenPaths);
const ZERO_SHA = /^0+$/;
const HOOK_FILES = ['pre-commit', 'commit-msg', 'pre-push', 'post-commit'];

const [hook, ...args] = process.argv.slice(2);

function git(gitArgs, { input } = {}) {
  return execFileSync('git', gitArgs, {
    encoding: 'utf8',
    input,
    stdio: ['pipe', 'pipe', 'pipe'],
    maxBuffer: 256 * 1024 * 1024,
  });
}

function gitOrEmpty(gitArgs) {
  try {
    return git(gitArgs).trim();
  } catch {
    return '';
  }
}

const splitZ = (text) => text.split('\0').filter(Boolean);
const splitLines = (text) => text.split(/\r?\n/).filter(Boolean);

// ASCII only: hook output goes through git to consoles with arbitrary code pages.
function fail(title, problems, hints = []) {
  const lines = [
    '',
    `[hooks] FAIL ${hook}: ${title}`,
    ...problems.map((problem) => `  - ${problem}`),
    ...(hints.length ? ['', ...hints.map((hint) => `  -> ${hint}`)] : []),
    '',
    '  Policy: .githooks/policy.json',
    '',
  ];
  process.stderr.write(`${lines.join('\n')}\n`);
  process.exit(1);
}

function configuredIdentity(role) {
  const upper = role.toUpperCase();
  return {
    name: process.env[`GIT_${upper}_NAME`] ?? gitOrEmpty(['config', '--get', 'user.name']),
    email: process.env[`GIT_${upper}_EMAIL`] ?? gitOrEmpty(['config', '--get', 'user.email']),
  };
}

const IDENTITY_HINTS = [
  `git config user.name "${policy.allowedAuthors[0]}"`,
  'git config user.email "<your email>"',
  'Never commit as a coding agent (Cursor, Claude, Codex, etc.).',
];

/* ---------------------------------------------------------------- pre-commit */

function preCommit() {
  const problems = [
    ...checkIdentity(policy, configuredIdentity('author'), 'author'),
    ...checkIdentity(policy, configuredIdentity('committer'), 'committer'),
  ];
  if (problems.length)
    fail('commit identity is not allowed', [...new Set(problems)], IDENTITY_HINTS);

  const staged = splitZ(git(['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z']));
  if (staged.length === 0) return;

  const forbidden = staged
    .map((path) => ({ path, pattern: matchForbidden(path) }))
    .filter(({ pattern }) => pattern !== null);
  if (forbidden.length) {
    fail(
      'staged files are not allowed in this repository',
      forbidden.map(({ path, pattern }) => `${path}  (matches "${pattern}")`),
      [
        'Unstage them: git rm --cached -r <path>',
        'Keep them out for good: make sure .gitignore covers the path.',
      ],
    );
  }

  const oversized = [];
  const secrets = [];
  const maxBytes = policy.maxFileSizeKB * 1024;
  for (const path of staged) {
    const size = Number(gitOrEmpty(['cat-file', '-s', `:${path}`]) || 0);
    if (size > maxBytes) {
      oversized.push(`${path}  (${(size / 1024).toFixed(0)} KB > ${policy.maxFileSizeKB} KB)`);
      continue;
    }
    const content = git(['show', `:${path}`]);
    if (isProbablyBinary(policy, path, content)) continue;
    for (const finding of scanSecrets(policy, content)) {
      secrets.push(`${path}:${finding.line}  (pattern /${finding.pattern}/)`);
    }
  }
  if (oversized.length) {
    fail('staged files exceed the size limit', oversized, [
      'Large binaries do not belong in this repository; host them elsewhere.',
    ]);
  }
  if (secrets.length) {
    fail('staged content looks like a credential', secrets, [
      'Remove the secret and rotate it if it was real.',
      `Fixture data that is intentionally fake: add "${policy.secretAllowMarker}" on the same line.`,
    ]);
  }

  // Windows has no executable bit, so freshly added hook scripts land in the index as 100644 and
  // would be silently skipped on macOS/Linux. Fix the mode in place; the commit picks it up.
  const notExecutable = HOOK_FILES.map((name) => `.githooks/${name}`).filter((path) => {
    const entry = gitOrEmpty(['ls-files', '-s', '--', path]);
    return entry !== '' && !entry.startsWith('100755');
  });
  if (notExecutable.length) {
    git(['update-index', '--chmod=+x', '--', ...notExecutable]);
    process.stderr.write(
      `[hooks] marked as executable in the index: ${notExecutable.join(', ')}\n`,
    );
  }
}

/* ---------------------------------------------------------------- commit-msg */

function commitMsg() {
  const file = args[0];
  if (!file) return;
  const message = readFileSync(file, 'utf8');
  const problems = checkMessage(policy, message, { stripComments: true });
  if (problems.length) {
    fail('commit message is not allowed', problems, [
      'Only the human author may appear in a commit. Remove the trailer/footer and commit again.',
      'If Cursor injected a "Co-authored-by" line, delete it - the message is yours alone.',
    ]);
  }
}

/* ---------------------------------------------------------------- pre-push */

function prePush() {
  const updates = splitLines(readFileSync(0, 'utf8')).map((line) => line.split(' '));
  const problems = [];

  for (const [, localSha, remoteRef, remoteSha] of updates) {
    if (!localSha || ZERO_SHA.test(localSha)) continue; // branch deletion

    const range = ZERO_SHA.test(remoteSha ?? '')
      ? [localSha, '--not', '--remotes']
      : [`${remoteSha}..${localSha}`];
    const commits = splitLines(git(['rev-list', ...range]));

    for (const sha of commits) {
      const [an, ae, cn, ce, body] = git([
        'log',
        '-1',
        '--format=%an%x00%ae%x00%cn%x00%ce%x00%B',
        sha,
      ]).split('\0');
      const short = sha.slice(0, 8);
      for (const problem of [
        ...checkIdentity(policy, { name: an, email: ae }, 'author'),
        ...checkIdentity(policy, { name: cn, email: ce }, 'committer'),
        ...checkMessage(policy, body ?? ''),
      ]) {
        problems.push(`${short}: ${problem}`);
      }
      const changed = splitZ(
        git(['diff-tree', '--no-commit-id', '--name-only', '-r', '-z', '--root', sha]),
      );
      for (const path of changed) {
        const pattern = matchForbidden(path);
        if (pattern) problems.push(`${short}: touches forbidden path ${path} ("${pattern}")`);
      }
    }

    const tree = splitZ(git(['ls-tree', '-r', '--name-only', '-z', localSha]));
    for (const path of tree) {
      const pattern = matchForbidden(path);
      if (pattern)
        problems.push(`${remoteRef}: tree contains forbidden path ${path} ("${pattern}")`);
    }
  }

  if (problems.length) {
    fail(
      'refusing to push',
      [...new Set(problems)],
      [
        'Rewrite the offending commits (git rebase -i / git commit --amend --reset-author) and push again.',
        'Remove forbidden paths from history: git rm --cached -r <path>, then amend/rebase.',
      ],
    );
  }
}

/* ---------------------------------------------------------------- post-commit */

function postCommit() {
  const [an, ae, cn, ce] = git(['log', '-1', '--format=%an%x00%ae%x00%cn%x00%ce']).split('\0');
  const problems = [
    ...checkIdentity(policy, { name: an, email: ae }, 'author'),
    ...checkIdentity(policy, { name: cn, email: ce }, 'committer'),
  ];
  if (problems.length) {
    // post-commit cannot block, but pre-push will; make the fix obvious now.
    fail(
      'the commit you just made violates the identity policy (pre-push will reject it)',
      problems,
      [...IDENTITY_HINTS, 'git commit --amend --reset-author --no-edit'],
    );
  }
}

const HOOKS = {
  'pre-commit': preCommit,
  'commit-msg': commitMsg,
  'pre-push': prePush,
  'post-commit': postCommit,
};

const run = HOOKS[hook];
if (!run) {
  process.stderr.write(`unknown hook "${hook}"\n`);
  process.exit(2);
}
try {
  run();
} catch (error) {
  process.stderr.write(`[hooks] FAIL ${hook}: hook crashed - ${error?.message ?? error}\n`);
  process.exit(1);
}
