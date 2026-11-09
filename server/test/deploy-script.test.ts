import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const script = join(__dirname, '..', '..', 'deploy.sh');

/** `--dry-run` only prints where the files would go; nothing is built or copied. */
function target(arg: string | undefined, env: Record<string, string> = {}) {
  const r = spawnSync('sh', [script, '--dry-run', ...(arg === undefined ? [] : [arg])], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH ?? '', ...env },
  });
  return { status: r.status, out: r.stdout.trim(), err: r.stderr.trim() };
}

describe('deploy.sh target (the release folder is added by the script)', () => {
  it('adds /release to the project folder', () => {
    expect(target('me@srv:/srv/todoness')).toMatchObject({
      status: 0,
      out: 'me@srv:/srv/todoness/release',
    });
  });

  it('ignores a trailing slash', () => {
    expect(target('me@srv:/srv/todoness/').out).toBe('me@srv:/srv/todoness/release');
  });

  it('does not add it twice if it was given anyway (the old way still works)', () => {
    expect(target('me@srv:/srv/todoness/release').out).toBe('me@srv:/srv/todoness/release');
    expect(target('me@srv:/srv/todoness/release/').out).toBe('me@srv:/srv/todoness/release');
  });

  it('works with a folder called "release-notes" (only an exact last part counts)', () => {
    expect(target('me@srv:/srv/release-notes').out).toBe('me@srv:/srv/release-notes/release');
  });

  it('works with a relative or home folder', () => {
    expect(target('me@srv:todoness').out).toBe('me@srv:todoness/release');
    expect(target('me@srv:~/todoness').out).toBe('me@srv:~/todoness/release');
  });

  it('reads DEPLOY_TARGET when no argument is given', () => {
    expect(target(undefined, { DEPLOY_TARGET: 'me@srv:/srv/todoness' }).out).toBe(
      'me@srv:/srv/todoness/release',
    );
  });

  it('explains the usage when there is no target', () => {
    const r = target(undefined);
    expect(r.status).toBe(1);
    expect(r.err).toMatch(/Usage: .*user@server:\/path\/to\/todoness/);
    expect(r.err).not.toMatch(/release/); // nothing about release to remember any more
  });
});
