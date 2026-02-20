import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Bot, Platform, AIModel, BotStatus } from '../types';
import { ICONS } from '../constants';
import { apiUrl } from '../utils/api';
import BrandLogo from '../components/BrandLogo';

type FlowStep = 'token' | 'send-first-message' | 'pairing' | 'success';
type DeployStep = 'input' | 'verifying' | 'provisioning' | 'webhooking';

const ConnectTelegram: React.FC<{ user: any; bots: Bot[]; setBots: any }> = ({ user, bots, setBots }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const isSuccessStage = new URLSearchParams(location.search).get('stage') === 'success';

  const [token, setToken] = useState('');
  const [isDeploying, setIsDeploying] = useState(false);
  const [deployStep, setDeployStep] = useState<DeployStep>('input');
  const [flowStep, setFlowStep] = useState<FlowStep>(isSuccessStage ? 'success' : 'token');
  const [deployError, setDeployError] = useState('');
  const [showConnectedToast, setShowConnectedToast] = useState(false);

  const [videoError, setVideoError] = useState(false);
  const [videoReady, setVideoReady] = useState(false);
  const [showManualPlay, setShowManualPlay] = useState(false);
  const [creditAmount, setCreditAmount] = useState<string>('10');
  const [isPurchasingCredit, setIsPurchasingCredit] = useState(false);
  const [creditError, setCreditError] = useState('');
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

  const generateDemoToken = () => {
    setToken('748291035:AAH_f9xS0v5k2m8Lp9qZ-rY7tW4u3i1o');
  };

  const handleConnect = async () => {
    if (!token) return;
    setDeployError('');
    setIsDeploying(true);

    setDeployStep('verifying');
    await new Promise((r) => setTimeout(r, 1000));

    setDeployStep('provisioning');
    await new Promise((r) => setTimeout(r, 1000));

    setDeployStep('webhooking');
    await new Promise((r) => setTimeout(r, 1000));

    const botId = Math.random().toString(36).slice(2, 11);

    try {
      const response = await fetch(apiUrl('/deploy-bot'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          botToken: token.trim(),
          botId
        })
      });

      const result = await response.json();

      if (!result.success) {
        if (response.status === 402) {
          setIsDeploying(false);
          alert('Free plan limit reached. Please upgrade to Pro Fleet to deploy additional bots.');
          navigate('/billing?cycle=monthly');
          return;
        }
        throw new Error(result.error || 'Deployment failed');
      }

      const botName = `SwiftNode-${bots.length + 1}`;
      const newBot: Bot = {
        id: botId,
        name: botName,
        platform: Platform.TELEGRAM,
        token: token.trim(),
        model: location.state?.model || AIModel.GEMINI_3_FLASH,
        status: BotStatus.ACTIVE,
        messageCount: 0,
        tokenUsage: 0,
        lastActive: new Date().toISOString(),
        memoryEnabled: true,
        webhookUrl: result.webhookUrl
      };

      setBots([newBot, ...bots]);
      setShowConnectedToast(true);
      window.setTimeout(() => setShowConnectedToast(false), 4200);
      setFlowStep('send-first-message');
      setIsDeploying(false);
      setDeployStep('input');
    } catch (error: any) {
      setIsDeploying(false);
      setDeployStep('input');
      setDeployError(error?.message || 'Unable to connect to backend.');
    }
  };

  const confirmFirstMessage = async () => {
    navigate('/connect/telegram/pairing');
  };

  const handlePurchaseCredit = async () => {
    const numeric = Number(creditAmount);
    if (!Number.isFinite(numeric) || numeric < 10) {
      setCreditError('Minimum purchase amount is $10.');
      return;
    }

    setCreditError('');
    setIsPurchasingCredit(true);
    try {
      const response = await fetch(apiUrl('/billing/create-credit-session'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ amountUsd: Math.floor(numeric) })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data?.checkoutUrl) {
        throw new Error(data?.message || 'Unable to start secure Stripe checkout.');
      }
      window.location.href = data.checkoutUrl;
    } catch (error: any) {
      setCreditError(error?.message || 'Unable to start secure Stripe checkout.');
      setIsPurchasingCredit(false);
    }
  };

  const renderFlowCard = () => {
    if (flowStep === 'send-first-message') {
      return (
        <div className="space-y-6">
          <h2 className="text-[17px] font-black text-white mb-4 italic uppercase tracking-tighter">Connect your Telegram</h2>
          <ul className="space-y-4">
            <li className="text-zinc-400 text-[14px]">1. Open your bot in Telegram.</li>
            <li className="text-zinc-400 text-[14px]">
              2. Send <code className="bg-zinc-800 text-zinc-200 px-2 py-1 rounded text-xs font-mono">/start</code> to activate the conversation.
            </li>
            <li className="text-zinc-400 text-[14px]">3. Click below after you send the first message.</li>
          </ul>
          <button
            onClick={confirmFirstMessage}
            className="w-full btn-deploy-gradient text-white py-5 rounded-2xl font-black text-base transition-all uppercase"
          >
            I have sent a message
          </button>
        </div>
      );
    }

    if (flowStep === 'pairing') {
      return (
        <div className="w-full">
          <div className="relative overflow-hidden bg-gradient-to-br from-[#0b1222]/90 via-[#09182d]/80 to-[#10211a]/70 border border-white/10 rounded-3xl px-6 py-16 md:px-10 text-center shadow-[0_35px_90px_rgba(0,0,0,0.45)]">
            <div className="absolute -top-16 -left-16 w-40 h-40 bg-cyan-400/10 rounded-full blur-3xl"></div>
            <div className="absolute -bottom-16 -right-16 w-40 h-40 bg-emerald-400/10 rounded-full blur-3xl"></div>
            <div className="relative w-12 h-12 mb-8 mx-auto">
              <div className="absolute inset-0 rounded-full border border-white/15"></div>
              <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-cyan-200/80 border-r-emerald-200/70 animate-spin"></div>
            </div>
            <p className="text-3xl md:text-4xl font-medium tracking-[-0.015em] bg-gradient-to-r from-cyan-200 via-sky-200 to-emerald-200 bg-clip-text text-transparent">
              Pairing Telegram
            </p>
            <p className="text-zinc-300 text-base md:text-lg mt-4 font-medium tracking-wide">Connecting your bot. Hang tight...</p>
          </div>
        </div>
      );
    }

    if (flowStep === 'success') {
      return (
        <div className="bg-black/25 border border-white/10 rounded-3xl px-6 py-12 md:px-10 text-center space-y-6">
          <div className="w-16 h-16 rounded-full bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center mx-auto">
            <ICONS.Check className="w-8 h-8 text-emerald-400" />
          </div>

          <div>
            <h2 className="text-3xl md:text-4xl font-bold text-white tracking-tight">Deployment success!</h2>
            <p className="text-zinc-400 mt-2 max-w-xl mx-auto">
              Your bot is live. Use your Telegram to chat; usage and credits are below.
            </p>
          </div>

          <div className="pt-2">
            <p className="text-5xl md:text-6xl font-bold text-white/95 leading-none">$10</p>
            <p className="text-zinc-400 mt-2 font-medium uppercase tracking-[0.12em] text-[11px]">Remaining credits</p>
          </div>

          <div className="text-sm text-zinc-500 font-semibold">
            $0 used today
            <span className="mx-2">•</span>
            $0 used this month
            <span className="mx-2">•</span>
            $10 per month plan
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3 max-w-[460px] mx-auto">
            <input
              type="number"
              min={10}
              step={1}
              value={creditAmount}
              onChange={(e) => setCreditAmount(e.target.value)}
              className="bg-[#141416] border border-white/10 rounded-xl px-4 py-3 text-zinc-200 font-semibold focus:outline-none focus:border-cyan-400/40"
            />
            <button
              type="button"
              onClick={handlePurchaseCredit}
              disabled={isPurchasingCredit}
              className="bg-zinc-100 text-black hover:bg-white rounded-xl px-5 py-3 font-black uppercase text-xs tracking-wider transition-colors"
            >
              {isPurchasingCredit ? 'Opening checkout...' : 'Purchase credit →'}
            </button>
          </div>
          {creditError ? (
            <p className="text-xs text-red-300">{creditError}</p>
          ) : null}

          <p className="text-xs text-zinc-500">One time purchase. 10% is charged as processing fees.</p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-[460px] mx-auto pt-1">
            <a
              href="https://t.me/BotFather"
              target="_blank"
              rel="noreferrer"
              className="text-center bg-zinc-800 hover:bg-zinc-700 text-white py-3 rounded-xl font-black uppercase text-xs tracking-wider"
            >
              Open Telegram
            </a>
            <button
              onClick={() => navigate('/')}
              className="btn-deploy-gradient text-white py-3 rounded-xl font-black uppercase text-xs tracking-wider"
            >
              Go to Home
            </button>
          </div>

          <p className="text-xs text-zinc-500 pt-1">
            For advanced scaling, dedicated performance tuning, or enterprise onboarding, contact support.
          </p>
        </div>
      );
    }

    return (
      <>
        <div className="mb-12">
          <h2 className="text-[17px] font-black text-white mb-8 italic uppercase tracking-tighter">Deployment Protocol</h2>
          <ul className="space-y-5">
            {[
              <>Open Telegram and go to <a href="https://t.me/BotFather" target="_blank" className="text-white border-b border-zinc-700 hover:border-white font-bold transition-all">@BotFather</a>.</>,
              <>Start a chat and type <code className="bg-zinc-800 text-zinc-200 px-2 py-1 rounded text-xs font-mono">/newbot</code>.</>,
              <>Follow the prompts to name your bot and choose a username.</>,
              <>BotFather will send you a message with your bot token. Copy the entire token.</>,
              <>Paste the token below and click Save & Connect.</>,
              <>SwiftDeploy will verify token, configure webhook, and activate your bot.</>
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
              <button onClick={generateDemoToken} className="text-[10px] font-black uppercase tracking-widest text-blue-500 hover:text-blue-400 transition-colors">
                Demo Mode
              </button>
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

          {deployError ? (
            <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 text-sm text-red-300">
              Deployment failed: {deployError}
            </div>
          ) : null}

          <button
            onClick={handleConnect}
            disabled={!token || isDeploying}
            className="w-full btn-deploy-gradient disabled:opacity-20 disabled:cursor-not-allowed text-white py-6 rounded-2xl font-black text-lg transition-all flex items-center justify-center gap-3 shadow-2xl active:scale-[0.98] group uppercase"
          >
            Save & Connect <ICONS.Check className="w-5 h-5 text-zinc-500 group-hover:text-white transition-colors" />
          </button>
        </div>
      </>
    );
  };

  return (
    <div className="min-h-screen bg-[#050a16] flex flex-col items-center justify-center p-6 relative font-sans">
      <div className="stars opacity-50"></div>

      <div className="absolute top-12 left-16 hidden md:block">
        <BrandLogo />
      </div>
      <div className="absolute top-12 right-16 hidden md:block">
        <button
          onClick={() => navigate('/contact')}
          className="text-zinc-700 font-bold text-sm flex items-center gap-2 hover:text-white transition-colors uppercase tracking-widest"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
          Contact Support
        </button>
      </div>

      <div className="text-center mb-10 max-w-5xl px-6">
        <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-emerald-400/10 border border-emerald-300/20 text-emerald-300 text-xs font-black uppercase tracking-[0.2em] mb-7">
          <span className="w-2 h-2 bg-emerald-300 rounded-full animate-pulse"></span>
          Autonomous Telegram Provisioning
        </div>
        <h1 className="text-4xl md:text-6xl font-black tracking-tight uppercase leading-[0.95]">
          <span className="text-white">Deploy </span>
          <span className="bg-gradient-to-r from-emerald-300 via-cyan-300 to-sky-300 bg-clip-text text-transparent">OpenClaw</span>
          <span className="text-zinc-300"> Under</span>
          <br />
          <span className="bg-gradient-to-r from-sky-300 via-cyan-200 to-emerald-300 bg-clip-text text-transparent">30 Seconds</span>
        </h1>
        <p className="text-zinc-400 text-base md:text-lg mt-4 max-w-3xl mx-auto">
          Eliminate technical setup and instantly launch your own always-on OpenClaw AI instance with a single secure deployment flow.
        </p>
      </div>

      <div className="w-full max-w-[940px] bg-[#050a16] border border-white/10 rounded-[48px] shadow-[0_80px_160px_rgba(0,0,0,0.9)] flex flex-col md:row overflow-hidden animate-in fade-in zoom-in-95 duration-700 relative">
        {isDeploying ? (
          <div className="absolute inset-0 z-50 bg-black/80 backdrop-blur-xl flex flex-col items-center justify-center animate-in fade-in duration-300 px-8 text-center">
            <div className="w-16 h-16 border-4 border-blue-500/20 border-t-blue-500 rounded-full animate-spin mb-8"></div>
            <p className="text-xl font-black italic tracking-tighter text-white uppercase tracking-[0.15em] animate-pulse">
              {deployStep === 'verifying'
                ? 'Verifying token'
                : deployStep === 'provisioning'
                  ? 'Starting your deployment'
                  : 'Pairing Telegram webhook'}
            </p>
            <p className="text-zinc-500 text-xs font-bold mt-4 italic">Do not switch tabs. This only takes a few seconds.</p>
          </div>
        ) : null}

        <div className="flex flex-col md:flex-row w-full">
          <div className={`p-12 md:p-20 border-b md:border-b-0 ${flowStep === 'success' ? 'w-full' : 'flex-1 md:border-r border-white/5'}`}>
            <div className="flex items-center gap-3 mb-12">
              <ICONS.Telegram className="w-9 h-9 shrink-0" />
              <h1 className="text-2xl font-black tracking-tight uppercase italic bg-gradient-to-r from-cyan-200 via-sky-200 to-emerald-200 bg-clip-text text-transparent">Connect Telegram</h1>
            </div>
            {renderFlowCard()}
          </div>

          {flowStep !== 'success' ? (
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
                {!videoError && showManualPlay ? (
                  <button
                    onClick={handleManualPlay}
                    className="absolute inset-x-6 bottom-20 btn-deploy-gradient py-3 rounded-xl text-xs font-black uppercase z-20"
                  >
                    Play Demo Video
                  </button>
                ) : null}
                <div className="absolute bottom-4 left-4 right-4 bg-black/70 backdrop-blur-sm rounded-xl p-3 z-10">
                  <p className="text-white text-xs font-bold text-center uppercase tracking-wider">Telegram Setup Demo</p>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <div className="mt-12 animate-pulse">
        <p className="text-[11px] font-black uppercase tracking-[0.5em] text-zinc-700">Cluster Provisioning Phase 2: Active</p>
      </div>

      {showConnectedToast ? (
        <div className="fixed right-6 bottom-6 z-[120] max-w-[380px] bg-emerald-500/15 border border-emerald-400/40 backdrop-blur-xl rounded-2xl px-5 py-4 shadow-[0_20px_50px_rgba(0,0,0,0.45)] animate-in fade-in slide-in-from-bottom-2 duration-300">
          <div className="flex items-start gap-3">
            <div className="w-6 h-6 rounded-full bg-emerald-500/25 border border-emerald-400/50 flex items-center justify-center mt-0.5">
              <ICONS.Check className="w-4 h-4 text-emerald-300" />
            </div>
            <div>
              <p className="text-emerald-200 font-black text-sm tracking-wide">Telegram connected</p>
              <p className="text-emerald-100/85 text-xs mt-1">Your bot is now linked. You are ready to send and receive messages.</p>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default ConnectTelegram;
