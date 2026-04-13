/**
 * Export utilities for PDF and CSV formats
 * Consolidates export logic from SearchTermPanel and other components
 */

/**
 * Export data to CSV format
 * @param {string[]} headers - Column headers
 * @param {Array<Array>} rows - Data rows (2D array)
 * @param {string} filename - Output filename (without .csv extension)
 * @returns {void} Triggers download
 */
export function exportToCSV(headers, rows, filename = 'export') {
  // Create CSV content
  const headerRow = headers.map(h => `"${String(h).replace(/"/g, '""')}"`).join(',');

  const dataRows = rows.map(row =>
    row
      .map(cell => `"${String(cell).replace(/"/g, '""')}"`)
      .join(',')
  );

  const csvContent = [headerRow, ...dataRows].join('\n');

  // Create blob and download
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `${filename}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}

/**
 * Export data to PDF format
 * @param {string} title - PDF title
 * @param {string[]} headers - Table column headers
 * @param {Array<Array>} rows - Table data rows (2D array)
 * @param {string} filename - Output filename (without .pdf extension)
 * @returns {void} Triggers download
 */
export function exportToPDF(title, headers, rows, filename = 'export') {
  // Create HTML table
  const headerHtml = headers
    .map(h => `<th style="border: 1px solid #ddd; padding: 8px; text-align: left; font-weight: bold;">${h}</th>`)
    .join('');

  const rowsHtml = rows
    .map(
      row =>
        `<tr>${row
          .map(cell => `<td style="border: 1px solid #ddd; padding: 8px;">${cell}</td>`)
          .join('')}</tr>`
    )
    .join('');

  const tableHtml = `
    <table style="width: 100%; border-collapse: collapse; margin-top: 20px;">
      <thead><tr>${headerHtml}</tr></thead>
      <tbody>${rowsHtml}</tbody>
    </table>
  `;

  // Create full HTML document
  const htmlContent = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <title>${title}</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif; margin: 20px; color: #333; }
          h1 { color: #1f2937; margin-bottom: 10px; }
          .timestamp { color: #6b7280; font-size: 12px; margin-bottom: 20px; }
          table { width: 100%; border-collapse: collapse; }
          th, td { border: 1px solid #d1d5db; padding: 10px; text-align: left; }
          th { background-color: #f3f4f6; font-weight: 600; }
          tr:nth-child(even) { background-color: #f9fafb; }
        </style>
      </head>
      <body>
        <h1>${title}</h1>
        <div class="timestamp">Generated on ${new Date().toLocaleString()}</div>
        ${tableHtml}
      </body>
    </html>
  `;

  // Open in new window and print
  const printWindow = window.open('', '', 'width=1200,height=800');
  printWindow.document.write(htmlContent);
  printWindow.document.close();

  // Wait for content to load then print
  setTimeout(() => {
    printWindow.print();
  }, 250);
}

/**
 * Export search terms data to CSV
 * @param {Array} searchTerms - Search term records with columns
 * @param {string} filename - Output filename
 * @returns {void} Triggers download
 */
export function exportSearchTermsCSV(searchTerms, filename = 'search-terms') {
  if (!searchTerms || searchTerms.length === 0) {
    alert('No data to export');
    return;
  }

  // Get headers from first row
  const headers = Object.keys(searchTerms[0]);

  // Convert rows to array format
  const rows = searchTerms.map(record => headers.map(h => record[h] ?? ''));

  exportToCSV(headers, rows, filename);
}

/**
 * Export campaign data to CSV
 * @param {Array} campaigns - Campaign records
 * @param {string} filename - Output filename
 * @returns {void} Triggers download
 */
export function exportCampaignsCSV(campaigns, filename = 'campaigns') {
  if (!campaigns || campaigns.length === 0) {
    alert('No data to export');
    return;
  }

  const headers = ['ID', 'Name', 'Status', 'Budget', 'Daily Budget'];
  const rows = campaigns.map(c => [c.id, c.name, c.state, c.budget, c.dailyBudget ?? '—']);

  exportToCSV(headers, rows, filename);
}

/**
 * Export report data to PDF
 * @param {string} reportTitle - Report title
 * @param {Array} data - Report data (array of records)
 * @param {string} filename - Output filename
 * @returns {void} Triggers download
 */
export function exportReportPDF(reportTitle, data, filename = 'report') {
  if (!data || data.length === 0) {
    alert('No data to export');
    return;
  }

  const headers = Object.keys(data[0]);
  const rows = data.map(record => headers.map(h => record[h] ?? ''));

  exportToPDF(reportTitle, headers, rows, filename);
}

/**
 * Generate downloadable JSON export
 * @param {any} data - Data to export
 * @param {string} filename - Output filename
 * @returns {void} Triggers download
 */
export function exportJSON(data, filename = 'export') {
  const jsonContent = JSON.stringify(data, null, 2);
  const blob = new Blob([jsonContent], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `${filename}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
}

/**
 * Copy text to clipboard
 * @param {string} text - Text to copy
 * @returns {Promise<boolean>} True if copy succeeded
 */
export async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (err) {
    console.error('Failed to copy:', err);
    return false;
  }
}
