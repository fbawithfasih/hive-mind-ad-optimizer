import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { getBillingStatus, createCheckoutSession, verifyPaymentApi, cancelSubscriptionApi, logoutApi } from '../services/api.js';

const TIER_LABEL  = { BASIC: 'Basic', PRO: 'Pro', ENTERPRISE: 'Enterprise', CUSTOM: 'Custom' };
const TIER_COLOR  = { BASIC: '#64748B', PRO: '#3B82F6', ENTERPRISE: '#8B5CF6', CUSTOM: '#F59E0B' };
const STATUS_COLOR = { ACTIVE: '#10B981', PAST_DUE: '#F59E0B', CANCELLED: '#F43F5E', EXPIRED: '#64748B' };

const PLAN_DETAILS = [
  {
    tier: 'BASIC',
    price: '₹3,999/mo',
    features: ['Up to 100 listing optimizations/mo', '5 bulk operations/mo', '10 reports/mo', '1 Amazon profile', 'Email support'],
  },
  {
    tier: 'PRO',
    price: '₹9,999/mo',
    popular: true,
    features: ['Unlimited listing optimizations', '50 bulk operations/mo', 'Unlimited reports', '5 Amazon profiles', 'Priority email support', 'AI keyword recommendations'],
  },
  {
    tier: 'ENTERPRISE',
    price: 'Custom',
    features: ['Everything in Pro', 'Unlimited profiles', 'Dedicated account manager', 'Custom AI models', 'SLA guarantee', 'SSO / SAML'],
  },
];

function Badge({ label, color }) {
  return (
    <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 99, background: color + '20', color, border: `1px solid ${color}40` }}>
      {label}
    </span>
  );
}

function UsageStat({ label, value }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid #334155' }}>
      <span style={{ fontSize: 13, color: '#94A3B8' }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: 600, color: '#F1F5F9' }}>{value.toLocaleString()}</span>
    </div>
  );
}

function CheckIcon() {
  return (
    <svg style={{ width: 14, height: 14, color: '#10B981', flexShrink: 0 }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7"/>
    </svg>
  );
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
      setError(err.response?.data?.error ?? 'Could not start checkout.');
      setWorking(false);
      return;
    }

    const { subscriptionId, keyId } = checkoutData;

    const options = {
      key:          keyId,
      subscription_id: subscriptionId,
      name:         'AMAIOP',
      description:  `${TIER_LABEL[tier]} Plan subscription`,
      theme:        { color: TIER_COLOR[tier] ?? '#3B82F6' },
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
      setError(err.response?.data?.error ?? 'Could not cancel subscription.');
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
    <div style={{ minHeight: '100vh', background: '#0F172A', color: '#F1F5F9' }}>
      {/* Navbar */}
      <header style={{ background: '#1E293B', borderBottom: '1px solid #334155', padding: '14px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Link to="/" style={{ fontSize: 13, color: '#64748B', textDecoration: 'none' }}>← Dashboard</Link>
          <span style={{ color: '#334155' }}>|</span>
          <span style={{ fontWeight: 700, fontSize: 15, color: '#F1F5F9' }}>Billing</span>
        </div>
        <button onClick={async () => { await logoutApi(); onLogout(); }}
          style={{ padding: '5px 12px', borderRadius: 6, border: '1px solid #334155', background: 'transparent', color: '#94A3B8', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
          Sign out
        </button>
      </header>

      <div style={{ maxWidth: 760, margin: '0 auto', padding: '32px 16px', display: 'flex', flexDirection: 'column', gap: 24 }}>

        {banner && (
          <div style={{
            background: banner.type === 'success' ? '#10B98118' : '#3B82F618',
            border: `1px solid ${banner.type === 'success' ? '#10B98140' : '#3B82F640'}`,
            borderRadius: 10, padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
          }}>
            <span style={{ fontSize: 13, color: banner.type === 'success' ? '#10B981' : '#93C5FD' }}>{banner.msg}</span>
            <button onClick={() => setBanner(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, color: '#64748B', padding: '0 4px', lineHeight: 1 }}>×</button>
          </div>
        )}

        {error && (
          <div style={{ background: '#F43F5E18', border: '1px solid #F43F5E44', borderRadius: 10, padding: '12px 16px', fontSize: 13, color: '#F87171' }}>{error}</div>
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
              <h2 style={{ margin: '0 0 8px', fontSize: 22, fontWeight: 900, color: '#FCA5A5' }}>
                Your free trial has ended
              </h2>
              <p style={{ margin: '0 0 20px', fontSize: 14, color: '#94A3B8', lineHeight: 1.6 }}>
                Your 3-day trial has expired. Choose a plan below to restore full access to
                Hive Mind Ad Optimizer 360 — campaigns, AI tools, and everything else.
              </p>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '8px 20px', borderRadius: 99, background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)', fontSize: 13, color: '#FCA5A5', fontWeight: 600 }}>
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
              <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: '#FCD34D' }}>
                Free trial active — {trialDaysLeft} day{trialDaysLeft !== 1 ? 's' : ''} remaining
              </p>
              <p style={{ margin: '2px 0 0', fontSize: 12, color: '#92400E' }}>
                Subscribe now and your plan activates immediately — no gap in service.
              </p>
            </div>
          </div>
        )}

        {!isAdmin && (
          <div style={{ background: '#F59E0B10', border: '1px solid #F59E0B30', borderRadius: 10, padding: '10px 16px', fontSize: 13, color: '#FCD34D' }}>
            You can view billing info but only an Admin can change the plan or manage the subscription.
          </div>
        )}

        {loading ? (
          <p style={{ color: '#475569', fontSize: 14, textAlign: 'center', padding: 40 }}>Loading billing info…</p>
        ) : (
          <>
            {/* Current plan */}
            <div style={{ background: '#1E293B', borderRadius: 14, border: '1px solid #334155', padding: '24px' }}>
              <p style={{ margin: '0 0 16px', fontSize: 12, fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Current Plan</p>
              {sub ? (
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                      <span style={{ fontSize: 22, fontWeight: 800, color: TIER_COLOR[sub.tier] ?? '#F1F5F9' }}>{TIER_LABEL[sub.tier] ?? sub.tier}</span>
                      <Badge label={sub.status} color={STATUS_COLOR[sub.status] ?? '#64748B'} />
                    </div>
                    {sub.currentPeriodEnd && (
                      <p style={{ margin: 0, fontSize: 12, color: '#64748B' }}>
                        {sub.status === 'CANCELLED' ? 'Access ends' : 'Renews'} {new Date(sub.currentPeriodEnd).toLocaleDateString('en-IN', { month: 'long', day: 'numeric', year: 'numeric' })}
                      </p>
                    )}
                  </div>
                  {canCancel && !showCancel && (
                    <button onClick={() => setShowCancel(true)} disabled={working}
                      style={{ padding: '9px 18px', borderRadius: 8, border: '1px solid #F43F5E44', background: 'transparent', color: '#F87171', fontSize: 13, fontWeight: 600, cursor: working ? 'not-allowed' : 'pointer' }}>
                      Cancel Subscription
                    </button>
                  )}
                </div>
              ) : (
                <p style={{ margin: 0, fontSize: 14, color: '#94A3B8' }}>
                  No active subscription. {isAdmin ? 'Choose a plan below to get started.' : 'Ask your Admin to set up a subscription.'}
                </p>
              )}

              {showCancel && (
                <div style={{ marginTop: 16, padding: '14px 16px', borderRadius: 10, background: '#F43F5E10', border: '1px solid #F43F5E44' }}>
                  <p style={{ margin: '0 0 12px', fontSize: 13, color: '#F87171' }}>
                    Are you sure? Your subscription will cancel at the end of the current billing period.
                  </p>
                  <div style={{ display: 'flex', gap: 10 }}>
                    <button onClick={handleCancel} disabled={working}
                      style={{ padding: '7px 16px', borderRadius: 7, border: 'none', background: '#F43F5E', color: '#fff', fontSize: 13, fontWeight: 600, cursor: working ? 'not-allowed' : 'pointer' }}>
                      {working ? 'Cancelling…' : 'Yes, cancel'}
                    </button>
                    <button onClick={() => setShowCancel(false)} disabled={working}
                      style={{ padding: '7px 16px', borderRadius: 7, border: '1px solid #334155', background: 'transparent', color: '#94A3B8', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                      Keep subscription
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Usage this month */}
            {usage && (
              <div style={{ background: '#1E293B', borderRadius: 14, border: '1px solid #334155', padding: '24px' }}>
                <p style={{ margin: '0 0 4px', fontSize: 12, fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Usage This Month</p>
                <p style={{ margin: '0 0 16px', fontSize: 12, color: '#475569' }}>{new Date().toLocaleString('default', { month: 'long', year: 'numeric' })}</p>
                <UsageStat label="Listings optimized"  value={usage.listingsOptimized} />
                <UsageStat label="Bulk operations"     value={usage.bulkOperations} />
                <UsageStat label="Reports generated"   value={usage.reportsGenerated} />
                <UsageStat label="API calls"           value={usage.apiCalls} />
              </div>
            )}

            {/* Plan cards */}
            <div style={{ background: '#1E293B', borderRadius: 14, border: '1px solid #334155', padding: '24px' }}>
              <p style={{ margin: '0 0 20px', fontSize: 12, fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                {sub ? 'Change Plan' : 'Choose a Plan'}
              </p>

              {availableTiers.size === 0 && (
                <p style={{ fontSize: 12, color: '#475569', marginBottom: 16 }}>
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
                      border: `1px solid ${isCurrent ? '#10B98150' : highlight ? TIER_COLOR[plan.tier] + '40' : '#334155'}`,
                      background: isCurrent ? '#10B98108' : highlight ? TIER_COLOR[plan.tier] + '08' : '#0F172A',
                      display: 'flex', flexDirection: 'column', gap: 14, position: 'relative',
                    }}>
                      {plan.popular && !isCurrent && (
                        <span style={{ position: 'absolute', top: -10, left: '50%', transform: 'translateX(-50%)', background: TIER_COLOR[plan.tier], color: '#fff', fontSize: 10, fontWeight: 700, padding: '2px 10px', borderRadius: 99, whiteSpace: 'nowrap' }}>
                          Most popular
                        </span>
                      )}

                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                          <span style={{ fontSize: 16, fontWeight: 800, color: TIER_COLOR[plan.tier] }}>{TIER_LABEL[plan.tier]}</span>
                          {isCurrent && <Badge label="Current" color="#10B981" />}
                        </div>
                        <span style={{ fontSize: 20, fontWeight: 700, color: '#F1F5F9' }}>{plan.price}</span>
                      </div>

                      <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8, flex: 1 }}>
                        {plan.features.map(f => (
                          <li key={f} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 12, color: '#94A3B8' }}>
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
                            background: isCurrent ? '#10B98130' : `linear-gradient(135deg,${TIER_COLOR[plan.tier]},${TIER_COLOR[plan.tier]}CC)`,
                            color: isCurrent ? '#10B981' : '#fff',
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
                <p style={{ marginTop: 16, fontSize: 12, color: '#475569' }}>Contact your organization Admin to change the plan.</p>
              )}
            </div>

            {/* Invoice history */}
            {sub?.invoices?.length > 0 && (
              <div style={{ background: '#1E293B', borderRadius: 14, border: '1px solid #334155', padding: '24px' }}>
                <p style={{ margin: '0 0 16px', fontSize: 12, fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Recent Invoices</p>
                {sub.invoices.map(inv => (
                  <div key={inv.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid #334155', gap: 8 }}>
                    <span style={{ fontSize: 13, color: '#94A3B8' }}>{new Date(inv.createdAt).toLocaleDateString()}</span>
                    <span style={{ fontSize: 13, fontWeight: 600, color: '#F1F5F9' }}>
                      {inv.currency === 'INR' ? '₹' : '$'}{(inv.amount / 100).toFixed(2)} {inv.currency?.toUpperCase()}
                    </span>
                    <Badge label={inv.status} color={inv.status === 'PAID' ? '#10B981' : '#F59E0B'} />
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
