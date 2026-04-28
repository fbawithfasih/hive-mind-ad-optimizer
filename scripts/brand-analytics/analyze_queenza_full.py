#!/usr/bin/env python3
"""
Efficient analysis of large Top Search Terms CSV
Identifies Queenza competitors from 470MB+ dataset
"""

import csv
import json
from collections import defaultdict

# Increase CSV field size limit for large fields
csv.field_size_limit(10000000)

INPUT_FILE = '/mnt/user-data/uploads/Top_Search_Terms.csv'

# Queenza-relevant keywords (broad net)
QUEENZA_KEYWORDS = [
    'salt cellar', 'salt box', 'salt holder', 'salt container',
    'marble coaster', 'marble tray', 'marble box', 'marble jar',
    'marble salt', 'marble decor', 'marble jewelry', 'marble dish',
    'marble bowl', 'marble plate', 'marble holder', 'marble stand',
    'marble inlay', 'pietra dura', 'taj mahal',
    'stone coaster', 'stone tray', 'stone box',
    'inlay box', 'inlay tray', 'inlay coaster',
    'spoon rest', 'butter dish marble', 'cheese board marble',
    'jewelry box marble', 'trinket box marble',
    'handmade marble', 'indian handicraft', 'handcrafted stone',
    'sugar bowl marble', 'pepper marble',
    'serving tray marble', 'decorative tray marble'
]

# Queenza's known ASINs (from your Brand Analytics data)
QUEENZA_ASINS = {
    'B0926QF71K', 'B08N1B3W2G', 'B095WLBYPZ', 'B09Z28W5CN', 'B092B3JWPR',
    'B0B9SVWHB1', 'B09Z7ZP8K7', 'B0DW46MR5R', 'B095WNDXGJ', 'B0DG5V4DSD',
    'B07H5GG7HJ', 'B0813WN24Z', 'B0813WSV5Y'
}

print("="*70)
print("QUEENZA COMPETITOR ANALYSIS - Top Search Terms Report")
print("="*70)
print(f"\nProcessing: {INPUT_FILE}")
print("This may take a few minutes for 470MB file...\n")

# Tracking variables
competitors = defaultdict(lambda: {
    'asin': '',
    'titles': set(),
    'brands': set(),
    'keywords': [],
    'total_click_share': 0.0,
    'total_conv_share': 0.0,
    'appearances': 0,
    'categories': set()
})

queenza_appearances = []
relevant_keywords = []
total_rows = 0
relevant_count = 0
queenza_keyword_count = 0

# Process the file
with open(INPUT_FILE, 'r', encoding='utf-8-sig') as f:
    reader = csv.DictReader(f)
    
    for row in reader:
        total_rows += 1
        
        # Progress indicator
        if total_rows % 50000 == 0:
            print(f"  Processed {total_rows:,} rows... found {relevant_count:,} Queenza-relevant, {queenza_keyword_count} where Queenza appears")
        
        search_term = (row.get('Search Term') or '').strip().lower()
        
        if not search_term:
            continue
        
        # Check if relevant to Queenza's product space
        is_relevant = any(kw in search_term for kw in QUEENZA_KEYWORDS)
        
        if not is_relevant:
            continue
        
        relevant_count += 1
        
        # Check if Queenza appears in this keyword
        queenza_in_keyword = False
        queenza_position = None
        
        # Extract data from top 3 products
        for i in range(1, 4):
            asin = (row.get(f'Top Clicked Product #{i}: ASIN') or '').strip()
            title = (row.get(f'Top Clicked Product #{i}: Product Title') or '').strip()
            brand = (row.get(f'Top Clicked Brand #{i}' if i > 1 else f'Top Clicked Brand #{i}') or '').strip()
            category = (row.get(f'Top Clicked Category #{i}') or '').strip()
            
            # Get correct brand column name
            if i == 1:
                brand = (row.get('Top Clicked Brand #1') or '').strip()
            elif i == 2:
                brand = (row.get('Top Clicked Brands #2') or '').strip()
            else:
                brand = (row.get('Top Clicked Brands #3') or '').strip()
            
            try:
                click_share = float(row.get(f'Top Clicked Product #{i}: Click Share', 0) or 0)
                conv_share = float(row.get(f'Top Clicked Product #{i}: Conversion Share', 0) or 0)
            except (ValueError, TypeError):
                click_share = 0
                conv_share = 0
            
            # Check if this is Queenza
            if asin in QUEENZA_ASINS or 'queenza' in brand.lower() or 'queenza' in title.lower():
                queenza_in_keyword = True
                queenza_position = i
                queenza_appearances.append({
                    'keyword': search_term,
                    'rank': row.get('Search Frequency Rank', ''),
                    'position': i,
                    'asin': asin,
                    'click_share': click_share,
                    'conv_share': conv_share
                })
                continue
            
            # Track as competitor (skip empty ASINs and Queenza products)
            if asin and len(asin) == 10 and asin.startswith('B'):
                comp = competitors[asin]
                comp['asin'] = asin
                if title:
                    comp['titles'].add(title[:100])
                if brand:
                    comp['brands'].add(brand)
                if category:
                    comp['categories'].add(category)
                comp['keywords'].append({
                    'term': search_term,
                    'click_share': click_share,
                    'conv_share': conv_share,
                    'position': i
                })
                comp['total_click_share'] += click_share
                comp['total_conv_share'] += conv_share
                comp['appearances'] += 1
        
        if queenza_in_keyword:
            queenza_keyword_count += 1
        
        # Save relevant keyword data
        relevant_keywords.append({
            'rank': row.get('Search Frequency Rank', ''),
            'term': search_term,
            'queenza_present': queenza_in_keyword,
            'queenza_position': queenza_position
        })

print(f"\n{'='*70}")
print("ANALYSIS COMPLETE")
print(f"{'='*70}")
print(f"Total rows processed: {total_rows:,}")
print(f"Queenza-relevant keywords: {relevant_count:,}")
print(f"Keywords where Queenza appears: {queenza_keyword_count}")
print(f"Unique competitor ASINs found: {len(competitors):,}")

# Convert sets to lists for JSON serialization
for asin, data in competitors.items():
    data['titles'] = list(data['titles'])
    data['brands'] = list(data['brands'])
    data['categories'] = list(data['categories'])
    if data['appearances'] > 0:
        data['avg_click_share'] = round(data['total_click_share'] / data['appearances'], 2)
        data['avg_conv_share'] = round(data['total_conv_share'] / data['appearances'], 2)

# Sort competitors by appearances
top_competitors = sorted(
    competitors.values(),
    key=lambda x: (x['appearances'], x['total_click_share']),
    reverse=True
)

# Save results
output_file = '/home/claude/queenza_competitors_analysis.json'
with open(output_file, 'w') as f:
    json.dump({
        'summary': {
            'total_rows_processed': total_rows,
            'queenza_relevant_keywords': relevant_count,
            'queenza_appearances': queenza_keyword_count,
            'unique_competitors': len(competitors)
        },
        'queenza_appearances': queenza_appearances,
        'top_50_competitors': top_competitors[:50],
        'top_relevant_keywords': relevant_keywords[:200]
    }, f, indent=2)

print(f"\n✅ Saved to: {output_file}")

# Display top competitors
print(f"\n{'='*70}")
print("TOP 30 QUEENZA COMPETITORS (Most Frequent in Relevant Keywords)")
print(f"{'='*70}")

for i, comp in enumerate(top_competitors[:30], 1):
    title = list(comp['titles'])[0][:70] if comp['titles'] else 'N/A'
    brands = ', '.join(list(comp['brands'])[:2])
    print(f"\n{i}. ASIN: {comp['asin']}")
    print(f"   Brand(s): {brands}")
    print(f"   Title: {title}")
    print(f"   Appears in: {comp['appearances']} relevant keywords")
    print(f"   Avg Click Share: {comp.get('avg_click_share', 0)}%")
    print(f"   Avg Conv Share: {comp.get('avg_conv_share', 0)}%")
    sample_kw = [k['term'] for k in comp['keywords'][:3]]
    print(f"   Sample keywords: {', '.join(sample_kw)}")

# Display Queenza appearances
if queenza_appearances:
    print(f"\n{'='*70}")
    print(f"QUEENZA APPEARS IN {len(queenza_appearances)} KEYWORDS")
    print(f"{'='*70}")
    for app in queenza_appearances[:20]:
        print(f"\n   Keyword: '{app['keyword']}' (Rank #{app['rank']})")
        print(f"   Position: #{app['position']}")
        print(f"   ASIN: {app['asin']}")
        print(f"   Click Share: {app['click_share']}% | Conv Share: {app['conv_share']}%")

# Save ASIN list for Keepa
keepa_asins = [comp['asin'] for comp in top_competitors[:30]]
with open('/home/claude/keepa_tracking_asins.txt', 'w') as f:
    f.write("TOP 30 COMPETITOR ASINS FOR KEEPA TRACKING\n")
    f.write("="*70 + "\n\n")
    f.write("Comma-separated list (for bulk import):\n")
    f.write(','.join(keepa_asins))
    f.write("\n\nDetailed list:\n")
    for i, comp in enumerate(top_competitors[:30], 1):
        title = list(comp['titles'])[0][:80] if comp['titles'] else 'N/A'
        brand = list(comp['brands'])[0] if comp['brands'] else 'Unknown'
        f.write(f"\n{i}. {comp['asin']} - {brand}\n")
        f.write(f"   {title}\n")
        f.write(f"   Appears in {comp['appearances']} keywords\n")

print(f"\n✅ ASIN list saved to: /home/claude/keepa_tracking_asins.txt")
print("\n🎯 Analysis Complete!")
