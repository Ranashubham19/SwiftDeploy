import React, { useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { User } from '../types';
import { apiUrl } from '../utils/api';

type CheckoutStatus = 'idle' | 'success' | 'cancel';
const BASE_PRICE_USD = 49;
const DISCOUNT_USD = 10;
const YEARLY_BASE_PRICE_USD = 499;
const YEARLY_DISCOUNT_USD = 100;

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
  const billingCycle = query.get('cycle') === 'yearly' ? 'yearly' : 'monthly';
  const [applyDiscount, setApplyDiscount] = useState(true);
  const basePrice = billingCycle === 'yearly' ? YEARLY_BASE_PRICE_USD : BASE_PRICE_USD;
  const discount = billingCycle === 'yearly' ? YEARLY_DISCOUNT_USD : DISCOUNT_USD;
  const finalPriceUsd = applyDiscount ? basePrice - discount : basePrice;

  React.useEffect(() => {
    if (checkoutStatus !== 'success' || isActivatingPlan) return;
    const activate = async () => {
      setIsActivatingPlan(true);
      try {
        await fetch(apiUrl('/billing/activate-plan'), {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ billingCycle })
        });
      } finally {
        setIsActivatingPlan(false);
      }
    };
    activate();
  }, [billingCycle, checkoutStatus, isActivatingPlan]);

  const handleCheckout = async () => {
    setError('');
    setIsProcessing(true);
    try {
      const response = await fetch(apiUrl('/billing/create-checkout-session'), {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          plan: 'PRO_FLEET',
          applyDiscount,
          billingCycle,
          paymentMethod: 'card',
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

        <h1 className="text-4xl md:text-5xl font-black text-white tracking-tight mb-2">Secure Card Checkout</h1>
        <p className="text-zinc-400 mb-8">Plan: {billingCycle === 'yearly' ? 'Pro Fleet Yearly' : 'Pro Fleet Monthly'}. You will be redirected to Stripe hosted checkout with card payment only.</p>

        <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-5 space-y-3 mb-6">
          <div className="flex justify-between text-sm text-zinc-400">
            <span>Base Price</span>
            <span>${basePrice.toFixed(2)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-zinc-300">Discount</span>
            <span className={applyDiscount ? 'text-emerald-400 font-bold' : 'text-zinc-500'}>- ${discount.toFixed(2)}</span>
          </div>
          <div className="h-px bg-white/10" />
          <div className="flex justify-between text-lg font-black text-white">
            <span>Total</span>
            <span>${finalPriceUsd.toFixed(2)}</span>
          </div>
        </div>

        <label className="inline-flex items-center gap-3 mb-6 text-zinc-200 font-semibold cursor-pointer">
          <input
            type="checkbox"
            checked={applyDiscount}
            onChange={(e) => setApplyDiscount(e.target.checked)}
            className="accent-cyan-400"
          />
          {`Apply promotional $${discount.toFixed(0)} discount`}
        </label>

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
          {isProcessing ? 'Opening Stripe Checkout...' : 'Continue to Card Checkout'}
        </button>
      </div>
    </div>
  );
};

export default Billing;
