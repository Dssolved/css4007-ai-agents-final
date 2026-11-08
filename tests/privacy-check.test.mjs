import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDenylist, findLeaks } from '../scripts/privacy-check.mjs';

test('denylist ignores comments and blank lines', () => {
  assert.deepEqual(parseDenylist('# private\n\nalpha\n  Beta Gamma  \r\n'), ['alpha', 'Beta Gamma']);
});

test('only added lines are checked, case-insensitively, with the file name', () => {
  const diff = [
    '+++ b/src/a.ts',
    '@@ -1 +1 @@',
    '-old line with ALPHA',
    '+new line with Alpha',
    '+++ b/src/b.ts',
    '+clean line',
  ].join('\n');
  assert.deepEqual(findLeaks(diff, ['alpha']), [{ file: 'src/a.ts', word: 'alpha' }]);
  assert.deepEqual(findLeaks(diff, ['delta']), []);
});
