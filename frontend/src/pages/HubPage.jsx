import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { logoutApi, switchOrgApi } from '../services/api.js';

// ─── Icons ────────────────────────────────────────────────────────────────────

const Icon = ({ d, size = 18, stroke = 'currentColor', strokeWidth = 2 }) => (
  <svg width={size} height={size} fill="none" stroke={stroke} viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={strokeWidth} d={d} />
  </svg>
);

const HomeIcon    = () => <Icon d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />;
const OptimizerIcon = () => <Icon d="M13 10V3L4 14h7v7l9-11h-7z" />;
const AmazonLinkIcon = () => <Icon d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />;
const BillingIcon = () => <Icon d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />;
const TeamIcon    = () => <Icon d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />;
const SettingsIcon = () => <Icon d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z" />;
const EmailIcon   = () => <Icon d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />;
const GlobeIcon   = () => <Icon d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9" />;
const SignOutIcon  = () => <Icon d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />;

// ─── Tool definitions ─────────────────────────────────────────────────────────

const TOOLS = [
  {
    tab: 'campaigns',
    name: 'Campaigns',
    badge: 'CORE',
    desc: 'Monitor and manage Sponsored Products, Brands & Display campaigns with real-time performance metrics.',
    color: '#F97316',
    bg: 'rgba(249,115,22,0.10)',
    border: 'rgba(249,115,22,0.28)',
    glow: 'rgba(249,115,22,0.18)',
    icon: <Icon d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" size={20} />,
  },
  {
    tab: 'search-terms',
    name: 'Search Terms',
    badge: 'AI',
    desc: 'Discover winning search terms, harvest from STs, and eliminate wasted spend with AI-powered analysis.',
    color: '#3B82F6',
    bg: 'rgba(59,130,246,0.10)',
    border: 'rgba(59,130,246,0.28)',
    glow: 'rgba(59,130,246,0.18)',
    icon: <Icon d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" size={20} />,
  },
  {
    tab: 'listings',
    name: 'Listing Optimizer',
    badge: 'AI',
    desc: 'Generate SEO-rich titles, bullets and A+ content powered by Claude AI — crafted to rank on Amazon.',
    color: '#8B5CF6',
    bg: 'rgba(139,92,246,0.10)',
    border: 'rgba(139,92,246,0.28)',
    glow: 'rgba(139,92,246,0.18)',
    icon: <Icon d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" size={20} />,
  },
  {
    tab: 'bulk',
    name: 'Bulk Optimizer',
    badge: 'POWER',
    desc: 'Optimise bids and budgets across hundreds of campaigns simultaneously. Scale without the manual grind.',
    color: '#06B6D4',
    bg: 'rgba(6,182,212,0.10)',
    border: 'rgba(6,182,212,0.28)',
    glow: 'rgba(6,182,212,0.18)',
    icon: <Icon d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" size={20} />,
  },
  {
    tab: 'health',
    name: 'Listing Health',
    badge: 'MONITOR',
    desc: 'Track listing quality scores, suppression alerts and content issues before they tank your ranking.',
    color: '#10B981',
    bg: 'rgba(16,185,129,0.10)',
    border: 'rgba(16,185,129,0.28)',
    glow: 'rgba(16,185,129,0.18)',
    icon: <Icon d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" size={20} />,
  },
  {
    tab: 'keywords',
    name: 'Keyword Intelligence',
    badge: 'AI',
    desc: 'AI-powered keyword recommendations, match type analysis and opportunity scoring for your ASINs.',
    color: '#EAB308',
    bg: 'rgba(234,179,8,0.10)',
    border: 'rgba(234,179,8,0.28)',
    glow: 'rgba(234,179,8,0.18)',
    icon: <Icon d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" size={20} />,
  },
  {
    tab: 'reports',
    name: 'Reporting Agent',
    badge: 'AI',
    desc: 'Ask questions in plain English and get instant campaign insights, charts and actionable recommendations.',
    color: '#EC4899',
    bg: 'rgba(236,72,153,0.10)',
    border: 'rgba(236,72,153,0.28)',
    glow: 'rgba(236,72,153,0.18)',
    icon: <Icon d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" size={20} />,
  },
  {
    tab: 'automation',
    name: 'Automation Rules',
    badge: 'PRO',
    desc: 'Set intelligent rules to auto-adjust bids, pause underperformers and scale winners — 24/7.',
    color: '#6366F1',
    bg: 'rgba(99,102,241,0.10)',
    border: 'rgba(99,102,241,0.28)',
    glow: 'rgba(99,102,241,0.18)',
    icon: <Icon d="M13 10V3L4 14h7v7l9-11h-7z" size={20} />,
  },
  {
    tab: 'amazon',
    name: 'Amazon Connect',
    badge: 'SETUP',
    desc: 'Connect your Amazon Advertising and Seller Central accounts to unlock the complete suite.',
    color: '#F59E0B',
    bg: 'rgba(245,158,11,0.10)',
    border: 'rgba(245,158,11,0.28)',
    glow: 'rgba(245,158,11,0.18)',
    icon: <Icon d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" size={20} />,
  },
  {
    tab: 'team',
    name: 'Team & Roles',
    badge: 'ADMIN',
    desc: 'Invite team members, assign roles and manage access permissions across your organisation.',
    color: '#14B8A6',
    bg: 'rgba(20,184,166,0.10)',
    border: 'rgba(20,184,166,0.28)',
    glow: 'rgba(20,184,166,0.18)',
    icon: <Icon d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" size={20} />,
  },
];

const PLAN_CONFIG = {
  STARTER: { label: 'Starter', color: '#3B82F6', profiles: '2' },
  GROWTH:  { label: 'Growth',  color: '#8B5CF6', profiles: '6' },
  SCALE:   { label: 'Scale',   color: '#F97316', profiles: 'Unlimited' },
};

function initials(name, email) {
  if (name) return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
  if (email) return email[0].toUpperCase();
  return 'U';
}

// ─── Tool Card ────────────────────────────────────────────────────────────────

function ToolCard({ tool, onClick }) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        padding: '22px',
        borderRadius: 16,
        background: hovered ? 'rgba(22,33,55,0.98)' : 'rgba(12,20,38,0.7)',
        border: hovered ? `1px solid ${tool.border}` : '1px solid rgba(51,65,85,0.45)',
        cursor: 'pointer',
        transition: 'all 0.22s cubic-bezier(0.4,0,0.2,1)',
        transform: hovered ? 'translateY(-3px)' : 'translateY(0)',
        boxShadow: hovered
          ? `0 12px 40px ${tool.glow}, 0 2px 8px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.04)`
          : '0 2px 8px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.02)',
        display: 'flex',
        flexDirection: 'column',
        backdropFilter: 'blur(12px)',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Subtle top-edge highlight */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: 1,
        background: hovered
          ? `linear-gradient(90deg, transparent, ${tool.color}55, transparent)`
          : 'linear-gradient(90deg, transparent, rgba(255,255,255,0.04), transparent)',
        transition: 'all 0.22s',
      }} />

      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16 }}>
        <div style={{
          width: 44, height: 44, borderRadius: 12,
          background: tool.bg,
          border: `1px solid ${tool.border}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: tool.color,
          transition: 'all 0.22s',
          boxShadow: hovered ? `0 0 18px ${tool.glow}` : 'none',
        }}>
          {tool.icon}
        </div>
        <span style={{
          fontSize: 9, fontWeight: 800, letterSpacing: '0.12em',
          padding: '3px 8px', borderRadius: 100,
          background: tool.bg, color: tool.color,
          border: `1px solid ${tool.border}`,
        }}>
          {tool.badge}
        </span>
      </div>

      {/* Name */}
      <h3 style={{
        fontSize: 15, fontWeight: 700, margin: '0 0 7px',
        color: hovered ? '#F8FAFC' : '#E2E8F0',
        transition: 'color 0.2s',
      }}>
        {tool.name}
      </h3>

      {/* Description */}
      <p style={{
        fontSize: 13, color: '#64748B', lineHeight: 1.6,
        flex: 1, margin: '0 0 18px',
      }}>
        {tool.desc}
      </p>

      {/* CTA */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 5,
        fontSize: 12, fontWeight: 700, letterSpacing: '0.01em',
        color: hovered ? tool.color : '#475569',
        transition: 'color 0.2s',
      }}>
        Open tool
        <svg
          width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24"
          style={{ transform: hovered ? 'translateX(4px)' : 'translateX(0)', transition: 'transform 0.22s' }}
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
        </svg>
      </div>
    </div>
  );
}

// ─── Sidebar NavItem ──────────────────────────────────────────────────────────

function NavItem({ label, icon, to, active, external }) {
  const [hov, setHov] = useState(false);
  const style = {
    display: 'flex', alignItems: 'center', gap: 10,
    padding: '9px 12px', borderRadius: 9, marginBottom: 2,
    background: active ? 'rgba(139,92,246,0.13)' : hov ? 'rgba(51,65,85,0.45)' : 'transparent',
    border: active ? '1px solid rgba(139,92,246,0.22)' : '1px solid transparent',
    color: active ? '#A78BFA' : hov ? '#E2E8F0' : '#94A3B8',
    textDecoration: 'none', fontSize: 13, fontWeight: active ? 600 : 500,
    cursor: 'pointer', transition: 'all 0.15s',
  };
  const inner = <><span style={{ color: 'inherit', display: 'flex' }}>{icon}</span>{label}</>;
  if (external) return (
    <a href={to} target="_blank" rel="noopener noreferrer" style={style}
      onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}>
      {inner}
    </a>
  );
  return (
    <Link to={to} style={style}
      onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}>
      {inner}
    </Link>
  );
}

// ─── Hub Page ─────────────────────────────────────────────────────────────────

export default function HubPage({ user, onLogout }) {
  const navigate = useNavigate();
  const [switchingOrg, setSwitchingOrg] = useState(false);

  const organizations = user?.organizations ?? [];
  const activeOrgId   = user?.currentOrg?.id ?? '';
  const rawName       = user?.user?.name ?? user?.email?.split('@')[0] ?? 'there';
  const firstName     = rawName.split(' ')[0];
  const plan          = user?.currentOrg?.plan ?? 'GROWTH';
  const planCfg       = PLAN_CONFIG[plan] ?? PLAN_CONFIG.GROWTH;
  const userInitials  = initials(user?.user?.name, user?.email);

  async function handleSwitchOrg(orgId) {
    if (orgId === activeOrgId || switchingOrg) return;
    setSwitchingOrg(true);
    try { await switchOrgApi(orgId); window.location.reload(); }
    catch { setSwitchingOrg(false); }
  }

  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });

  return (
    <div style={{
      minHeight: '100vh', display: 'flex',
      background: '#070D1C',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, sans-serif',
      position: 'relative', overflow: 'hidden',
      color: '#F1F5F9',
    }}>

      {/* ── Background atmosphere ── */}
      <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 0 }}>
        <div style={{ position: 'absolute', top: -240, left: -120, width: 700, height: 700, background: 'radial-gradient(circle, rgba(139,92,246,0.07) 0%, transparent 65%)' }} />
        <div style={{ position: 'absolute', bottom: -200, right: -100, width: 600, height: 600, background: 'radial-gradient(circle, rgba(249,115,22,0.06) 0%, transparent 65%)' }} />
        <div style={{ position: 'absolute', top: '45%', right: '25%', width: 450, height: 450, background: 'radial-gradient(circle, rgba(59,130,246,0.05) 0%, transparent 65%)' }} />
        <div style={{ position: 'absolute', inset: 0, backgroundImage: 'radial-gradient(rgba(255,255,255,0.025) 1px, transparent 1px)', backgroundSize: '28px 28px' }} />
      </div>

      {/* ══════════════════ SIDEBAR ══════════════════ */}
      <aside style={{
        width: 262,
        flexShrink: 0,
        background: 'rgba(9,15,32,0.96)',
        borderRight: '1px solid rgba(51,65,85,0.55)',
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        position: 'sticky',
        top: 0,
        backdropFilter: 'blur(24px)',
        zIndex: 20,
      }}>

        {/* Logo */}
        <div style={{ padding: '20px 18px 16px', borderBottom: '1px solid rgba(51,65,85,0.5)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <img src="/HMN-APP-ICON.png" alt="HMN"
              style={{ width: 38, height: 38, borderRadius: 10, objectFit: 'contain', flexShrink: 0 }} />
            <div>
              <p style={{ fontWeight: 700, fontSize: 14, color: '#F1F5F9', lineHeight: 1.2, margin: 0 }}>Hive Mind</p>
              <p style={{ fontSize: 11, color: '#475569', lineHeight: 1, margin: 0 }}>Nestor Hub</p>
            </div>
          </div>
        </div>

        {/* User card */}
        <div style={{ padding: '14px 18px', borderBottom: '1px solid rgba(51,65,85,0.5)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {/* Avatar */}
            <div style={{
              width: 38, height: 38, borderRadius: '50%', flexShrink: 0,
              background: 'linear-gradient(135deg, #8B5CF6, #3B82F6)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 14, fontWeight: 700, color: '#fff',
              boxShadow: '0 0 0 2px rgba(139,92,246,0.3)',
            }}>
              {userInitials}
            </div>
            <div style={{ minWidth: 0 }}>
              <p style={{ fontSize: 13, fontWeight: 600, color: '#E2E8F0', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {rawName}
              </p>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 3 }}>
                <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#10B981', animation: 'pulse 2s infinite' }} />
                <span style={{
                  fontSize: 10, fontWeight: 700, letterSpacing: '0.05em',
                  color: planCfg.color,
                  background: planCfg.color + '18',
                  border: `1px solid ${planCfg.color}33`,
                  padding: '1px 6px', borderRadius: 100,
                }}>
                  {planCfg.label.toUpperCase()} PLAN
                </span>
              </div>
            </div>
          </div>
          {organizations.length > 1 && (
            <select
              value={activeOrgId}
              onChange={e => handleSwitchOrg(e.target.value)}
              disabled={switchingOrg}
              style={{
                marginTop: 10, width: '100%',
                background: '#111827', border: '1px solid rgba(51,65,85,0.8)',
                color: '#94A3B8', borderRadius: 8, padding: '6px 8px', fontSize: 12,
                cursor: 'pointer', outline: 'none',
              }}
            >
              {organizations.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          )}
        </div>

        {/* Navigation */}
        <nav style={{ flex: 1, padding: '14px 10px', overflowY: 'auto' }}>
          <p style={{ fontSize: 9, fontWeight: 700, color: '#334155', textTransform: 'uppercase', letterSpacing: '0.12em', padding: '0 10px', marginBottom: 6 }}>
            Main
          </p>
          <NavItem label="Home"               icon={<HomeIcon />}       to="/"              active />
          <NavItem label="Ad Optimizer 360"   icon={<OptimizerIcon />}  to="/app"           />
          <NavItem label="Amazon Account"     icon={<AmazonLinkIcon />} to="/app?tab=amazon" />
          <NavItem label="Billing"            icon={<BillingIcon />}    to="/billing"       />
          <NavItem label="Team"               icon={<TeamIcon />}       to="/app?tab=team"  />
          <NavItem label="Settings"           icon={<SettingsIcon />}   to="/app?tab=amazon" />

          <div style={{ height: 1, background: 'rgba(51,65,85,0.4)', margin: '14px 0' }} />

          <p style={{ fontSize: 9, fontWeight: 700, color: '#334155', textTransform: 'uppercase', letterSpacing: '0.12em', padding: '0 10px', marginBottom: 6 }}>
            Support
          </p>
          <NavItem label="Email Support" icon={<EmailIcon />}  to="mailto:info@hivemindnestor.com" external />
          <NavItem label="Website"       icon={<GlobeIcon />}  to="https://www.hivemindnestor.com" external />
        </nav>

        {/* Sign out */}
        <div style={{ padding: '12px 10px', borderTop: '1px solid rgba(51,65,85,0.5)' }}>
          <SignOutButton onLogout={onLogout} />
        </div>
      </aside>

      {/* ══════════════════ MAIN ══════════════════ */}
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: '100vh', position: 'relative', zIndex: 1 }}>

        {/* Top bar */}
        <header style={{
          position: 'sticky', top: 0, zIndex: 10,
          background: 'rgba(7,13,28,0.88)',
          backdropFilter: 'blur(20px)',
          borderBottom: '1px solid rgba(51,65,85,0.4)',
          padding: '13px 36px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          {/* Breadcrumb */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
            <span style={{ color: '#334155' }}>Hive Mind Nestor</span>
            <span style={{ color: '#1E293B' }}>/</span>
            <span style={{ color: '#64748B', fontWeight: 600 }}>Hub</span>
          </div>

          {/* Right controls */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {/* Live indicator */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '4px 12px', borderRadius: 100,
              background: 'rgba(16,185,129,0.08)',
              border: '1px solid rgba(16,185,129,0.22)',
            }}>
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#10B981' }} className="animate-pulse" />
              <span style={{ fontSize: 11, fontWeight: 600, color: '#10B981' }}>All systems live</span>
            </div>
            <Link to="/billing" style={{
              fontSize: 12, fontWeight: 600, color: '#94A3B8', padding: '6px 14px',
              borderRadius: 7, border: '1px solid rgba(51,65,85,0.8)',
              background: 'rgba(30,41,59,0.5)', textDecoration: 'none',
            }}>
              Billing
            </Link>
          </div>
        </header>

        {/* ── Content ── */}
        <div style={{ flex: 1, padding: '44px 40px 70px', maxWidth: 1080, width: '100%', margin: '0 auto', boxSizing: 'border-box' }}>

          {/* ── Welcome hero ── */}
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 24, flexWrap: 'wrap', marginBottom: 48 }}>
            <div>
              <p style={{ fontSize: 12, fontWeight: 600, color: '#334155', marginBottom: 8, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                {today}
              </p>
              <h1 style={{
                fontSize: 42, fontWeight: 900, letterSpacing: '-1px', lineHeight: 1.08,
                margin: '0 0 12px',
                background: 'linear-gradient(135deg, #F1F5F9 20%, #94A3B8 100%)',
                WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
              }}>
                Welcome back,<br />{firstName} 👋
              </h1>
              <p style={{ fontSize: 15, color: '#475569', lineHeight: 1.6, margin: 0, maxWidth: 480 }}>
                Your <strong style={{ color: '#94A3B8' }}>Hive Mind Ad Optimizer 360</strong> suite is live and ready.
                Pick a tool below to dive in.
              </p>
            </div>

            {/* Plan card */}
            <PlanCard planCfg={planCfg} plan={plan} />
          </div>

          {/* ── Stats row ── */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: 12, marginBottom: 44,
          }}>
            {[
              { label: 'Tools Included',  value: TOOLS.length, icon: '⚡', color: '#8B5CF6' },
              { label: 'Amazon Profiles', value: planCfg.profiles, icon: '📦', color: '#3B82F6' },
              { label: 'AI Models',       value: '2',  icon: '🤖', color: '#EC4899' },
              { label: 'Support',         value: 'Priority', icon: '💬', color: '#10B981' },
            ].map(s => (
              <div key={s.label} style={{
                padding: '16px 20px', borderRadius: 12,
                background: 'rgba(15,23,42,0.6)',
                border: '1px solid rgba(51,65,85,0.45)',
                backdropFilter: 'blur(10px)',
                display: 'flex', alignItems: 'center', gap: 12,
              }}>
                <div style={{
                  width: 38, height: 38, borderRadius: 10, flexShrink: 0,
                  background: s.color + '18', border: `1px solid ${s.color}33`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 17,
                }}>
                  {s.icon}
                </div>
                <div>
                  <p style={{ fontSize: 20, fontWeight: 800, color: '#F1F5F9', margin: 0, lineHeight: 1 }}>{s.value}</p>
                  <p style={{ fontSize: 11, color: '#475569', margin: '3px 0 0', fontWeight: 500 }}>{s.label}</p>
                </div>
              </div>
            ))}
          </div>

          {/* ── Tools section ── */}
          <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
            <div>
              <h2 style={{ fontSize: 20, fontWeight: 800, color: '#E2E8F0', margin: '0 0 4px', letterSpacing: '-0.3px' }}>
                Your Tools
              </h2>
              <p style={{ fontSize: 13, color: '#334155', margin: 0 }}>
                {TOOLS.length} tools included in your Ad Optimizer 360 plan
              </p>
            </div>
            <Link to="/app" style={{
              display: 'flex', alignItems: 'center', gap: 6,
              fontSize: 13, fontWeight: 700, color: '#8B5CF6',
              padding: '8px 18px', borderRadius: 9,
              border: '1px solid rgba(139,92,246,0.3)',
              background: 'rgba(139,92,246,0.08)',
              textDecoration: 'none', transition: 'all 0.15s',
            }}>
              Full dashboard
              <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
              </svg>
            </Link>
          </div>

          {/* Tool grid */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(295px, 1fr))',
            gap: 14,
            marginBottom: 52,
          }}>
            {TOOLS.map(tool => (
              <ToolCard
                key={tool.tab}
                tool={tool}
                onClick={() => navigate(`/app?tab=${tool.tab}`)}
              />
            ))}
          </div>

          {/* ── Help banner ── */}
          <div style={{
            padding: '28px 32px',
            borderRadius: 18,
            background: 'linear-gradient(135deg, rgba(15,23,42,0.9) 0%, rgba(22,33,55,0.9) 100%)',
            border: '1px solid rgba(51,65,85,0.6)',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            gap: 20, flexWrap: 'wrap',
            position: 'relative', overflow: 'hidden',
          }}>
            {/* decorative gradient */}
            <div style={{
              position: 'absolute', right: -60, top: -60, width: 220, height: 220,
              background: 'radial-gradient(circle, rgba(249,115,22,0.08) 0%, transparent 70%)',
              pointerEvents: 'none',
            }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, position: 'relative' }}>
              <div style={{
                width: 48, height: 48, borderRadius: 14, flexShrink: 0,
                background: 'rgba(249,115,22,0.12)', border: '1px solid rgba(249,115,22,0.22)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <svg width="22" height="22" fill="none" stroke="#F97316" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 5.636l-3.536 3.536m0 5.656l3.536 3.536M9.172 9.172L5.636 5.636m3.536 9.192l-3.536 3.536M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-5 0a4 4 0 11-8 0 4 4 0 018 0z"/>
                </svg>
              </div>
              <div>
                <p style={{ fontSize: 15, fontWeight: 700, color: '#F1F5F9', margin: '0 0 4px' }}>
                  Need help getting started?
                </p>
                <p style={{ fontSize: 13, color: '#475569', margin: 0 }}>
                  Our Amazon experts are here to walk you through the platform.
                </p>
              </div>
            </div>
            <a
              href="mailto:info@hivemindnestor.com"
              style={{
                padding: '11px 22px', borderRadius: 10, flexShrink: 0,
                background: 'linear-gradient(135deg, #F97316, #F59E0B)',
                color: '#fff', fontSize: 13, fontWeight: 700,
                textDecoration: 'none',
                boxShadow: '0 4px 20px rgba(249,115,22,0.35)',
                transition: 'all 0.15s',
                position: 'relative',
              }}
            >
              Contact Support →
            </a>
          </div>

        </div>
      </main>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </div>
  );
}

// ─── Plan Card ────────────────────────────────────────────────────────────────

function PlanCard({ planCfg, plan }) {
  return (
    <div style={{
      padding: '20px 24px',
      borderRadius: 16,
      background: 'rgba(12,20,38,0.85)',
      border: `1px solid ${planCfg.color}30`,
      backdropFilter: 'blur(16px)',
      minWidth: 230,
      boxShadow: `0 0 40px ${planCfg.color}0D`,
      position: 'relative', overflow: 'hidden',
    }}>
      {/* Glow top border */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: 2,
        background: `linear-gradient(90deg, transparent, ${planCfg.color}88, transparent)`,
      }} />

      <p style={{ fontSize: 10, fontWeight: 700, color: '#334155', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 14 }}>
        Active Plan
      </p>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
        <div style={{
          width: 36, height: 36, borderRadius: 10,
          background: planCfg.color + '18', border: `1px solid ${planCfg.color}33`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <svg width="16" height="16" fill="none" stroke={planCfg.color} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M13 10V3L4 14h7v7l9-11h-7z"/>
          </svg>
        </div>
        <div>
          <p style={{ fontSize: 14, fontWeight: 800, color: '#F1F5F9', margin: 0, lineHeight: 1.2 }}>
            Ad Optimizer 360
          </p>
          <span style={{
            fontSize: 10, fontWeight: 700, letterSpacing: '0.08em',
            padding: '2px 8px', borderRadius: 100,
            background: planCfg.color + '18', color: planCfg.color,
            border: `1px solid ${planCfg.color}33`,
          }}>
            {planCfg.label.toUpperCase()}
          </span>
        </div>
      </div>

      <div style={{ fontSize: 12, color: '#475569', marginBottom: 16 }}>
        Up to <strong style={{ color: '#94A3B8' }}>{planCfg.profiles} profiles</strong> · All tools included
      </div>

      <Link to="/billing" style={{
        display: 'block', textAlign: 'center',
        fontSize: 12, fontWeight: 700, color: planCfg.color,
        padding: '8px', borderRadius: 9,
        border: `1px solid ${planCfg.color}30`,
        background: planCfg.color + '0F',
        textDecoration: 'none',
      }}>
        Manage subscription →
      </Link>
    </div>
  );
}

// ─── Sign out button ──────────────────────────────────────────────────────────

function SignOutButton({ onLogout }) {
  const [hov, setHov] = useState(false);
  return (
    <button
      onClick={async () => { await logoutApi(); onLogout(); }}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        width: '100%', padding: '9px 12px', borderRadius: 9,
        background: hov ? 'rgba(239,68,68,0.08)' : 'transparent',
        border: hov ? '1px solid rgba(239,68,68,0.2)' : '1px solid transparent',
        color: hov ? '#F87171' : '#475569',
        fontSize: 13, fontWeight: 500, cursor: 'pointer',
        transition: 'all 0.15s', textAlign: 'left',
      }}
    >
      <SignOutIcon />
      Sign out
    </button>
  );
}
