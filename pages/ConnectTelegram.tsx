
import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Bot, Platform, AIModel, BotStatus } from '../types';
import { ICONS } from '../constants';

const ConnectTelegram: React.FC<{ user: any, bots: Bot[], setBots: any }> = ({ user, bots, setBots }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const [token, setToken] = useState('');
  const [isDeploying, setIsDeploying] = useState(false);
  const [deployStep, setDeployStep] = useState<'input' | 'verifying' | 'syncing'>('input');

  const handleConnect = async () => {
    if (!token) return;
    setIsDeploying(true);
    
    // Step 1: Verification Animation
    setDeployStep('verifying');
    await new Promise(r => setTimeout(r, 1500));
    
    // Step 2: Syncing Animation
    setDeployStep('syncing');
    await new Promise(r => setTimeout(r, 1200));
    
    const botId = Math.random().toString(36).substr(2, 9);
    
    try {
      // Deploy bot via backend API
      const response = await fetch(`${import.meta.env.VITE_API_URL}/deploy-bot`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          botToken: token,
          botId: botId
        })
      });
      
      const result = await response.json();
      
      if (result.success) {
        const newBot: Bot = {
          id: botId,
          name: `SwiftNode-${bots.length + 1}`,
          platform: Platform.TELEGRAM,
          token: token,
          model: location.state?.model || AIModel.GEMINI_3_FLASH,
          status: BotStatus.ACTIVE,
          messageCount: 0,
          tokenUsage: 0,
          lastActive: new Date().toISOString(),
          memoryEnabled: true,
          webhookUrl: result.webhookUrl
        };
        
        setBots([newBot, ...bots]);
        setIsDeploying(false);
        navigate('/dashboard');
      } else {
        throw new Error(result.error || 'Deployment failed');
      }
    } catch (error) {
      console.error('Deployment failed:', error);
      setIsDeploying(false);
      alert(`Deployment failed: ${error.message}`);
    }
  };

  const generateDemoToken = () => {
    setToken('748291035:AAH_f9xS0v5k2m8Lp9qZ-rY7tW4u3i1o');
  };

  return (
    <div className="min-h-screen bg-black flex flex-col items-center justify-center p-6 relative font-sans">
      <div className="stars opacity-50"></div>
      
      {/* Branding Overlay */}
      <div className="absolute top-12 left-16 hidden md:block">
        <span className="text-zinc-700 font-bold text-sm tracking-tighter italic uppercase tracking-widest">SwiftDeploy.<span className="italic">ai</span></span>
      </div>
      <div className="absolute top-12 right-16 hidden md:block">
        <button className="text-zinc-700 font-bold text-sm flex items-center gap-2 hover:text-white transition-colors uppercase tracking-widest">
           <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
           Contact Support
        </button>
      </div>

      <div className="w-full max-w-[940px] bg-[#0c0c0e] border border-white/5 rounded-[48px] shadow-[0_80px_160px_rgba(0,0,0,0.9)] flex flex-col md:row overflow-hidden animate-in fade-in zoom-in-95 duration-700 relative">
        
        {isDeploying && (
          <div className="absolute inset-0 z-50 bg-black/80 backdrop-blur-xl flex flex-col items-center justify-center animate-in fade-in duration-300">
             <div className="w-16 h-16 border-4 border-blue-500/20 border-t-blue-500 rounded-full animate-spin mb-8"></div>
             <p className="text-xl font-black italic tracking-tighter text-white uppercase tracking-[0.2em] animate-pulse">
               {deployStep === 'verifying' ? 'Verifying Telegram Handshake...' : 'Synchronizing Neural Backbone...'}
             </p>
             <p className="text-zinc-500 text-xs font-bold mt-4 italic">Cluster node allocation in progress</p>
          </div>
        )}

        <div className="flex flex-col md:flex-row w-full">
          {/* Left Side: Instructions */}
          <div className="flex-1 p-12 md:p-20 border-b md:border-b-0 md:border-r border-white/5">
            <div className="flex items-center gap-3 mb-12">
              <div className="w-10 h-10 bg-[#0088cc] rounded-full flex items-center justify-center shadow-[0_0_20px_rgba(0,136,204,0.4)]">
                <ICONS.Telegram className="w-6 h-6 text-white" />
              </div>
              <h1 className="text-2xl font-black text-white tracking-tight uppercase italic">Connect Telegram</h1>
            </div>

            <div className="mb-12">
              <h2 className="text-[17px] font-black text-white mb-8 italic uppercase tracking-tighter">Deployment Protocol</h2>
              <ul className="space-y-5">
                {[
                  <>Open Telegram and go to <a href="https://t.me/BotFather" target="_blank" className="text-white border-b border-zinc-700 hover:border-white font-bold transition-all">@BotFather</a>.</>,
                  <>Start a chat and type <code className="bg-zinc-800 text-zinc-200 px-2 py-1 rounded text-xs font-mono">/newbot</code>.</>,
                  <>Follow the prompts to name your bot and choose a username.</>,
                  <>BotFather will send you a message with your bot token. Copy the entire token.</>,
                  <>Paste the token below and click Launch SwiftDeploy Node.</>,
                  <>The system will automatically configure webhooks and deploy your bot.</>
                ].map((step, i) => (
                  <li key={i} className="flex gap-4 text-[14px] font-medium text-zinc-500 leading-relaxed">
                    <span className="text-zinc-700 font-black shrink-0">{i + 1}.</span>
                    <span>{step}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="space-y-6">
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                   <label className="text-xs font-black uppercase tracking-widest text-zinc-600">Enter bot token</label>
                   <button onClick={generateDemoToken} className="text-[10px] font-black uppercase tracking-widest text-blue-500 hover:text-blue-400 transition-colors">Demo Mode</button>
                </div>
                <div className="relative">
                  <div className="absolute left-6 top-1/2 -translate-y-1/2">
                    <svg className="w-5 h-5 text-zinc-700" fill="currentColor" viewBox="0 0 24 24"><path d="M12.65 10C11.83 7.67 9.61 6 7 6c-3.31 0-6 2.69-6 6s2.69 6 6 6c2.61 0 4.83-1.67 5.65-4H17v4h4v-4h2v-4H12.65zM7 14c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2z"/></svg>
                  </div>
                  <input 
                    type="text" 
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    placeholder="34567890:ABCdefGHIjklMNOpqrSTUVwxyz"
                    className="w-full bg-[#141416] border border-white/5 rounded-2xl pl-16 pr-6 py-6 text-white font-mono text-sm focus:outline-none focus:border-white/20 transition-all placeholder:text-zinc-800"
                  />
                </div>
              </div>

              <button 
                onClick={handleConnect}
                disabled={!token || isDeploying}
                className="w-full bg-[#333333] hover:bg-[#444444] disabled:opacity-20 disabled:cursor-not-allowed text-white py-6 rounded-2xl font-black text-lg transition-all flex items-center justify-center gap-3 shadow-2xl active:scale-[0.98] group italic uppercase"
              >
                Launch SwiftDeploy Node <span className="text-zinc-500 group-hover:text-white transition-colors">✓</span>
              </button>
            </div>
          </div>

          {/* Right Side: Visual Mockup */}
          <div className="hidden lg:flex w-[400px] bg-[#09090b] relative items-center justify-center p-10 overflow-hidden">
             {/* Glowing orb behind phone */}
             <div className="absolute w-[300px] h-[300px] bg-blue-600/10 rounded-full blur-[100px]"></div>
             
             {/* Phone Mockup */}
             <div className="w-full h-[640px] bg-black rounded-[54px] border-[12px] border-[#1a1a1c] shadow-[0_40px_80px_rgba(0,0,0,0.8)] relative overflow-hidden flex flex-col">
                <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[140px] h-[34px] bg-[#1a1a1c] rounded-b-3xl z-20"></div>
                
                {/* Simulated Screen */}
                <div className="flex-1 bg-[#0c0c0e] pt-12 flex flex-col">
                   <div className="px-6 mb-6 flex items-center justify-between">
                      <div className="flex-1 bg-zinc-900 h-9 rounded-xl flex items-center px-4 gap-3">
                         <svg className="w-4 h-4 text-zinc-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                         <span className="text-zinc-500 text-sm font-medium uppercase tracking-tighter">BotF</span>
                         <div className="w-0.5 h-4 bg-blue-500 animate-pulse"></div>
                      </div>
                      <span className="text-zinc-600 text-xs font-bold ml-3 uppercase tracking-widest">Cancel</span>
                   </div>

                   <div className="px-6 space-y-6">
                      <p className="text-[10px] font-black uppercase tracking-widest text-zinc-700">Global Search</p>
                      
                      <div className="flex items-center gap-4">
                         <div className="w-12 h-12 rounded-full bg-[#0088cc] flex items-center justify-center">
                            <ICONS.Telegram className="w-7 h-7 text-white" />
                         </div>
                         <div className="flex-1 border-b border-white/5 pb-5">
                            <div className="flex items-center gap-2">
                               <span className="text-sm font-bold text-white italic">BotFather</span>
                               <svg className="w-3.5 h-3.5 text-blue-500" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>
                            </div>
                            <p className="text-xs text-zinc-600">@BotFather</p>
                         </div>
                      </div>

                      {[1,2,3,4].map(i => (
                        <div key={i} className="flex items-center gap-4 opacity-20">
                           <div className="w-12 h-12 rounded-full bg-zinc-900"></div>
                           <div className="flex-1 border-b border-white/5 pb-5">
                              <div className="w-32 h-2.5 bg-zinc-800 rounded"></div>
                              <div className="w-16 h-2 bg-zinc-900 rounded mt-2"></div>
                           </div>
                        </div>
                      ))}
                   </div>

                   {/* iOS Keyboard Mockup */}
                   <div className="mt-auto bg-[#1a1a1c]/80 backdrop-blur-xl p-1.5 grid grid-cols-10 gap-1.5 pt-4 pb-10 px-3">
                      {['q','w','e','r','t','y','u','i','o','p','a','s','d','f','g','h','j','k','l','z','x','c','v','b','n','m'].map(k => (
                        <div key={k} className="h-11 bg-[#2c2c2e] rounded-lg text-white flex items-center justify-center font-medium uppercase text-xs shadow-sm">{k}</div>
                      ))}
                      <div className="col-span-10 grid grid-cols-10 gap-1.5 mt-1">
                         <div className="col-span-2 h-11 bg-[#3a3a3c] rounded-lg flex items-center justify-center text-[10px] text-white">123</div>
                         <div className="col-span-6 h-11 bg-[#3a3a3c] rounded-lg flex items-center justify-center text-[10px] text-white">space</div>
                         <div className="col-span-2 h-11 bg-blue-600 rounded-lg flex items-center justify-center">
                            <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                         </div>
                      </div>
                   </div>
                </div>
             </div>
          </div>
        </div>
      </div>

      <div className="mt-12 animate-pulse">
        <p className="text-[11px] font-black uppercase tracking-[0.5em] text-zinc-700">Cluster Provisioning Phase 2: Active</p>
      </div>
    </div>
  );
};

export default ConnectTelegram;
