
import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { User, Platform } from '../types';
import { ICONS } from '../constants';

const LandingPage: React.FC<{ user: User | null }> = ({ user }) => {
  const navigate = useNavigate();
  const [selectedModel, setSelectedModel] = useState<string>('gemini-3-pro-preview');
  const [selectedPlatform, setSelectedPlatform] = useState<Platform>(Platform.TELEGRAM);

  const scrollToSection = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
  };

  const handleDeploymentInit = () => {
    if (user) {
      if (selectedPlatform === Platform.TELEGRAM) {
        navigate('/connect/telegram', { state: { model: selectedModel } });
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
      <nav className="fixed top-0 w-full z-50 h-20 md:h-24 flex items-center justify-between px-6 md:px-16 bg-black/20 backdrop-blur-2xl border-b border-white/5">
        <div className="flex items-center gap-3 group cursor-pointer" onClick={() => navigate('/')}>
          <div className="w-10 h-10 flex items-center justify-center bg-gradient-to-br from-blue-500 to-indigo-600 rounded-xl shadow-[0_0_20px_rgba(59,130,246,0.3)] transition-transform group-hover:scale-105">
            <svg viewBox="0 0 24 24" fill="white" className="w-6 h-6"><path d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
          </div>
          <span className="text-xl md:text-2xl font-black tracking-tighter font-heading uppercase italic">SwiftDeploy</span>
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
              <Link to="/login?mode=register" className="bg-white hover:bg-zinc-200 text-black text-sm font-black px-6 md:px-8 py-3 rounded-xl transition-all shadow-xl active:scale-95 uppercase italic">
                Get Started
              </Link>
            </>
          ) : (
            <Link to="/dashboard" className="bg-blue-600 hover:bg-blue-500 text-white text-sm font-black px-8 py-3 rounded-xl shadow-[0_10px_20px_rgba(59,130,246,0.2)] transition-all uppercase italic">
              Command Center
            </Link>
          )}
        </div>
      </nav>

      {/* Hero Section */}
      <section className="min-h-screen pt-40 md:pt-48 pb-20 px-6 flex flex-col items-center">
        <div className="text-center mb-16 max-w-5xl">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400 text-xs font-black uppercase tracking-[0.2em] mb-8">
            <span className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></span>
            Global Cluster Provisioning Online
          </div>
          <h1 className="text-5xl md:text-8xl font-black tracking-tighter leading-[0.95] mb-8 font-heading uppercase italic">
            Deploy <span className="text-blue-500">Autonomous</span> Bots <br /> 
            in <span className="text-zinc-500 italic">Record Time</span>
          </h1>
          <p className="text-lg md:text-xl text-zinc-400 font-medium max-w-3xl mx-auto leading-relaxed italic">
            Authorized infrastructure for Telegram, Discord, and WhatsApp. Scalable cloud backbone for enterprise AI agents.
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
                { id: 'gemini-3-pro-preview', label: 'Gemini 3 Pro', icon: <ICONS.Gemini className="w-6 h-6" /> },
                { id: 'claude-opus-4-5', label: 'Claude Opus 4.5', icon: <ICONS.Claude className="w-6 h-6" /> },
                { id: 'gpt-5-2', label: 'GPT-5.2', icon: <ICONS.GPT className="w-6 h-6 text-white" /> }
              ].map((m) => (
                <button 
                  key={m.id}
                  onClick={() => setSelectedModel(m.id)}
                  className={`flex items-center gap-4 px-6 py-4 rounded-[20px] transition-all relative ${selectedModel === m.id ? 'btn-model-active' : 'btn-model'}`}
                >
                  <div className="flex items-center justify-center w-8 h-8">{m.icon}</div>
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
                className={`flex items-center gap-4 px-6 py-4 rounded-[20px] border transition-all ${selectedPlatform === Platform.TELEGRAM ? 'bg-white/5 border-white/30 shadow-[0_0_20px_rgba(255,255,255,0.05)]' : 'bg-transparent border-white/5 hover:border-white/10'}`}
              >
                <div className="w-8 h-8 flex items-center justify-center shrink-0">
                  <ICONS.Telegram className="w-8 h-8" />
                </div>
                <span className="text-[16px] font-bold text-zinc-100">Telegram</span>
              </button>

              <div className="flex items-center gap-4 px-6 py-4 rounded-[20px] border border-white/5 opacity-60 relative group cursor-not-allowed">
                <div className="w-8 h-8 flex items-center justify-center shrink-0">
                  <ICONS.Discord className="w-8 h-8" />
                </div>
                <div>
                  <span className="text-[16px] font-bold text-zinc-100 block">Discord</span>
                  <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider block leading-none">In Alpha</span>
                </div>
              </div>

              <div className="flex items-center gap-4 px-6 py-4 rounded-[20px] border border-white/5 opacity-60 relative group cursor-not-allowed">
                <div className="w-8 h-8 flex items-center justify-center shrink-0">
                  <ICONS.WhatsApp className="w-8 h-8" />
                </div>
                <div>
                  <span className="text-[16px] font-bold text-zinc-100 block">WhatsApp</span>
                  <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider block leading-none">Pending</span>
                </div>
              </div>
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
              <p className="text-zinc-500 font-bold italic text-lg">Next-gen operational stack for autonomous AI fleets.</p>
           </div>
           
           <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              {[
                { title: "Long-Term Memory", desc: "Bots retain context across months of conversation with persistent vector databases.", icon: <ICONS.Check className="text-blue-500" /> },
                { title: "Gemini 3 Pro Cluster", desc: "Powered by the latest reasoning engines with advanced thinking budgets.", icon: <ICONS.Gemini className="w-8 h-8" /> },
                { title: "Edge Signal Routing", desc: "Sub-100ms response times via our global webhook tunneling architecture.", icon: <svg className="w-6 h-6 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg> },
                { title: "Multimodal Native", desc: "Bots process images, documents, and audio files without external plugins.", icon: <ICONS.Claude className="w-6 h-6" /> },
                { title: "Real-time Monitoring", desc: "Full inspection of signal traffic and AI reasoning logs via dashboard.", icon: <ICONS.Dashboard className="w-6 h-6" /> },
                { title: "Automated Handshakes", desc: "One-click deployment for Telegram bots using BotFather token validation.", icon: <ICONS.Telegram className="w-6 h-6" /> }
              ].map((feat, i) => (
                <div key={i} className="config-card p-10 bg-[#0c0c0e]/40 border-white/5 hover:border-white/10 transition-all group">
                  <div className="mb-6 w-14 h-14 flex items-center justify-center bg-white/5 rounded-2xl group-hover:scale-110 transition-transform">
                    {feat.icon}
                  </div>
                  <h4 className="text-2xl font-black text-white italic mb-3 uppercase tracking-tighter">{feat.title}</h4>
                  <p className="text-zinc-500 text-sm font-bold leading-relaxed italic">{feat.desc}</p>
                </div>
              ))}
           </div>
        </div>

        {/* Pricing Section */}
        <div id="pricing" className="w-full max-w-5xl px-6 mb-40">
           <div className="text-center mb-20">
              <h2 className="text-4xl md:text-6xl font-black italic text-white tracking-tighter uppercase mb-4">Operational Tunnels</h2>
              <p className="text-zinc-500 font-bold italic text-lg">Predictable pricing for global AI distribution.</p>
           </div>

           <div className="grid md:grid-cols-2 gap-10">
              <div className="config-card p-12 bg-blue-600/[0.04] border-blue-500/30 flex flex-col relative overflow-hidden group hover:scale-[1.02] transition-transform">
                <div className="absolute top-0 right-0 p-8">
                   <span className="text-[10px] font-black uppercase tracking-widest bg-blue-500 text-white px-4 py-2 rounded-full shadow-[0_0_20px_rgba(59,130,246,0.4)]">AUTHORIZED</span>
                </div>
                <h3 className="text-4xl font-black italic text-white mb-2 uppercase tracking-tighter">Pro Fleet</h3>
                <p className="text-zinc-500 text-sm font-bold italic mb-8 italic leading-relaxed">Advanced production node for active businesses.</p>
                <div className="flex items-baseline gap-2 mb-10">
                  <span className="text-7xl font-black text-white italic tracking-tighter">$30</span>
                  <span className="text-zinc-600 font-bold uppercase tracking-widest text-xs">/ month</span>
                </div>
                <ul className="space-y-4 mb-12 flex-1">
                  {["10 Production Bots", "Enterprise Memory Nodes", "24/7 Priority Support", "Custom Webhook Tunneling", "Audit Log Retention"].map(f => (
                    <li key={f} className="flex items-center gap-3 text-[13px] font-bold text-zinc-300 italic">
                      <ICONS.Check className="w-4 h-4 text-blue-500" /> {f}
                    </li>
                  ))}
                </ul>
                <button onClick={() => navigate('/login?mode=login')} className="w-full py-6 bg-white text-black font-black italic rounded-3xl text-xl hover:bg-zinc-200 transition-all shadow-xl active:scale-95 uppercase italic">Allocate Node</button>
              </div>

              <div className="config-card p-12 bg-white/[0.01] border-white/5 flex flex-col opacity-70 group hover:opacity-100 transition-opacity">
                <h3 className="text-4xl font-black italic text-white mb-2 uppercase tracking-tighter">Custom Core</h3>
                <p className="text-zinc-500 text-sm font-bold italic mb-8 leading-relaxed">Tailored infrastructure for massive agent fleets.</p>
                <div className="flex items-baseline gap-2 mb-10">
                  <span className="text-7xl font-black text-white italic tracking-tighter">Custom</span>
                </div>
                <ul className="space-y-4 mb-12 flex-1">
                  {["Unlimited Deployment Nodes", "Full Cluster White-label", "On-premise Private Cloud", "Dedicated Solutions Engineer", "SLA Guarantee"].map(f => (
                    <li key={f} className="flex items-center gap-3 text-[13px] font-bold text-zinc-600 italic">
                      <ICONS.Check className="w-4 h-4 text-zinc-800" /> {f}
                    </li>
                  ))}
                </ul>
                <button className="w-full py-6 bg-white/5 border border-white/10 text-zinc-400 font-black italic rounded-3xl text-xl hover:text-white hover:border-white/30 transition-all uppercase">Contact Enterprise</button>
              </div>
           </div>
        </div>

        {/* Footer */}
        <footer id="contact" className="w-full max-w-7xl px-6 py-20 border-t border-white/5 flex flex-col md:flex-row items-center justify-between gap-10">
           <div className="flex flex-col items-center md:items-start">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-8 h-8 flex items-center justify-center bg-zinc-900 rounded-lg">
                  <svg viewBox="0 0 24 24" fill="white" className="w-5 h-5"><path d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                </div>
                <span className="text-xl font-black tracking-tighter text-white uppercase italic">SwiftDeploy</span>
              </div>
              <p className="text-zinc-600 text-[10px] font-black uppercase tracking-[0.3em]">© 2025 SWIFTDEPLOY OPERATIONS GROUP LLC.</p>
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
                 <a href="mailto:ops@swiftdeploy.ai" className="text-xs font-bold text-zinc-500 hover:text-white transition-colors italic uppercase tracking-wider">ops@swiftdeploy.ai</a>
              </div>
           </div>
        </footer>
      </section>
    </div>
  );
};

export default LandingPage;
