import { Component } from 'react';

/**
 * Top-level error boundary. Without one, any render-time throw (e.g. trying to
 * render a non-string error object) unmounts the entire React tree and the user
 * sees a blank white page. This catches it and shows a recoverable fallback.
 */
export default class ErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // Surfaced in the browser console; pairs with backend logs for debugging.
    console.error('Unhandled UI error:', error, info?.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div style={{ minHeight: '100vh', background: 'var(--bg-app-2)', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <div style={{ maxWidth: 460, textAlign: 'center' }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>⚠️</div>
          <h1 style={{ fontSize: 20, fontWeight: 800, margin: '0 0 8px' }}>Something went wrong</h1>
          <p style={{ fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.6, margin: '0 0 20px' }}>
            This page hit an unexpected error and couldn’t finish loading. Try reloading —
            if it keeps happening, contact support.
          </p>
          <button
            onClick={() => { this.setState({ error: null }); window.location.reload(); }}
            style={{ padding: '10px 20px', borderRadius: 8, border: 'none', background: '#3B82F6', color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
          >
            Reload page
          </button>
        </div>
      </div>
    );
  }
}
