import React, { useState, useEffect } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { logoutApi, switchOrgApi, syncProfilesApi } from '../services/api.js';
import { useTheme } from '../hooks/useTheme.jsx';
import SupportContact from '../components/SupportContact.jsx';

const Icon = ({ d, size = 18, stroke = 'currentColor', strokeWidth = 2 }) => (
  <svg width={size} height={size} fill="none" stroke={stroke} viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={strokeWidth} d={d} />
  </svg>
);

const HomeIcon     = () => <Icon d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />;
const OptimizerIcon = () => <Icon d="M13 10V3L4 14h7v7l9-11h-7z" />;
const AmazonIcon   = () => <Icon d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />;
const BillingIcon  = () => <Icon d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />;
const TeamIcon     = () => <Icon d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />;
const SettingsIcon = () => <Icon d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z" />;
const EmailIcon    = () => <Icon d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />;
const GlobeIcon    = () => <Icon d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9" />;
const SignOutIcon  = () => <Icon d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />;

const TOOLS = [
  {
    tab: 'campaigns', name: 'Campaigns', badge: 'CORE',
    desc: 'Monitor and manage Sponsored Products, Brands & Display campaigns with real-time performance metrics.',
    gradient: 'linear-gradient(135deg, #FF6B35, #F7931E)',
    glow: 'rgba(255,107,53,0.45)',
    bg: 'rgba(255,107,53,0.12)',
    border: 'rgba(255,107,53,0.35)',
    color: '#FF8C5A',
    icon: <Icon d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" size={22} />,
  },
  {
    tab: 'search-terms', name: 'Search Terms', badge: 'AI',
    desc: 'Harvest winning keywords, eliminate wasted spend and discover hidden gems with AI-powered analysis.',
    gradient: 'linear-gradient(135deg, #4776E6, #8E54E9)',
    glow: 'rgba(142,84,233,0.45)',
    bg: 'rgba(142,84,233,0.12)',
    border: 'rgba(142,84,233,0.35)',
    color: 'var(--accent)',
    icon: <Icon d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" size={22} />,
  },
  {
    tab: 'listings', name: 'Listing Optimizer', badge: 'AI',
    desc: 'Generate SEO-rich titles, bullets and A+ content powered by Claude AI — crafted to rank on Amazon.',
    gradient: 'linear-gradient(135deg, #DA22FF, #9733EE)',
    glow: 'rgba(218,34,255,0.40)',
    bg: 'rgba(218,34,255,0.10)',
    border: 'rgba(218,34,255,0.32)',
    color: '#E879F9',
    icon: <Icon d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" size={22} />,
  },
  {
    tab: 'image-optimizer', name: 'Main Image Optimizer', badge: 'AI',
    desc: 'Upload your product photo, answer a short brief, and generate an Amazon-compliant main image with a pure-white background.',
    gradient: 'linear-gradient(135deg, var(--accent-strong), var(--info-strong))',
    glow: 'rgba(139,92,246,0.40)',
    bg: 'rgba(139,92,246,0.10)',
    border: 'rgba(139,92,246,0.32)',
    color: 'var(--accent)',
    icon: <Icon d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" size={22} />,
  },
  {
    tab: 'listing-history', name: 'Optimization History', badge: 'DATA',
    desc: 'Browse every past AI optimization run — see before/after content, published status, and keywords used.',
    gradient: 'linear-gradient(135deg, var(--indigo), var(--accent-strong))',
    glow: 'rgba(99,102,241,0.40)',
    bg: 'rgba(99,102,241,0.10)',
    border: 'rgba(99,102,241,0.32)',
    color: 'var(--indigo-soft)',
    icon: <Icon d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" size={22} />,
  },
  {
    tab: 'bulk', name: 'Bulk Optimizer', badge: 'POWER',
    desc: 'Optimise bids and budgets across hundreds of campaigns simultaneously. Scale without the grind.',
    gradient: 'linear-gradient(135deg, #00C9FF, #00B4D8)',
    glow: 'rgba(0,201,255,0.40)',
    bg: 'rgba(0,201,255,0.10)',
    border: 'rgba(0,201,255,0.32)',
    color: '#22D3EE',
    icon: <Icon d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" size={22} />,
  },
  {
    tab: 'health', name: 'Listing Health', badge: 'MONITOR',
    desc: 'Track quality scores, suppression alerts and content issues before they tank your ranking.',
    gradient: 'linear-gradient(135deg, #0BA360, #3CBA92)',
    glow: 'rgba(11,163,96,0.42)',
    bg: 'rgba(11,163,96,0.10)',
    border: 'rgba(11,163,96,0.32)',
    color: 'var(--success-2)',
    icon: <Icon d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" size={22} />,
  },
  {
    tab: 'keywords', name: 'Keyword Intelligence', badge: 'AI',
    desc: 'AI keyword recommendations, match type analysis and opportunity scoring for all your ASINs.',
    gradient: 'linear-gradient(135deg, #F7971E, #FFD200)',
    glow: 'rgba(247,151,30,0.45)',
    bg: 'rgba(247,151,30,0.10)',
    border: 'rgba(247,151,30,0.32)',
    color: 'var(--warning-3)',
    icon: <Icon d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" size={22} />,
  },
  {
    tab: 'reports', name: 'Reporting Agent', badge: 'AI',
    desc: 'Ask in plain English — get instant campaign insights, charts and actionable recommendations.',
    gradient: 'linear-gradient(135deg, #f953c6, #b91d73)',
    glow: 'rgba(249,83,198,0.42)',
    bg: 'rgba(249,83,198,0.10)',
    border: 'rgba(249,83,198,0.32)',
    color: '#F472B6',
    icon: <Icon d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" size={22} />,
  },
  {
    tab: 'alerts', name: 'Campaign Alerts', badge: 'NEW',
    desc: 'Set ACoS, spend, ROAS and other thresholds — get notified the moment any campaign crosses a limit.',
    gradient: 'linear-gradient(135deg, var(--rose), var(--danger-strong))',
    glow: 'rgba(244,63,94,0.40)',
    bg: 'rgba(244,63,94,0.10)',
    border: 'rgba(244,63,94,0.32)',
    color: 'var(--danger)',
    icon: <Icon d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" size={22} />,
  },
  {
    tab: 'automation', name: 'Automation Rules', badge: 'PRO',
    desc: 'Set intelligent rules to auto-adjust bids, pause underperformers and scale winners — 24/7.',
    gradient: 'linear-gradient(135deg, #4776E6, #3B1FDB)',
    glow: 'rgba(71,118,230,0.42)',
    bg: 'rgba(71,118,230,0.10)',
    border: 'rgba(71,118,230,0.32)',
    color: '#818CF8',
    icon: <Icon d="M13 10V3L4 14h7v7l9-11h-7z" size={22} />,
  },
  {
    tab: 'amazon', name: 'Amazon Connect', badge: 'SETUP',
    desc: 'Connect your Amazon Advertising and Seller Central accounts to unlock the complete suite.',
    gradient: 'linear-gradient(135deg, var(--warning), #D97706)',
    glow: 'rgba(245,158,11,0.42)',
    bg: 'rgba(245,158,11,0.10)',
    border: 'rgba(245,158,11,0.32)',
    color: 'var(--warning-2)',
    icon: <Icon d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" size={22} />,
  },
  {
    tab: 'team', name: 'Team & Roles', badge: 'ADMIN',
    desc: 'Invite members, assign roles and manage access permissions across your organisation.',
    gradient: 'linear-gradient(135deg, #11998e, #38ef7d)',
    glow: 'rgba(17,153,142,0.42)',
    bg: 'rgba(17,153,142,0.10)',
    border: 'rgba(17,153,142,0.32)',
    color: '#2DD4BF',
    icon: <Icon d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" size={22} />,
  },
];

const PLAN_CONFIG = {
  STARTER: { label: 'Starter', color: 'var(--info)', glow: 'rgba(96,165,250,0.4)',  profiles: '2' },
  GROWTH:  { label: 'Growth',  color: 'var(--accent)', glow: 'rgba(167,139,250,0.4)', profiles: '6' },
  SCALE:   { label: 'Scale',   color: '#FB923C', glow: 'rgba(251,146,60,0.4)',  profiles: 'Unlimited' },
};

function initials(name, email) {
  if (name) return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
  if (email) return email[0].toUpperCase();
  return 'U';
}

function ToolCard({ tool, onClick }) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        padding: '24px',
        borderRadius: 20,
        background: hovered
          ? `linear-gradient(145deg, ${tool.bg}, var(--bg-overlay-hi))`
          : 'var(--bg-overlay-lo)',
        border: `1px solid ${hovered ? tool.border : 'var(--overlay-5)'}`,
        cursor: 'pointer',
        transition: 'all 0.25s cubic-bezier(0.4,0,0.2,1)',
        transform: hovered ? 'translateY(-5px) scale(1.01)' : 'translateY(0) scale(1)',
        boxShadow: hovered
          ? `0 20px 60px ${tool.glow}, 0 4px 16px var(--bg-overlay-lo), inset 0 1px 0 var(--overlay-6)`
          : '0 2px 12px var(--overlay-8)',
        display: 'flex',
        flexDirection: 'column',
        backdropFilter: 'blur(16px)',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Animated gradient top border */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: 2,
        background: hovered ? tool.gradient : 'transparent',
        transition: 'all 0.3s',
        borderRadius: '20px 20px 0 0',
      }} />

      {/* Glow blob behind icon */}
      {hovered && (
        <div style={{
          position: 'absolute', top: -20, left: -20, width: 120, height: 120,
          background: `radial-gradient(circle, ${tool.glow} 0%, transparent 70%)`,
          pointerEvents: 'none',
        }} />
      )}

      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 18, position: 'relative' }}>
        <div style={{
          width: 50, height: 50, borderRadius: 14,
          background: hovered ? tool.gradient : tool.bg,
          border: `1px solid ${tool.border}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: '#fff',
          transition: 'all 0.25s',
          boxShadow: hovered ? `0 0 24px ${tool.glow}` : 'none',
        }}>
          {tool.icon}
        </div>
        <span style={{
          fontSize: 9, fontWeight: 800, letterSpacing: '0.14em',
          padding: '4px 10px', borderRadius: 100,
          background: hovered ? tool.gradient : tool.bg,
          color: hovered ? '#fff' : tool.color,
          border: `1px solid ${tool.border}`,
          boxShadow: hovered ? `0 2px 10px ${tool.glow}` : 'none',
          transition: 'all 0.2s',
        }}>
          {tool.badge}
        </span>
      </div>

      <h3 style={{
        fontSize: 16, fontWeight: 800, margin: '0 0 8px',
        color: hovered ? '#FFFFFF' : 'var(--text-strong)',
        letterSpacing: '-0.2px',
        transition: 'color 0.2s',
      }}>
        {tool.name}
      </h3>

      <p style={{
        fontSize: 13, color: hovered ? 'var(--text-muted)' : 'var(--text-faint)',
        lineHeight: 1.65, flex: 1, margin: '0 0 20px',
        transition: 'color 0.2s',
      }}>
        {tool.desc}
      </p>

      <div style={{
        display: 'flex', alignItems: 'center', gap: 6,
        fontSize: 12, fontWeight: 800, letterSpacing: '0.02em',
        color: hovered ? tool.color : 'var(--text-faint)',
        transition: 'color 0.2s',
      }}>
        Open tool
        <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24"
          style={{ transform: hovered ? 'translateX(5px)' : 'translateX(0)', transition: 'transform 0.25s' }}>
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
        </svg>
      </div>
    </div>
  );
}

function NavItem({ label, icon, to, active, external, onClick }) {
  const [hov, setHov] = useState(false);
  const style = {
    display: 'flex', alignItems: 'center', gap: 10,
    padding: '9px 12px', borderRadius: 10, marginBottom: 2,
    background: active
      ? 'linear-gradient(135deg, rgba(167,139,250,0.18), rgba(96,165,250,0.10))'
      : hov ? 'var(--overlay-4)' : 'transparent',
    border: active ? '1px solid rgba(167,139,250,0.3)' : '1px solid transparent',
    color: active ? 'var(--accent-soft)' : hov ? 'var(--text-strong)' : 'var(--text-subtle)',
    textDecoration: 'none', fontSize: 13, fontWeight: active ? 700 : 500,
    cursor: 'pointer', transition: 'all 0.15s',
    boxShadow: active ? '0 0 20px rgba(167,139,250,0.1)' : 'none',
  };
  const inner = <><span style={{ color: 'inherit', display: 'flex' }}>{icon}</span>{label}</>;
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        style={{ ...style, width: '100%', fontFamily: 'inherit', textAlign: 'left' }}
        onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      >
        {inner}
      </button>
    );
  }
  if (external) {
    const isMail = typeof to === 'string' && to.startsWith('mailto:');
    return (
      <a
        href={to}
        {...(isMail ? {} : { target: '_blank', rel: 'noopener noreferrer' })}
        style={style}
        onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      >
        {inner}
      </a>
    );
  }
  return (
    <Link to={to} style={style}
      onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}>
      {inner}
    </Link>
  );
}

function TrialBanner({ trialDaysLeft }) {
  const urgent = trialDaysLeft <= 1;
  return (
    <div style={{
      padding: '11px 40px',
      background: urgent
        ? 'linear-gradient(90deg, rgba(239,68,68,0.15), rgba(239,68,68,0.06))'
        : 'linear-gradient(90deg, rgba(245,158,11,0.15), rgba(245,158,11,0.06))',
      borderBottom: `1px solid ${urgent ? 'rgba(239,68,68,0.3)' : 'rgba(245,158,11,0.3)'}`,
      display: 'flex', alignItems: 'center', gap: 12,
    }}>
      <span style={{ fontSize: 16 }}>{urgent ? '🚨' : '⏳'}</span>
      <span style={{ fontSize: 13, color: urgent ? 'var(--danger-soft)' : 'var(--warning-2)', flex: 1 }}>
        <strong>{trialDaysLeft === 0 ? 'Last day' : `${trialDaysLeft} day${trialDaysLeft > 1 ? 's' : ''} left`}</strong> on your free trial.
        Subscribe now to keep access to all tools.
      </span>
      <a href="/billing" style={{
        fontSize: 12, fontWeight: 800, padding: '5px 16px', borderRadius: 8,
        background: urgent ? 'linear-gradient(135deg, var(--danger-strong), #DC2626)' : 'linear-gradient(135deg, var(--warning), #D97706)',
        color: '#fff', textDecoration: 'none', flexShrink: 0,
        boxShadow: urgent ? '0 0 16px rgba(239,68,68,0.4)' : '0 0 16px rgba(245,158,11,0.4)',
      }}>
        Upgrade now →
      </a>
    </div>
  );
}

export default function HubPage({ user, onLogout }) {
  const [supportOpen, setSupportOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const [switchingOrg, setSwitchingOrg] = useState(false);
  const [oauthStep, setOauthStep] = useState(null); // 'connecting-ads' | 'syncing' | 'done' | null

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const step = params.get('step');
    const connected = params.get('connected');

    if (step === 'connect-ads') {
      // SP-API done — auto-kick off Ads OAuth
      setOauthStep('connecting-ads');
      window.history.replaceState({}, '', '/');
      const t = setTimeout(() => {
        window.location.href = '/api/sp-oauth/ads-start';
      }, 1800);
      return () => clearTimeout(t);
    }

    if (connected === 'both') {
      // Both OAuth flows done — auto-sync profiles
      setOauthStep('syncing');
      window.history.replaceState({}, '', '/');
      syncProfilesApi()
        .then(() => setOauthStep('done'))
        .catch(() => setOauthStep('done'));
    }
  }, [location.search]);

  const organizations = user?.organizations ?? [];
  const activeOrgId   = user?.currentOrg?.id ?? '';
  const rawName       = user?.user?.name ?? user?.email?.split('@')[0] ?? 'there';
  const firstName     = rawName.split(' ')[0];
  const clientName    = user?.currentOrg?.name ?? firstName;
  const clientInitials = initials(user?.currentOrg?.name, user?.email);
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
      background: 'var(--bg-app)',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, sans-serif',
      position: 'relative', overflow: 'hidden',
      color: 'var(--text-primary)',
    }}>

      {/* ── Background atmosphere (dark theme only — the orbs turn a light
          theme muddy, so we skip them entirely and let the clean bg breathe) ── */}
      {isDark && (
        <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 0 }}>
          <div style={{ position: 'absolute', top: -300, left: -150, width: 900, height: 900, background: 'radial-gradient(circle, rgba(139,92,246,0.18) 0%, transparent 60%)' }} />
          <div style={{ position: 'absolute', bottom: -250, right: -150, width: 800, height: 800, background: 'radial-gradient(circle, rgba(249,115,22,0.14) 0%, transparent 60%)' }} />
          <div style={{ position: 'absolute', top: '30%', right: '-5%', width: 600, height: 600, background: 'radial-gradient(circle, rgba(0,201,255,0.10) 0%, transparent 60%)' }} />
          <div style={{ position: 'absolute', top: '55%', left: '35%', width: 500, height: 500, background: 'radial-gradient(circle, rgba(249,83,198,0.08) 0%, transparent 60%)' }} />
          <div style={{ position: 'absolute', inset: 0, backgroundImage: 'radial-gradient(rgba(255,255,255,0.035) 1px, transparent 1px)', backgroundSize: '30px 30px' }} />
          <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(ellipse at 50% 50%, transparent 40%, var(--bg-overlay-lo) 100%)' }} />
        </div>
      )}

      {/* ══════════════════ SIDEBAR ══════════════════ */}
      <aside style={{
        width: 265, flexShrink: 0,
        background: 'var(--bg-app)',
        borderRight: '1px solid var(--overlay-5)',
        display: 'flex', flexDirection: 'column',
        height: '100vh', position: 'sticky', top: 0,
        backdropFilter: 'blur(32px)',
        zIndex: 20,
      }}>
        {/* Sidebar top glow */}
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 1, background: 'linear-gradient(90deg, transparent, rgba(167,139,250,0.5), transparent)', pointerEvents: 'none' }} />

        {/* Logo */}
        <div style={{ padding: '22px 18px 18px', borderBottom: '1px solid var(--overlay-4)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
            <div style={{
              width: 40, height: 40, borderRadius: 12, overflow: 'hidden', flexShrink: 0,
              background: 'linear-gradient(135deg, #7C3AED, var(--info-strong))',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 0 20px rgba(124,58,237,0.5)',
            }}>
              <img src="/HMN-APP-ICON.png" alt="HMN"
                style={{ width: 40, height: 40, objectFit: 'contain' }}
                onError={e => { e.target.style.display = 'none'; }} />
            </div>
            <div>
              <p style={{ fontWeight: 800, fontSize: 14, color: 'var(--text-primary)', lineHeight: 1.2, margin: 0, letterSpacing: '-0.2px' }}>Hive Mind</p>
              <p style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', color: 'var(--accent)', lineHeight: 1, margin: 0 }}>AD OPTIMIZER 360</p>
            </div>
          </div>
        </div>

        {/* User card */}
        <div style={{ padding: '16px 18px', borderBottom: '1px solid var(--overlay-4)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
            <div style={{
              width: 40, height: 40, borderRadius: '50%', flexShrink: 0,
              background: 'linear-gradient(135deg, #7C3AED, #2563EB)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 14, fontWeight: 800, color: '#fff',
              boxShadow: '0 0 0 2px rgba(124,58,237,0.4), 0 0 16px rgba(124,58,237,0.3)',
            }}>
              {clientInitials}
            </div>
            <div style={{ minWidth: 0 }}>
              <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-strong)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {clientName}
              </p>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 4 }}>
                <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--success)', boxShadow: '0 0 6px var(--success)' }} />
                <span style={{
                  fontSize: 9, fontWeight: 800, letterSpacing: '0.1em',
                  color: planCfg.color,
                  background: `color-mix(in srgb, ${planCfg.color} 10%, transparent)`,
                  border: `1px solid color-mix(in srgb, ${planCfg.color} 25%, transparent)`,
                  padding: '2px 7px', borderRadius: 100,
                  boxShadow: `0 0 8px ${planCfg.glow}`,
                }}>
                  {planCfg.label.toUpperCase()}
                </span>
              </div>
            </div>
          </div>
          {organizations.length > 1 && (
            <select value={activeOrgId} onChange={e => handleSwitchOrg(e.target.value)} disabled={switchingOrg}
              style={{
                marginTop: 11, width: '100%',
                background: 'var(--overlay-3)', border: '1px solid var(--overlay-7)',
                color: 'var(--text-muted)', borderRadius: 8, padding: '6px 8px', fontSize: 12,
                cursor: 'pointer', outline: 'none',
              }}>
              {organizations.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          )}
        </div>

        {/* Nav */}
        <nav style={{ flex: 1, padding: '16px 10px', overflowY: 'auto' }}>
          <p style={{ fontSize: 9, fontWeight: 800, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.14em', padding: '0 10px', marginBottom: 8 }}>
            Main
          </p>
          <NavItem label="Home"             icon={<HomeIcon />}      to="/"               active />
          <NavItem label="Ad Optimizer 360" icon={<OptimizerIcon />} to="/app"            />
          <NavItem label="Amazon Account"   icon={<AmazonIcon />}    to="/app?tab=amazon" />
          <NavItem label="Billing"          icon={<BillingIcon />}   to="/billing"        />
          <NavItem label="Team"             icon={<TeamIcon />}      to="/app?tab=team"   />
          <NavItem label="Settings"         icon={<SettingsIcon />}  to="/app?tab=amazon" />

          <div style={{ height: 1, background: 'var(--overlay-3)', margin: '16px 0' }} />

          <p style={{ fontSize: 9, fontWeight: 800, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.14em', padding: '0 10px', marginBottom: 8 }}>
            Support
          </p>
          <NavItem label="Email Support" icon={<EmailIcon />} onClick={() => setSupportOpen(true)} />
          <NavItem label="Website"       icon={<GlobeIcon />} to="https://www.hivemindnestor.com" external />
        </nav>

        <div style={{ padding: '12px 10px', borderTop: '1px solid var(--overlay-4)' }}>
          <SignOutButton onLogout={onLogout} />
        </div>
      </aside>

      {/* ══════════════════ MAIN ══════════════════ */}
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: '100vh', position: 'relative', zIndex: 1 }}>

        {/* Top bar */}
        <header style={{
          position: 'sticky', top: 0, zIndex: 10,
          background: 'var(--bg-overlay-hi)',
          backdropFilter: 'blur(24px)',
          borderBottom: '1px solid var(--overlay-5)',
          padding: '14px 40px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
            <span style={{ color: 'var(--text-muted)' }}>Hive Mind Nestor</span>
            <span style={{ color: 'var(--text-faint)' }}>/</span>
            <span style={{
              fontSize: 13, fontWeight: 700,
              backgroundImage: 'var(--grad-accent)',
              WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
            }}>Hub</span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 7,
              padding: '5px 14px', borderRadius: 100,
              background: 'rgba(16,185,129,0.10)',
              border: '1px solid rgba(16,185,129,0.28)',
              boxShadow: '0 0 16px rgba(16,185,129,0.12)',
            }}>
              <div style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--success)', boxShadow: '0 0 8px var(--success)' }} />
              <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--success-2)' }}>All systems live</span>
            </div>
            <ThemeToggle />
            <Link to="/billing" style={{
              fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', padding: '6px 16px',
              borderRadius: 8, border: '1px solid var(--overlay-7)',
              background: 'var(--overlay-3)', textDecoration: 'none',
              transition: 'all 0.15s',
            }}>
              Billing
            </Link>
          </div>
        </header>

        {/* ── Trial countdown banner ── */}
        {user?.currentOrg?.isOnTrial && (
          <TrialBanner trialDaysLeft={user.currentOrg.trialDaysLeft} />
        )}

        {/* ── OAuth progress banner ── */}
        {oauthStep && (
          <div style={{
            margin: '0', padding: '14px 40px',
            background: oauthStep === 'done'
              ? 'linear-gradient(90deg, rgba(16,185,129,0.15), rgba(16,185,129,0.05))'
              : 'linear-gradient(90deg, rgba(124,58,237,0.18), rgba(59,130,246,0.12))',
            borderBottom: `1px solid ${oauthStep === 'done' ? 'rgba(16,185,129,0.3)' : 'rgba(124,58,237,0.3)'}`,
            display: 'flex', alignItems: 'center', gap: 12,
          }}>
            {oauthStep === 'connecting-ads' && (
              <>
                <span style={{ fontSize: 18 }}>✅</span>
                <div>
                  <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent)' }}>Seller Central connected!</span>
                  <span style={{ fontSize: 13, color: 'var(--text-subtle)', marginLeft: 8 }}>Redirecting to authorize Amazon Advertising…</span>
                </div>
                <div style={{ marginLeft: 'auto', width: 18, height: 18, border: '2px solid rgba(167,139,250,0.3)', borderTopColor: 'var(--accent)', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
              </>
            )}
            {oauthStep === 'syncing' && (
              <>
                <span style={{ fontSize: 18 }}>🔗</span>
                <div>
                  <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--info)' }}>Amazon Advertising connected!</span>
                  <span style={{ fontSize: 13, color: 'var(--text-subtle)', marginLeft: 8 }}>Syncing your profiles…</span>
                </div>
                <div style={{ marginLeft: 'auto', width: 18, height: 18, border: '2px solid rgba(96,165,250,0.3)', borderTopColor: 'var(--info)', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
              </>
            )}
            {oauthStep === 'done' && (
              <>
                <span style={{ fontSize: 18 }}>🎉</span>
                <div>
                  <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--success-2)' }}>Amazon account fully connected!</span>
                  <span style={{ fontSize: 13, color: 'var(--text-subtle)', marginLeft: 8 }}>Your campaigns are ready to load.</span>
                </div>
                <button onClick={() => setOauthStep(null)} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--text-subtle)', cursor: 'pointer', fontSize: 18, lineHeight: 1 }}>×</button>
              </>
            )}
          </div>
        )}
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

        {/* ── Content ── */}
        <div style={{ flex: 1, padding: '48px 44px 80px', maxWidth: 1100, width: '100%', margin: '0 auto', boxSizing: 'border-box' }}>

          {/* ── Welcome hero ── */}
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 24, flexWrap: 'wrap', marginBottom: 52 }}>
            <div>
              <p style={{
                fontSize: 11, fontWeight: 800, marginBottom: 10, letterSpacing: '0.14em', textTransform: 'uppercase',
                backgroundImage: 'var(--grad-accent-90)',
                WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
              }}>
                {today}
              </p>
              <h1 style={{
                fontSize: 48, fontWeight: 900, letterSpacing: '-2px', lineHeight: 1.05,
                margin: '0 0 16px',
                backgroundImage: 'var(--grad-hero)',
                WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
              }}>
                Welcome {clientName} 👋
              </h1>
              <p style={{ fontSize: 15, color: 'var(--text-subtle)', lineHeight: 1.7, margin: 0, maxWidth: 500 }}>
                Your <strong style={{ color: 'var(--accent)' }}>Hive Mind Ad Optimizer 360</strong> suite is live and ready.
                Pick a tool below to start scaling your Amazon performance.
              </p>
            </div>
            <PlanCard planCfg={planCfg} plan={plan} />
          </div>

          {/* ── Stats row ── */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 14, marginBottom: 52 }}>
            {[
              { label: 'Tools Included',  value: TOOLS.length, icon: '⚡', gradient: 'linear-gradient(135deg, #7C3AED, #5B21B6)', glow: 'rgba(124,58,237,0.4)', color: 'var(--accent)' },
              { label: 'Amazon Profiles', value: planCfg.profiles, icon: '📦', gradient: 'linear-gradient(135deg, #1D4ED8, var(--info-strong))', glow: 'rgba(59,130,246,0.4)', color: 'var(--info)' },
              { label: 'AI Models',       value: '2',  icon: '🤖', gradient: 'linear-gradient(135deg, #BE185D, #EC4899)', glow: 'rgba(236,72,153,0.4)', color: '#F472B6' },
              { label: 'Support',         value: 'Priority', icon: '💬', gradient: 'linear-gradient(135deg, #065F46, var(--success))', glow: 'rgba(16,185,129,0.4)', color: 'var(--success-2)' },
            ].map(s => (
              <div key={s.label} style={{
                padding: '20px 22px', borderRadius: 16,
                background: 'var(--bg-overlay-lo)',
                border: `1px solid color-mix(in srgb, ${s.color} 15%, transparent)`,
                backdropFilter: 'blur(16px)',
                display: 'flex', alignItems: 'center', gap: 14,
                boxShadow: `0 4px 24px color-mix(in srgb, ${s.glow} 13%, transparent)`,
                position: 'relative', overflow: 'hidden',
              }}>
                {/* Glow behind */}
                <div style={{ position: 'absolute', top: -20, left: -20, width: 100, height: 100, background: `radial-gradient(circle, ${s.glow} 0%, transparent 70%)`, pointerEvents: 'none' }} />
                <div style={{
                  width: 44, height: 44, borderRadius: 13, flexShrink: 0,
                  background: s.gradient,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 20,
                  boxShadow: `0 4px 16px ${s.glow}`,
                  position: 'relative',
                }}>
                  {s.icon}
                </div>
                <div style={{ position: 'relative' }}>
                  <p style={{ fontSize: 22, fontWeight: 900, color: 'var(--text-primary)', margin: 0, lineHeight: 1, letterSpacing: '-0.5px' }}>{s.value}</p>
                  <p style={{ fontSize: 11, color: s.color, margin: '4px 0 0', fontWeight: 700, letterSpacing: '0.02em' }}>{s.label}</p>
                </div>
              </div>
            ))}
          </div>

          {/* ── Tools header ── */}
          <div style={{ marginBottom: 20, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
            <div>
              <h2 style={{
                fontSize: 22, fontWeight: 900, margin: '0 0 5px', letterSpacing: '-0.5px',
                background: 'linear-gradient(135deg, var(--text-primary), var(--text-muted))',
                WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
              }}>
                Your Tools
              </h2>
              <p style={{ fontSize: 13, color: 'var(--text-subtle)', margin: 0, fontWeight: 500 }}>
                {TOOLS.length} tools · AI-powered · Amazon native
              </p>
            </div>
            <Link to="/app" style={{
              display: 'flex', alignItems: 'center', gap: 7,
              fontSize: 13, fontWeight: 800,
              background: 'linear-gradient(135deg, #7C3AED, #2563EB)',
              color: '#fff',
              padding: '10px 20px', borderRadius: 10,
              textDecoration: 'none',
              boxShadow: '0 4px 20px rgba(124,58,237,0.4)',
              transition: 'all 0.15s',
            }}>
              Full Dashboard
              <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
              </svg>
            </Link>
          </div>

          {/* Tool grid */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
            gap: 16, marginBottom: 56,
          }}>
            {TOOLS.map(tool => (
              <ToolCard key={tool.tab} tool={tool} onClick={() => navigate(`/app?tab=${tool.tab}`)} />
            ))}
          </div>

          {/* ── Help banner ── */}
          <div style={{
            padding: '30px 36px',
            borderRadius: 20,
            background: 'linear-gradient(135deg, rgba(124,58,237,0.15) 0%, rgba(37,99,235,0.12) 50%, rgba(249,83,198,0.10) 100%)',
            border: '1px solid rgba(167,139,250,0.2)',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            gap: 24, flexWrap: 'wrap',
            position: 'relative', overflow: 'hidden',
            boxShadow: '0 8px 40px rgba(124,58,237,0.12)',
          }}>
            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 1, background: 'linear-gradient(90deg, rgba(167,139,250,0.5), rgba(96,165,250,0.5), rgba(244,114,182,0.5))' }} />
            <div style={{ position: 'absolute', right: -40, top: -40, width: 200, height: 200, background: 'radial-gradient(circle, rgba(249,115,22,0.12) 0%, transparent 70%)', pointerEvents: 'none' }} />

            <div style={{ display: 'flex', alignItems: 'center', gap: 18, position: 'relative' }}>
              <div style={{
                width: 52, height: 52, borderRadius: 16, flexShrink: 0,
                background: 'linear-gradient(135deg, #F97316, var(--warning-3))',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                boxShadow: '0 6px 24px rgba(249,115,22,0.45)',
                fontSize: 24,
              }}>
                🚀
              </div>
              <div>
                <p style={{ fontSize: 16, fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 5px', letterSpacing: '-0.2px' }}>
                  Need help getting started?
                </p>
                <p style={{ fontSize: 13, color: 'var(--text-subtle)', margin: 0, lineHeight: 1.5 }}>
                  Our Amazon experts are ready to walk you through the platform.
                </p>
              </div>
            </div>
            <button type="button" onClick={() => setSupportOpen(true)} style={{
              border: 'none', cursor: 'pointer', fontFamily: 'inherit',
              padding: '12px 26px', borderRadius: 12, flexShrink: 0,
              background: 'linear-gradient(135deg, #F97316, var(--warning-3))',
              color: '#fff', fontSize: 13, fontWeight: 800,
              textDecoration: 'none',
              boxShadow: '0 6px 28px rgba(249,115,22,0.45)',
              letterSpacing: '0.01em',
            }}>
              Contact Support →
            </button>
          </div>

        </div>
      </main>

      <SupportContact open={supportOpen} onClose={() => setSupportOpen(false)} />

      <style>{`
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
      `}</style>
    </div>
  );
}

function PlanCard({ planCfg, plan }) {
  return (
    <div style={{
      padding: '22px 26px', borderRadius: 20,
      background: 'var(--bg-overlay-hi)',
      border: `1px solid color-mix(in srgb, ${planCfg.color} 19%, transparent)`,
      backdropFilter: 'blur(20px)',
      minWidth: 240,
      boxShadow: `0 8px 40px ${planCfg.glow}`,
      position: 'relative', overflow: 'hidden',
    }}>
      {/* Top gradient border */}
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: `linear-gradient(90deg, transparent, ${planCfg.color}, transparent)` }} />
      {/* Glow blob */}
      <div style={{ position: 'absolute', bottom: -40, right: -40, width: 160, height: 160, background: `radial-gradient(circle, ${planCfg.glow} 0%, transparent 70%)`, pointerEvents: 'none' }} />

      <p style={{ fontSize: 9, fontWeight: 800, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.14em', marginBottom: 16 }}>
        Active Plan
      </p>

      <div style={{ display: 'flex', alignItems: 'center', gap: 13, marginBottom: 16 }}>
        <div style={{
          width: 40, height: 40, borderRadius: 12,
          background: `linear-gradient(135deg, color-mix(in srgb, ${planCfg.color} 25%, transparent), color-mix(in srgb, ${planCfg.color} 13%, transparent))`,
          border: `1px solid color-mix(in srgb, ${planCfg.color} 25%, transparent)`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: `0 0 20px ${planCfg.glow}`,
        }}>
          <svg width="18" height="18" fill="none" stroke={planCfg.color} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M13 10V3L4 14h7v7l9-11h-7z"/>
          </svg>
        </div>
        <div>
          <p style={{ fontSize: 14, fontWeight: 800, color: 'var(--text-primary)', margin: 0, lineHeight: 1.2, letterSpacing: '-0.3px' }}>
            Ad Optimizer 360
          </p>
          <span style={{
            fontSize: 9, fontWeight: 800, letterSpacing: '0.1em',
            padding: '3px 9px', borderRadius: 100,
            background: `color-mix(in srgb, ${planCfg.color} 13%, transparent)`, color: planCfg.color,
            border: `1px solid color-mix(in srgb, ${planCfg.color} 25%, transparent)`,
            boxShadow: `0 0 10px ${planCfg.glow}`,
          }}>
            {planCfg.label.toUpperCase()}
          </span>
        </div>
      </div>

      <div style={{ fontSize: 12, color: 'var(--text-subtle)', marginBottom: 18 }}>
        Up to <strong style={{ color: 'var(--text-primary)' }}>{planCfg.profiles} profiles</strong> · All tools
      </div>

      <Link to="/billing" style={{
        display: 'block', textAlign: 'center',
        fontSize: 12, fontWeight: 800,
        background: `linear-gradient(135deg, color-mix(in srgb, ${planCfg.color} 19%, transparent), color-mix(in srgb, ${planCfg.color} 8%, transparent))`,
        color: planCfg.color,
        padding: '9px', borderRadius: 10,
        border: `1px solid color-mix(in srgb, ${planCfg.color} 21%, transparent)`,
        textDecoration: 'none',
        boxShadow: `0 2px 12px ${planCfg.glow}`,
      }}>
        Manage subscription →
      </Link>
    </div>
  );
}

function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const [hov, setHov] = useState(false);
  const isLight = theme === 'light';
  return (
    <button
      onClick={toggle}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      aria-label={isLight ? 'Switch to dark mode' : 'Switch to light mode'}
      title={isLight ? 'Switch to dark mode' : 'Switch to light mode'}
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: 34, height: 34, borderRadius: 10, cursor: 'pointer',
        background: hov ? 'var(--overlay-6)' : 'var(--overlay-3)',
        border: '1px solid var(--overlay-7)',
        color: 'var(--text-muted)',
        transition: 'background 0.15s, color 0.15s, transform 0.2s',
        transform: hov ? 'translateY(-1px)' : 'none',
      }}
    >
      {isLight ? (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
      ) : (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
        </svg>
      )}
    </button>
  );
}

function SignOutButton({ onLogout }) {
  const [hov, setHov] = useState(false);
  return (
    <button
      onClick={async () => { await logoutApi(); onLogout(); }}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        width: '100%', padding: '9px 12px', borderRadius: 10,
        background: hov ? 'rgba(239,68,68,0.10)' : 'transparent',
        border: hov ? '1px solid rgba(239,68,68,0.25)' : '1px solid transparent',
        color: hov ? 'var(--danger-strong)' : 'var(--text-subtle)',
        fontSize: 13, fontWeight: 600, cursor: 'pointer',
        transition: 'all 0.15s', textAlign: 'left',
        boxShadow: hov ? '0 0 16px rgba(239,68,68,0.15)' : 'none',
      }}
    >
      <SignOutIcon />
      Sign out
    </button>
  );
}
