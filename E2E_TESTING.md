# E2E Testing - Phase 5

## Overview

End-to-end (E2E) tests using **Playwright** for comprehensive testing of user workflows and UI interactions across the Dashboard and key features.

**Test Suite**: 36 tests across 2 files  
**Coverage**: Dashboard navigation, metrics workflow, filtering, export preparation, error handling

## Test Structure

### 1. Dashboard Tab Navigation (`dashboard.spec.js`)
**18 tests** covering core Dashboard UI functionality:

- **Tab Switching**: 
  - Display campaigns tab by default
  - Switch to each tab (Search Terms, Listing Optimizer, Reporting Agent)
  - Cycle through all tabs
  - Verify active tab styling (blue bottom border)

- **AI Command Panel**:
  - Display AI Command section
  - Toggle between Gemini and Claude models
  - Verify model selection styling

- **Stat Cards**:
  - Display all 4 stat cards (Total Campaigns, Active, Paused, Daily Budget)
  - Verify values are rendered

- **Date Range Selection**:
  - Display date range inputs
  - Update start/end dates
  - Enforce 31-day maximum range constraint

- **Campaign Search & Filter**:
  - Search input functionality
  - Status filter dropdown (all, enabled, paused, ended, archived)
  - Filter option selection
  - Clear search terms

- **Error Handling**:
  - Error container structure
  - Error display when present

- **Sign Out**:
  - Display sign out button
  - User email display (when authenticated)

### 2. Metrics Loading Workflow (`metrics-workflow.spec.js`)
**18 tests** covering complete metrics workflow and related features:

- **Metrics Loading** (5 tests):
  - Load metrics button visible and enabled
  - Loading state during metrics fetch
  - Loading status messages
  - Campaign filtering after load
  - Metrics date range display

- **Campaign Table Interactions** (3 tests):
  - Table rendering
  - Clickable campaign rows
  - Sort functionality (if implemented)

- **Campaign Metrics Display** (3 tests):
  - Campaign table with metric columns
  - Status filtering after metrics load
  - Campaign count display

- **Export Workflow** (3 tests):
  - Export buttons in Search Terms panel
  - CSV export trigger
  - PDF export trigger
  - File download handling

- **Error Handling** (3 tests):
  - Error message display
  - Retry capability with load button
  - Error clearing on successful load

- **State Persistence** (2 tests):
  - Filters retained during metrics load
  - Status filter maintained across operations

## Running Tests

### From Frontend Directory

```bash
# Run all tests
npm run test:e2e

# Run with interactive UI (recommended for development)
npm run test:e2e:ui

# Run with browser visible (headed mode)
npm run test:e2e:headed

# Run in debug mode
npm run test:e2e:debug
```

### From Root Directory

```bash
# Run tests from root
cd frontend && npm run test:e2e

# Or with npx directly
npx playwright test
```

### Run Specific Tests

```bash
# Run single test file
npx playwright test e2e/dashboard.spec.js

# Run tests matching pattern
npx playwright test --grep "Tab Navigation"

# Run single test
npx playwright test -g "should switch to search terms tab"
```

## Test Results & Reports

After running tests:

```
playwright-report/index.html  # Interactive HTML report
```

Open the HTML report in a browser to:
- View test results with screenshots
- Replay test execution step-by-step
- See network requests and console logs
- Inspect DOM at each step

## Configuration

**File**: `playwright.config.js`

Key settings:
- **baseURL**: `http://localhost:5173` (Vite dev server)
- **testDir**: `frontend/e2e/`
- **webServer**: Auto-starts Vite dev server before tests
- **browsers**: Chromium, Firefox
- **screenshots**: Captured on test failure
- **trace**: Recording on first retry (allows step-by-step replay)

## Test Coverage Summary

| Feature | Tests | Status |
|---------|-------|--------|
| Tab Navigation | 5 | ✅ Complete |
| AI Model Selection | 1 | ✅ Complete |
| Date Range Controls | 3 | ✅ Complete |
| Search & Filter | 4 | ✅ Complete |
| Metrics Loading | 5 | ✅ Complete |
| Campaign Table | 3 | ✅ Complete |
| Export Workflow | 3 | ✅ Complete |
| Error Handling | 3 | ✅ Complete |
| State Persistence | 2 | ✅ Complete |

## Implementation Notes

### Design Approach
- **UI-Centric**: Tests focus on user interactions and visible behavior
- **Flexible Selectors**: Uses accessible role and text matchers (ARIA-aware)
- **Graceful Degradation**: Tests handle missing elements gracefully (`.catch(() => false)`)
- **State Verification**: Tests verify UI state changes after interactions

### Testing Patterns

1. **Tab Switching**:
   ```javascript
   await page.getByRole('button', { name: /Tab Name/i }).click();
   await expect(button).toHaveCSS('border-bottom-color', /rgb.*58.*130.*246/);
   ```

2. **Form Input**:
   ```javascript
   await searchInput.fill('test query');
   await expect(searchInput).toHaveValue('test query');
   ```

3. **Async Operations**:
   ```javascript
   await loadButton.click();
   const isLoading = await loadingText.isVisible().catch(() => false);
   ```

4. **Error Handling**:
   ```javascript
   const errorContainer = page.locator('[style*="F43F5E"]');
   expect(await errorContainer.count()).toBeGreaterThan(0);
   ```

### Limitations & Future Improvements

**Current Limitations**:
- No API mocking (requires running backend)
- Tests may skip if features aren't fully implemented
- Some assertions are lenient due to optional UI features
- No performance benchmarks

**Future Enhancements**:
- Add mock interceptors for API responses
- Implement test fixtures for consistent data
- Add accessibility (a11y) testing
- Add visual regression testing
- Add performance monitoring
- Expand coverage for edge cases
- Add load testing scenarios

## Troubleshooting

### Tests Timeout
```javascript
// Increase timeout for specific test
test.setTimeout(30000); // 30 seconds
```

### Elements Not Found
- Use `--headed` mode to see what's rendering
- Use `--ui` mode for interactive debugging
- Check browser console for errors

### API Call Failures
- Ensure backend is running
- Check network tab in Playwright UI
- Consider using `page.route()` for API mocking

### WebServer Won't Start
```bash
# Kill any existing Vite process
pkill -f "vite"
# Then run tests
npm run test:e2e
```

## Integration with CI/CD

For CI/CD pipelines:
```yaml
# Example GitHub Actions
- name: Run E2E Tests
  run: cd frontend && npm run test:e2e
  
- name: Upload Test Report
  if: always()
  uses: actions/upload-artifact@v3
  with:
    name: playwright-report
    path: playwright-report/
```

## Key Takeaways

✅ **36 E2E tests** covering user workflows  
✅ **Dashboard navigation** - tab switching, model selection  
✅ **Metrics workflow** - loading, filtering, export  
✅ **Error handling** - recovery, retry functionality  
✅ **State persistence** - filters maintained across operations  
✅ **Interactive debugging** - Playwright UI mode for development  

The E2E test suite enables confident refactoring and feature additions by verifying complete user workflows end-to-end.
