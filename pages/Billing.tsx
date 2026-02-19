import React, { useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { User } from '../types';
import { apiUrl } from '../utils/api';

type CheckoutStatus = 'idle' | 'success' | 'cancel';
type PlanKey = 'starter' | 'pro' | 'enterprise';
type Provider = 'stripe' | 'razorpay';

const PRICING: Record<PlanKey, { label: string; usd: number; inr: number; points: string[] }> = {
  starter: {
    label: 'Starter',
    usd: 29,
    inr: 999,
    points: ['1 Production Bot', 'Basic Memory Context', 'Lead Capture Starter Flow', 'Email Support']
  },
  pro: {
    label: 'Pro',
    usd: 79,
    inr: 3499,
    points: ['10 Production Bots', 'CRM Tags + Lead Scoring', 'Advanced Templates', 'Priority Support']
  },
  enterprise: {
    label: 'Enterprise',
    usd: 399,
    inr: 12999,
    points: ['Unlimited Scale Policy', 'White-Label Mode', 'Custom Workflow Integrations', 'Dedicated Success Channel']
  }
};

const Billing: React.FC<{ user: User }> = ({ user }) => {
  const location = useLocation();
  const query = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const checkoutStatus: CheckoutStatus =
    query.get('checkout') === 'success' ? 'success' :
    query.get('checkout') === 'cancel' ? 'cancel' :
    'idle';

  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState('');
  const [isActivatingPlan, setIsActivatingPlan] = useState(false);
  const initialPlan = (query.get('plan') || 'pro').toLowerCase();
  const [plan, setPlan] = useState<PlanKey>(
    initialPlan === 'starter' ? 'starter' : initialPlan === 'enterprise' ? 'enterprise' : 'pro'
  );
  const [provider, setProvider] = useState<Provider>('stripe');
  const selected = PRICING[plan];

  React.useEffect(() => {
    if (checkoutStatus !== 'success' || isActivatingPlan) return;
    const activate = async () => {
      setIsActivatingPlan(true);
      try {
        await fetch(apiUrl('/billing/activate-plan'), {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tier: plan.toUpperCase() })
        });
      } finally {
        setIsActivatingPlan(false);
      }
    };
    activate();
  }, [plan, checkoutStatus, isActivatingPlan]);

  const handleCheckout = async () => {
    setError('');
    setIsProcessing(true);
    try {
      const response = await fetch(apiUrl('/billing/create-checkout-session'), {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          plan: plan.toUpperCase(),
          provider,
          billingDetails: {
            fullName: user.name || '',
            email: user.email || ''
          }
        })
      });

      const data = await response.json();
      if (!response.ok || !data?.checkoutUrl) {
        setError(data?.message || 'Failed to initialize secure Stripe checkout.');
        return;
      }

      window.location.href = data.checkoutUrl;
    } catch {
      setError('Unable to connect to payment service. Please try again.');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#050a16]/90 p-6 md:p-16 flex items-center justify-center">
      <div className="max-w-2xl w-full rounded-3xl border border-white/10 bg-black/60 p-8 md:p-10">
        <Link to="/dashboard" className="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-500 hover:text-white flex items-center gap-3 mb-8 transition-all group">
          <svg className="w-4 h-4 group-hover:-translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M10 19l-7-7m0 0l7-7m-7 7h18" /></svg>
          Return to Command Center
        </Link>

        <h1 className="text-4xl md:text-5xl font-black text-white tracking-tight mb-2">Secure Checkout</h1>
        <p className="text-zinc-400 mb-8">Select plan and payment gateway. Stripe is for international cards (USD). Razorpay is for India payments (INR).</p>

        <div className="grid md:grid-cols-3 gap-3 mb-6">
          {(Object.keys(PRICING) as PlanKey[]).map((k) => (
            <button
              key={k}
              onClick={() => setPlan(k)}
              className={`rounded-xl border px-4 py-4 text-left transition-all ${plan === k ? 'border-cyan-300 bg-cyan-400/10' : 'border-white/10 bg-white/[0.02]'}`}
            >
              <p className="text-sm font-black text-white uppercase">{PRICING[k].label}</p>
              <p className="text-xs text-zinc-400 mt-2">${PRICING[k].usd}/month</p>
              <p className="text-xs text-zinc-500">₹{PRICING[k].inr}/month</p>
            </button>
          ))}
        </div>

        <div className="grid md:grid-cols-2 gap-3 mb-6">
          <button
            onClick={() => setProvider('stripe')}
            className={`rounded-xl border px-4 py-3 text-sm font-black uppercase tracking-wider transition-all ${provider === 'stripe' ? 'border-cyan-300 bg-cyan-400/10 text-white' : 'border-white/10 text-zinc-300'}`}
          >
            Stripe (International)
          </button>
          <button
            onClick={() => setProvider('razorpay')}
            className={`rounded-xl border px-4 py-3 text-sm font-black uppercase tracking-wider transition-all ${provider === 'razorpay' ? 'border-cyan-300 bg-cyan-400/10 text-white' : 'border-white/10 text-zinc-300'}`}
          >
            Razorpay (India)
          </button>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-5 space-y-3 mb-6">
          <div className="flex justify-between text-sm text-zinc-300">
            <span>Selected Plan</span>
            <span className="font-bold">{selected.label}</span>
          </div>
          <div className="flex justify-between text-sm text-zinc-400">
            <span>USD Price</span>
            <span>${selected.usd.toFixed(2)} / month</span>
          </div>
          <div className="flex justify-between text-sm text-zinc-400">
            <span>INR Price</span>
            <span>₹{selected.inr.toLocaleString('en-IN')} / month</span>
          </div>
          <div className="h-px bg-white/10" />
          <ul className="space-y-2">
            {selected.points.map((item) => (
              <li key={item} className="text-xs text-zinc-300 font-semibold">• {item}</li>
            ))}
          </ul>
        </div>

        {checkoutStatus === 'success' && (
          <div className="mb-4 border border-emerald-500/30 bg-emerald-500/10 rounded-xl px-4 py-3 text-emerald-300 text-sm font-semibold">
            Payment completed successfully.
          </div>
        )}
        {checkoutStatus === 'cancel' && (
          <div className="mb-4 border border-amber-500/30 bg-amber-500/10 rounded-xl px-4 py-3 text-amber-300 text-sm font-semibold">
            Payment was cancelled. You can retry now.
          </div>
        )}
        {error && (
          <div className="mb-4 border border-red-500/30 bg-red-500/10 rounded-xl px-4 py-3 text-red-300 text-sm font-semibold">{error}</div>
        )}

        <button
          onClick={handleCheckout}
          disabled={isProcessing}
          className="w-full py-4 rounded-xl bg-white text-black font-black text-sm hover:bg-zinc-200 transition disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isProcessing ? 'Opening Secure Checkout...' : `Continue with ${provider === 'stripe' ? 'Stripe' : 'Razorpay'}`}
        </button>
      </div>
    </div>
  );
};

export default Billing;
