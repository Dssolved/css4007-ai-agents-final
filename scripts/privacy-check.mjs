// Pre-commit privacy check: blocks a commit whose staged changes contain words from a private
// denylist (names, places, private project names). The denylist lives OUTSIDE the repository
// (~/.css4007-denylist.txt, one word or phrase per line, # for comments), so the list itself
// never gets published. Without the file the check warns and passes.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const listPath = process.env.PRIVACY_DENYLIST ?? path.join(os.homedir(), '.css4007-denylist.txt');

export function parseDenylist(text) {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
}

/** Added lines of a unified diff that contain a denied word (case-insensitive) */
export function findLeaks(diff, words) {
  const lower = words.map((w) => w.toLowerCase());
  const leaks = [];
  let file = '';
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++ ')) file = line.slice(6);
    else if (line.startsWith('+') && !line.startsWith('+++')) {
      const l = line.toLowerCase();
      const hit = lower.find((w) => l.includes(w));
      if (hit) leaks.push({ file, word: hit });
    }
  }
  return leaks;
}

if (process.argv[1]?.endsWith('privacy-check.mjs')) {
  if (!fs.existsSync(listPath)) {
    console.warn(`privacy-check: no denylist at ${listPath} — skipped`);
  } else {
    const words = parseDenylist(fs.readFileSync(listPath, 'utf8'));
    const diff = execFileSync('git', ['diff', '--cached', '-U0', '--no-color'], { encoding: 'utf8' });
    const leaks = findLeaks(diff, words);
    if (leaks.length) {
      // The word itself is not printed: the terminal log may be shared
      for (const l of leaks) console.error(`privacy-check: denied word #${words.map((w) => w.toLowerCase()).indexOf(l.word) + 1} in ${l.file}`);
      console.error('privacy-check: commit blocked');
      process.exitCode = 1;
    }
  }
}
