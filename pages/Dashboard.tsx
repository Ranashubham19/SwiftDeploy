
import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { User, Bot } from '../types';
import { ICONS } from '../constants';
import { generateBotResponse } from '../geminiService';

interface DashboardProps {
  user: User;
  bots: Bot[];
  setBots: React.Dispatch<React.SetStateAction<Bot[]>>;
  onLogout: () => void;
}

type Tab = 'FLEET' | 'INFRASTRUCTURE' | 'BILLING' | 'SETTINGS';

const Dashboard: React.FC<DashboardProps> = ({ user, bots, setBots, onLogout }) => {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<Tab>('FLEET');
  const [selectedBotId, setSelectedBotId] = useState<string | null>(bots[0]?.id || null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [webhookInfo, setWebhookInfo] = useState<any>(null);
  const [syncStatus, setSyncStatus] = useState<'IDLE' | 'SUCCESS' | 'ERROR'>('IDLE');
  const [diagnosticMode, setDiagnosticMode] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);

  const handleLogout = async () => {
    try {
      const response = await fetch(`${import.meta.env.VITE_API_URL}/logout`, {
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
  const backendBaseUrl = import.meta.env.VITE_API_URL;
  const webhookUrl = `${backendBaseUrl}/webhook`;

  const initials = user.name.substring(0, 2).toUpperCase();

  useEffect(() => {
    terminalEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [terminalLogs, isGenerating]);

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
      const response = await generateBotResponse(userInput);
      addLog(response, 'ai');
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
      const res = await fetch(`${backendBaseUrl}/set-webhook`, {
        method: 'GET',
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

  const renderFleetView = () => (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
      <header className="mb-12">
        <h2 className="text-6xl font-black tracking-tighter italic text-white mb-2 uppercase leading-none">Fleet Control</h2>
        <p className="text-zinc-500 font-bold italic">Cluster Status: <span className="text-emerald-500 uppercase tracking-widest ml-2">Production • Operational</span></p>
      </header>

      <div className="grid md:grid-cols-2 gap-8 mb-12">
        <div className="config-card p-10 bg-[#0c0c0e] border-white/5 group hover:border-blue-500/20 transition-colors">
          <p className="text-[11px] font-black uppercase tracking-[0.2em] text-zinc-700 mb-4">Signal Traffic</p>
          <p className="text-6xl font-black text-white italic tracking-tighter">{selectedBot?.messageCount.toLocaleString() || '0'}</p>
          <div className="mt-6 flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse"></div>
            <span className="text-[10px] font-black text-blue-500 uppercase tracking-widest">Live Flow</span>
          </div>
        </div>
        <div className="config-card p-10 bg-[#0c0c0e] border-white/5 group hover:border-emerald-500/20 transition-colors">
          <p className="text-[11px] font-black uppercase tracking-[0.2em] text-zinc-700 mb-4">Neural Health</p>
          <p className="text-6xl font-black text-white italic tracking-tighter">100%</p>
          <div className="mt-6 flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500"></div>
            <span className="text-[10px] font-black text-emerald-500 uppercase tracking-widest">Optimized</span>
          </div>
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
            Route Telegram signals to your AI node. This bridge links the global Telegram API with your Gemini 3 Pro reasoning cluster.
          </p>
        </div>

        <div className="space-y-8 mb-10">
          <div className="space-y-4">
            <label className="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-700 ml-2">Active Webhook Tunnel</label>
            <div className="flex items-center gap-3 p-6 bg-black border border-white/5 rounded-3xl group transition-all hover:border-blue-500/30">
              <code className="text-[14px] font-bold text-blue-400 font-mono truncate">{webhookUrl}</code>
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
          <a href={`https://t.me/${selectedBot?.name || 'swiftdeploy_bot'}`} target="_blank" rel="noreferrer" className="flex-1 py-7 bg-[#0088cc] text-white hover:bg-[#0077b5] rounded-3xl font-black italic text-xl transition-all shadow-2xl text-center">
            View on Telegram
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
          { label: 'Active Clusters', value: '14 Regions', desc: 'Global Edge Signal Distribution' },
          { label: 'Signal Latency', value: '124ms', desc: 'Sub-200ms handshake threshold' },
          { label: 'Uptime Score', value: '99.99%', desc: 'Verified by autonomous watchdogs' }
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

  const renderBillingView = () => (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
      <header className="mb-12">
        <h2 className="text-6xl font-black tracking-tighter italic text-white mb-2 uppercase leading-none">Signal Billing</h2>
        <p className="text-zinc-500 font-bold italic">Resource Consumption & Node Allocation</p>
      </header>
      <div className="config-card p-12 bg-blue-600/[0.02] border-blue-500/10 mb-10">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-8">
           <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-zinc-600 mb-2">Current Subscription</p>
              <h3 className="text-4xl font-black text-white italic tracking-tighter uppercase">Pro Fleet Node</h3>
           </div>
           <button onClick={() => navigate('/billing')} className="bg-white text-black px-10 py-5 rounded-2xl font-black italic uppercase shadow-xl hover:bg-zinc-200 transition-all active:scale-95">
             Upgrade Subscription
           </button>
        </div>
      </div>
      <div className="grid md:grid-cols-2 gap-8">
        <div className="config-card p-10 bg-[#0c0c0e] border-white/5">
          <p className="text-[10px] font-black uppercase tracking-widest text-zinc-700 mb-6">Signal Usage (This Cycle)</p>
          <div className="w-full h-3 bg-zinc-900 rounded-full overflow-hidden mb-4">
             <div className="w-[75%] h-full bg-blue-500 rounded-full"></div>
          </div>
          <div className="flex justify-between text-[11px] font-black uppercase tracking-widest">
             <span className="text-white">7.5M Signals</span>
             <span className="text-zinc-600">10M Limit</span>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-[100] flex flex-col md:flex-row bg-[#020202] overflow-hidden selection:bg-blue-500/30">
      {/* Sidebar */}
      <aside className="w-full md:w-80 border-r border-white/5 bg-[#050505] flex flex-col z-[110]">
        <div className="p-10 flex items-center gap-4 group cursor-pointer" onClick={() => navigate('/')}>
          <div className="w-10 h-10 flex items-center justify-center bg-gradient-to-br from-blue-500 to-indigo-600 rounded-xl shadow-lg transition-transform group-hover:scale-105">
            <svg viewBox="0 0 24 24" fill="white" className="w-6 h-6"><path d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
          </div>
          <span className="text-xl font-black tracking-tighter font-heading text-white uppercase italic">SwiftDeploy</span>
        </div>

        <nav className="flex-1 px-8 space-y-2 mt-4 overflow-y-auto">
          <p className="px-5 text-[9px] font-black uppercase tracking-[0.3em] text-zinc-700 mb-4">Operations Center</p>
          {[
            { id: 'FLEET', label: 'Neural Fleet', icon: <ICONS.Dashboard className="w-5 h-5" /> },
            { id: 'INFRASTRUCTURE', label: 'Infrastructure', icon: <ICONS.Settings className="w-5 h-5" /> },
            { id: 'BILLING', label: 'Signal Billing', icon: <ICONS.Billing className="w-5 h-5" /> },
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
                onClick={() => navigate('/connect/telegram')}
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
          {activeTab === 'BILLING' && renderBillingView()}
          {activeTab === 'SETTINGS' && (
            <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
               <header className="mb-12">
                  <h2 className="text-6xl font-black tracking-tighter italic text-white mb-2 uppercase leading-none">Settings</h2>
                  <p className="text-zinc-500 font-bold italic">Node configuration & System Parameters</p>
               </header>
               <div className="config-card p-12 bg-zinc-900/10 border-white/5">
                  <p className="text-zinc-500 font-bold italic">System preference matrix scheduled for next cluster update.</p>
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
                 <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse border border-emerald-500/40"></div>
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
};

export default Dashboard;
