
import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { User, Platform } from '../types';
import { ICONS } from '../constants';
import { apiUrl } from '../utils/api';
import BrandLogo from '../components/BrandLogo';

const LandingPage: React.FC<{ user: User | null }> = ({ user }) => {
  const navigate = useNavigate();
  const [selectedModel, setSelectedModel] = useState<string>('gpt-5-2');
  const [selectedPlatform, setSelectedPlatform] = useState<Platform>(Platform.TELEGRAM);

  const scrollToSection = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
  };

  const handleDeploymentInit = () => {
    if (user) {
      if (selectedPlatform === Platform.TELEGRAM) {
        navigate('/connect/telegram', { state: { model: selectedModel } });
      } else {
        return;
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
        <div className="text-center mb-16 max-w-6xl">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-cyan-400/10 border border-cyan-300/20 text-cyan-300 text-xs font-black uppercase tracking-[0.2em] mb-8">
            <span className="w-2 h-2 bg-cyan-300 rounded-full animate-pulse"></span>
            One-Click AI Provisioning
          </div>
          <h1 className="text-5xl md:text-6xl lg:text-7xl font-black tracking-tighter leading-[0.95] mb-8 font-heading uppercase break-words">
            Deploy <span className="text-cyan-300">OpenClaw</span> <span className="text-zinc-400">Under</span><br /><span className="text-zinc-400">30 Seconds</span>
          </h1>
          <p className="text-lg md:text-xl text-zinc-400 font-medium max-w-3xl mx-auto leading-relaxed italic">
            Eliminate technical setup and instantly launch your own always-on OpenClaw AI instance with a single secure deployment flow.
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
                type="button"
                disabled
                className="flex items-center gap-4 px-6 py-5 rounded-[24px] border transition-all bg-transparent border-white/10 opacity-55 cursor-not-allowed"
              >
                <div className="w-8 h-8 flex items-center justify-center shrink-0">
                  <ICONS.Discord className="w-8 h-8" />
                </div>
                <div className="flex flex-col items-start">
                  <span className="text-[16px] font-bold text-zinc-100">Discord</span>
                  <span className="text-[11px] font-black uppercase tracking-widest text-zinc-500">Coming soon</span>
                </div>
              </button>

              <button
                type="button"
                disabled
                className="relative flex items-center gap-4 px-6 py-5 rounded-[24px] border transition-all bg-transparent border-white/10 opacity-55 cursor-not-allowed"
              >
                <div className="w-8 h-8 flex items-center justify-center shrink-0">
                  <ICONS.WhatsApp className="w-8 h-8" />
                </div>
                <div className="flex flex-col items-start">
                  <span className="text-[16px] font-bold text-zinc-100">WhatsApp</span>
                  <span className="text-[11px] font-black uppercase tracking-widest text-zinc-500">Coming soon</span>
                </div>
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

        {/* Features Section */}
        <div id="features" className="w-full max-w-7xl px-6 mb-40">
           <div className="text-center mb-20">
              <h2 className="text-4xl md:text-6xl font-black italic text-white tracking-tighter uppercase mb-4">Infrastructure Capabilities</h2>
              <p className="text-zinc-500 font-bold italic text-lg">One assistant, thousands of practical business workflows.</p>
           </div>
           
           <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              {[
                {
                  title: "Translate Messages in Real Time",
                  desc: "Handle multilingual conversations instantly across customer and team channels with accurate context.",
                  metric: "Live Translation: Active",
                  icon: <svg className="w-6 h-6 text-cyan-300" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M3 5h12M9 3v2m-3 7h6m-5 9l4-10 4 10m2-14h4v4m0 0l-5 5" /></svg>
                },
                {
                  title: "Organize Your Inbox",
                  desc: "Automatically classify, prioritize, and draft replies so important conversations are never missed.",
                  metric: "Inbox Automation: On",
                  icon: <svg className="w-6 h-6 text-indigo-300" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M4 4h16v11H4zM4 15l3 5h10l3-5" /></svg>
                },
                {
                  title: "Answer Support Tickets",
                  desc: "Resolve repetitive support requests with consistent, policy-aware responses and escalation triggers.",
                  metric: "Ticket Resolution: Faster",
                  icon: <svg className="w-6 h-6 text-emerald-300" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M9 12l2 2 4-4M4 6h16v12H4z" /></svg>
                },
                {
                  title: "Track Expenses and Receipts",
                  desc: "Capture expense entries, tag categories, and maintain searchable records for cleaner operations.",
                  metric: "Ops Tracking: Structured",
                  icon: <svg className="w-6 h-6 text-amber-300" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M7 3h10v18l-5-3-5 3V3z" /></svg>
                },
                {
                  title: "Find Best Prices Online",
                  desc: "Compare options quickly, surface better deals, and reduce manual effort across purchase workflows.",
                  metric: "Price Intelligence: Enabled",
                  icon: <svg className="w-6 h-6 text-violet-300" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M12 8c-1.657 0-3 1.343-3 3s1.343 3 3 3m0-6c1.657 0 3 1.343 3 3m-3-3V6m0 8v2m-7-5h14" /></svg>
                },
                {
                  title: "Draft Social Posts",
                  desc: "Generate polished platform-ready post drafts, hooks, and caption variants in seconds.",
                  metric: "Content Drafting: Instant",
                  icon: <svg className="w-6 h-6 text-pink-300" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M8 10h8M8 14h5M5 4h14a2 2 0 012 2v12a2 2 0 01-2 2H5a2 2 0 01-2-2V6a2 2 0 012-2z" /></svg>
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


