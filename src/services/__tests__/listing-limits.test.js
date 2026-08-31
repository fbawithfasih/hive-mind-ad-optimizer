/**
 * enforceListingLimits — the last thing between a verbose model and a failed
 * publish. Amazon rejects the whole listing server-side when a field is over
 * its cap, so anything that slips through here surfaces as an opaque publish
 * error much later, after the copy has already been shown to the user as their
 * optimized listing.
 *
 * The generic-keyword cap is counted in UTF-8 BYTES, not characters, which is
 * the part most likely to be got wrong.
 */
import { enforceListingLimits } from '../claude-mcp.js';

const TITLE_MAX       = 200;
const BULLET_MAX      = 250;
const DESCRIPTION_MAX = 800;
const KEYWORD_MAX_BYTES = 250;

const bytes = (s) => new TextEncoder().encode(s).length;
/** n characters made of whole words, so word-boundary trimming has somewhere to cut. */
const words = (n) => 'lorem '.repeat(Math.ceil(n / 6)).slice(0, n);

beforeEach(() => { jest.spyOn(console, 'warn').mockImplementation(() => {}); });
afterEach(() => { jest.restoreAllMocks(); });

describe('leaving compliant output alone', () => {
  it('returns fields that already fit unchanged', () => {
    const input = {
      title: 'A good title', bullets: ['One', 'Two'],
      description: 'A description', genericKeyword: 'alpha beta',
    };

    expect(enforceListingLimits(input)).toMatchObject(input);
  });

  it('preserves fields it does not manage', () => {
    const out = enforceListingLimits({
      title: 'T', bullets: [], description: 'D', genericKeyword: '', reasoning: 'why',
    });

    expect(out.reasoning).toBe('why');
  });

  it('warns only when something was actually over', () => {
    enforceListingLimits({ title: 'short', bullets: [], description: 'd', genericKeyword: 'k' });
    expect(console.warn).not.toHaveBeenCalled();

    enforceListingLimits({ title: words(400), bullets: [], description: 'd', genericKeyword: 'k' });
    expect(console.warn).toHaveBeenCalled();
  });
});

describe('character caps', () => {
  it.each([
    ['title',       TITLE_MAX],
    ['description', DESCRIPTION_MAX],
  ])('trims %s to %i characters', (field, max) => {
    const out = enforceListingLimits({
      title: 'ok', bullets: [], description: 'ok', genericKeyword: '',
      [field]: words(max * 2),
    });

    expect(out[field].length).toBeLessThanOrEqual(max);
  });

  it('trims every bullet independently', () => {
    const out = enforceListingLimits({
      title: 'ok', description: 'ok', genericKeyword: '',
      bullets: [words(BULLET_MAX * 2), 'short', words(BULLET_MAX + 10)],
    });

    expect(out.bullets.map(b => b.length <= BULLET_MAX)).toEqual([true, true, true]);
    expect(out.bullets[1]).toBe('short');   // untouched
    expect(out.bullets).toHaveLength(3);    // none dropped
  });

  it('cuts at a word boundary when one is close enough', () => {
    const out = enforceListingLimits({
      title: words(400), bullets: [], description: 'd', genericKeyword: '',
    });

    expect(out.title.endsWith(' ')).toBe(false);
    expect(out.title).not.toMatch(/lore$|lo$|l$/);  // not cut mid-word
  });

  it('cuts hard rather than gutting a field with no late word boundary', () => {
    // One long word then nothing to break on: trimming back to the last space
    // would throw away most of the title, so it cuts at the limit instead.
    const title = `${'a'.repeat(190)} ${'b'.repeat(200)}`;
    const out = enforceListingLimits({ title, bullets: [], description: 'd', genericKeyword: '' });

    expect(out.title.length).toBeLessThanOrEqual(TITLE_MAX);
    expect(out.title.length).toBeGreaterThan(TITLE_MAX * 0.7);
  });

  it('substitutes empty strings for missing fields instead of "undefined"', () => {
    const out = enforceListingLimits({});

    expect(out).toMatchObject({ title: '', description: '', genericKeyword: '', bullets: [] });
  });

  it('survives a null entry in the bullets array', () => {
    const out = enforceListingLimits({ title: 't', description: 'd', genericKeyword: '', bullets: [null, 'ok'] });

    expect(out.bullets).toEqual(['', 'ok']);
  });
});

describe('the generic keyword byte cap', () => {
  it('measures bytes, not characters', () => {
    // 200 two-byte characters is under the character count but over 250 bytes.
    const keyword = Array.from({ length: 200 }, () => 'é').join(' ').slice(0, 200);
    const out = enforceListingLimits({ title: 't', bullets: [], description: 'd', genericKeyword: keyword });

    expect(bytes(out.genericKeyword)).toBeLessThanOrEqual(KEYWORD_MAX_BYTES);
  });

  it('drops whole terms from the end rather than splitting one', () => {
    const keyword = Array.from({ length: 60 }, (_, i) => `keyword${i}`).join(' ');
    const out = enforceListingLimits({ title: 't', bullets: [], description: 'd', genericKeyword: keyword });

    expect(bytes(out.genericKeyword)).toBeLessThanOrEqual(KEYWORD_MAX_BYTES);
    // Every surviving term is intact — no half-words that match nothing.
    for (const term of out.genericKeyword.split(' ')) {
      expect(keyword.split(' ')).toContain(term);
    }
  });

  it('keeps as much as fits', () => {
    const keyword = Array.from({ length: 60 }, (_, i) => `keyword${i}`).join(' ');
    const out = enforceListingLimits({ title: 't', bullets: [], description: 'd', genericKeyword: keyword });

    expect(bytes(out.genericKeyword)).toBeGreaterThan(KEYWORD_MAX_BYTES - 20);
  });

  it('shortens a single over-long term instead of discarding the field', () => {
    // Dropping tokens from the end empties the list when there is only one, and
    // the entire keyword field was silently thrown away.
    const out = enforceListingLimits({
      title: 't', bullets: [], description: 'd', genericKeyword: 'x'.repeat(400),
    });

    expect(out.genericKeyword.length).toBeGreaterThan(0);
    expect(bytes(out.genericKeyword)).toBeLessThanOrEqual(KEYWORD_MAX_BYTES);
  });

  it('never splits a multi-byte character when cutting hard', () => {
    // 😀 is 4 bytes; 250 is not a multiple of 4, so a naive byte slice would
    // leave a broken code point and Amazon would reject the field.
    const out = enforceListingLimits({
      title: 't', bullets: [], description: 'd', genericKeyword: '😀'.repeat(200),
    });

    expect(bytes(out.genericKeyword)).toBeLessThanOrEqual(KEYWORD_MAX_BYTES);
    expect(out.genericKeyword).not.toContain('�');
    expect([...out.genericKeyword].every(ch => ch === '😀')).toBe(true);
  });

  it('leaves an absent keyword as an empty string', () => {
    expect(enforceListingLimits({ title: 't', bullets: [], description: 'd' }).genericKeyword).toBe('');
  });
});
