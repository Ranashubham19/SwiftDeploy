
import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Bot, Platform, AIModel, BotStatus } from '../types';
import { ICONS } from '../constants';
import { apiUrl } from '../utils/api';
import BrandLogo from '../components/BrandLogo';

const ConnectTelegram: React.FC<{ user: any, bots: Bot[], setBots: any }> = ({ user, bots, setBots }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const [token, setToken] = useState('');
  const [isDeploying, setIsDeploying] = useState(false);
  const [deployStep, setDeployStep] = useState<'input' | 'verifying' | 'syncing'>('input');
  const [videoError, setVideoError] = useState(false);
  const [videoReady, setVideoReady] = useState(false);
  const [showManualPlay, setShowManualPlay] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const node = videoRef.current;
    if (!node || videoError) return;
    node.muted = true;
    node.playsInline = true;
    node
      .play()
      .then(() => {
        setShowManualPlay(false);
      })
      .catch(() => {
        setShowManualPlay(true);
      });
  }, [videoReady, videoError]);

  const handleManualPlay = async () => {
    const node = videoRef.current;
    if (!node) return;
    try {
      node.muted = true;
      await node.play();
      setShowManualPlay(false);
    } catch {
      setShowManualPlay(true);
    }
  };

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
      const response = await fetch(apiUrl('/deploy-bot'), {
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
        if (response.status === 402) {
          alert('Free plan limit reached. Please upgrade to Pro Fleet to deploy additional bots.');
          navigate('/billing?cycle=monthly');
          return;
        }
        throw new Error(result.error || 'Deployment failed');
      }
    } catch (error: any) {
      console.error('Deployment failed:', error);
      setIsDeploying(false);
      alert(`Deployment failed: ${error?.message || 'Unable to connect to backend.'}`);
    }
  };

  const generateDemoToken = () => {
    setToken('748291035:AAH_f9xS0v5k2m8Lp9qZ-rY7tW4u3i1o');
  };

  return (
    <div className="min-h-screen bg-[#050a16] flex flex-col items-center justify-center p-6 relative font-sans">
      <div className="stars opacity-50"></div>
      
      {/* Branding Overlay */}
      <div className="absolute top-12 left-16 hidden md:block">
        <BrandLogo />
      </div>
      <div className="absolute top-12 right-16 hidden md:block">
        <button onClick={() => navigate('/contact')} className="text-zinc-700 font-bold text-sm flex items-center gap-2 hover:text-white transition-colors uppercase tracking-widest">
           <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
           Contact Support
        </button>
      </div>

      <div className="w-full max-w-[940px] bg-[#091428] border border-white/10 rounded-[48px] shadow-[0_80px_160px_rgba(0,0,0,0.9)] flex flex-col md:row overflow-hidden animate-in fade-in zoom-in-95 duration-700 relative">
        
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
              <ICONS.Telegram className="w-9 h-9 shrink-0" />
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
                className="w-full btn-deploy-gradient disabled:opacity-20 disabled:cursor-not-allowed text-white py-6 rounded-2xl font-black text-lg transition-all flex items-center justify-center gap-3 shadow-2xl active:scale-[0.98] group uppercase"
              >
                Launch SwiftDeploy Node <span className="text-zinc-500 group-hover:text-white transition-colors">✓</span>
              </button>
            </div>
          </div>

          {/* Right Side: Demo Video */}
          <div className="hidden md:flex w-[400px] bg-[#09090b] relative items-center justify-center p-10 overflow-hidden">
            <div className="absolute w-[300px] h-[300px] bg-blue-600/10 rounded-full blur-[100px]"></div>
            <div className="w-full h-[640px] bg-black rounded-[54px] border-[12px] border-[#1a1a1c] shadow-[0_40px_80px_rgba(0,0,0,0.8)] relative overflow-hidden">
              {!videoError ? (
                <video
                  ref={videoRef}
                  autoPlay
                  loop
                  muted
                  playsInline
                  controls
                  preload="auto"
                  className="w-full h-full object-cover"
                  onLoadedData={() => setVideoReady(true)}
                  onError={() => setVideoError(true)}
                >
                  <source src="/videos/demo.mp4" type="video/mp4" />
                  <source src="/videos/telegram-token-tutorial.mp4" type="video/mp4" />
                  <source src="/videos/telegram-token-tutorial.webm" type="video/webm" />
                  Your browser does not support the video tag.
                </video>
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center px-6 text-center bg-[#0b0b0d]">
                  <p className="text-white font-bold mb-3">Video preview failed to load</p>
                  <a
                    href="/videos/demo.mp4"
                    target="_blank"
                    rel="noreferrer"
                    className="btn-deploy-gradient px-4 py-2 rounded-lg text-sm font-black uppercase"
                  >
                    Open Demo Video
                  </a>
                </div>
              )}
              {!videoError && showManualPlay && (
                <button
                  onClick={handleManualPlay}
                  className="absolute inset-x-6 bottom-20 btn-deploy-gradient py-3 rounded-xl text-xs font-black uppercase z-20"
                >
                  Play Demo Video
                </button>
              )}
              <div className="absolute bottom-4 left-4 right-4 bg-black/70 backdrop-blur-sm rounded-xl p-3 z-10">
                <p className="text-white text-xs font-bold text-center uppercase tracking-wider">
                  Telegram Setup Demo
                </p>
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
