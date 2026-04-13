# Lighthouse Audit CI - Phase 6

Performance monitoring and continuous auditing using Google Lighthouse integrated into CI/CD pipeline.

## Overview

Automated Lighthouse audits run on:
- **Every push** to `main` and `develop` branches
- **Every pull request** to `main` and `develop` branches
- **Multiple URLs** to test different app sections
- **3 runs per URL** for statistical validity

## Performance Targets

### Score Thresholds
- **Performance**: ≥ 80
- **Accessibility**: ≥ 90
- **Best Practices**: ≥ 85
- **SEO**: ≥ 85

### Core Web Vitals (CWV)
- **Speed Index**: ≤ 3500ms
- **Largest Contentful Paint (LCP)**: ≤ 2500ms
- **Cumulative Layout Shift (CLS)**: ≤ 0.1
- **First Input Delay (FID)**: ≤ 100ms

### Resource Budgets
- **JavaScript**: ≤ 300KB
- **Stylesheets**: ≤ 50KB
- **Images**: ≤ 500KB
- **Third-party scripts**: ≤ 10

## Configuration

### `.lighthouserc.json`

```json
{
  "ci": {
    "collect": {
      "url": [
        "http://localhost:5173",                    // Dashboard (campaigns)
        "http://localhost:5173/?tab=search-terms",  // Search Terms tab
        "http://localhost:5173/?tab=listings",      // Listing Optimizer tab
        "http://localhost:5173/?tab=reports"        // Reporting Agent tab
      ],
      "numberOfRuns": 3,
      "settings": {
        "chromeFlags": ["--no-sandbox"],
        "onlyCategories": [
          "performance",
          "accessibility",
          "best-practices",
          "seo"
        ]
      }
    },
    "assert": {
      "preset": "lighthouse:recommended",
      "assertions": {
        // Category scores
        "categories:performance": ["error", { "minScore": 0.8 }],
        "categories:accessibility": ["error", { "minScore": 0.9 }],
        "categories:best-practices": ["error", { "minScore": 0.85 }],
        "categories:seo": ["error", { "minScore": 0.85 }],
        
        // Resource budgets
        "performance-budget": [
          "error",
          {
            "resourceSizes": [
              { "resourceType": "script", "budget": 300000 },
              { "resourceType": "stylesheet", "budget": 50000 },
              { "resourceType": "image", "budget": 500000 }
            ],
            "resourceCounts": [
              { "resourceType": "third-party", "budget": 10 }
            ]
          }
        ],
        
        // Core Web Vitals
        "speed-index": ["error", { "maxNumericValue": 3500 }],
        "largest-contentful-paint": ["error", { "maxNumericValue": 2500 }],
        "cumulative-layout-shift": ["error", { "maxNumericValue": 0.1 }],
        "first-input-delay": ["error", { "maxNumericValue": 100 }]
      }
    }
  }
}
```

## GitHub Actions Workflow

### File: `.github/workflows/lighthouse-audit.yml`

**Trigger Events**:
- Push to `main` or `develop`
- Pull requests targeting `main` or `develop`

**Steps**:
1. Check out code
2. Setup Node.js 20
3. Install dependencies
4. Build frontend (production build)
5. Install Lighthouse CI globally
6. Start dev server (preview mode)
7. Run Lighthouse CI audits
8. Upload artifacts (reports, measurements)
9. Parse results and comment on PR (if PR)
10. Display final results

**Timeout**: 30 minutes total, 15 minutes for Lighthouse CI

## Using Lighthouse Audits Locally

### Install Lighthouse CI
```bash
npm install -g @lhci/cli@*
```

### Run Lighthouse CI Locally
```bash
# Start dev server in one terminal
cd frontend && npm run preview

# In another terminal, run Lighthouse
lhci autorun --config=.lighthouserc.json --upload.serverBaseUrl=http://localhost:9001
```

### View Results
```bash
# Open local HTML report
open .lighthouse/index.html

# View JSON results
cat .lighthouse/manifest.json | jq '.'
```

## CI/CD Integration

### GitHub Actions Output

1. **Workflow Artifacts**:
   - `.lighthouse/` directory uploaded
   - Retention: 30 days
   - Contains reports, measurements, and manifest

2. **PR Comments** (on pull requests):
   - Automatic comment with score summary
   - Links to full artifacts
   - Score breakdown table:
     - Performance
     - Accessibility
     - Best Practices
     - SEO

3. **Build Status**:
   - ✅ Pass: All scores meet thresholds
   - ❌ Fail: Any score below threshold
   - ⚠️ Warning: Budgets exceeded

### Accessing Reports

**GitHub Actions UI**:
1. Go to Actions tab
2. Select "Lighthouse Audit CI" workflow
3. Click the specific run
4. Download "lighthouse-report" artifact
5. Extract and open `index.html` in browser

**Direct Link**:
```
https://github.com/<owner>/<repo>/actions/workflows/lighthouse-audit.yml
```

## Performance Optimization Guide

### If Lighthouse Scores Are Low

#### Performance (< 80)
**Check**:
- JavaScript bundle size (should be < 300KB)
- Image optimization
- CSS delivery (critical CSS inline)
- Third-party scripts (Google Analytics, etc.)

**Fixes**:
```bash
# Analyze bundle size
npm run build
# Check dist/assets/ file sizes

# Optimize images
# Use WebP, compress with tinypng.com, lazy load

# Code split
# Use React.lazy() for route-based splitting

# Defer third-party
# Load GA, Sentry, etc. asynchronously
```

#### Accessibility (< 90)
**Check**:
- Color contrast ratios
- Missing ARIA labels
- Keyboard navigation
- Focus indicators

**Fixes**:
```jsx
// Add ARIA labels
<button aria-label="Load metrics">📊 Load</button>

// Ensure color contrast
// Use tools like WebAIM contrast checker

// Keyboard navigation
// Test Tab key through all interactive elements

// Focus visible
// Add :focus-visible CSS for all interactive elements
```

#### Best Practices (< 85)
**Check**:
- HTTPS usage
- Console errors
- Deprecated APIs
- Permission requests

#### SEO (< 85)
**Check**:
- Meta tags
- Page titles
- Heading hierarchy
- Mobile-friendliness

## Monitoring Performance Trends

### Track Over Time

1. **Save baseline** (initial good run):
   ```bash
   cp .lighthouse/manifest.json baseline.json
   ```

2. **Compare new runs**:
   ```bash
   # View score trend
   cat .lighthouse/manifest.json | jq '.[].results[].summary'
   ```

3. **GitHub Actions Artifacts**:
   - Compare reports from different runs
   - Identify which changes affected performance
   - Review commit diffs alongside score changes

## Troubleshooting

### Lighthouse CI Fails to Connect

```bash
# Error: "Could not access URL"
# Solution: Ensure dev server is running
cd frontend && npm run preview &
sleep 5
lhci autorun --config=.lighthouserc.json
```

### Scores Vary Between Runs

**Normal**: Lighthouse scores can vary ±5 points due to:
- Network timing
- CPU throttling simulation
- Background processes
- Browser cache state

**Solution**: `.lighthouserc.json` runs 3 times per URL for stability

### Resource Budget Exceeded

```bash
# Error: "resource exceeded budget"
# Check which resource type exceeded

# View detailed report
cat .lighthouse/manifest.json | jq '.[] | .results[] | .details'
```

### GitHub Action Times Out

**Issue**: Dev server takes too long to start or build is slow

**Fix**:
```yaml
# Increase timeout in workflow
timeout-minutes: 45  # Instead of 30
```

## Best Practices

### 1. Monitor Trends, Not Absolute Scores
- Scores fluctuate ±5 points naturally
- Focus on sustained regressions (> 10 point drop)
- Use baseline for comparison

### 2. Balance Performance vs Features
- Don't sacrifice UX for lighthouse scores
- Aim for sustainable targets (80+ is good)
- User experience matters more than 100/100

### 3. Regular Optimization
- Review failing audits in PRs
- Fix major issues before merge
- Schedule quarterly performance reviews

### 4. Test Different Conditions
- Current config: Desktop, 4G throttle
- Consider adding: Mobile, 3G throttle
- Test with different regional networks

### 5. Performance Budget Management
- Update budgets as codebase grows
- Document why budgets changed
- Distribute budget across features

## Example Workflow Outputs

### Passing Run
```
✅ Lighthouse audit completed
Performance:      85
Accessibility:    95
Best Practices:   90
SEO:              88

All targets met! 🎉
```

### Failing Run
```
❌ Lighthouse audit failed
Performance:      72 (target: 80)
Accessibility:    92
Best Practices:   83 (target: 85)
SEO:              86

Fix performance and best practices budgets.
```

### PR Comment Example
```markdown
## 🔍 Lighthouse Audit Results

| Category | Score |
|----------|-------|
| Performance | 85 |
| Accessibility | 95 |
| Best Practices | 90 |
| SEO | 88 |

[📊 Full Report](https://github.com/...)
```

## Future Enhancements

- [ ] Add mobile performance audit (separate config)
- [ ] Add 3G throttling measurement
- [ ] Store historical data in database
- [ ] Generate performance trend graphs
- [ ] Integrate with performance monitoring (Sentry, DataDog)
- [ ] Custom audit rules for domain-specific metrics
- [ ] Performance regression detection (auto-fail on > 10% drop)

## Resources

- [Google Lighthouse](https://developers.google.com/web/tools/lighthouse)
- [Lighthouse CI Documentation](https://github.com/GoogleChrome/lighthouse-ci)
- [Web Vitals Guide](https://web.dev/vitals/)
- [Performance Best Practices](https://web.dev/lighthouse-performance/)
- [Accessibility Checklist](https://www.a11yproject.com/checklist/)

## Summary

✅ Automated performance monitoring on every PR  
✅ Core Web Vitals tracking  
✅ Resource budget enforcement  
✅ Historical report artifacts  
✅ PR comments with score summaries  
✅ Multiple URL coverage (all dashboard tabs)  

The Lighthouse CI setup enables continuous performance oversight and prevents regressions from being merged to production.
