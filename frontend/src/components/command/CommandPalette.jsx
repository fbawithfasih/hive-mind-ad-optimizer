import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Command } from 'cmdk';
import { NAV_COMMANDS, DATE_COMMANDS, ACTION_COMMANDS } from './commands.js';

const BADGE_COLORS = {
  sp: '#3B82F6', sb: '#8B5CF6', sd: '#10B981',
};

function typeLabel(t) {
  if (t === 'sponsoredProducts') return { text: 'SP', color: BADGE_COLORS.sp };
  if (t === 'sponsoredBrands')   return { text: 'SB', color: BADGE_COLORS.sb };
  if (t === 'sponsoredDisplay')  return { text: 'SD', color: BADGE_COLORS.sd };
  return { text: t ?? '—', color: 'var(--text-muted)' };
}

const STATUS_COLOR = {
  enabled: '#10B981', active: '#10B981',
  paused: '#F59E0B', ended: '#F43F5E', archived: 'var(--text-muted)',
};

export default function CommandPalette({ open, onOpenChange, actionsRef }) {
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (!open) setQuery('');
  }, [open]);

  function close() { onOpenChange(false); }

  function navigate(tab) { actionsRef.current.navigate?.(tab); close(); }
  function applyPreset(p) { actionsRef.current.applyPreset?.(p); close(); }
  function runAction(a)   {
    if (a === 'enable') actionsRef.current.enableSelected?.();
    if (a === 'pause')  actionsRef.current.pauseSelected?.();
    close();
  }
  function openCampaign(c) {
    actionsRef.current.navigate?.('campaigns');
    actionsRef.current.openCampaign?.(c);
    close();
  }

  const campaigns = actionsRef.current.campaigns ?? [];

  const panel = open ? (
    <>
      {/* Backdrop */}
      <motion.div
        key="palette-backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.15 }}
        onClick={close}
        style={{
          position: 'fixed', inset: 0, zIndex: 200,
          background: 'rgba(4,6,16,0.72)',
          backdropFilter: 'blur(6px)',
        }}
      />

      {/* Panel */}
      <motion.div
        key="palette-panel"
        initial={{ opacity: 0, scale: 0.97, y: -12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97, y: -12 }}
        transition={{ type: 'spring', stiffness: 380, damping: 30 }}
        style={{
          position: 'fixed', top: '15vh', left: '50%', transform: 'translateX(-50%)',
          width: 620, maxWidth: 'calc(100vw - 32px)',
          zIndex: 201,
          background: 'rgba(8,12,26,0.98)',
          border: '1px solid var(--overlay-8)',
          borderRadius: 16,
          boxShadow: '0 32px 80px var(--bg-overlay-lo), 0 0 0 1px rgba(59,130,246,0.08)',
          overflow: 'hidden',
        }}
      >
        <Command
          loop
          shouldFilter
          label="Command palette"
          style={{ width: '100%' }}
          onKeyDown={e => { if (e.key === 'Escape') close(); }}
        >
          {/* Search input */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '14px 18px',
            borderBottom: '1px solid var(--overlay-5)',
          }}>
            <svg width="15" height="15" fill="none" stroke="var(--border-med)" viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <Command.Input
              value={query}
              onValueChange={setQuery}
              placeholder="Search panels, campaigns, actions…"
              style={{
                flex: 1, background: 'none', border: 'none', outline: 'none',
                fontSize: 14, color: 'var(--text-primary)', caretColor: '#3B82F6',
                fontFamily: 'inherit',
              }}
            />
            <kbd style={{
              fontSize: 10, fontWeight: 700, color: 'var(--border-strong)',
              background: 'var(--overlay-4)', border: '1px solid var(--overlay-7)',
              borderRadius: 5, padding: '2px 6px', letterSpacing: '0.04em', flexShrink: 0,
            }}>
              ESC
            </kbd>
          </div>

          {/* Results list */}
          <Command.List style={{
            maxHeight: 420, overflowY: 'auto',
            padding: '6px 0 10px',
            scrollbarWidth: 'thin',
            scrollbarColor: 'var(--bg-panel) transparent',
          }}>
            <Command.Empty style={{ padding: '28px 18px', textAlign: 'center', fontSize: 13, color: 'var(--border-strong)' }}>
              No results for "{query}"
            </Command.Empty>

            {/* Navigate */}
            <Command.Group heading="Navigate" >
              {NAV_COMMANDS.map(cmd => (
                <Command.Item
                  key={cmd.id}
                  value={`navigate ${cmd.label} ${cmd.hint}`}
                  onSelect={() => navigate(cmd.tab)}
                  style={itemStyle}
                  className="cmdk-item"
                >
                  <span style={iconStyle}>{cmd.icon}</span>
                  <span style={{ flex: 1 }}>
                    <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{cmd.label}</span>
                    {cmd.hint && <span style={{ color: 'var(--border-strong)', fontSize: 11, marginLeft: 8 }}>{cmd.hint}</span>}
                  </span>
                  <span style={enterStyle}>↵</span>
                </Command.Item>
              ))}
            </Command.Group>

            <div style={dividerStyle} />

            {/* Date range */}
            <Command.Group heading="Load Metrics" >
              {DATE_COMMANDS.map(cmd => (
                <Command.Item
                  key={cmd.id}
                  value={`load metrics ${cmd.label}`}
                  onSelect={() => applyPreset(cmd.preset)}
                  style={itemStyle}
                  className="cmdk-item"
                >
                  <span style={iconStyle}>{cmd.icon}</span>
                  <span style={{ flex: 1, color: 'var(--text-primary)', fontWeight: 600 }}>{cmd.label}</span>
                  <span style={{ ...enterStyle, color: '#F59E0B' }}>{cmd.preset}</span>
                </Command.Item>
              ))}
            </Command.Group>

            <div style={dividerStyle} />

            {/* Actions */}
            <Command.Group heading="Actions" >
              {ACTION_COMMANDS.map(cmd => (
                <Command.Item
                  key={cmd.id}
                  value={`action ${cmd.label}`}
                  onSelect={() => runAction(cmd.action)}
                  style={itemStyle}
                  className="cmdk-item"
                >
                  <span style={{ ...iconStyle, fontFamily: 'system-ui' }}>{cmd.icon}</span>
                  <span style={{ flex: 1, color: 'var(--text-primary)', fontWeight: 600 }}>{cmd.label}</span>
                  <span style={enterStyle}>↵</span>
                </Command.Item>
              ))}
            </Command.Group>

            {/* Campaigns (dynamic) */}
            {campaigns.length > 0 && (
              <>
                <div style={dividerStyle} />
                <Command.Group heading="Campaigns" >
                  {campaigns.slice(0, 50).map((c, i) => {
                    const cid = c.id ?? c.campaignId;
                    const tl = typeLabel(c.campaignType);
                    const sColor = STATUS_COLOR[c.status] ?? 'var(--text-muted)';
                    return (
                      <Command.Item
                        key={cid ?? i}
                        value={`campaign ${c.name ?? ''} ${c.campaignType ?? ''} ${c.status ?? ''}`}
                        onSelect={() => openCampaign(c)}
                        style={itemStyle}
                        className="cmdk-item"
                      >
                        <span style={{ ...iconStyle, fontSize: 10, fontWeight: 800, color: tl.color }}>{tl.text}</span>
                        <span style={{ flex: 1, color: 'var(--text-muted)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {c.name}
                        </span>
                        <span style={{ fontSize: 10, fontWeight: 700, color: sColor, marginRight: 8 }}>
                          {c.status}
                        </span>
                        <span style={enterStyle}>↵</span>
                      </Command.Item>
                    );
                  })}
                </Command.Group>
              </>
            )}
          </Command.List>

          {/* Footer hint */}
          <div style={{
            padding: '8px 18px',
            borderTop: '1px solid var(--overlay-4)',
            display: 'flex', alignItems: 'center', gap: 16,
          }}>
            {[['↑↓', 'navigate'], ['↵', 'select'], ['esc', 'close']].map(([key, label]) => (
              <span key={key} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <kbd style={{ fontSize: 10, color: 'var(--bg-panel)', background: 'var(--overlay-5)', border: '1px solid var(--overlay-7)', borderRadius: 4, padding: '1px 5px' }}>
                  {key}
                </kbd>
                <span style={{ fontSize: 10, color: 'var(--bg-panel)' }}>{label}</span>
              </span>
            ))}
            <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--bg-panel)', letterSpacing: '0.04em' }}>
              ⌘K to toggle
            </span>
          </div>
        </Command>
      </motion.div>

      <style>{`
        .cmdk-item[data-selected=true] { background: rgba(59,130,246,0.12) !important; }
        .cmdk-item[data-selected=true] > span:last-child { opacity: 1 !important; }
        [cmdk-group-heading] {
          padding: 6px 18px 3px;
          font-size: 10px;
          font-weight: 800;
          letter-spacing: 0.10em;
          text-transform: uppercase;
          color: var(--bg-panel);
        }
        [cmdk-list-sizer] { padding: 0; }
      `}</style>
    </>
  ) : null;

  return createPortal(
    <AnimatePresence>{panel}</AnimatePresence>,
    document.body,
  );
}

const itemStyle = {
  display: 'flex', alignItems: 'center', gap: 10,
  padding: '9px 18px', cursor: 'pointer', fontSize: 13,
  borderRadius: 0, outline: 'none', userSelect: 'none',
};

const iconStyle = {
  width: 20, textAlign: 'center', fontSize: 13, flexShrink: 0,
};

const enterStyle = {
  fontSize: 11, color: 'var(--bg-panel)', opacity: 0, transition: 'opacity 0.1s',
};

const dividerStyle = {
  height: 1, background: 'var(--overlay-3)', margin: '4px 0',
};
