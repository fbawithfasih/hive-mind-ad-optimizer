import {
  isValidDateFormat,
  isValidDateRange,
  isValidString,
  isValidPositiveInt,
  isValidASIN,
  isRequired,
} from '../validation.js';

describe('isValidDateFormat', () => {
  it('accepts valid YYYY-MM-DD dates', () => {
    expect(isValidDateFormat('2024-01-15')).toBe(true);
    expect(isValidDateFormat('2024-12-31')).toBe(true);
    expect(isValidDateFormat('2000-02-29')).toBe(true); // leap year
  });

  it('rejects non-string values', () => {
    expect(isValidDateFormat(null)).toBe(false);
    expect(isValidDateFormat(undefined)).toBe(false);
    expect(isValidDateFormat(20240115)).toBe(false);
  });

  it('rejects wrong format', () => {
    expect(isValidDateFormat('01-15-2024')).toBe(false);
    expect(isValidDateFormat('2024/01/15')).toBe(false);
    expect(isValidDateFormat('2024-1-5')).toBe(false);
    expect(isValidDateFormat('not-a-date')).toBe(false);
  });

  it('rejects invalid calendar dates', () => {
    expect(isValidDateFormat('2024-13-01')).toBe(false);
    expect(isValidDateFormat('2024-00-01')).toBe(false);
  });
});

describe('isValidDateRange', () => {
  it('accepts valid range', () => {
    expect(isValidDateRange('2024-01-01', '2024-01-31')).toEqual({ valid: true });
  });

  it('accepts same start and end date', () => {
    expect(isValidDateRange('2024-01-01', '2024-01-01')).toEqual({ valid: true });
  });

  it('rejects invalid startDate', () => {
    const result = isValidDateRange('bad-date', '2024-01-31');
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/startDate/);
  });

  it('rejects invalid endDate', () => {
    const result = isValidDateRange('2024-01-01', 'bad-date');
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/endDate/);
  });

  it('rejects startDate after endDate', () => {
    const result = isValidDateRange('2024-01-31', '2024-01-01');
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/before/);
  });
});

describe('isValidString', () => {
  it('accepts non-empty strings', () => {
    expect(isValidString('hello')).toEqual({ valid: true });
    expect(isValidString('  hello  ')).toEqual({ valid: true });
  });

  it('rejects empty string', () => {
    const result = isValidString('', 'name');
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/name/);
  });

  it('rejects whitespace-only string', () => {
    expect(isValidString('   ').valid).toBe(false);
  });

  it('rejects non-strings', () => {
    expect(isValidString(null).valid).toBe(false);
    expect(isValidString(123).valid).toBe(false);
  });

  it('uses generic field name when not provided', () => {
    expect(isValidString('').error).toMatch(/field/);
  });
});

describe('isValidPositiveInt', () => {
  it('accepts positive integers', () => {
    expect(isValidPositiveInt(1)).toEqual({ valid: true });
    expect(isValidPositiveInt(100)).toEqual({ valid: true });
    expect(isValidPositiveInt('42')).toEqual({ valid: true });
  });

  it('rejects zero', () => {
    expect(isValidPositiveInt(0).valid).toBe(false);
  });

  it('rejects negative numbers', () => {
    expect(isValidPositiveInt(-5).valid).toBe(false);
  });

  it('rejects non-numeric strings', () => {
    expect(isValidPositiveInt('abc').valid).toBe(false);
    expect(isValidPositiveInt(null).valid).toBe(false);
  });

  it('includes field name in error', () => {
    expect(isValidPositiveInt(-1, 'count').error).toMatch(/count/);
  });
});

describe('isValidASIN', () => {
  it('accepts valid 10-char uppercase alphanumeric ASINs', () => {
    expect(isValidASIN('B08N5WRWNW')).toEqual({ valid: true });
    expect(isValidASIN('0132350882')).toEqual({ valid: true });
    expect(isValidASIN('B000000000')).toEqual({ valid: true });
  });

  it('rejects ASINs with wrong length', () => {
    expect(isValidASIN('B08N5WRWN').valid).toBe(false);  // 9 chars
    expect(isValidASIN('B08N5WRWNWX').valid).toBe(false); // 11 chars
  });

  it('rejects lowercase letters', () => {
    expect(isValidASIN('b08n5wrwnw').valid).toBe(false);
  });

  it('rejects special characters', () => {
    expect(isValidASIN('B08N-WRWNW').valid).toBe(false);
  });

  it('rejects non-strings', () => {
    expect(isValidASIN(null).valid).toBe(false);
    expect(isValidASIN(1234567890).valid).toBe(false);
  });
});

describe('isRequired', () => {
  it('accepts non-null, non-undefined, non-empty values', () => {
    expect(isRequired('hello')).toEqual({ valid: true });
    expect(isRequired(0)).toEqual({ valid: true });
    expect(isRequired(false)).toEqual({ valid: true });
    expect(isRequired([])).toEqual({ valid: true });
  });

  it('rejects null', () => {
    expect(isRequired(null, 'field').valid).toBe(false);
  });

  it('rejects undefined', () => {
    expect(isRequired(undefined, 'field').valid).toBe(false);
  });

  it('rejects empty string', () => {
    expect(isRequired('', 'field').valid).toBe(false);
  });

  it('includes field name in error', () => {
    expect(isRequired(null, 'orgId').error).toMatch(/orgId/);
  });
});
