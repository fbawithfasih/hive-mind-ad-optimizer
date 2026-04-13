# E2E Tests (Phase 5)

End-to-End tests using Playwright for testing complete user workflows and UI interactions.

## Test Files

- **dashboard.spec.js** — Dashboard navigation, tab switching, date range selection, filtering
- **metrics-workflow.spec.js** — Complete metrics loading workflow, campaign filtering, export preparation

## Running Tests

### Run all tests
```bash
npm run test:e2e
```

### Run in UI mode (recommended for development)
```bash
npm run test:e2e:ui
```

### Run in debug mode
```bash
npm run test:e2e:debug
```

### Run with browser visible
```bash
npm run test:e2e:headed
```

### Run specific test file
```bash
npm run test:e2e -- frontend/e2e/dashboard.spec.js
```

### Run tests matching pattern
```bash
npm run test:e2e -- --grep "Tab Navigation"
```

## Test Coverage

### Dashboard Tab Navigation
- ✅ Display campaigns tab by default
- ✅ Switch between all tabs (Campaigns, Search Terms, Listing Optimizer, Reporting Agent)
- ✅ Verify active tab styling
- ✅ AI Command input visibility
- ✅ AI model toggle (Gemini ↔ Claude)
- ✅ Stat card display
- ✅ Error container structure

### Date Range Selection
- ✅ Date input fields visible
- ✅ Start date update
- ✅ 31-day maximum range enforcement
- ✅ End date validation

### Campaign Search & Filter
- ✅ Search input functionality
- ✅ Status filter dropdown
- ✅ Filter option selection
- ✅ Search term clearing

### Metrics Loading Workflow
- ✅ Load button visibility and state
- ✅ Loading state during metrics fetch
- ✅ Campaign filtering after load
- ✅ Metrics table display
- ✅ Status filtering
- ✅ Campaign count display
- ✅ Metrics date range display

### Campaign Table
- ✅ Table rendering
- ✅ Row interactivity
- ✅ Sort functionality (if implemented)

### Export Workflow
- ✅ Export button visibility
- ✅ CSV export trigger
- ✅ PDF export trigger

### Error Handling
- ✅ Error message display
- ✅ Retry capability
- ✅ Error clearing on success

### State Persistence
- ✅ Filters retained during metrics load
- ✅ Status filter maintained across operations

## Configuration

Playwright configuration: `playwright.config.js`

Key settings:
- **baseURL**: `http://localhost:5173` (Vite dev server)
- **webServer**: Auto-starts Vite dev server
- **browsers**: Chromium, Firefox
- **screenshots**: Captured on failure
- **trace**: Recorded on first retry
- **reports**: HTML report in `playwright-report/`

## Notes

- Tests require a running backend API (mocking may be needed for full isolation)
- Tests are UI-focused and test user workflows, not API contracts
- Some tests may skip or be lenient if features aren't fully implemented
- Use `--headed` flag to see browser during test execution
- Use UI mode (`--ui`) for interactive test development

## Troubleshooting

### Tests fail due to timeouts
- Increase timeout in test: `await page.goto('/', { timeout: 15000 })`
- Ensure dev server is running: `npm run dev`

### Cannot find elements
- Use `--ui` mode to see what's being rendered
- Check browser console for errors
- Verify selectors match actual DOM structure

### API calls fail
- Some tests may require mock data or running backend
- Check network tab in Playwright inspector
- Consider using mock interceptors for API calls

## Future Improvements

- Add mock data/fixtures for consistent test data
- Implement API mocking for isolated tests
- Add performance benchmarks
- Expand test coverage for edge cases
- Add accessibility testing
