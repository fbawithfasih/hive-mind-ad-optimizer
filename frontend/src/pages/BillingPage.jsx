import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { getBillingStatus, createCheckoutSession, verifyPaymentApi, cancelSubscriptionApi, logoutApi } from '../services/api.js';

const TIER_LABEL  = { BASIC: 'Starter', PRO: 'Growth', ENTERPRISE: 'Scale', CUSTOM: 'Custom' };
const TIER_COLOR  = { BASIC: 'var(--text-subtle)', PRO: 'var(--info-strong)', ENTERPRISE: 'var(--accent-strong)', CUSTOM: 'var(--warning)' };
// TIER_COLOR served two incompatible jobs. As TEXT on the card it must be light
// in dark mode; as a saturated FILL under white text it must be dark in both.
// One token cannot be both, so they are split.
const TIER_TEXT = { BASIC: 'var(--text-muted)', PRO: 'var(--info)', ENTERPRISE: 'var(--accent)', CUSTOM: 'var(--warning)' };
// Deliberately literal: white is the only ink that clears AA on these, and it
// does so only while the fill stays dark. Flipping them breaks the badge in
// dark mode, where neither white (4.23:1) nor ink (4.22:1) passes on #8B5CF6.
const TIER_FILL = { BASIC: '#475569', PRO: '#1D4ED8', ENTERPRISE: '#6D28D9', CUSTOM: '#B45309' };
const STATUS_COLOR = { ACTIVE: 'var(--success-deep)', PAST_DUE: 'var(--warning-deep)', CANCELLED: 'var(--rose)', EXPIRED: 'var(--text-subtle)' };

// Prices mirror src/config/pricing.js — keep aligned with the backend source of truth.
const PLAN_DETAILS = [
  {
    tier: 'BASIC',
    name: 'Starter',
    price: '$49/mo',
    features: ['Up to 100 listing optimizations/mo', '5 bulk operations/mo', '10 reports/mo', '1 Amazon profile', 'Email support'],
  },
  {
    tier: 'PRO',
    name: 'Growth',
    price: '$149/mo',
    popular: true,
    features: ['Unlimited listing optimizations', '50 bulk operations/mo', 'Unlimited reports', '5 Amazon profiles', 'Priority email support', 'AI keyword recommendations'],
  },
  {
    tier: 'ENTERPRISE',
    name: 'Scale',
    price: '$499/mo',
    features: ['Everything in Growth', 'Unlimited profiles', 'Dedicated account manager', 'Custom AI models', 'SLA guarantee', 'SSO / SAML'],
  },
];

function Badge({ label, color }) {
  return (
    <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 99, background: `color-mix(in srgb, ${color} 13%, transparent)`, color, border: `1px solid color-mix(in srgb, ${color} 25%, transparent)` }}>
      {label}
    </span>
  );
}

function UsageStat({ label, value }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid var(--border-strong)' }}>
      <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{value.toLocaleString()}</span>
    </div>
  );
}

function CheckIcon() {
  return (
    <svg style={{ width: 14, height: 14, color: 'var(--success)', flexShrink: 0 }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7"/>
    </svg>
  );
}

// Always resolve an API error to a string. The backend's global error handler
// returns { error: { code, message } } (an object) on 500s — rendering that
// object directly would crash React, so never store a non-string in `error`.
function errMsg(err, fallback) {
  const e = err?.response?.data?.error;
  if (typeof e === 'string') return e;
  if (e && typeof e === 'object') return e.message || e.description || fallback;
  return err?.message || fallback;
}

function loadRazorpayScript() {
  return new Promise((resolve) => {
    if (window.Razorpay) return resolve(true);
    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.onload  = () => resolve(true);
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
  });
}

export default function BillingPage({ user, onLogout }) {
  const [data, setData]         = useState(null);
  const [loading, setLoading]   = useState(true);
  const [working, setWorking]   = useState(false);
  const [error, setError]       = useState(null);
  const [banner, setBanner]     = useState(null); // { type: 'success'|'info', msg }
  const [showCancel, setShowCancel] = useState(false);

  const isAdmin = user?.currentOrg?.role === 'ADMIN';

  const reload = useCallback(() => {
    setLoading(true);
    getBillingStatus()
      .then(setData)
      .catch(() => setError('Failed to load billing information.'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { reload(); }, [reload]);

  async function handleCheckout(tier) {
    setError(null);
    setWorking(true);

    const loaded = await loadRazorpayScript();
    if (!loaded) {
      setError('Could not load Razorpay checkout. Check your internet connection.');
      setWorking(false);
      return;
    }

    let checkoutData;
    try {
      checkoutData = await createCheckoutSession(tier);
    } catch (err) {
      setError(errMsg(err, 'Could not start checkout.'));
      setWorking(false);
      return;
    }

    const { subscriptionId, keyId } = checkoutData;

    const options = {
      key:          keyId,
      subscription_id: subscriptionId,
      name:         'AMAIOP',
      description:  `${TIER_LABEL[tier]} Plan subscription`,
      theme:        { color: TIER_COLOR[tier] ?? 'var(--info-strong)' },
      handler: async function (response) {
        try {
          await verifyPaymentApi(
            response.razorpay_payment_id,
            response.razorpay_subscription_id,
            response.razorpay_signature,
          );
          setBanner({ type: 'success', msg: 'Payment successful! Your plan is now active.' });
          reload();
        } catch {
          setError('Payment verification failed. Contact support if amount was deducted.');
        } finally {
          setWorking(false);
        }
      },
      modal: {
        ondismiss: () => {
          setBanner({ type: 'info', msg: 'Checkout cancelled — your plan was not changed.' });
          setWorking(false);
        },
      },
    };

    const rzp = new window.Razorpay(options);
    rzp.open();
  }

  async function handleCancel() {
    setWorking(true);
    setError(null);
    try {
      await cancelSubscriptionApi();
      setBanner({ type: 'info', msg: 'Subscription cancelled. Access continues until the current period ends.' });
      setShowCancel(false);
      reload();
    } catch (err) {
      setError(errMsg(err, 'Could not cancel subscription.'));
    } finally {
      setWorking(false);
    }
  }

  const sub            = data?.subscription;
  const usage          = data?.currentMonthUsage;
  const trial          = data?.trial ?? {};
  const availableTiers = new Set((data?.availablePlans ?? []).map(p => p.tier));
  const visiblePlans   = PLAN_DETAILS.filter(p => availableTiers.size === 0 || availableTiers.has(p.tier));
  const canCancel      = isAdmin && sub?.status === 'ACTIVE' && sub?.subscriptionId;
  const trialExpired   = user?.currentOrg?.trialExpired || trial.trialExpired;
  const isOnTrial      = user?.currentOrg?.isOnTrial    || trial.isOnTrial;
  const trialDaysLeft  = user?.currentOrg?.trialDaysLeft ?? trial.trialDaysLeft ?? 0;

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-app-2)', color: 'var(--text-primary)' }}>
      {/* Navbar */}
      <header style={{ background: 'var(--bg-panel)', borderBottom: '1px solid var(--border-strong)', padding: '14px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Link to="/" style={{ fontSize: 13, color: 'var(--text-subtle)', textDecoration: 'none' }}>← Dashboard</Link>
          <span style={{ color: 'var(--text-faint)' }}>|</span>
          <span style={{ fontWeight: 700, fontSize: 15, color: 'var(--text-primary)' }}>Billing</span>
        </div>
        <button onClick={async () => { await logoutApi(); onLogout(); }}
          style={{ padding: '5px 12px', borderRadius: 6, border: '1px solid var(--border-strong)', background: 'transparent', color: 'var(--text-muted)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
          Sign out
        </button>
      </header>

      <div style={{ maxWidth: 760, margin: '0 auto', padding: '32px 16px', display: 'flex', flexDirection: 'column', gap: 24 }}>

        {banner && (
          <div style={{
            background: banner.type === 'success' ? 'color-mix(in srgb, var(--success) 9%, transparent)' : 'color-mix(in srgb, var(--info-strong) 9%, transparent)',
            border: `1px solid ${banner.type === 'success' ? 'color-mix(in srgb, var(--success) 25%, transparent)' : 'color-mix(in srgb, var(--info-strong) 25%, transparent)'}`,
            borderRadius: 10, padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
          }}>
            <span style={{ fontSize: 13, color: banner.type === 'success' ? 'var(--success-deep)' : 'var(--info-2)' }}>{banner.msg}</span>
            <button onClick={() => setBanner(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, color: 'var(--text-subtle)', padding: '0 4px', lineHeight: 1 }}>×</button>
          </div>
        )}

        {error && (
          <div style={{ background: 'color-mix(in srgb, var(--rose) 9%, transparent)', border: '1px solid #F43F5E44', borderRadius: 10, padding: '12px 16px', fontSize: 13, color: 'var(--danger)' }}>{error}</div>
        )}

        {/* ── Trial expired wall ── */}
        {trialExpired && !sub && (
          <div style={{
            borderRadius: 16, overflow: 'hidden',
            border: '1px solid rgba(239,68,68,0.4)',
            background: 'linear-gradient(135deg, rgba(239,68,68,0.12), rgba(220,38,38,0.06))',
          }}>
            <div style={{ padding: '28px 28px 20px', textAlign: 'center' }}>
              <div style={{ fontSize: 48, marginBottom: 12 }}>🔒</div>
              <h2 style={{ margin: '0 0 8px', fontSize: 22, fontWeight: 900, color: 'var(--danger-soft)' }}>
                Your free trial has ended
              </h2>
              <p style={{ margin: '0 0 20px', fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.6 }}>
                Your 3-day trial has expired. Choose a plan below to restore full access to
                Hive Mind Ad Optimizer 360 — campaigns, AI tools, and everything else.
              </p>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '8px 20px', borderRadius: 99, background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)', fontSize: 13, color: 'var(--danger-soft)', fontWeight: 600 }}>
                🚨 Access suspended — subscribe to continue
              </div>
            </div>
          </div>
        )}

        {/* ── Active trial badge ── */}
        {isOnTrial && !sub && (
          <div style={{
            borderRadius: 12, padding: '14px 20px',
            background: 'linear-gradient(90deg, rgba(245,158,11,0.12), rgba(245,158,11,0.06))',
            border: '1px solid rgba(245,158,11,0.3)',
            display: 'flex', alignItems: 'center', gap: 12,
          }}>
            <span style={{ fontSize: 20 }}>⏳</span>
            <div>
              <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: 'var(--warning-2)' }}>
                Free trial active — {trialDaysLeft} day{trialDaysLeft !== 1 ? 's' : ''} remaining
              </p>
              <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--warning-2)', opacity: 0.85 }}>
                Subscribe now and your plan activates immediately — no gap in service.
              </p>
            </div>
          </div>
        )}

        {!isAdmin && (
          <div style={{ background: 'color-mix(in srgb, var(--warning) 6%, transparent)', border: '1px solid #F59E0B30', borderRadius: 10, padding: '10px 16px', fontSize: 13, color: 'var(--warning-2)' }}>
            You can view billing info but only an Admin can change the plan or manage the subscription.
          </div>
        )}

        {loading ? (
          <p style={{ color: 'var(--text-faint)', fontSize: 14, textAlign: 'center', padding: 40 }}>Loading billing info…</p>
        ) : (
          <>
            {/* Current plan */}
            <div style={{ background: 'var(--bg-panel)', borderRadius: 14, border: '1px solid var(--border-strong)', padding: '24px' }}>
              <p style={{ margin: '0 0 16px', fontSize: 12, fontWeight: 700, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Current Plan</p>
              {sub ? (
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                      <span style={{ fontSize: 22, fontWeight: 800, color: TIER_COLOR[sub.tier] ?? 'var(--text-primary)' }}>{TIER_LABEL[sub.tier] ?? sub.tier}</span>
                      <Badge label={sub.status} color={STATUS_COLOR[sub.status] ?? 'var(--text-subtle)'} />
                    </div>
                    {sub.currentPeriodEnd && (
                      <p style={{ margin: 0, fontSize: 12, color: 'var(--text-subtle)' }}>
                        {sub.status === 'CANCELLED' ? 'Access ends' : 'Renews'} {new Date(sub.currentPeriodEnd).toLocaleDateString('en-IN', { month: 'long', day: 'numeric', year: 'numeric' })}
                      </p>
                    )}
                  </div>
                  {canCancel && !showCancel && (
                    <button onClick={() => setShowCancel(true)} disabled={working}
                      style={{ padding: '9px 18px', borderRadius: 8, border: '1px solid #F43F5E44', background: 'transparent', color: 'var(--danger)', fontSize: 13, fontWeight: 600, cursor: working ? 'not-allowed' : 'pointer' }}>
                      Cancel Subscription
                    </button>
                  )}
                </div>
              ) : (
                <p style={{ margin: 0, fontSize: 14, color: 'var(--text-muted)' }}>
                  No active subscription. {isAdmin ? 'Choose a plan below to get started.' : 'Ask your Admin to set up a subscription.'}
                </p>
              )}

              {showCancel && (
                <div style={{ marginTop: 16, padding: '14px 16px', borderRadius: 10, background: 'color-mix(in srgb, var(--rose) 6%, transparent)', border: '1px solid #F43F5E44' }}>
                  <p style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--danger)' }}>
                    Are you sure? Your subscription will cancel at the end of the current billing period.
                  </p>
                  <div style={{ display: 'flex', gap: 10 }}>
                    <button onClick={handleCancel} disabled={working}
                      style={{ padding: '7px 16px', borderRadius: 7, border: 'none', background: 'var(--fill-danger)', color: '#fff', fontSize: 13, fontWeight: 600, cursor: working ? 'not-allowed' : 'pointer' }}>
                      {working ? 'Cancelling…' : 'Yes, cancel'}
                    </button>
                    <button onClick={() => setShowCancel(false)} disabled={working}
                      style={{ padding: '7px 16px', borderRadius: 7, border: '1px solid var(--border-strong)', background: 'transparent', color: 'var(--text-muted)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                      Keep subscription
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Usage this month */}
            {usage && (
              <div style={{ background: 'var(--bg-panel)', borderRadius: 14, border: '1px solid var(--border-strong)', padding: '24px' }}>
                <p style={{ margin: '0 0 4px', fontSize: 12, fontWeight: 700, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Usage This Month</p>
                <p style={{ margin: '0 0 16px', fontSize: 12, color: 'var(--text-faint)' }}>{new Date().toLocaleString('default', { month: 'long', year: 'numeric' })}</p>
                <UsageStat label="Listings optimized"  value={usage.listingsOptimized} />
                <UsageStat label="Bulk operations"     value={usage.bulkOperations} />
                <UsageStat label="Reports generated"   value={usage.reportsGenerated} />
                <UsageStat label="API calls"           value={usage.apiCalls} />
              </div>
            )}

            {/* Plan cards */}
            <div style={{ background: 'var(--bg-panel)', borderRadius: 14, border: '1px solid var(--border-strong)', padding: '24px' }}>
              <p style={{ margin: '0 0 20px', fontSize: 12, fontWeight: 700, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                {sub ? 'Change Plan' : 'Choose a Plan'}
              </p>

              {availableTiers.size === 0 && (
                <p style={{ fontSize: 12, color: 'var(--text-faint)', marginBottom: 16 }}>
                  Razorpay is not configured on this server — plan selection is unavailable.
                </p>
              )}

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 14 }}>
                {visiblePlans.map(plan => {
                  const isCurrent  = sub?.tier === plan.tier && sub?.status === 'ACTIVE';
                  const isDisabled = working || !isAdmin || !availableTiers.has(plan.tier);
                  const highlight  = plan.popular && !isCurrent;

                  return (
                    <div key={plan.tier} style={{
                      borderRadius: 12, padding: '20px',
                      border: `1px solid ${isCurrent ? 'color-mix(in srgb, var(--success) 31%, transparent)' : highlight ? `color-mix(in srgb, ${TIER_COLOR[plan.tier]} 25%, transparent)` : 'var(--border-strong)'}`,
                      background: isCurrent ? 'color-mix(in srgb, var(--success) 3%, transparent)' : highlight ? `color-mix(in srgb, ${TIER_COLOR[plan.tier]} 3%, transparent)` : 'var(--bg-app-2)',
                      display: 'flex', flexDirection: 'column', gap: 14, position: 'relative',
                    }}>
                      {plan.popular && !isCurrent && (
                        <span style={{ position: 'absolute', top: -10, left: '50%', transform: 'translateX(-50%)', background: TIER_FILL[plan.tier], color: '#fff', fontSize: 10, fontWeight: 700, padding: '2px 10px', borderRadius: 99, whiteSpace: 'nowrap' }}>
                          Most popular
                        </span>
                      )}

                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                          <span style={{ fontSize: 16, fontWeight: 800, color: TIER_TEXT[plan.tier] }}>{TIER_LABEL[plan.tier]}</span>
                          {isCurrent && <Badge label="Current" color="var(--success-deep)" />}
                        </div>
                        <span style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-primary)' }}>{plan.price}</span>
                      </div>

                      <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8, flex: 1 }}>
                        {plan.features.map(f => (
                          <li key={f} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 12, color: 'var(--text-muted)' }}>
                            <CheckIcon />
                            {f}
                          </li>
                        ))}
                      </ul>

                      {isAdmin && availableTiers.has(plan.tier) && (
                        <button
                          onClick={() => !isCurrent && !working && handleCheckout(plan.tier)}
                          disabled={isDisabled || isCurrent}
                          style={{
                            width: '100%', padding: '9px', borderRadius: 8, border: 'none', fontSize: 13, fontWeight: 600,
                            cursor: isCurrent || working ? 'not-allowed' : 'pointer',
                            background: isCurrent ? 'color-mix(in srgb, var(--success) 19%, transparent)' : `linear-gradient(135deg,${TIER_FILL[plan.tier]},color-mix(in srgb, ${TIER_FILL[plan.tier]} 80%, transparent))`,
                            color: isCurrent ? 'var(--success-deep)' : '#fff',
                            opacity: working && !isCurrent ? 0.6 : 1,
                          }}
                        >
                          {isCurrent ? 'Current plan' : working ? 'Opening checkout…' : sub ? 'Switch to this plan' : 'Get started'}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>

              {!isAdmin && availableTiers.size > 0 && (
                <p style={{ marginTop: 16, fontSize: 12, color: 'var(--text-faint)' }}>Contact your organization Admin to change the plan.</p>
              )}
            </div>

            {/* Invoice history */}
            {sub?.invoices?.length > 0 && (
              <div style={{ background: 'var(--bg-panel)', borderRadius: 14, border: '1px solid var(--border-strong)', padding: '24px' }}>
                <p style={{ margin: '0 0 16px', fontSize: 12, fontWeight: 700, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Recent Invoices</p>
                {sub.invoices.map(inv => (
                  <div key={inv.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid var(--border-strong)', gap: 8 }}>
                    <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>{new Date(inv.createdAt).toLocaleDateString()}</span>
                    <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
                      {inv.currency === 'INR' ? '₹' : '$'}{(inv.amount / 100).toFixed(2)} {inv.currency?.toUpperCase()}
                    </span>
                    <Badge label={inv.status} color={inv.status === 'PAID' ? 'var(--success-deep)' : 'var(--warning-deep)'} />
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
