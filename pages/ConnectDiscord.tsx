import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Bot, Platform, AIModel, BotStatus } from '../types';
import { ICONS } from '../constants';
import { apiUrl } from '../utils/api';
import BrandLogo from '../components/BrandLogo';

const ConnectDiscord: React.FC<{ user: any, bots: Bot[], setBots: any }> = ({ user, bots, setBots }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const [botToken, setBotToken] = useState('');
  const [applicationId, setApplicationId] = useState('');
  const [publicKey, setPublicKey] = useState('');
  const [isDeploying, setIsDeploying] = useState(false);
  const [deployStep, setDeployStep] = useState<'input' | 'verifying' | 'syncing'>('input');
  const [videoError, setVideoError] = useState(false);
  const [videoReady, setVideoReady] = useState(false);
  const [showManualPlay, setShowManualPlay] = useState(false);
  const [tutorialStep, setTutorialStep] = useState(0);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const discordTutorialSteps = [
    <>Open <strong className="text-white">Discord Developer Portal</strong> and create/select your application.</>,
    <>Go to <strong className="text-white">Bot</strong> tab and copy your <strong className="text-white">Bot Token</strong>.</>,
    <>From <strong className="text-white">General Information</strong>, copy <strong className="text-white">Application ID</strong> and <strong className="text-white">Public Key</strong>.</>,
    <>Paste all credentials below to deploy the <strong className="text-white">AI command system</strong>.</>,
    <>After deploy, use <strong className="text-white">/ask</strong> in your Discord server for AI replies.</>
  ];

  useEffect(() => {
    const interval = setInterval(() => {
      setTutorialStep((prev) => (prev + 1) % discordTutorialSteps.length);
    }, 2600);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const node = videoRef.current;
    if (!node || videoError) return;
    node.muted = true;
    node.playsInline = true;
    node.play().then(() => {
      setShowManualPlay(false);
    }).catch(() => {
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
    if (!botToken || !applicationId || !publicKey) return;
    setIsDeploying(true);
    setDeployStep('verifying');
    await new Promise((r) => setTimeout(r, 1200));
    setDeployStep('syncing');
    await new Promise((r) => setTimeout(r, 1000));

    const botId = Math.random().toString(36).slice(2, 11);

    try {
      const response = await fetch(apiUrl('/deploy-discord-bot'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          botId,
          botToken: botToken.trim(),
          applicationId: applicationId.trim(),
          publicKey: publicKey.trim()
        })
      });

      const rawBody = await response.text();
      const result = (() => {
        try {
          return rawBody ? JSON.parse(rawBody) : {};
        } catch {
          return { message: rawBody };
        }
      })();

      if (!response.ok || !result?.success) {
        if (response.status === 401) {
          alert('Session expired. Please sign in again and retry Discord deployment.');
          navigate('/login?mode=login');
          return;
        }
        throw new Error(
          result?.details ||
          result?.error ||
          result?.message ||
          `Discord deployment failed (HTTP ${response.status})`
        );
      }

      const newBot: Bot = {
        id: botId,
        name: result.botName ? `${result.botName}` : `DiscordNode-${bots.length + 1}`,
        platform: Platform.DISCORD,
        token: botToken,
        model: location.state?.model || AIModel.GPT_5_2,
        status: BotStatus.ACTIVE,
        messageCount: 0,
        tokenUsage: 0,
        lastActive: new Date().toISOString(),
        memoryEnabled: true,
        webhookUrl: result.interactionUrl
      };

      setBots([newBot, ...bots]);
      if (result.inviteUrl) {
        window.open(result.inviteUrl, '_blank', 'noopener,noreferrer');
      }
      navigate('/');
    } catch (error: any) {
      alert(`Deployment failed: ${error?.message || 'Unable to connect to backend.'}`);
    } finally {
      setIsDeploying(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#050a16] flex flex-col items-center justify-center p-6 relative font-sans">
      <div className="stars opacity-50"></div>
      <div className="absolute top-12 left-16 hidden md:block">
        <BrandLogo />
      </div>

      <div className="text-center mb-8 max-w-4xl px-6">
        <h1 className="text-4xl md:text-6xl font-black text-white tracking-tight uppercase">
          Deploy OpenClaw Under 30 Seconds
        </h1>
        <p className="text-zinc-400 text-base md:text-lg mt-3">
          Eliminate technical setup and instantly launch your own always-on OpenClaw AI instance with a single secure deployment flow.
        </p>
      </div>

      <div className="w-full max-w-[1120px] bg-[#050a16] border border-white/10 rounded-[48px] shadow-[0_80px_160px_rgba(0,0,0,0.9)] overflow-hidden relative animate-in fade-in zoom-in-95 duration-700">
        {isDeploying && (
          <div className="absolute inset-0 z-50 bg-black/80 backdrop-blur-xl flex flex-col items-center justify-center animate-in fade-in duration-300">
            <div className="w-16 h-16 border-4 border-indigo-500/20 border-t-indigo-500 rounded-full animate-spin mb-8"></div>
            <p className="text-xl font-black italic tracking-tighter text-white uppercase tracking-[0.2em] animate-pulse">
              {deployStep === 'verifying' ? 'Verifying Discord Bot Credentials...' : 'Publishing Slash Commands...'}
            </p>
            <p className="text-zinc-500 text-xs font-bold mt-4 italic">Secure bot provisioning in progress</p>
          </div>
        )}

        <div className="p-12 md:p-16">
            <div className="flex items-center gap-3 mb-10">
              <ICONS.Discord className="w-9 h-9 shrink-0" />
              <h1 className="text-3xl md:text-4xl font-black text-white tracking-tight uppercase italic">Connect Discord</h1>
            </div>

            <div className="mb-10 space-y-5 max-w-4xl">
              {discordTutorialSteps.map((step, i) => (
                <div key={i} className="flex gap-3 text-sm text-zinc-400">
                  <span className="text-zinc-600 font-black">{i + 1}.</span>
                  <span>{step}</span>
                </div>
              ))}
            </div>

            <div className="grid md:grid-cols-2 gap-5 mb-8">
              <div>
                <label className="text-xs font-black uppercase tracking-widest text-zinc-600 mb-2 block">Bot Token</label>
                <input
                  type="password"
                  value={botToken}
                  onChange={(e) => setBotToken(e.target.value)}
                  placeholder="Discord Bot Token"
                  className="w-full bg-[#141416] border border-white/5 rounded-2xl px-6 py-4 text-white text-sm focus:outline-none focus:border-white/20 placeholder:text-zinc-700"
                />
              </div>
              <div>
                <label className="text-xs font-black uppercase tracking-widest text-zinc-600 mb-2 block">Application ID</label>
                <input
                  type="text"
                  value={applicationId}
                  onChange={(e) => setApplicationId(e.target.value)}
                  placeholder="123456789012345678"
                  className="w-full bg-[#141416] border border-white/5 rounded-2xl px-6 py-4 text-white text-sm focus:outline-none focus:border-white/20 placeholder:text-zinc-700"
                />
              </div>
              <div>
                <label className="text-xs font-black uppercase tracking-widest text-zinc-600 mb-2 block">Public Key</label>
                <input
                  type="text"
                  value={publicKey}
                  onChange={(e) => setPublicKey(e.target.value)}
                  placeholder="64-char hexadecimal public key"
                  className="w-full bg-[#141416] border border-white/5 rounded-2xl px-6 py-4 text-white text-sm focus:outline-none focus:border-white/20 placeholder:text-zinc-700"
                />
              </div>
            </div>

            <button
              onClick={handleConnect}
              disabled={isDeploying || !botToken || !applicationId || !publicKey}
              className="w-full md:w-auto md:min-w-[340px] bg-[#5865F2] hover:bg-[#4c59e0] disabled:opacity-30 disabled:cursor-not-allowed text-white px-12 py-5 rounded-2xl font-black text-base transition-all active:scale-[0.98] uppercase tracking-wide"
            >
              Deploy Discord Node
            </button>

            <div className="mt-10">
              <div className="w-full max-w-[420px] h-[560px] bg-black rounded-[44px] border-[12px] border-[#1a1a1c] shadow-[0_30px_70px_rgba(0,0,0,0.8)] relative overflow-hidden">
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
                    <source src="/videos/discord-demo.mp4" type="video/mp4" />
                    <source src="/videos/discord-demo.webm" type="video/webm" />
                    <source src="/videos/demo.mp4" type="video/mp4" />
                  </video>
                ) : (
                  <div className="absolute inset-0 bg-[#0b0b10] flex flex-col">
                    <div className="px-5 py-3 border-b border-white/10 flex items-center justify-between">
                      <p className="text-[11px] uppercase tracking-[0.2em] text-zinc-400 font-black">Discord Setup Reel</p>
                      <span className="text-[10px] text-[#5865F2] font-black uppercase">Auto Guide</span>
                    </div>
                    <div className="flex-1 p-5 flex flex-col justify-center">
                      <p className="text-[10px] uppercase tracking-[0.2em] text-zinc-500 font-black mb-2">
                        Step {tutorialStep + 1} of {discordTutorialSteps.length}
                      </p>
                      <div className="rounded-2xl border border-[#5865F2]/35 bg-[#5865F2]/10 p-4">
                        <p className="text-white font-bold leading-relaxed">{discordTutorialSteps[tutorialStep]}</p>
                      </div>
                      <div className="mt-4 h-2 w-full bg-zinc-800 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-[#5865F2] transition-all duration-700"
                          style={{ width: `${((tutorialStep + 1) / discordTutorialSteps.length) * 100}%` }}
                        />
                      </div>
                    </div>
                  </div>
                )}
                {!videoError && showManualPlay && (
                  <button
                    onClick={handleManualPlay}
                    className="absolute inset-x-5 bottom-16 bg-[#5865F2] hover:bg-[#4c59e0] text-white py-3 rounded-xl text-xs font-black uppercase z-20"
                  >
                    Play Discord Demo Video
                  </button>
                )}
                <div className="absolute bottom-3 left-3 right-3 bg-black/70 backdrop-blur-sm rounded-xl p-3 z-10">
                  <p className="text-white text-xs font-bold text-center uppercase tracking-wider">
                    Discord Deployment Tutorial
                  </p>
                </div>
              </div>
            </div>

            <div className="mt-10 p-4 rounded-2xl border border-white/10 bg-black/30 max-w-[420px]">
              <p className="text-[11px] uppercase tracking-[0.25em] text-zinc-600 font-black mb-2">Operator</p>
              <p className="text-white font-bold">{user?.name}</p>
              <p className="text-zinc-500 text-xs mt-1">{user?.email}</p>
            </div>
        </div>
      </div>
    </div>
  );
};

export default ConnectDiscord;
