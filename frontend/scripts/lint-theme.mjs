#!/usr/bin/env node
/**
 * Theme lint — guards the colour bugs that the build cannot see.
 *
 * Every rule here corresponds to a class of defect that actually shipped to
 * production and that `vite build` compiled without complaint. The rules are
 * deliberately narrow: each one describes a shape, not a taste.
 *
 * Run:  node scripts/lint-theme.mjs [--json]
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('../src/', import.meta.url).pathname;

// Semantic tokens whose value differs between themes. Anything in this list is
// unsafe as a saturated fill under white text, because white only clears AA on
// the darker of the two values.
const FLIPPING = [
  'success', 'success-2', 'success-deep', 'info', 'info-strong', 'info-2', 'info-deep',
  'accent', 'accent-strong', 'accent-soft', 'accent-deep', 'rose', 'danger',
  'danger-strong', 'danger-soft', 'warning', 'warning-2', 'warning-3', 'warning-deep',
  'indigo', 'indigo-soft', 'teal', 'cyan', 'orange', 'sky',
].join('|');

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.jsx?$/.test(p)) out.push(p);
  }
  return out;
}

/** The style object literal enclosing `idx`, by brace matching. */
function enclosingObject(text, idx) {
  let depth = 0, i = idx;
  while (i > 0) {
    const c = text[i];
    if (c === '}') depth++;
    else if (c === '{') { if (depth === 0) break; depth--; }
    i--;
  }
  const start = i;
  depth = 0;
  let j = start;
  while (j < text.length) {
    if (text[j] === '{') depth++;
    else if (text[j] === '}') { depth--; if (depth === 0) break; }
    j++;
  }
  return text.slice(start, j + 1);
}

/** A `color:` value read to its next TOP-LEVEL comma — ternaries included. */
function* colorValues(text) {
  for (const m of text.matchAll(/(?<![A-Za-z])color:\s*/g)) {
    let i = m.index + m[0].length, depth = 0;
    const start = i;
    while (i < text.length) {
      const c = text[i];
      if ('([{`'.includes(c)) depth++;
      else if (')]}`'.includes(c)) { if (depth === 0) break; depth--; }
      else if (c === ',' && depth === 0) break;
      i++;
    }
    yield [m.index, text.slice(start, i).trim()];
  }
}

const lineOf = (text, i) => text.slice(0, i).split('\n').length;

// hardcoded-hex is ADVISORY: brand marks, pages that are deliberately light in
// both themes, and non-text icon accents are all legitimate. The other four
// rules produce silently broken CSS with no legitimate use, so they block.
const ADVISORY = new Set(['hardcoded-hex']);

const findings = [];
let CURRENT = { file: '', text: '', disabled: new Set() };
const add = (file, line, rule, detail) => {
  if (CURRENT.disabled.has(rule)) return;
  const lines = CURRENT.text.split('\n');
  const here = lines[line - 1] ?? '';
  const above = lines[line - 2] ?? '';
  if (/theme-lint-ok/.test(here) || /theme-lint-ok/.test(above)) return;
  findings.push({
    file: relative(ROOT, file), line, rule,
    detail: detail.replace(/\s+/g, ' ').slice(0, 110),
    advisory: ADVISORY.has(rule),
  });
};

const WHITE = /^#(fff|ffffff)$/i;

function analyze(file, text) {

  // ── 1. Hardcoded non-white hex as a text colour, ternaries and templates
  //       included. White is allowed: it is legitimate on a gradient or a fill.
  for (const [idx, val] of colorValues(text)) {
    // Quoted only. An unquoted hex means this is CSS inside a template string
    // — the print/export report stylesheets — which is deliberately fixed.
    for (const m of val.matchAll(/'(#[0-9A-Fa-f]{3,8})'/g)) {
      if (WHITE.test(m[1])) continue;
      add(file, lineOf(text, idx), 'hardcoded-hex',
          `color: ${val} — use a token so it flips with the theme`);
    }
  }

  // ── 2. Alpha-suffix concatenation. `var(--x)20` and `rgba(...)20` are valid
  //       to CSS.supports() but compute to transparent. Silent, and invisible
  //       to the build.
  for (const m of text.matchAll(/\$\{([A-Za-z_][\w.[\]]*)\}([0-9A-Fa-f]{2})(?![0-9A-Fa-f])/g))
    add(file, lineOf(text, m.index), 'alpha-concat',
        `\${${m[1]}}${m[2]} — use color-mix(in srgb, … N%, transparent)`);
  for (const m of text.matchAll(/\b([A-Za-z_][\w.]*)\s\+\s'([0-9A-Fa-f]{2})'/g))
    add(file, lineOf(text, m.index), 'alpha-concat',
        `${m[1]} + '${m[2]}' — use color-mix(in srgb, … N%, transparent)`);
  for (const m of text.matchAll(/'(?:var\(--[\w-]+\)|rgba?\([^)]*\))[0-9A-Fa-f]{2}'/g))
    add(file, lineOf(text, m.index), 'alpha-concat',
        `${m[0]} — literal hex alpha on a non-hex colour computes to transparent`);

  // ── 3. Hex passed as a JSX prop. Never appears in a `color:` scan.
  for (const m of text.matchAll(/\b(\w*[Cc]olor|accent)=\{?"(#[0-9A-Fa-f]{3,8})"/g)) {
    if (WHITE.test(m[2])) continue;
    add(file, lineOf(text, m.index), 'hex-prop', `${m[1]}="${m[2]}" — pass a token`);
  }

  // ── 4. White text on a bare flipping token, including the parameter-default
  //       form, where the token never appears in the style object at all.
  const flipRe = new RegExp(`'var\\(--(${FLIPPING})\\)'`, 'g');
  for (const m of text.matchAll(/color:\s*[^,}]*'#(?:fff|ffffff)'/gi)) {
    const obj = enclosingObject(text, m.index);
    for (const bm of obj.matchAll(/background(?:Color)?:\s*([^,}]+)/g)) {
      const val = bm[1];
      if (/gradient|color-mix/.test(val)) continue;   // white is fine on those
      const bare = val.match(new RegExp(`^(?:[^?]*\\?\\s*)?'var\\(--(${FLIPPING})\\)'`));
      if (bare) add(file, lineOf(text, m.index), 'white-on-flipping-fill',
                    `background: ${val.trim()} under #fff — use a --fill-* token`);
    }
  }
  // parameter defaults: (color = 'var(--info-strong)') => ({ … color: '#fff' })
  for (const m of text.matchAll(new RegExp(`\\(\\s*\\w+\\s*=\\s*${flipRe.source}`, 'g'))) {
    const after = text.slice(m.index, m.index + 600);
    if (/color:\s*[^,}]*'#(?:fff|ffffff)'/i.test(after))
      add(file, lineOf(text, m.index), 'white-on-flipping-fill',
          `parameter default var(--${m[1]}) used as a fill under #fff — use a --fill-* token`);
  }

  // ── 5. A colour used as text on a wash of ITSELF. Passes on a page, fails on
  //       its own tint; needs the -deep/-soft variant.
  for (const m of text.matchAll(/color:?\s*'var\(--([\w-]+)\)'/g)) {
    const tok = m[1];
    if (/-deep$|-soft$|^text-|^fill-/.test(tok)) continue;
    const obj = enclosingObject(text, m.index);
    const same = new RegExp(`(?:background|bg):[^,}]*color-mix\\(in srgb,\\s*var\\(--${tok}\\)`);
    if (same.test(obj))
      add(file, lineOf(text, m.index), 'text-on-own-tint',
          `--${tok} as text on a wash of itself — use --${tok}-deep or a -soft tone`);
  }
}

// ── Self-test ───────────────────────────────────────────────────────────────
// Each fixture is a shape that actually shipped a visible bug. A lint never
// shown to fail on the thing it targets is not evidence of anything.
const FIXTURES = [
  ['hardcoded-hex',   `<p style={{ color: hovered ? '#A78BFA' : 'var(--border-med)' }}>x</p>`],
  ['alpha-concat',    'const a = { background: `${color}20` };'],
  ['alpha-concat',    "const b = { background: color + '22' };"],
  ['alpha-concat',    "const c = { bg: 'var(--text-muted)18' };"],
  ['hex-prop',        `<MetricPill color="#06B6D4" />`],
  ['white-on-flipping-fill', `<span style={{ background: 'var(--rose)', color: '#fff' }}>3</span>`],
  ['white-on-flipping-fill', `const S = { btn: (color = 'var(--info-strong)') => ({ background: color, color: '#fff' }) };`],
  ['text-on-own-tint', `<b style={{ background: 'color-mix(in srgb, var(--success) 9%, transparent)', color: 'var(--success)' }}>ok</b>`],
];

function selfTest() {
  let failed = 0;
  for (const [rule, src] of FIXTURES) {
    findings.length = 0;
    CURRENT = { file: 'fixture', text: src, disabled: new Set() };
    analyze('fixture', src);
    const caught = findings.some(f => f.rule === rule);
    console.log(`  ${caught ? 'CAUGHT ' : 'MISSED '} ${rule.padEnd(24)} ${src.slice(0, 60)}`);
    if (!caught) failed++;
  }
  const clean = [
    `<b style={{ background: 'color-mix(in srgb, var(--success) 9%, transparent)', color: 'var(--success-deep)' }}>ok</b>`,
    `<span style={{ background: 'var(--fill-danger)', color: '#fff' }}>3</span>`,
    `<div style={{ background: 'linear-gradient(135deg,var(--info-strong),var(--accent-strong))', color: '#fff' }}>go</div>`,
  ].join('\n');
  findings.length = 0;
  CURRENT = { file: 'fixture', text: clean, disabled: new Set() };
  analyze('fixture', clean);
  const noise = findings.filter(f => !f.advisory);
  console.log(`  ${noise.length === 0 ? 'CAUGHT ' : 'MISSED '} ${'(negative control)'.padEnd(24)} correct code stays silent`);
  if (noise.length) { failed++; for (const f of noise) console.log(`      unexpected: ${f.rule} ${f.detail}`); }
  console.log(failed ? `\n${failed} self-test failure(s)` : '\nself-test: every shape caught, no false alarm');
  process.exit(failed ? 1 : 0);
}

if (process.argv.includes('--self-test')) selfTest();

for (const file of walk(ROOT)) {
  const text = readFileSync(file, 'utf8');
  const disabled = new Set();
  for (const m of text.matchAll(/theme-lint-disable\s+([\w,\s-]+)/g))
    for (const r of m[1].split(/[,\s]+/)) if (r) disabled.add(r.trim());
  CURRENT = { file, text, disabled };
  analyze(file, text);
}

const blocking = findings.filter(f => !f.advisory);
const advisory = findings.filter(f => f.advisory);

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(findings, null, 2));
} else {
  const show = (list, label) => {
    if (!list.length) return;
    const byRule = {};
    for (const f of list) (byRule[f.rule] ??= []).push(f);
    console.error(`\n${label}`);
    for (const [rule, l] of Object.entries(byRule)) {
      console.error(`\n  ${rule}  (${l.length})`);
      for (const f of l) console.error(`    ${f.file}:${f.line}  ${f.detail}`);
    }
  };
  show(blocking, 'BLOCKING — these compile fine and render broken:');
  if (process.argv.includes('--all')) show(advisory, 'ADVISORY — review, not enforced:');
  if (!blocking.length) {
    console.log(`theme lint: clean${advisory.length ? ` (${advisory.length} advisory, --all to list)` : ''}`);
  } else {
    console.error(`\n${blocking.length} blocking issue(s).`);
    console.error('Silence a deliberate one with `// theme-lint-ok` or a file-level');
    console.error('`/* theme-lint-disable <rule> — reason */`.\n');
  }
}
process.exit(blocking.length ? 1 : 0);
