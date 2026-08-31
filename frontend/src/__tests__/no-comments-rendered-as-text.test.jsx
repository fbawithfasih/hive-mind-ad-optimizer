/**
 * A `//` comment placed in JSX *children* is not a comment — it is text, and
 * React renders it into the page.
 *
 * This shipped. AmazonConnectPanel.jsx had:
 *
 *     <div className="rounded-lg p-2.5" style={{ ... }}>
 *       // theme-lint-ok — Amazon brand orange on their logo mark; must not flip
 *       <svg ... />
 *     </div>
 *
 * and the Amazon Account page showed a grey box reading "// theme-lint-ok —
 * Amazon brand orange on their logo mark; must not flip" where the Amazon logo
 * belongs. It builds, it lints, it type-checks; nothing catches it but looking
 * at the screen.
 *
 * The rule: inside JSX children, comments must be `{/* … *\/}`. `//` is only a
 * comment in a JS expression context — inside a `style={{ … }}` object, or
 * between attributes in an opening tag.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';

/** Every .jsx file under src/. */
function jsxFiles(dir = 'src', acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) jsxFiles(full, acc);
    else if (entry.name.endsWith('.jsx')) acc.push(full);
  }
  return acc;
}

/**
 * Find `//` lines that sit in JSX children position.
 *
 * Heuristic, deliberately narrow to avoid false alarms: the line is a bare `//`
 * comment, and the previous non-blank line ends with `>` — i.e. an opening or
 * self-closing JSX tag just closed, so what follows is children. A comment
 * inside a style object or an attribute list does not match, because those
 * lines end with `{`, `,`, `"` or similar.
 */
function commentsInJsxChildren(file) {
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const hits = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line.startsWith('//')) continue;

    let j = i - 1;
    while (j >= 0 && lines[j].trim() === '') j--;
    if (j < 0) continue;

    const prev = lines[j].trim();
    // Ends an opening tag → we are now in children position.
    if (/>$/.test(prev) && !prev.startsWith('//') && !prev.startsWith('*')) {
      hits.push({ line: i + 1, text: line.slice(0, 72) });
    }
  }
  return hits;
}

describe('comments never render as visible text', () => {
  const files = jsxFiles();

  it('finds .jsx files to scan', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it.each(files)('%s has no // comment in JSX children', (file) => {
    const hits = commentsInJsxChildren(file);
    expect(
      hits.map(h => `line ${h.line}: ${h.text}`),
    ).toEqual([]);
  });
});

describe('the detector actually detects', () => {
  // Guarding the guard: a check for a rendering bug that cannot see the bug is
  // worse than none, because it reads as coverage.
  const tmp = path.join('src', '__tests__', '.jsx-comment-fixture.jsx');

  it('catches the exact shape that shipped', () => {
    fs.writeFileSync(tmp, [
      'export default function X() {',
      '  return (',
      '    <div className="a" style={{ background: "#FF990022" }}>',
      '      // theme-lint-ok — Amazon brand orange on their logo mark',
      '      <svg />',
      '    </div>',
      '  );',
      '}',
    ].join('\n'));
    try {
      expect(commentsInJsxChildren(tmp)).toHaveLength(1);
    } finally { fs.unlinkSync(tmp); }
  });

  it('does not flag a comment inside a style object', () => {
    fs.writeFileSync(tmp, [
      'export default function X() {',
      '  return (',
      '    <a style={{',
      '      background: "linear-gradient(90deg, var(--warning), #D97706)",',
      '      // theme-lint-ok — sits on a fixed amber gradient',
      '      color: "#0F172A",',
      '    }}>go</a>',
      '  );',
      '}',
    ].join('\n'));
    try {
      expect(commentsInJsxChildren(tmp)).toEqual([]);
    } finally { fs.unlinkSync(tmp); }
  });

  it('does not flag a comment between attributes in an opening tag', () => {
    fs.writeFileSync(tmp, [
      'export default function X() {',
      '  return (',
      '    <div',
      '      className="a"',
      '      // theme-lint-ok — Amazon brand orange; must not flip',
      '      style={{ background: "#FF990022" }}',
      '    >x</div>',
      '  );',
      '}',
    ].join('\n'));
    try {
      expect(commentsInJsxChildren(tmp)).toEqual([]);
    } finally { fs.unlinkSync(tmp); }
  });

  it('does not flag a JSX comment, which is the correct form', () => {
    fs.writeFileSync(tmp, [
      'export default function X() {',
      '  return (',
      '    <div className="a">',
      '      {/* theme-lint-ok — Amazon brand orange on their logo mark */}',
      '      <svg />',
      '    </div>',
      '  );',
      '}',
    ].join('\n'));
    try {
      expect(commentsInJsxChildren(tmp)).toEqual([]);
    } finally { fs.unlinkSync(tmp); }
  });
});
