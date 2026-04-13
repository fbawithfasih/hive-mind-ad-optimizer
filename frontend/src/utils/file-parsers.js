/**
 * File parsing utilities for CSV and XLSX formats
 * Consolidates parsing logic from ListingOptimizerPanel
 */

/**
 * Parse CSV text into array of keywords
 * Supports both single column and multi-column CSV formats
 * @param {string} csvText - Raw CSV text content
 * @param {number} column - Column index to extract (default: 0, first column)
 * @returns {string[]} Array of keywords (trimmed, non-empty)
 * @throws {Error} If CSV format is invalid
 */
export function parseCsvKeywords(csvText, column = 0) {
  if (!csvText || typeof csvText !== 'string') {
    throw new Error('CSV text must be a non-empty string');
  }

  const lines = csvText
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.length > 0);

  if (lines.length === 0) {
    throw new Error('CSV file is empty');
  }

  const keywords = [];

  for (let i = 0; i < lines.length; i++) {
    try {
      // Simple CSV parsing (handle quoted fields)
      const parts = parseCsvLine(lines[i]);

      if (parts.length > column) {
        const keyword = parts[column].trim();
        if (keyword) {
          keywords.push(keyword);
        }
      }
    } catch (err) {
      throw new Error(`Error parsing CSV line ${i + 1}: ${err.message}`);
    }
  }

  if (keywords.length === 0) {
    throw new Error('No valid keywords found in CSV');
  }

  return keywords;
}

/**
 * Parse a single CSV line handling quoted fields
 * @param {string} line - CSV line to parse
 * @returns {string[]} Array of field values
 */
function parseCsvLine(line) {
  const result = [];
  let current = '';
  let insideQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      if (insideQuotes && line[i + 1] === '"') {
        // Escaped quote
        current += '"';
        i++; // Skip next quote
      } else {
        // Toggle quote state
        insideQuotes = !insideQuotes;
      }
    } else if (char === ',' && !insideQuotes) {
      // Field separator
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }

  result.push(current); // Last field

  return result;
}

/**
 * Parse XLSX file into keywords array
 * Requires xlsx library to be loaded (dynamically imported)
 * @param {File} file - XLSX file object
 * @param {number} sheetIndex - Sheet index to parse (default: 0, first sheet)
 * @param {number} column - Column index to extract (default: 0, first column)
 * @returns {Promise<string[]>} Array of keywords
 * @throws {Error} If file format is invalid or parsing fails
 */
export async function parseXlsxKeywords(file, sheetIndex = 0, column = 0) {
  if (!file || !(file instanceof File)) {
    throw new Error('Must provide a valid File object');
  }

  if (!file.name.match(/\.(xlsx|xls)$/i)) {
    throw new Error('File must be an Excel file (.xlsx or .xls)');
  }

  try {
    // Dynamically import xlsx library
    const { read, utils } = await import('xlsx');

    // Read file as array buffer
    const arrayBuffer = await file.arrayBuffer();
    const workbook = read(arrayBuffer, { type: 'array' });

    if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
      throw new Error('Excel file contains no sheets');
    }

    if (sheetIndex >= workbook.SheetNames.length) {
      throw new Error(`Sheet index ${sheetIndex} is out of range`);
    }

    // Get the specified sheet
    const sheetName = workbook.SheetNames[sheetIndex];
    const worksheet = workbook.Sheets[sheetName];

    if (!worksheet) {
      throw new Error(`Could not read sheet: ${sheetName}`);
    }

    // Convert sheet to array of arrays
    const rows = utils.sheet_to_json(worksheet, { header: 1 });

    if (!rows || rows.length === 0) {
      throw new Error('Sheet contains no data');
    }

    // Extract keywords from specified column
    const keywords = [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (Array.isArray(row) && row.length > column) {
        const keyword = String(row[column] ?? '').trim();
        if (keyword && keyword.toLowerCase() !== 'keyword') {
          // Skip header row if it says "keyword"
          keywords.push(keyword);
        }
      }
    }

    if (keywords.length === 0) {
      throw new Error(`No valid keywords found in column ${column + 1}`);
    }

    return keywords;
  } catch (err) {
    if (err instanceof Error && err.message.includes('xlsx')) {
      throw new Error('XLSX library not available. Please ensure xlsx is installed.');
    }
    throw err;
  }
}

/**
 * Parse keywords from file (auto-detect format)
 * @param {File} file - File to parse (CSV or XLSX)
 * @param {number} column - Column index (default: 0)
 * @returns {Promise<string[]>} Array of keywords
 * @throws {Error} If format is unsupported
 */
export async function parseKeywordsFile(file, column = 0) {
  if (!file || !(file instanceof File)) {
    throw new Error('Must provide a valid File object');
  }

  // Detect format by file extension
  const ext = file.name.split('.').pop()?.toLowerCase();

  if (ext === 'csv') {
    const text = await file.text();
    return parseCsvKeywords(text, column);
  } else if (ext === 'xlsx' || ext === 'xls') {
    return parseXlsxKeywords(file, 0, column);
  } else {
    throw new Error(`Unsupported file format: .${ext}. Please use CSV or XLSX.`);
  }
}

/**
 * Validate keywords array
 * @param {string[]} keywords - Keywords to validate
 * @returns {Object} {valid: boolean, errors: string[]}
 */
export function validateKeywords(keywords) {
  const errors = [];

  if (!Array.isArray(keywords)) {
    return { valid: false, errors: ['Must be an array'] };
  }

  if (keywords.length === 0) {
    errors.push('At least one keyword is required');
  }

  const maxLength = 200; // Amazon Ads API limit per keyword
  const duplicates = new Set();
  const seen = new Set();

  for (let i = 0; i < keywords.length; i++) {
    const keyword = keywords[i];

    // Check type
    if (typeof keyword !== 'string') {
      errors.push(`Keyword ${i + 1}: must be a string`);
      continue;
    }

    // Check length
    if (keyword.length > maxLength) {
      errors.push(`Keyword ${i + 1} exceeds ${maxLength} character limit`);
    }

    // Check for empty
    if (!keyword.trim()) {
      errors.push(`Keyword ${i + 1} is empty`);
    }

    // Check for duplicates
    const lower = keyword.toLowerCase();
    if (seen.has(lower)) {
      duplicates.add(lower);
    } else {
      seen.add(lower);
    }
  }

  if (duplicates.size > 0) {
    errors.push(`Found ${duplicates.size} duplicate keyword(s)`);
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Clean keywords array (remove duplicates, trim, validate)
 * @param {string[]} keywords - Raw keywords to clean
 * @returns {string[]} Cleaned keywords
 */
export function cleanKeywords(keywords) {
  if (!Array.isArray(keywords)) return [];

  const cleaned = new Set();

  for (const keyword of keywords) {
    const trimmed = String(keyword).trim().toLowerCase();
    if (trimmed) {
      cleaned.add(trimmed);
    }
  }

  return Array.from(cleaned);
}
