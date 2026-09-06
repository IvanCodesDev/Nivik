/**
 * Pure policy logic shared by the hooks. No git or filesystem access here so it can be unit
 * tested; `run.mjs` wires it to the repository.
 */

const GLOB_ESCAPE = /[.+^${}()|[\]\\]/g;

/**
 * Minimal gitignore-style glob → RegExp. Supports `**`, `*`, `?`. Like .gitignore: `name` and
 * `name/` match at any depth (the latter meaning everything inside that directory), while a pattern
 * with a slash elsewhere (`docs/**`) is anchored to the repository root.
 */
export function globToRegExp(glob) {
  let pattern = glob;
  if (pattern.endsWith('/')) pattern = `**/${pattern}**`;
  else if (!pattern.includes('/')) pattern = `**/${pattern}`;

  let source = '';
  for (let i = 0; i < pattern.length; i += 1) {
    const char = pattern[i];
    if (char === '*') {
      if (pattern[i + 1] === '*') {
        const followedBySlash = pattern[i + 2] === '/';
        source += followedBySlash ? '(?:.*/)?' : '.*';
        i += followedBySlash ? 2 : 1;
      } else {
        source += '[^/]*';
      }
    } else if (char === '?') {
      source += '[^/]';
    } else {
      source += char.replace(GLOB_ESCAPE, '\\$&');
    }
  }
  return new RegExp(`^${source}$`);
}

/** Returns `matchPath(path) → pattern | null`. Leading `!` marks an exception. */
export function createPathMatcher(patterns) {
  const denied = [];
  const allowed = [];
  for (const raw of patterns) {
    if (raw.startsWith('!')) allowed.push(globToRegExp(raw.slice(1)));
    else denied.push({ raw, regexp: globToRegExp(raw) });
  }
  return (path) => {
    const normalized = path.replace(/\\/g, '/').replace(/^\.\//, '');
    if (allowed.some((regexp) => regexp.test(normalized))) return null;
    const hit = denied.find(({ regexp }) => regexp.test(normalized));
    return hit ? hit.raw : null;
  };
}

/** Checks one identity (author or committer). Returns a list of problems (empty = ok). */
export function checkIdentity(policy, { name, email }, label = 'identity') {
  const problems = [];
  const denied = new RegExp(policy.deniedIdentityPattern, 'i');
  const trimmedName = (name ?? '').trim();
  const trimmedEmail = (email ?? '').trim();

  if (!trimmedName) {
    problems.push(`${label}: user.name is not set`);
  } else if (!policy.allowedAuthors.includes(trimmedName)) {
    problems.push(
      `${label}: "${trimmedName}" is not an allowed author (allowed: ${policy.allowedAuthors.join(', ')})`,
    );
  }
  if (trimmedName && denied.test(trimmedName)) {
    problems.push(`${label}: name "${trimmedName}" looks like a coding agent / bot`);
  }
  if (!trimmedEmail) {
    problems.push(`${label}: user.email is not set`);
  } else {
    if (denied.test(trimmedEmail)) {
      problems.push(`${label}: email "${trimmedEmail}" looks like a coding agent / bot`);
    }
    if (policy.allowedEmails.length > 0 && !policy.allowedEmails.includes(trimmedEmail)) {
      problems.push(`${label}: email "${trimmedEmail}" is not in allowedEmails`);
    }
  }
  return problems;
}

/**
 * Commit message rules: no co-authors at all, no agent attribution trailers or footers, and any
 * Signed-off-by must name an allowed author. `stripComments` is used at commit-msg time only.
 */
export function checkMessage(policy, message, { stripComments = false } = {}) {
  const problems = [];
  const lines = message.split(/\r?\n/).filter((line) => !(stripComments && line.startsWith('#')));
  const body = lines.join('\n');

  for (const line of lines) {
    if (/^\s*co-authored-by\s*:/i.test(line)) {
      problems.push(`co-author trailer is not allowed: "${line.trim()}"`);
    }
    const signedOff = /^\s*signed-off-by\s*:\s*(.+)$/i.exec(line);
    if (signedOff && !policy.allowedAuthors.some((author) => signedOff[1].includes(author))) {
      problems.push(`Signed-off-by must name an allowed author: "${line.trim()}"`);
    }
  }
  for (const source of policy.deniedMessagePatterns) {
    const regexp = new RegExp(source, 'im');
    const match = regexp.exec(body);
    if (match) problems.push(`message contains forbidden attribution: "${match[0].trim()}"`);
  }
  return problems;
}

/** Returns `[{ line, pattern }]` for secret-looking content; lines carrying the allow marker are skipped. */
export function scanSecrets(policy, text) {
  const findings = [];
  const regexps = policy.secretPatterns.map((source) => new RegExp(source, 'i'));
  const lines = text.split(/\r?\n/);
  lines.forEach((line, index) => {
    if (line.includes(policy.secretAllowMarker)) return;
    for (const regexp of regexps) {
      if (regexp.test(line)) {
        findings.push({ line: index + 1, pattern: regexp.source });
        break;
      }
    }
  });
  return findings;
}

export function isProbablyBinary(policy, path, content) {
  const lower = path.toLowerCase();
  if (policy.secretScanSkipExtensions.some((ext) => lower.endsWith(ext))) return true;
  return content.includes('\0');
}
