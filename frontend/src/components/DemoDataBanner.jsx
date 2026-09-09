/**
 * The honesty marker on sample data.
 *
 * Shown whenever the selected profile is the demo, and never dismissable: a
 * trial user who forgets that "Aarohi Handicrafts" is fictional would draw
 * conclusions about a business that does not exist. The CTA goes to the
 * Seller Central consent first — the Ads consent cannot be saved without it.
 */
export default function DemoDataBanner({ visible }) {
  if (!visible) return null;
  return (
    <div role="status" style={{
      display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12, marginBottom: 16, padding: '12px 16px',
      borderRadius: 10, background: 'color-mix(in srgb, var(--warning) 8%, transparent)',
      border: '1px solid color-mix(in srgb, var(--warning) 35%, transparent)',
    }}>
      <div style={{ flex: '1 1 320px' }}>
        <div style={{ fontWeight: 700, color: 'var(--warning-deep)' }}>You're looking at sample data</div>
        <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>
          Aarohi Handicrafts is a fictional Jaipur seller on amazon.com. Nothing here is yours yet — connect your
          Amazon account and the agent will read your real search terms.
        </div>
      </div>
      <a href="/api/sp-oauth/start" style={{
        padding: '8px 14px', borderRadius: 8, fontSize: 13, fontWeight: 700, textDecoration: 'none',
        background: 'var(--accent)', color: '#fff', whiteSpace: 'nowrap',
      }}>Connect Amazon</a>
    </div>
  );
}
