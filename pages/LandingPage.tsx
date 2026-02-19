
import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { User, Platform } from '../types';
import { ICONS } from '../constants';
import { apiUrl } from '../utils/api';
import BrandLogo from '../components/BrandLogo';

const LandingPage: React.FC<{ user: User | null }> = ({ user }) => {
  const navigate = useNavigate();
  const [selectedModel, setSelectedModel] = useState<string>('gpt-5-2');
  const [selectedPlatform, setSelectedPlatform] = useState<Platform>(Platform.TELEGRAM);
  const [customCoreCycle, setCustomCoreCycle] = useState<'monthly' | 'yearly'>('monthly');

  // Only redirect on initial load if user is logged in and not manually navigating to home
  const [hasRedirected, setHasRedirected] = useState(false);
  
  useEffect(() => {
    // Check if user navigated here manually (via URL or navigation)
    const cameFromNavigation = window.history.state?.usr?.fromNavigation;
    
    // Remove automatic redirect to dashboard - users should stay on home page
    // if (user && !hasRedirected && !cameFromNavigation) {
    //   setHasRedirected(true);
    //   navigate('/dashboard', { replace: true });
    // }
  }, [user, navigate, hasRedirected]);

  const scrollToSection = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
  };

  const handleDeploymentInit = () => {
    if (user) {
      if (selectedPlatform === Platform.TELEGRAM) {
        navigate('/connect/telegram', { state: { model: selectedModel } });
      } else if (selectedPlatform === Platform.DISCORD) {
        navigate('/connect/discord', { state: { model: selectedModel } });
      } else {
        navigate('/dashboard', { state: { openDeploy: true, platform: selectedPlatform, model: selectedModel } });
      }
    } else {
      navigate('/login?mode=register');
    }
  };

  return (
    <div className="relative">
      {/* Navigation */}
      <nav className="theme-nav fixed top-0 w-full z-50 h-20 md:h-24 flex items-center justify-between px-6 md:px-16 backdrop-blur-2xl border-b border-white/10">
        <div className="flex items-center gap-3 group cursor-pointer" onClick={() => navigate('/')}>
          <BrandLogo />
        </div>
        
        <div className="hidden lg:flex items-center gap-10">
          <button onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} className="text-sm font-bold text-white uppercase tracking-widest">Home</button>
          <button onClick={() => scrollToSection('features')} className="text-sm font-bold text-zinc-400 hover:text-white transition-colors uppercase tracking-widest">Features</button>
          <button onClick={() => scrollToSection('pricing')} className="text-sm font-bold text-zinc-400 hover:text-white transition-colors uppercase tracking-widest">Pricing</button>
          <button onClick={() => scrollToSection('contact')} className="text-sm font-bold text-zinc-400 hover:text-white transition-colors uppercase tracking-widest">Contact</button>
        </div>

        <div className="flex items-center gap-4">
          {!user ? (
            <>
              <Link to="/login?mode=login" className="hidden sm:block text-sm font-bold text-zinc-400 hover:text-white transition-colors mr-2 uppercase tracking-widest">Sign in</Link>
              <Link to="/login?mode=register" className="btn-deploy-gradient text-sm font-black px-6 md:px-8 py-3 rounded-xl transition-all active:scale-95 uppercase">
                Get Started
              </Link>
            </>
          ) : (
            <div className="flex items-center gap-3">
              <Link to="/dashboard" className="btn-deploy-gradient text-sm font-black px-8 py-3 rounded-xl transition-all uppercase">
                Command Center
              </Link>
              <div className="relative group">
                <div className="w-10 h-10 rounded-full overflow-hidden border-2 border-white/10 shadow-lg bg-zinc-900 cursor-pointer">
                  <img 
                    src={`https://ui-avatars.com/api/?name=${user.name}&background=random&color=fff&size=128`} 
                    alt={user.name} 
                    className="w-full h-full object-cover"
                  />
                </div>
                <div className="absolute right-0 mt-2 w-48 bg-[#0c0c0e] border border-white/10 rounded-xl shadow-2xl py-2 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-50">
                  <div className="px-4 py-3 border-b border-white/5">
                    <p className="text-white font-bold text-sm truncate">{user.name}</p>
                    <p className="text-zinc-500 text-xs truncate">{user.email}</p>
                  </div>
                  <button 
                    onClick={async () => {
                      try {
                        const response = await fetch(apiUrl('/logout'), {
                          method: 'GET',
                          credentials: 'include'
                        });
                        
                        if (response.ok) {
                          // Clear local storage and reload
                          localStorage.clear();
                          window.location.href = '/';
                        } else {
                          // Fallback if server request fails
                          window.location.href = '/';
                        }
                      } catch (error) {
                        console.error('Logout failed:', error);
                        // Even if the request fails, still logout locally
                        window.location.href = '/';
                      }
                    }}
                    className="w-full text-left px-4 py-2 text-sm text-red-400 hover:text-red-300 hover:bg-red-500/10 transition-colors flex items-center gap-2"
                  >
                    <ICONS.Settings className="w-4 h-4" /> Sign Out
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </nav>

      {/* Hero Section */}
      <section className="min-h-screen pt-40 md:pt-48 pb-20 px-6 flex flex-col items-center">
        <div className="text-center mb-16 max-w-5xl">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-cyan-400/10 border border-cyan-300/20 text-cyan-300 text-xs font-black uppercase tracking-[0.2em] mb-8">
            <span className="w-2 h-2 bg-cyan-300 rounded-full animate-pulse"></span>
            AI Business Assistant Infrastructure
          </div>
          <h1 className="text-5xl md:text-8xl font-black tracking-tighter leading-[0.95] mb-8 font-heading uppercase">
            Build <span className="text-cyan-300">Revenue-Ready</span> AI Assistants <br /> 
            for <span className="text-zinc-400">Real Business Outcomes</span>
          </h1>
          <p className="text-lg md:text-xl text-zinc-400 font-medium max-w-3xl mx-auto leading-relaxed italic">
            Launch lead capture, conversion, and support assistants across Telegram and Discord with monetization, analytics, and CRM memory built in.
          </p>
        </div>

        {/* The Configurator Tool */}
        <div className="config-card w-full max-w-[840px] p-8 md:p-16 shadow-[0_60px_100px_rgba(0,0,0,0.8)] mb-32 relative">
          <div className="absolute -top-10 -left-10 w-40 h-40 bg-blue-500/10 rounded-full blur-3xl"></div>
          
          {/* Model Selection */}
          <div className="mb-14">
            <h2 className="text-[20px] md:text-[24px] font-bold text-white mb-8 font-heading uppercase italic">
              Which model do you want as default?
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {[
                { id: 'claude-opus-4-5', label: 'Claude Opus 4.5', icon: <ICONS.Claude className="w-8 h-8 text-[#D97757]" /> },
                { id: 'gpt-5-2', label: 'GPT-5.2', icon: <ICONS.GPT className="w-8 h-8" />, iconWrapClass: 'w-8 h-8' },
                { id: 'gemini-3-pro-preview', label: 'Gemini 3 Flash', icon: <ICONS.Gemini className="w-8 h-8" /> }
              ].map((m) => (
                <button
                  key={m.id}
                  onClick={() => setSelectedModel(m.id)}
                  className={`flex items-center gap-4 px-7 py-5 rounded-[28px] border transition-all relative ${selectedModel === m.id ? 'bg-white/[0.06] border-white/40 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.25)]' : 'bg-black/30 border-white/10 hover:border-white/20'}`}
                >
                  {m.icon && <div className={`flex items-center justify-center ${m.iconWrapClass || 'w-8 h-8'}`}>{m.icon}</div>}
                  <span className="text-[16px] font-bold text-zinc-100 whitespace-nowrap">{m.label}</span>
                  {selectedModel === m.id && <ICONS.Check className="w-5 h-5 text-zinc-400 ml-auto" />}
                </button>
              ))}
            </div>
          </div>

          {/* Platform Selection */}
          <div className="mb-14">
            <h2 className="text-[20px] md:text-[24px] font-bold text-white mb-8 font-heading uppercase italic">
              Which channel do you want to use?
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <button 
                onClick={() => setSelectedPlatform(Platform.TELEGRAM)}
                className={`flex items-center gap-4 px-6 py-5 rounded-[24px] border transition-all ${selectedPlatform === Platform.TELEGRAM ? 'bg-white/5 border-white/35 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.2)]' : 'bg-transparent border-white/10 hover:border-white/20'}`}
              >
                <div className="w-8 h-8 flex items-center justify-center shrink-0">
                  <ICONS.Telegram className="w-8 h-8" />
                </div>
                <span className="text-[16px] font-bold text-zinc-100">Telegram</span>
              </button>

              <button
                onClick={() => setSelectedPlatform(Platform.DISCORD)}
                className={`flex items-center gap-4 px-6 py-5 rounded-[24px] border transition-all ${selectedPlatform === Platform.DISCORD ? 'bg-white/5 border-white/35 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.2)]' : 'bg-transparent border-white/10 hover:border-white/20'}`}
              >
                <div className="w-8 h-8 flex items-center justify-center shrink-0">
                  <ICONS.Discord className="w-8 h-8" />
                </div>
                <span className="text-[16px] font-bold text-zinc-100">Discord</span>
              </button>

              <button
                onClick={() => setSelectedPlatform(Platform.WHATSAPP)}
                className={`relative flex items-center gap-4 px-6 py-5 rounded-[24px] border transition-all ${selectedPlatform === Platform.WHATSAPP ? 'bg-white/5 border-white/35 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.2)]' : 'bg-transparent border-white/10 hover:border-white/20'}`}
              >
                <span className="absolute -top-2 right-3 text-[10px] font-black uppercase tracking-widest bg-orange-500 text-white px-3 py-1 rounded-full shadow-[0_0_14px_rgba(249,115,22,0.45)]">
                  High Demand
                </span>
                <div className="w-8 h-8 flex items-center justify-center shrink-0">
                  <ICONS.WhatsApp className="w-8 h-8" />
                </div>
                <span className="text-[16px] font-bold text-zinc-100">WhatsApp</span>
              </button>
            </div>
          </div>

          {/* Action Section */}
          <div className="flex flex-col items-start gap-10 border-t border-white/5 pt-10">
            <div className="w-full space-y-8">
              {user && (
                 <div className="flex items-center gap-4 animate-in fade-in slide-in-from-top-2 mb-4">
                  <div className="w-14 h-14 rounded-full overflow-hidden border-2 border-white/10 shadow-lg bg-zinc-900">
                    <img 
                      src={`https://ui-avatars.com/api/?name=${user.name}&background=random&color=fff&size=128`} 
                      alt={user.name} 
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <div>
                    <h3 className="text-xl font-black text-white tracking-tight leading-none">{user.name}</h3>
                    <p className="text-sm font-bold text-zinc-500 italic mt-1">{user.email}</p>
                  </div>
                </div>
              )}

              <button 
                onClick={handleDeploymentInit}
                className="bg-[#1a1a1a] hover:bg-[#222] text-white px-12 py-6 rounded-3xl flex items-center gap-5 transition-all shadow-[0_30px_60px_rgba(0,0,0,0.6)] border border-white/5 group active:scale-[0.98] w-full md:w-auto"
              >
                <svg className="w-8 h-8 text-zinc-500 group-hover:text-blue-500 transition-colors" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                <span className="text-[22px] font-black tracking-tighter italic">Deploy SwiftDeploy Now</span>
              </button>

              <p className="text-[14px] md:text-[16px] font-bold text-zinc-500 italic">
                {user ? `Connect ${selectedPlatform.charAt(0) + selectedPlatform.slice(1).toLowerCase()} to continue.` : 'Initialize cluster link to continue.'}{' '}
                <span className="text-blue-500">Only 11 nodes remaining in this region.</span>
              </p>

            </div>
          </div>
        </div>

        {/* Outcome-Focused Differentiators */}
        <div className="w-full max-w-7xl px-6 mb-36">
          <div className="text-center mb-16">
            <h2 className="text-4xl md:text-6xl font-black italic text-white tracking-tighter uppercase mb-4">Outcome Engine</h2>
            <p className="text-zinc-500 font-bold italic text-lg">Designed to grow revenue, not just deploy bots.</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6">
            {[
              {
                title: 'Monetization Rails',
                desc: 'Paywalled replies, subscription unlocks, free-usage limits, and payment triggers for premium flows.',
                metric: 'Revenue Controls: Native'
              },
              {
                title: 'Template Studio',
                desc: 'Industry-ready bot blueprints for coaching, real estate, ecommerce, education, and agencies.',
                metric: 'Launch Time: < 10 min'
              },
              {
                title: 'AI CRM Memory',
                desc: 'Lead score, lifecycle tags, history context, and sync/export paths for follow-up pipelines.',
                metric: 'Lead Context: Persistent'
              },
              {
                title: 'Agency White-Label',
                desc: 'Brandless client delivery mode for agencies to resell automation systems at scale.',
                metric: 'B2B Resell Ready'
              }
            ].map((item) => (
              <div key={item.title} className="config-card p-8 bg-[#0c0c0e]/45 border-white/5 hover:border-cyan-300/20 transition-all">
                <div className="w-12 h-12 rounded-2xl bg-cyan-400/10 border border-cyan-300/20 flex items-center justify-center mb-5">
                  <ICONS.Check className="w-5 h-5 text-cyan-300" />
                </div>
                <h3 className="text-2xl font-black text-white uppercase tracking-tight mb-3">{item.title}</h3>
                <p className="text-zinc-400 text-sm font-bold leading-relaxed italic mb-5">{item.desc}</p>
                <div className="inline-flex items-center px-3 py-1 rounded-full border border-cyan-300/25 bg-cyan-500/10 text-cyan-200 text-[10px] font-black uppercase tracking-widest">
                  {item.metric}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Business Template Packs */}
        <div className="w-full max-w-7xl px-6 mb-40">
          <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-6 mb-14">
            <div>
              <h2 className="text-4xl md:text-6xl font-black italic text-white tracking-tighter uppercase mb-4">Business Template Packs</h2>
              <p className="text-zinc-500 font-bold italic text-lg">Pre-built flows to launch specific outcomes fast.</p>
            </div>
            <p className="text-xs font-black uppercase tracking-[0.25em] text-cyan-300">India-Ready Language Presets Included</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
            {[
              ['Real Estate Lead Bot', 'Captures buyer intent, budgets, and location preferences with instant qualification.'],
              ['Coaching Enrollment Bot', 'Handles discovery, eligibility, and payment-ready enrollment workflow.'],
              ['Ecommerce Support Bot', 'Resolves orders, returns, FAQs, and upsell prompts automatically.'],
              ['Agency Client Bot', 'Collects briefs, scopes requests, and automates delivery updates.'],
              ['Education Doubt Bot', 'Provides structured doubt solving with topic-based memory context.'],
              ['Creator Monetization Bot', 'Unlocks premium answers, subscriber-only help, and paid consultations.']
            ].map(([title, desc]) => (
              <div key={title} className="config-card p-7 bg-black/30 border-white/10 hover:border-white/25 transition-all">
                <div className="flex items-center justify-between mb-4">
                  <span className="text-[10px] font-black uppercase tracking-widest text-cyan-300">Ready Template</span>
                  <span className="text-[10px] font-black uppercase tracking-widest text-zinc-600">2-Min Setup</span>
                </div>
                <h3 className="text-xl font-black text-white tracking-tight uppercase mb-3">{title}</h3>
                <p className="text-sm text-zinc-400 font-bold italic leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Features Section */}
        <div id="features" className="w-full max-w-7xl px-6 mb-40">
           <div className="text-center mb-20">
              <h2 className="text-4xl md:text-6xl font-black italic text-white tracking-tighter uppercase mb-4">Infrastructure Capabilities</h2>
              <p className="text-zinc-500 font-bold italic text-lg">Next-gen operational stack for autonomous AI fleets.</p>
           </div>
           
           <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              {[
                {
                  title: "Conversation Memory",
                  desc: "Persistent context windows retain user history, intent, and state transitions across long-running threads.",
                  metric: "Context Recall: 99.2%",
                  icon: <ICONS.Check className="text-blue-500" />
                },
                {
                  title: "Reasoning Cluster",
                  desc: "Production-grade model routing with deterministic fallback policies and latency-aware inference paths.",
                  metric: "Median Reasoning: 1.8s",
                  icon: <ICONS.Gemini className="w-8 h-8" />
                },
                {
                  title: "Edge Signal Routing",
                  desc: "Geo-aware webhook routing keeps regional latency low and delivery consistency high during peak traffic.",
                  metric: "P95 Handshake: 142ms",
                  icon: <svg className="w-6 h-6 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                },
                {
                  title: "Multimodal Intake",
                  desc: "Images, documents, and audio are normalized into one processing stream for consistent downstream automation.",
                  metric: "Supported Inputs: 12+",
                  icon: <ICONS.Claude className="w-6 h-6" />
                },
                {
                  title: "Live Observability",
                  desc: "Per-bot telemetry, response quality traces, and operational events are visible in the command dashboard.",
                  metric: "Live Refresh: 5s",
                  icon: <ICONS.Dashboard className="w-6 h-6" />
                },
                {
                  title: "Verified Provisioning",
                  desc: "Credential checks, command sync, and channel verification happen before deployment goes active.",
                  metric: "Deploy Validation: Strict",
                  icon: <ICONS.Telegram className="w-6 h-6" />
                }
              ].map((feat, i) => (
                <div key={i} className="config-card p-10 bg-[#0c0c0e]/45 border-white/5 hover:border-cyan-300/25 transition-all group">
                  <div className="mb-6 w-14 h-14 flex items-center justify-center bg-white/5 rounded-2xl group-hover:scale-110 transition-transform">
                    {feat.icon}
                  </div>
                  <h4 className="text-2xl font-black text-white italic mb-3 uppercase tracking-tighter">{feat.title}</h4>
                  <p className="text-zinc-400 text-sm font-bold leading-relaxed italic">{feat.desc}</p>
                  <div className="mt-5 inline-flex items-center px-3 py-1 rounded-full border border-cyan-300/20 bg-cyan-500/10 text-cyan-200 text-[10px] font-black uppercase tracking-widest">
                    {feat.metric}
                  </div>
                </div>
              ))}
           </div>
        </div>

        {/* Trust and Security Section */}
        <div className="w-full max-w-7xl px-6 mb-40">
          <div className="config-card p-10 md:p-16 border-cyan-300/20 bg-cyan-500/[0.03]">
            <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-10 mb-12">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.3em] text-cyan-300 mb-4">Security Fabric</p>
                <h2 className="text-4xl md:text-6xl font-black text-white tracking-tight uppercase font-heading mb-4">Built for Secure Operations</h2>
                <p className="text-zinc-400 max-w-2xl text-lg">Protection layers now include OTP abuse throttling, brute-force lockouts, strict request limits, secure headers, and hardened session controls.</p>
              </div>
              <div className="grid grid-cols-2 gap-4 min-w-[220px]">
                <div className="bg-[#07111f] border border-white/10 rounded-2xl p-4 text-center">
                  <p className="text-cyan-300 text-2xl font-black">64KB</p>
                  <p className="text-zinc-500 text-xs uppercase tracking-widest font-bold">Max JSON Body</p>
                </div>
                <div className="bg-[#07111f] border border-white/10 rounded-2xl p-4 text-center">
                  <p className="text-cyan-300 text-2xl font-black">15m</p>
                  <p className="text-zinc-500 text-xs uppercase tracking-widest font-bold">Login Lock Window</p>
                </div>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {[
                'Smart email-domain validation with typo hints',
                'OTP request cooldown and abuse limits',
                'Security headers and hardened API surface'
              ].map((item) => (
                <div key={item} className="bg-[#0a1526] border border-white/10 rounded-2xl p-5 text-zinc-300 font-semibold">
                  {item}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Pricing Section */}
        <div id="pricing" className="w-full max-w-5xl px-6 mb-40">
           <div className="text-center mb-20">
              <h2 className="text-4xl md:text-6xl font-black italic text-white tracking-tighter uppercase mb-4">Operational Tunnels</h2>
              <p className="text-zinc-500 font-bold italic text-lg">Predictable pricing for global AI distribution.</p>
           </div>

           <div className="grid md:grid-cols-3 gap-8">
              <div className="config-card p-10 bg-white/[0.01] border-white/10 flex flex-col relative overflow-hidden">
                <div className="absolute top-0 right-0 p-7">
                   <span className="text-[10px] font-black uppercase tracking-widest bg-zinc-700 text-white px-4 py-2 rounded-full">FREE</span>
                </div>
                <h3 className="text-3xl font-black italic text-white mb-2 uppercase tracking-tighter">Starter</h3>
                <p className="text-zinc-500 text-sm font-bold italic mb-8 leading-relaxed">Limited trial for testing SwiftDeploy quickly.</p>
                <div className="flex items-baseline gap-2 mb-10">
                  <span className="text-6xl font-black text-white italic tracking-tighter">₹0</span>
                  <span className="text-zinc-600 font-bold uppercase tracking-widest text-xs">/ free</span>
                </div>
                <ul className="space-y-4 mb-10 flex-1">
                  {["1 Telegram Bot Limit", "Up to 7 Days Trial Window", "Basic Queue Priority", "Community Support", "Upgrade Required After Limit"].map(f => (
                    <li key={f} className="flex items-center gap-3 text-[12px] font-bold text-zinc-400 italic">
                      <ICONS.Check className="w-4 h-4 text-zinc-500" /> {f}
                    </li>
                  ))}
                </ul>
                <button
                  onClick={() => {
                    if (user) {
                      navigate('/connect/telegram');
                    } else {
                      navigate('/login?mode=register');
                    }
                  }}
                  className="w-full py-5 bg-white/10 border border-white/20 text-white font-black rounded-2xl text-base hover:bg-white/15 transition-all uppercase"
                >
                  Start Free
                </button>
              </div>

              <div className="config-card p-12 bg-blue-600/[0.04] border-blue-500/30 flex flex-col relative overflow-hidden group hover:scale-[1.02] transition-transform">
                <div className="absolute top-0 right-0 p-8">
                   <span className="text-[10px] font-black uppercase tracking-widest bg-blue-500 text-white px-4 py-2 rounded-full shadow-[0_0_20px_rgba(59,130,246,0.4)]">AUTHORIZED</span>
                </div>
                <h3 className="text-4xl font-black italic text-white mb-2 uppercase tracking-tighter">Pro Fleet</h3>
                <p className="text-zinc-500 text-sm font-bold italic mb-8 italic leading-relaxed">Advanced production node billed monthly.</p>
                <div className="flex items-baseline gap-2 mb-10">
                  <span className="text-7xl font-black text-white italic tracking-tighter">₹999</span>
                  <span className="text-zinc-600 font-bold uppercase tracking-widest text-xs">/ month</span>
                </div>
                <ul className="space-y-4 mb-12 flex-1">
                  {["10 Production Bots", "Enterprise Memory Nodes", "24/7 Priority Support", "Custom Webhook Tunneling", "Built-in Monetization Controls"].map(f => (
                    <li key={f} className="flex items-center gap-3 text-[13px] font-bold text-zinc-300 italic">
                      <ICONS.Check className="w-4 h-4 text-blue-500" /> {f}
                    </li>
                  ))}
                </ul>
                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500 mb-6">Optional 5% success commission on bot-collected revenue</p>
                <button 
                  onClick={() => {
                    if (user) {
                      navigate('/billing?cycle=monthly');
                    } else {
                      navigate('/login?mode=login');
                    }
                  }} 
                  className="w-full py-6 bg-white text-black font-black italic rounded-3xl text-xl hover:bg-zinc-200 transition-all shadow-xl active:scale-95 uppercase italic"
                >
                  Subscribe
                </button>
              </div>

              <div className="config-card p-12 bg-emerald-600/[0.04] border-emerald-500/30 flex flex-col relative overflow-hidden group hover:scale-[1.02] transition-transform">
                <div className="absolute top-0 right-0 p-8">
                   <span className="text-[10px] font-black uppercase tracking-widest bg-emerald-500 text-black px-4 py-2 rounded-full shadow-[0_0_20px_rgba(16,185,129,0.4)]">BEST VALUE</span>
                </div>
                <h3 className="text-4xl font-black italic text-white mb-2 uppercase tracking-tighter">Pro Fleet Yearly</h3>
                <p className="text-zinc-500 text-sm font-bold italic mb-8 leading-relaxed">Annual contract with better savings.</p>
                <div className="flex items-baseline gap-2 mb-10">
                  <span className="text-7xl font-black text-white italic tracking-tighter">₹2,999</span>
                  <span className="text-zinc-600 font-bold uppercase tracking-widest text-xs">/ month equivalent</span>
                </div>
                <ul className="space-y-4 mb-12 flex-1">
                  {["Everything in Monthly Pro", "2 Months Price Advantage", "Long-Term Stability Pricing", "Priority Enterprise Queues", "Annual Success Review"].map(f => (
                    <li key={f} className="flex items-center gap-3 text-[13px] font-bold text-zinc-300 italic">
                      <ICONS.Check className="w-4 h-4 text-emerald-400" /> {f}
                    </li>
                  ))}
                </ul>
                <button
                  onClick={() => {
                    if (user) {
                      navigate('/billing?cycle=yearly');
                    } else {
                      navigate('/login?mode=login');
                    }
                  }}
                  className="w-full py-6 bg-emerald-400 text-black font-black italic rounded-3xl text-xl hover:bg-emerald-300 transition-all uppercase"
                >
                  Subscribe
                </button>
              </div>
           </div>

           <div className="config-card p-10 bg-white/[0.01] border-white/5 mt-10">
             <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6">
               <div>
                 <h3 className="text-3xl font-black italic text-white uppercase tracking-tighter mb-2">Custom Core</h3>
                 <p className="text-zinc-500 text-sm font-bold italic">Enterprise infrastructure for very large agent fleets.</p>
               </div>
               <div className="inline-flex rounded-xl bg-white/5 border border-white/10 p-1">
                 {(['monthly', 'yearly'] as const).map((cycle) => (
                   <button
                     key={cycle}
                     onClick={() => setCustomCoreCycle(cycle)}
                     className={`px-4 py-2 rounded-lg text-xs font-black uppercase tracking-widest ${customCoreCycle === cycle ? 'bg-white text-black' : 'text-zinc-400 hover:text-white'}`}
                   >
                     {cycle}
                   </button>
                 ))}
               </div>
             </div>
             <div className="mt-6 flex flex-col md:flex-row md:items-end md:justify-between gap-6">
               <div>
                 <p className="text-zinc-500 text-xs uppercase tracking-widest font-bold">Starting at</p>
                 <p className="text-5xl font-black italic text-white tracking-tighter">
                   {customCoreCycle === 'yearly' ? '₹2,40,000' : '₹24,999'}
                   <span className="text-zinc-600 text-base font-bold"> / {customCoreCycle === 'yearly' ? 'year' : 'month'}</span>
                 </p>
               </div>
               <button
                 onClick={() => navigate('/contact')}
                 className="px-8 py-4 bg-white/5 border border-white/10 text-zinc-300 font-black rounded-2xl hover:text-white hover:border-white/30 transition-all uppercase"
               >
                 Contact Enterprise
               </button>
             </div>
           </div>
        </div>

        {/* Footer */}
        <footer id="contact" className="w-full max-w-7xl px-6 py-20 border-t border-white/5 flex flex-col md:flex-row items-center justify-between gap-10">
           <div className="flex flex-col items-center md:items-start">
              <div className="flex items-center gap-3 mb-4">
                <BrandLogo compact />
              </div>
              <p className="text-zinc-500 text-[10px] font-black uppercase tracking-[0.3em]">© 2026 SWIFTDEPLOY OPERATIONS GROUP LLC.</p>
           </div>
           
           <div className="flex gap-12">
              <div className="space-y-4">
                 <p className="text-[11px] font-black uppercase tracking-widest text-white italic">Status</p>
                 <div className="flex items-center gap-3">
                    <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div>
                    <span className="text-xs font-bold text-emerald-500 uppercase tracking-widest">Nodes Online</span>
                 </div>
              </div>
              <div className="space-y-4">
                 <p className="text-[11px] font-black uppercase tracking-widest text-white italic">Contact</p>
                 <div className="space-y-2">
                   <a href="mailto:ops@swiftdeploy.ai" className="flex items-center gap-2 text-xs font-bold text-zinc-400 hover:text-white transition-colors uppercase tracking-wider">
                     <svg className="w-3.5 h-3.5 text-cyan-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                       <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l9 6 9-6M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                     </svg>
                     ops@swiftdeploy.ai
                   </a>
                   <p className="text-[10px] font-bold text-zinc-600 uppercase tracking-widest">
                     Response SLA: under 4 business hours
                   </p>
                   <button
                     onClick={() => navigate('/contact')}
                     className="text-xs font-bold text-blue-400 hover:text-blue-300 transition-colors uppercase tracking-wider flex items-center gap-1"
                   >
                     Open Contact Desk
                     <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                       <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                     </svg>
                   </button>
                 </div>
              </div>
           </div>
        </footer>
      </section>
    </div>
  );
};

export default LandingPage;
