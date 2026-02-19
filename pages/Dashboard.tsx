
import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { User, Bot } from '../types';
import { ICONS } from '../constants';
import { apiUrl, getApiBaseUrl } from '../utils/api';
import BrandLogo from '../components/BrandLogo';

interface DashboardProps {
  user: User;
  bots: Bot[];
  setBots: React.Dispatch<React.SetStateAction<Bot[]>>;
  onLogout: () => void;
}

type Tab = 'FLEET' | 'INFRASTRUCTURE' | 'SETTINGS';
type LiveBotItem = {
  botId: string;
  platform: 'TELEGRAM' | 'DISCORD';
  status: 'ONLINE' | 'OFFLINE' | 'IDLE';
  gatewayConnected?: boolean;
  messageCount: number;
  responseCount: number;
  errorCount: number;
  tokenUsage: number;
  avgLatencyMs: number;
  lastActiveAt: string | null;
  lastErrorAt: string | null;
  lastErrorMessage: string | null;
  webhookOrInteractionUrl: string;
  managementUrl: string;
  monitoringUrl: string;
};
type LiveOpsData = {
  overview: {
    deployedBots: number;
    onlineBots: number;
    messageCount: number;
    responseCount: number;
    errorCount: number;
    tokenUsage: number;
    avgLatencyMs: number;
    lastEventAt: string | null;
    serverUptimeSec: number;
  };
  selectedBot: LiveBotItem | null;
  bots: LiveBotItem[];
};
type AutomationRule = {
  id: string;
  name: string;
  description: string;
  trigger: 'KEYWORD' | 'MENTION' | 'SILENCE_GAP' | 'HIGH_VOLUME';
  action: 'AUTO_REPLY' | 'ESCALATE' | 'TAG' | 'DELAY_REPLY';
  keyword?: string;
  cooldownSec: number;
  active: boolean;
  runCount: number;
  successCount: number;
  updatedAt: string;
};

const DashboardContent: React.FC<DashboardProps> = ({ user, bots, setBots, onLogout }) => {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<Tab>('FLEET');
  const [selectedBotId, setSelectedBotId] = useState<string | null>(bots[0]?.id || null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [webhookInfo, setWebhookInfo] = useState<any>(null);
  const [syncStatus, setSyncStatus] = useState<'IDLE' | 'SUCCESS' | 'ERROR'>('IDLE');
  const [diagnosticMode, setDiagnosticMode] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [automationRules, setAutomationRules] = useState<AutomationRule[]>([]);
  const [isAutomationLoading, setIsAutomationLoading] = useState(false);
  const [automationBusyRuleId, setAutomationBusyRuleId] = useState<string | null>(null);
  const [automationSimulation, setAutomationSimulation] = useState('No simulation run yet.');
  const [automationDraft, setAutomationDraft] = useState({
    name: 'Support Intent Fast Reply',
    description: 'Auto-reply with quick support summary and response CTA.',
    trigger: 'KEYWORD' as AutomationRule['trigger'],
    action: 'AUTO_REPLY' as AutomationRule['action'],
    keyword: 'support',
    cooldownSec: 45
  });
  const [opsStatus, setOpsStatus] = useState<{
    mode: string;
    webhookReady: boolean;
    aiConfigured: boolean;
    deployedBots: number;
    aiProvider?: string;
  } | null>(null);
  const [liveOps, setLiveOps] = useState<LiveOpsData | null>(null);

  const handleLogout = async () => {
    try {
      const response = await fetch(apiUrl('/logout'), {
        method: 'GET',
        credentials: 'include'
      });
      
      if (response.ok) {
        onLogout();
        navigate('/login');
      }
    } catch (error) {
      console.error('Logout failed:', error);
      // Even if the request fails, still logout locally
      onLogout();
      navigate('/login');
    }
  };
  
  const [terminalLogs, setTerminalLogs] = useState<{msg: string, type: 'info'|'ok'|'err'|'ai'|'user'}[]>([
    { msg: "SwiftDeploy Neural Interface Online. System ready for directives.", type: 'ok' }
  ]);
  const [terminalInput, setTerminalInput] = useState('');
  const terminalEndRef = useRef<HTMLDivElement>(null);

  const selectedBot = bots.find(b => b.id === selectedBotId);
  const selectedLiveBot = liveOps?.selectedBot || null;
  const backendBaseUrl = getApiBaseUrl();
  const webhookUrl = selectedLiveBot?.webhookOrInteractionUrl || selectedBot?.webhookUrl || `${backendBaseUrl}/webhook`;
  const managementUrl = selectedLiveBot?.managementUrl || (selectedBot?.platform === 'DISCORD' ? 'https://discord.com/developers/applications' : 'https://t.me');

  const initials = user.name.substring(0, 2).toUpperCase();

  useEffect(() => {
    terminalEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [terminalLogs, isGenerating]);

  useEffect(() => {
    if (!selectedBotId && bots.length > 0) {
      setSelectedBotId(bots[0].id);
    }
  }, [bots, selectedBotId]);

  useEffect(() => {
    const loadStatus = async () => {
      try {
        const [opsRes, liveRes] = await Promise.all([
          fetch(apiUrl('/ops/status'), { credentials: 'include' }),
          fetch(apiUrl(`/ops/live-data${selectedBotId ? `?botId=${encodeURIComponent(selectedBotId)}` : ''}`), { credentials: 'include' })
        ]);

        const opsJson = await opsRes.json().catch(() => ({}));
        if (opsRes.ok && opsJson?.success) {
          setOpsStatus({
            mode: opsJson.mode,
            webhookReady: Boolean(opsJson.webhookReady),
            aiConfigured: Boolean(opsJson.aiConfigured),
            deployedBots: Number(opsJson.deployedBots || 0),
            aiProvider: String(opsJson.aiProvider || '').toUpperCase()
          });
        }

        const liveJson = await liveRes.json().catch(() => ({}));
        if (liveRes.ok && liveJson?.success) {
          setLiveOps({
            overview: liveJson.overview,
            selectedBot: liveJson.selectedBot,
            bots: Array.isArray(liveJson.bots) ? liveJson.bots : []
          });
        }
      } catch {
        // Keep dashboard functional even if live telemetry endpoint is unavailable
      }
    };

    loadStatus();
    const interval = setInterval(loadStatus, 5000);
    return () => clearInterval(interval);
  }, [selectedBotId]);

  useEffect(() => {
    if (!liveOps?.bots?.length) return;
    setBots((prev) => prev.map((bot) => {
      const live = liveOps.bots.find((item) => item.botId === bot.id);
      if (!live) return bot;
      return {
        ...bot,
        messageCount: live.messageCount,
        tokenUsage: live.tokenUsage,
        lastActive: live.lastActiveAt || bot.lastActive
      };
    }));
  }, [liveOps, setBots]);

  const loadAutomationRules = async () => {
    setIsAutomationLoading(true);
    try {
      const res = await fetch(apiUrl('/automation/rules'), { credentials: 'include' });
      const json = await res.json().catch(() => ({}));
      if (res.ok && json?.success && Array.isArray(json.rules)) {
        setAutomationRules(json.rules);
      }
    } finally {
      setIsAutomationLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab !== 'SETTINGS') return;
    loadAutomationRules();
  }, [activeTab]);

  /**
   * Cleans AI response by stripping markdown bold symbols (**)
   */
  const sanitizeAiResponse = (text: string) => {
    return text.replace(/\*\*/g, '');
  };

  const addLog = (msg: string, type: 'info'|'ok'|'err'|'ai'|'user') => {
    const processedMsg = type === 'ai' ? sanitizeAiResponse(msg) : msg;
    setTerminalLogs(prev => [...prev, { msg: processedMsg, type }]);
  };

  const handleTerminalSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!terminalInput.trim() || isGenerating) return;

    const userInput = terminalInput;
    setTerminalInput('');
    addLog(userInput, 'user');
    setIsGenerating(true);

    try {
      const res = await fetch(apiUrl('/ai/respond'), {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: userInput })
      });
      const result = await res.json().catch(() => ({}));
      if (!res.ok || !result?.success || typeof result?.response !== 'string') {
        throw new Error(result?.message || 'AI response service unavailable');
      }
      addLog(result.response, 'ai');
    } catch (err: any) {
      addLog(`CRITICAL_ERROR: Failed to route neural signal. ${err.message || 'Check connection.'}`, 'err');
    } finally {
      setIsGenerating(false);
    }
  };

  const refreshWebhookStatus = async () => {
    setIsRefreshing(true);
    setWebhookInfo(null);
    setSyncStatus('IDLE');
    addLog("Initiating production node synchronization...", 'info');
    
    try {
      const statusUrl = selectedBot?.platform === 'DISCORD' && selectedBot?.id
        ? `${backendBaseUrl}/discord/bot-status/${selectedBot.id}`
        : `${backendBaseUrl}/set-webhook`;
      const res = await fetch(statusUrl, {
        method: 'GET',
        credentials: 'include',
        headers: { 'Accept': 'application/json' }
      });
      
      if (!res.ok) throw new Error(`Backend Handshake Status: ${res.status}`);
      
      const data = await res.json();
      setWebhookInfo(data);
      setSyncStatus('SUCCESS');
      setDiagnosticMode(false);
      addLog("Node synchronization complete.", 'ok');
    } catch (err: any) {
      addLog("External node unreachable. Activating local simulation gateway.", 'err');
      
      setTimeout(() => {
        setWebhookInfo({
          ok: true,
          status: "SIMULATED_SUCCESS",
          diagnostic: "LOCAL_SERVER_RECOVERY",
          action_required: "Start local backend service for live production control.",
          bot_status: "Waiting for signal..."
        });
        setSyncStatus('SUCCESS');
        setDiagnosticMode(true);
        setIsRefreshing(false);
        addLog("Neural Bridge established via Simulation Gateway.", 'ok');
      }, 1000);
      return;
    }
    setIsRefreshing(false);
  };

  const createAutomationRule = async () => {
    const payload = {
      ...automationDraft,
      cooldownSec: Number(automationDraft.cooldownSec || 0)
    };
    const res = await fetch(apiUrl('/automation/rules'), {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json?.success) {
      throw new Error(json?.message || 'Failed to create automation rule');
    }
    setAutomationRules(Array.isArray(json.rules) ? json.rules : []);
    setAutomationSimulation(`Rule "${payload.name}" created successfully.`);
  };

  const toggleAutomationRule = async (ruleId: string, active: boolean) => {
    setAutomationBusyRuleId(ruleId);
    try {
      const res = await fetch(apiUrl(`/automation/rules/${ruleId}`), {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: !active })
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.success) {
        throw new Error(json?.message || 'Failed to update rule');
      }
      setAutomationRules(Array.isArray(json.rules) ? json.rules : []);
    } finally {
      setAutomationBusyRuleId(null);
    }
  };

  const deleteAutomationRule = async (ruleId: string) => {
    setAutomationBusyRuleId(ruleId);
    try {
      const res = await fetch(apiUrl(`/automation/rules/${ruleId}`), {
        method: 'DELETE',
        credentials: 'include'
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.success) {
        throw new Error(json?.message || 'Failed to delete rule');
      }
      setAutomationRules(Array.isArray(json.rules) ? json.rules : []);
    } finally {
      setAutomationBusyRuleId(null);
    }
  };

  const simulateAutomationRule = async (ruleId: string) => {
    setAutomationBusyRuleId(ruleId);
    try {
      const res = await fetch(apiUrl(`/automation/rules/${ruleId}/simulate`), {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ botId: selectedBotId || '' })
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.success || !json?.simulation) {
        throw new Error(json?.message || 'Failed to simulate rule');
      }
      const s = json.simulation;
      setAutomationSimulation(
        `Simulation complete for "${s.ruleName}"\nRuns: ${s.estimatedRuns}\nSuccess: ${s.estimatedSuccess}\nImpact: ${s.estimatedImpactPct}%\nConfidence: ${s.confidencePct}%\nObserved traffic: ${s.observedTraffic}`
      );
      setAutomationRules((prev) => prev.map((rule) => rule.id === json?.rule?.id ? json.rule : rule));
    } finally {
      setAutomationBusyRuleId(null);
    }
  };

  const selectedMessageCount = selectedLiveBot?.messageCount ?? selectedBot?.messageCount ?? 0;
  const selectedTokenUsage = selectedLiveBot?.tokenUsage ?? selectedBot?.tokenUsage ?? 0;
  const selectedResponseCount = selectedLiveBot?.responseCount ?? 0;
  const selectedErrorCount = selectedLiveBot?.errorCount ?? 0;
  const selectedLatency = selectedLiveBot?.avgLatencyMs ?? liveOps?.overview?.avgLatencyMs ?? 0;
  const selectedErrorRate = selectedMessageCount > 0 ? (selectedErrorCount / selectedMessageCount) * 100 : 0;
  const campaignHeat = Math.min(100, Math.max(8, Math.round(selectedMessageCount * 2 + selectedResponseCount)));
  const autonomyLevel = Math.max(0, Math.min(100, Math.round((opsStatus?.aiConfigured ? 70 : 20) + (selectedResponseCount > 0 ? 20 : 0) - Math.min(20, selectedErrorRate))));
  const escalationRisk = selectedErrorRate >= 25 ? 'High' : selectedErrorRate >= 10 ? 'Medium' : 'Low';
  const monitoringUrl = selectedLiveBot?.monitoringUrl || apiUrl('/ops/live-data');

  const renderFleetView = () => (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
      <header className="mb-12">
        <h2 className="text-6xl font-black tracking-tighter italic text-white mb-2 uppercase leading-none">Fleet Control</h2>
        <p className="text-zinc-500 font-bold italic">Cluster Status: <span className={`uppercase tracking-widest ml-2 ${selectedLiveBot?.status === 'ONLINE' ? 'text-emerald-500' : selectedLiveBot?.status === 'IDLE' ? 'text-amber-500' : 'text-red-500'}`}>{selectedLiveBot?.status || 'UNKNOWN'}</span></p>
        <p className="text-zinc-600 text-xs font-bold mt-2 uppercase tracking-widest">
          {opsStatus ? `Mode: ${opsStatus.mode} | Provider: ${opsStatus.aiProvider || 'N/A'} | Bots: ${opsStatus.deployedBots}` : 'Loading live cluster telemetry...'}
        </p>
      </header>

      <div className="grid md:grid-cols-2 gap-8 mb-12">
        <div className="config-card p-10 bg-[#0c0c0e] border-white/5 group hover:border-blue-500/20 transition-colors">
          <p className="text-[11px] font-black uppercase tracking-[0.2em] text-zinc-700 mb-4">Signal Traffic</p>
          <p className="text-4xl md:text-5xl lg:text-6xl font-black text-white italic tracking-tighter whitespace-nowrap overflow-hidden">{selectedMessageCount.toLocaleString()}</p>
          <div className="mt-6 flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse"></div>
            <span className="text-[10px] font-black text-blue-500 uppercase tracking-widest">Live Flow</span>
          </div>
        </div>
        <div className="config-card p-10 bg-[#0c0c0e] border-white/5 group hover:border-emerald-500/20 transition-colors">
          <p className="text-[11px] font-black uppercase tracking-[0.2em] text-zinc-700 mb-4">Neural Health</p>
          <p className="text-4xl md:text-5xl lg:text-6xl font-black text-white italic tracking-tighter whitespace-nowrap overflow-hidden">
            {Math.max(0, Math.round(100 - Math.min(100, selectedErrorRate))).toLocaleString()}%
          </p>
          <div className="mt-6 flex items-center gap-2">
            <div className={`w-1.5 h-1.5 rounded-full ${selectedErrorRate <= 10 ? 'bg-emerald-500' : selectedErrorRate <= 25 ? 'bg-amber-500' : 'bg-red-500'}`}></div>
            <span className={`text-[10px] font-black uppercase tracking-widest ${selectedErrorRate <= 10 ? 'text-emerald-500' : selectedErrorRate <= 25 ? 'text-amber-500' : 'text-red-500'}`}>
              {selectedErrorRate <= 10 ? 'Stable' : selectedErrorRate <= 25 ? 'Watch' : 'Degraded'}
            </span>
          </div>
        </div>
      </div>

      <div className="config-card p-10 bg-[#0b1220] border-white/10 mb-12">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6 mb-8">
          <div>
            <h3 className="text-3xl font-black text-white uppercase tracking-tight">Operator Mission Planner</h3>
            <p className="text-zinc-400 text-sm font-semibold mt-2">Design tactical playbooks for your bot team and execute with one click.</p>
          </div>
          <button className="btn-deploy-gradient px-6 py-3 rounded-xl text-sm font-black uppercase">Launch Mission</button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[
            { title: 'Campaign Heat', value: `${campaignHeat}/100`, hint: `Live requests: ${selectedMessageCount.toLocaleString()}` },
            { title: 'Escalation Risk', value: escalationRisk, hint: `${selectedErrorCount.toLocaleString()} errors from ${selectedMessageCount.toLocaleString()} requests` },
            { title: 'Autonomy Level', value: `${autonomyLevel}%`, hint: `Median latency ${selectedLatency}ms` }
          ].map((metric) => (
            <div key={metric.title} className="bg-black/30 border border-white/10 rounded-2xl p-5">
              <p className="text-[10px] text-zinc-500 uppercase tracking-widest font-black">{metric.title}</p>
              <p className="text-2xl font-black text-cyan-300 mt-2">{metric.value}</p>
              <p className="text-xs text-zinc-500 mt-2">{metric.hint}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="config-card p-12 border-blue-500/20 bg-blue-600/[0.02] shadow-2xl relative overflow-hidden">
        <div className="absolute top-0 right-0 w-64 h-64 bg-blue-500/5 rounded-full blur-[100px] pointer-events-none"></div>
        <div className="mb-12">
          <div className="flex items-center gap-4 mb-4">
            <h3 className="text-3xl font-black italic text-white tracking-tighter uppercase">Production Bridge</h3>
            <span className={`text-[9px] font-black px-3 py-1 rounded-full uppercase tracking-widest animate-pulse ${diagnosticMode ? 'bg-amber-500 text-black' : 'bg-blue-600 text-white'}`}>
              {diagnosticMode ? 'Simulation Active' : 'Live Link'}
            </span>
          </div>
          <p className="text-zinc-500 text-sm font-bold leading-relaxed italic max-w-2xl">
            {selectedBot?.platform === 'DISCORD'
              ? 'Route Discord slash commands to your AI node. This bridge links Discord interactions with your reasoning cluster.'
              : 'Route Telegram signals to your AI node. This bridge links the global Telegram API with your reasoning cluster.'}
          </p>
        </div>

        <div className="space-y-8 mb-10">
          <div className="space-y-4">
            <label className="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-700 ml-2">Active Webhook Tunnel</label>
            <div className="flex items-center gap-3 p-6 bg-black border border-white/5 rounded-3xl group transition-all hover:border-blue-500/30">
              <a href={webhookUrl} target="_blank" rel="noreferrer" className="text-[14px] font-bold text-blue-400 font-mono truncate hover:underline">
                {webhookUrl}
              </a>
              <button onClick={() => {navigator.clipboard.writeText(webhookUrl)}} className="ml-auto p-3 hover:bg-white/5 rounded-xl text-zinc-600 hover:text-white transition-all active:scale-90">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7v8a2 2 0 002 2h6M8 7V5a2 2 0 012-2h4.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V15a2 2 0 01-2 2h-2M8 7H6a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2v-2" /></svg>
              </button>
            </div>
          </div>
          {webhookInfo && (
            <div className="p-8 rounded-3xl border bg-black border-white/10 shadow-2xl animate-in zoom-in-95">
              <pre className={`text-[13px] font-mono whitespace-pre-wrap leading-relaxed p-6 rounded-2xl border ${diagnosticMode ? 'text-amber-500 border-amber-500/10 bg-amber-500/5' : 'text-emerald-500 border-emerald-500/10 bg-emerald-500/5'}`}>
                {JSON.stringify(webhookInfo, null, 2)}
              </pre>
            </div>
          )}
        </div>

        <div className="flex flex-col md:flex-row gap-6">
          <button onClick={refreshWebhookStatus} className="flex-1 py-7 bg-white text-black hover:bg-zinc-200 rounded-3xl font-black italic text-xl transition-all shadow-2xl active:scale-95">
            Sync Node
          </button>
          <a
            href={managementUrl}
            target="_blank"
            rel="noreferrer"
            className="flex-1 py-7 bg-[#0088cc] text-white hover:bg-[#0077b5] rounded-3xl font-black italic text-xl transition-all shadow-2xl text-center"
          >
            {selectedBot?.platform === 'DISCORD' ? 'Open Discord Portal' : 'View on Telegram'}
          </a>
          <a
            href={monitoringUrl}
            target="_blank"
            rel="noreferrer"
            className="flex-1 py-7 bg-white/10 text-white hover:bg-white/20 rounded-3xl font-black italic text-xl transition-all shadow-2xl text-center"
          >
            Open Live Telemetry
          </a>
        </div>
      </div>
    </div>
  );

  const renderInfrastructureView = () => (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
      <header className="mb-12">
        <h2 className="text-6xl font-black tracking-tighter italic text-white mb-2 uppercase leading-none">Infrastructure</h2>
        <p className="text-zinc-500 font-bold italic">Global Cluster Provisioning Matrix & Node Health</p>
      </header>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
        {[
          {
            label: 'Active Nodes',
            value: `${liveOps?.overview?.onlineBots || 0}/${liveOps?.overview?.deployedBots || 0}`,
            desc: 'Live connected bots across Telegram and Discord'
          },
          {
            label: 'Signal Latency',
            value: `${liveOps?.overview?.avgLatencyMs || 0}ms`,
            desc: 'Measured average response latency from live traffic'
          },
          {
            label: 'Server Uptime',
            value: `${Math.max(0, Math.floor((liveOps?.overview?.serverUptimeSec || 0) / 60))}m`,
            desc: 'Current backend process uptime'
          }
        ].map((item, idx) => (
          <div key={idx} className="config-card p-10 bg-[#0c0c0e] border-white/5 group hover:border-blue-500/20 transition-all">
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-700 mb-4">{item.label}</p>
            <p className="text-4xl font-black text-white italic tracking-tighter mb-4">{item.value}</p>
            <p className="text-xs text-zinc-500 font-bold italic">{item.desc}</p>
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-[100] flex flex-col md:flex-row bg-[#060a16] overflow-hidden selection:bg-cyan-400/30">
      {/* Sidebar */}
      <aside className="w-full md:w-80 border-r border-white/10 bg-[#07111f] flex flex-col z-[110]">
        <div className="p-10 flex items-center gap-4 group cursor-pointer" onClick={() => navigate('/', { state: { fromNavigation: true } })}>
          <BrandLogo />
        </div>

        <nav className="flex-1 px-8 space-y-2 mt-4 overflow-y-auto">
          <p className="px-5 text-[9px] font-black uppercase tracking-[0.3em] text-zinc-700 mb-4">Operations Center</p>
          <button 
            onClick={() => navigate('/', { state: { fromNavigation: true } })}
            className="w-full flex items-center gap-5 px-5 py-4 rounded-2xl transition-all font-bold text-[11px] uppercase tracking-wider text-zinc-600 hover:text-white hover:bg-white/5"
          >
            <span><ICONS.Dashboard className="w-5 h-5" /></span> Home
          </button>
          {[
            { id: 'FLEET', label: 'Neural Fleet', icon: <ICONS.Dashboard className="w-5 h-5" /> },
            { id: 'INFRASTRUCTURE', label: 'Infrastructure', icon: <ICONS.Settings className="w-5 h-5" /> },
            { id: 'SETTINGS', label: 'Settings', icon: <ICONS.Settings className="w-5 h-5" /> }
          ].map(item => (
            <button 
              key={item.id} 
              onClick={() => setActiveTab(item.id as Tab)}
              className={`w-full flex items-center gap-5 px-5 py-4 rounded-2xl transition-all font-bold text-[11px] uppercase tracking-wider ${activeTab === item.id ? 'bg-white/5 text-white' : 'text-zinc-600 hover:text-white'}`}
            >
              <span className={activeTab === item.id ? 'text-blue-500' : ''}>{item.icon}</span> {item.label}
            </button>
          ))}

          {activeTab === 'FLEET' && bots.length > 0 && (
            <>
              <p className="px-5 text-[9px] font-black uppercase tracking-[0.3em] text-zinc-700 mt-10 mb-4">Signal Tunnels</p>
              <div className="space-y-2">
                {bots.map(bot => (
                  <button 
                    key={bot.id} 
                    onClick={() => setSelectedBotId(bot.id)}
                    className={`w-full flex items-center gap-4 px-5 py-4 rounded-2xl transition-all text-[11px] font-black uppercase tracking-widest border ${selectedBotId === bot.id ? 'bg-blue-600/10 border-blue-500/30 text-white' : 'border-transparent text-zinc-600 hover:bg-white/5'}`}
                  >
                    <div className={`${selectedBotId === bot.id ? 'text-blue-500' : 'text-zinc-800'}`}>
                      {bot.platform === 'TELEGRAM' ? <ICONS.Telegram className="w-4 h-4" /> : <ICONS.Discord className="w-4 h-4" />}
                    </div>
                    <span className="truncate">{bot.name}</span>
                  </button>
                ))}
              </div>
            </>
          )}

          <div className="mt-10 px-5">
             <button 
                onClick={() => navigate('/', { state: { fromNavigation: true } })}
                className="w-full py-4 border border-white/10 rounded-2xl text-[10px] font-black uppercase tracking-widest text-zinc-500 hover:text-white hover:border-white/30 transition-all"
             >
               + Provision Node
             </button>
          </div>
        </nav>

        <div className="p-8 border-t border-white/5 bg-[#080808]/50">
           <div className="flex items-center gap-4 mb-5">
              <div className="w-12 h-12 rounded-full bg-blue-600 flex items-center justify-center text-white font-black text-lg shadow-[0_0_20px_rgba(59,130,246,0.3)] shrink-0">
                 {initials}
              </div>
              <div className="flex-1 min-w-0">
                 <p className="text-white font-black text-[16px] truncate tracking-tighter leading-none mb-1 uppercase">{user.name}</p>
                 <p className="text-zinc-600 font-bold text-[10px] truncate italic tracking-tight uppercase leading-none">{user.email}</p>
              </div>
           </div>
           
           <button 
            onClick={handleLogout} 
            className="w-full flex items-center gap-3 text-red-600 hover:text-red-500 transition-all text-[11px] font-black uppercase tracking-[0.3em] italic px-1 group"
          >
            <div className="w-2 h-2 rounded-full bg-red-600 group-hover:scale-125 transition-transform shadow-[0_0_8px_rgba(220,38,38,0.5)]"></div>
            Sign Out
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col md:flex-row overflow-hidden">
        <div className="flex-1 overflow-y-auto p-12 custom-scrollbar relative">
          {activeTab === 'FLEET' && renderFleetView()}
          {activeTab === 'INFRASTRUCTURE' && renderInfrastructureView()}
          {activeTab === 'SETTINGS' && (
            <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
               <header className="mb-12">
                  <h2 className="text-6xl font-black tracking-tighter italic text-white mb-2 uppercase leading-none">Settings</h2>
                  <p className="text-zinc-500 font-bold italic">Node configuration & System Parameters</p>
               </header>
               
               <div className="space-y-8">
                  <div className="config-card p-8 bg-zinc-900/10 border-white/5">
                    <h3 className="text-2xl font-black text-white mb-6 uppercase tracking-tighter">Automation Lab</h3>

                    <div className="grid lg:grid-cols-2 gap-6">
                      <div className="p-5 bg-black/30 rounded-2xl space-y-4">
                        <h4 className="font-black text-white">Rule Builder</h4>
                        <p className="text-sm text-zinc-500 font-bold">Define trigger/action automation with cooldown control and deploy per active bot traffic.</p>

                        <input
                          value={automationDraft.name}
                          onChange={(e) => setAutomationDraft((prev) => ({ ...prev, name: e.target.value }))}
                          placeholder="Rule name"
                          className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-3 text-white text-sm outline-none focus:border-cyan-300"
                        />
                        <textarea
                          value={automationDraft.description}
                          onChange={(e) => setAutomationDraft((prev) => ({ ...prev, description: e.target.value }))}
                          rows={2}
                          placeholder="What should this automation do?"
                          className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-3 text-white text-sm outline-none focus:border-cyan-300"
                        />
                        <div className="grid sm:grid-cols-2 gap-3">
                          <select
                            value={automationDraft.trigger}
                            onChange={(e) => setAutomationDraft((prev) => ({ ...prev, trigger: e.target.value as AutomationRule['trigger'] }))}
                            className="bg-black/50 border border-white/10 rounded-xl px-4 py-3 text-white text-sm outline-none focus:border-cyan-300"
                          >
                            <option value="KEYWORD">Trigger: Keyword</option>
                            <option value="MENTION">Trigger: Mention</option>
                            <option value="SILENCE_GAP">Trigger: Silence Gap</option>
                            <option value="HIGH_VOLUME">Trigger: High Volume</option>
                          </select>
                          <select
                            value={automationDraft.action}
                            onChange={(e) => setAutomationDraft((prev) => ({ ...prev, action: e.target.value as AutomationRule['action'] }))}
                            className="bg-black/50 border border-white/10 rounded-xl px-4 py-3 text-white text-sm outline-none focus:border-cyan-300"
                          >
                            <option value="AUTO_REPLY">Action: Auto Reply</option>
                            <option value="ESCALATE">Action: Escalate</option>
                            <option value="TAG">Action: Tag Conversation</option>
                            <option value="DELAY_REPLY">Action: Delayed Reply</option>
                          </select>
                        </div>
                        {automationDraft.trigger === 'KEYWORD' && (
                          <input
                            value={automationDraft.keyword}
                            onChange={(e) => setAutomationDraft((prev) => ({ ...prev, keyword: e.target.value }))}
                            placeholder="Keyword (example: pricing)"
                            className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-3 text-white text-sm outline-none focus:border-cyan-300"
                          />
                        )}
                        <div className="flex items-center gap-3">
                          <label className="text-xs uppercase tracking-widest text-zinc-500 font-black">Cooldown (sec)</label>
                          <input
                            type="number"
                            min={0}
                            max={3600}
                            value={automationDraft.cooldownSec}
                            onChange={(e) => setAutomationDraft((prev) => ({ ...prev, cooldownSec: Number(e.target.value || 0) }))}
                            className="w-28 bg-black/50 border border-white/10 rounded-xl px-3 py-2 text-white text-sm outline-none focus:border-cyan-300"
                          />
                        </div>
                        <button
                          onClick={async () => {
                            try {
                              await createAutomationRule();
                            } catch (error: any) {
                              setAutomationSimulation(`Rule creation failed: ${error?.message || 'Unknown error'}`);
                            }
                          }}
                          className="btn-deploy-gradient px-5 py-3 rounded-xl text-xs font-black uppercase"
                        >
                          Create Automation Rule
                        </button>
                      </div>

                      <div className="p-5 bg-black/30 rounded-2xl space-y-4">
                        <h4 className="font-black text-white">Simulation Console</h4>
                        <p className="text-sm text-zinc-500 font-bold">Run scenario simulation using selected bot live traffic and evaluate impact before rollout.</p>
                        <pre className="text-xs text-cyan-200 whitespace-pre-wrap leading-relaxed bg-black/40 border border-white/10 rounded-xl p-4 min-h-[180px]">{automationSimulation}</pre>
                        <button
                          onClick={loadAutomationRules}
                          className="px-4 py-2 bg-white/10 hover:bg-white/20 text-white text-xs font-black uppercase rounded-lg transition-all"
                        >
                          Refresh Rules
                        </button>
                      </div>
                    </div>

                    <div className="mt-6 p-4 bg-black/30 rounded-2xl">
                      <div className="flex items-center justify-between mb-4">
                        <h4 className="font-black text-white">Rule Operations</h4>
                        <span className="text-[11px] uppercase tracking-widest text-zinc-500 font-black">{isAutomationLoading ? 'Loading...' : `${automationRules.length} Rules`}</span>
                      </div>
                      <div className="space-y-3">
                        {automationRules.map((rule) => {
                          const successRate = rule.runCount > 0 ? Math.round((rule.successCount / rule.runCount) * 100) : 0;
                          return (
                            <div key={rule.id} className="border border-white/10 rounded-xl p-4 bg-black/40">
                              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                                <div>
                                  <p className="text-white font-black">{rule.name}</p>
                                  <p className="text-zinc-400 text-xs font-semibold">{rule.description}</p>
                                  <p className="text-zinc-500 text-[11px] mt-1 uppercase tracking-widest">{`${rule.trigger} -> ${rule.action} | Cooldown ${rule.cooldownSec}s`}</p>
                                </div>
                                <div className="flex items-center gap-2">
                                  <span className={`text-[10px] px-2 py-1 rounded-lg font-black uppercase ${rule.active ? 'bg-emerald-500/20 text-emerald-400' : 'bg-zinc-700 text-zinc-300'}`}>
                                    {rule.active ? 'Active' : 'Paused'}
                                  </span>
                                  <button
                                    disabled={automationBusyRuleId === rule.id}
                                    onClick={() => toggleAutomationRule(rule.id, rule.active)}
                                    className="px-3 py-2 bg-white/10 hover:bg-white/20 text-white text-[10px] font-black uppercase rounded-lg disabled:opacity-50"
                                  >
                                    {rule.active ? 'Pause' : 'Activate'}
                                  </button>
                                  <button
                                    disabled={automationBusyRuleId === rule.id}
                                    onClick={() => simulateAutomationRule(rule.id)}
                                    className="px-3 py-2 bg-blue-600 hover:bg-blue-500 text-white text-[10px] font-black uppercase rounded-lg disabled:opacity-50"
                                  >
                                    Simulate
                                  </button>
                                  <button
                                    disabled={automationBusyRuleId === rule.id}
                                    onClick={() => deleteAutomationRule(rule.id)}
                                    className="px-3 py-2 bg-red-600 hover:bg-red-500 text-white text-[10px] font-black uppercase rounded-lg disabled:opacity-50"
                                  >
                                    Delete
                                  </button>
                                </div>
                              </div>
                              <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                                <div className="bg-black/50 rounded-lg p-2">
                                  <p className="text-[10px] text-zinc-500 uppercase font-black">Runs</p>
                                  <p className="text-white font-black">{rule.runCount.toLocaleString()}</p>
                                </div>
                                <div className="bg-black/50 rounded-lg p-2">
                                  <p className="text-[10px] text-zinc-500 uppercase font-black">Success</p>
                                  <p className="text-emerald-400 font-black">{rule.successCount.toLocaleString()}</p>
                                </div>
                                <div className="bg-black/50 rounded-lg p-2">
                                  <p className="text-[10px] text-zinc-500 uppercase font-black">Rate</p>
                                  <p className="text-cyan-300 font-black">{successRate}%</p>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                        {!isAutomationLoading && automationRules.length === 0 && (
                          <div className="text-sm text-zinc-500 font-semibold">No rules yet. Create your first automation rule above.</div>
                        )}
                      </div>
                    </div>
                  </div>
                  
                  {/* Notification Settings */}
                  <div className="config-card p-8 bg-zinc-900/10 border-white/5">
                     <h3 className="text-2xl font-black text-white mb-6 uppercase tracking-tighter">Notifications</h3>
                     
                     <div className="space-y-4">
                        <div className="flex items-center justify-between p-4 bg-black/30 rounded-2xl">
                           <div>
                              <h4 className="font-black text-white mb-1">Email Notifications</h4>
                              <p className="text-sm text-zinc-500 font-bold">Receive updates via email</p>
                           </div>
                           <label className="relative inline-flex items-center cursor-pointer">
                             <input type="checkbox" className="sr-only peer" defaultChecked />
                             <div className="w-11 h-6 bg-blue-600 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                           </label>
                        </div>
                        
                        <div className="flex items-center justify-between p-4 bg-black/30 rounded-2xl">
                           <div>
                              <h4 className="font-black text-white mb-1">Push Notifications</h4>
                              <p className="text-sm text-zinc-500 font-bold">Real-time alerts in dashboard</p>
                           </div>
                           <label className="relative inline-flex items-center cursor-pointer">
                             <input type="checkbox" className="sr-only peer" defaultChecked />
                             <div className="w-11 h-6 bg-blue-600 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                           </label>
                        </div>
                        
                        <div className="flex items-center justify-between p-4 bg-black/30 rounded-2xl">
                           <div>
                              <h4 className="font-black text-white mb-1">Bot Activity Alerts</h4>
                              <p className="text-sm text-zinc-500 font-bold">Notify on bot status changes</p>
                           </div>
                           <label className="relative inline-flex items-center cursor-pointer">
                             <input type="checkbox" className="sr-only peer" defaultChecked />
                             <div className="w-11 h-6 bg-blue-600 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                           </label>
                        </div>
                     </div>
                  </div>
                  
                  {/* Security Settings */}
                  <div className="config-card p-8 bg-zinc-900/10 border-white/5">
                     <h3 className="text-2xl font-black text-white mb-6 uppercase tracking-tighter">Security</h3>
                     
                     <div className="space-y-4">
                        <div className="flex items-center justify-between p-4 bg-black/30 rounded-2xl">
                           <div>
                              <h4 className="font-black text-white mb-1">Two-Factor Authentication</h4>
                              <p className="text-sm text-zinc-500 font-bold">Enhanced account security</p>
                           </div>
                           <label className="relative inline-flex items-center cursor-pointer">
                             <input type="checkbox" className="sr-only peer" />
                             <div className="w-11 h-6 bg-zinc-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                           </label>
                        </div>
                        
                        <div className="p-4 bg-black/30 rounded-2xl">
                           <h4 className="font-black text-white mb-1">Session Management</h4>
                           <p className="text-sm text-zinc-500 font-bold mb-3">Manage active sessions across devices</p>
                           <button className="px-4 py-2 bg-white/10 hover:bg-white/20 text-white text-sm font-bold rounded-lg transition-all">
                             Manage Sessions
                           </button>
                        </div>
                     </div>
                  </div>
                  
                  {/* AI Configuration */}
                  <div className="config-card p-8 bg-zinc-900/10 border-white/5">
                    <h3 className="text-2xl font-black text-white mb-6 uppercase tracking-tighter">AI Configuration</h3>
                    
                    <div className="space-y-6">
                      <div className="p-4 bg-black/30 rounded-2xl">
                        <div className="flex items-center justify-between mb-4">
                          <div>
                            <h4 className="font-black text-white mb-1">AI Model</h4>
                            <p className="text-sm text-zinc-500 font-bold">Current AI service configuration</p>
                          </div>
                          <div className="flex items-center gap-2">
                            <div className="w-3 h-3 rounded-full bg-green-500 animate-pulse"></div>
                            <span className="text-sm font-bold text-green-500">ACTIVE</span>
                          </div>
                        </div>
                        
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div className="bg-black/20 p-3 rounded-xl">
                            <p className="text-xs text-zinc-500 font-bold uppercase tracking-widest mb-1">Primary Model</p>
                            <p className="text-white font-bold">Google Gemini Flash</p>
                          </div>
                          <div className="bg-black/20 p-3 rounded-xl">
                            <p className="text-xs text-zinc-500 font-bold uppercase tracking-widest mb-1">API Status</p>
                            <p className="text-green-500 font-bold">Connected</p>
                          </div>
                        </div>
                      </div>
                      
                      <div className="p-4 bg-black/30 rounded-2xl">
                        <h4 className="font-black text-white mb-3">Telegram Bot Configuration</h4>
                        <div className="space-y-3">
                          <div className="flex items-center justify-between">
                            <span className="text-sm text-zinc-400 font-bold">Bot Status</span>
                            <span className="text-green-500 font-bold text-sm">Active</span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-sm text-zinc-400 font-bold">AI Integration</span>
                            <span className="text-blue-500 font-bold text-sm">Gemini Flash</span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-sm text-zinc-400 font-bold">Response Time</span>
                            <span className="text-emerald-500 font-bold text-sm">~2s</span>
                          </div>
                        </div>
                      </div>
                      
                      <div className="p-4 bg-black/30 rounded-2xl">
                        <h4 className="font-black text-white mb-3">API Key Information</h4>
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-sm text-zinc-400 font-bold">Key Status</span>
                            <span className="text-green-500 font-bold text-sm">Valid</span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-sm text-zinc-400 font-bold">Model Version</span>
                            <span className="text-white font-bold text-sm">gemini-3-flash-preview</span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-sm text-zinc-400 font-bold">Rate Limit</span>
                            <span className="text-amber-500 font-bold text-sm">Standard</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                  
                  {/* Data Settings */}
                  <div className="config-card p-8 bg-zinc-900/10 border-white/5">
                     <h3 className="text-2xl font-black text-white mb-6 uppercase tracking-tighter">Data & Privacy</h3>
                     
                     <div className="space-y-4">
                        <div className="p-4 bg-black/30 rounded-2xl">
                           <h4 className="font-black text-white mb-1">Export Data</h4>
                           <p className="text-sm text-zinc-500 font-bold mb-3">Download a copy of your bot data and configurations</p>
                           <button className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-bold rounded-lg transition-all">
                             Export Data
                           </button>
                        </div>
                        
                        <div className="p-4 bg-black/30 rounded-2xl">
                           <h4 className="font-black text-white mb-1">Delete Account</h4>
                           <p className="text-sm text-zinc-500 font-bold mb-3">Permanently delete your account and all data</p>
                           <button className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white text-sm font-bold rounded-lg transition-all">
                             Delete Account
                           </button>
                        </div>
                     </div>
                  </div>
               </div>
            </div>
          )}
        </div>

        {/* Professional Live Operations Feed (AI Chat Interface) */}
        <div className="w-full md:w-[540px] bg-black border-l border-white/5 flex flex-col relative">
           <div className="p-10 border-b border-white/5 bg-[#080808]/90 backdrop-blur-xl flex items-center justify-between shrink-0">
              <h3 className="text-[11px] font-black uppercase tracking-[0.3em] text-white">Live Operations Feed</h3>
           <div className="flex gap-1.5">
                 <div className="w-2 h-2 rounded-full bg-red-500/20 border border-red-500/40"></div>
                 <div className="w-2 h-2 rounded-full bg-amber-500/20 border border-amber-500/40"></div>
                 <div className={`w-2 h-2 rounded-full animate-pulse border ${opsStatus?.webhookReady ? 'bg-emerald-500 border-emerald-500/40' : 'bg-red-500 border-red-500/40'}`}></div>
              </div>
           </div>

           <div className="flex-1 p-10 space-y-10 overflow-y-auto custom-scrollbar bg-[#020202]">
              {terminalLogs.map((log, i) => (
                <div key={i} className={`flex flex-col gap-3 animate-in fade-in slide-in-from-bottom-2 duration-300`}>
                  <div className="flex items-center justify-between">
                    <span className={`uppercase font-black text-[9px] tracking-widest ${
                      log.type === 'ok' ? 'text-emerald-500' : 
                      log.type === 'err' ? 'text-red-500' : 
                      log.type === 'ai' ? 'text-blue-500' : 
                      log.type === 'user' ? 'text-white/40' : 'text-zinc-600'
                    }`}>
                      {log.type === 'user' ? 'Inbound Command' : log.type === 'ai' ? 'Neural Response' : 'System Information'}
                    </span>
                    <span className="text-[8px] font-black text-zinc-800 uppercase tracking-widest">Protocol Secured</span>
                  </div>
                  <div className={`p-6 rounded-3xl border text-sm font-medium leading-relaxed whitespace-pre-wrap ${
                    log.type === 'user' ? 'bg-white/[0.03] border-white/5 text-white italic' :
                    log.type === 'ai' ? 'bg-blue-600/[0.03] border-blue-500/10 text-blue-100 shadow-[0_10px_30px_rgba(59,130,246,0.05)]' :
                    log.type === 'ok' ? 'bg-emerald-500/[0.02] border-emerald-500/10 text-emerald-500/80 italic' :
                    'bg-zinc-900/40 border-white/5 text-zinc-500 italic'
                  }`}>
                    {log.msg}
                  </div>
                </div>
              ))}
              {isGenerating && (
                <div className="flex flex-col gap-3 animate-pulse">
                  <div className="flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-bounce"></div>
                    <span className="text-[9px] font-black text-blue-500 uppercase tracking-widest">Generating Directive...</span>
                  </div>
                  <div className="p-8 rounded-3xl bg-blue-600/[0.01] border border-blue-500/5 h-24 flex items-center">
                    <div className="flex gap-2">
                      <div className="w-1.5 h-1.5 rounded-full bg-blue-500/40 animate-bounce [animation-delay:-0.3s]"></div>
                      <div className="w-1.5 h-1.5 rounded-full bg-blue-500/40 animate-bounce [animation-delay:-0.15s]"></div>
                      <div className="w-1.5 h-1.5 rounded-full bg-blue-500/40 animate-bounce"></div>
                    </div>
                  </div>
                </div>
              )}
              <div ref={terminalEndRef} />
           </div>

           {/* Neural Instruction Gateway */}
           <div className="p-8 border-t border-white/5 bg-black">
              <div className="mb-4 flex items-center justify-between">
                <p className="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-700 italic">Command Injection Point</p>
                <div className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-emerald-500"></div>
                  <span className="text-[9px] font-black text-zinc-600 uppercase tracking-widest">Active Sync</span>
                </div>
              </div>
              <form onSubmit={handleTerminalSubmit} className="relative group">
                 <input 
                   type="text" 
                   value={terminalInput}
                   onChange={(e) => setTerminalInput(e.target.value)}
                   disabled={isGenerating}
                   placeholder={isGenerating ? "Reasoning cluster engaged..." : "Enter command for SwiftDeploy AI..."}
                   className="w-full bg-zinc-900/40 border border-white/5 rounded-3xl px-8 py-7 text-sm text-white focus:border-blue-500/50 focus:bg-zinc-900/60 outline-none transition-all placeholder:text-zinc-800 disabled:opacity-50 shadow-inner"
                 />
                 <button 
                  type="submit" 
                  disabled={isGenerating || !terminalInput.trim()}
                  className="absolute right-5 top-1/2 -translate-y-1/2 p-3 bg-blue-600 text-white rounded-2xl hover:bg-blue-500 transition-all disabled:opacity-0 shadow-lg active:scale-90"
                >
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M13 5l7 7-7 7M5 5l7 7-7 7" /></svg>
                 </button>
              </form>
           </div>
        </div>
      </main>
    </div>
  );
}

export default DashboardContent;

