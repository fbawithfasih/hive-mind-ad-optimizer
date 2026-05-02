// The frontend sends `searchTerms` as objects ({searchTerm, recommendation, ...})
// while ListingOptimization.keywords is declared as String[] in Prisma. Inserting
// the object array straight in throws a type error and silently empties the
// history page, so always normalize to plain strings before persisting.
export function flattenListingKeywords(arr) {
  return (Array.isArray(arr) ? arr : [])
    .map(k => typeof k === 'string' ? k : (k?.searchTerm ?? k?.term ?? ''))
    .map(s => String(s).trim())
    .filter(Boolean);
}
