
import React, { useState } from 'react';
import { User } from '../types';
import { Link, useNavigate } from 'react-router-dom';
import { ICONS } from '../constants';

const Billing: React.FC<{ user: User }> = ({ user }) => {
  const [selectedMethod, setSelectedMethod] = useState<'card' | 'paypal' | 'upi'>('card');
  const [isProcessing, setIsProcessing] = useState(false);
  const navigate = useNavigate();

  const handlePaymentAction = () => {
    setIsProcessing(true);
    setTimeout(() => {
      setIsProcessing(false);
      alert('Handshake Successful: Subscription node updated.');
    }, 2000);
  };

  return (
    <div className="min-h-screen bg-[#030308]/80 p-6 md:p-24 flex justify-center selection:bg-blue-500/20">
      <div className="max-w-5xl w-full">
        <header className="mb-16">
          <Link to="/dashboard" className="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-600 hover:text-white flex items-center gap-3 mb-8 transition-all group">
            <svg className="w-4 h-4 group-hover:-translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M10 19l-7-7m0 0l7-7m-7 7h18" /></svg>
            Return to Command Center
          </Link>
          <h1 className="text-5xl lg:text-7xl font-black tracking-tighter italic font-heading text-white">Infrastructure Billing</h1>
          <p className="text-zinc-500 mt-4 text-lg italic">Manage your active subscription nodes and payment tunnels.</p>
        </header>

        <div className="grid lg:grid-cols-3 gap-10 mb-16">
          {/* Active Plan Detail */}
          <div className="lg:col-span-1 glass-panel p-10 rounded-[48px] border-blue-500/20 bg-blue-500/[0.02] shadow-[0_20px_60px_rgba(59,130,246,0.1)] relative overflow-hidden flex flex-col">
             <div className="absolute top-0 right-0 p-8">
                <span className="text-[9px] font-black uppercase text-blue-400 bg-blue-500/10 border border-blue-500/20 px-3 py-1.5 rounded-full shadow-[0_0_15px_rgba(59,130,246,0.3)]">AUTHORIZED</span>
             </div>
             <h3 className="text-3xl font-black italic mb-2 text-white">Pro Fleet</h3>
             <p className="text-zinc-500 text-xs font-bold mb-8 italic">Enterprise node orchestration.</p>
             <div className="flex items-baseline gap-1 mb-10">
                <span className="text-5xl font-black tracking-tighter text-white">$30</span>
                <span className="text-zinc-600 font-bold">/mo</span>
             </div>
             <div className="space-y-4 mb-10 flex-1">
                {["10 Production Bots", "Enterprise Memory Engine", "Priority Handshake", "Custom Webhooks"].map(f => (
                  <div key={f} className="flex items-start gap-3 text-[11px] font-bold text-zinc-400 leading-relaxed italic">
                     <div className="mt-1"><ICONS.Check className="w-3.5 h-3.5 text-blue-500" /></div>
                     {f}
                  </div>
                ))}
             </div>
             <button className="w-full py-4 bg-white/5 hover:bg-white/10 border border-white/10 rounded-2xl font-black transition-all italic text-zinc-300 text-sm">Switch Plan Node</button>
          </div>

          {/* Payment Methods Section */}
          <div className="lg:col-span-2 glass-panel p-10 border-white/5 rounded-[48px] bg-[#080816]/40 flex flex-col">
             <h3 className="text-xl font-black italic mb-8 text-white">Select Payment Tunnel</h3>
             
             <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-10">
               {[
                 { id: 'card', label: 'Credit Card', icon: <ICONS.Card className="w-6 h-6" /> },
                 { id: 'paypal', label: 'PayPal', icon: <ICONS.PayPal className="w-6 h-6" /> },
                 { id: 'upi', label: 'UPI (India)', icon: <ICONS.UPI className="w-6 h-6" /> }
               ].map(method => (
                 <button 
                  key={method.id}
                  onClick={() => setSelectedMethod(method.id as any)}
                  className={`flex flex-col items-center gap-4 p-6 rounded-[32px] border-2 transition-all ${selectedMethod === method.id ? 'border-blue-500 bg-blue-500/10 shadow-[0_0_20px_rgba(59,130,246,0.2)]' : 'border-white/5 bg-white/[0.02] hover:border-white/10'}`}
                 >
                   <div className={`${selectedMethod === method.id ? 'text-blue-400' : 'text-zinc-600'}`}>
                    {method.icon}
                   </div>
                   <span className={`text-[10px] font-black uppercase tracking-widest ${selectedMethod === method.id ? 'text-white' : 'text-zinc-500'}`}>{method.label}</span>
                 </button>
               ))}
             </div>

             {/* Dynamic Form */}
             <div className="bg-black/60 border border-white/5 rounded-[32px] p-8 flex-1">
                {selectedMethod === 'card' && (
                  <div className="space-y-6">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-black text-zinc-700 uppercase tracking-widest">Active Card Entity</span>
                      <button className="text-[10px] font-black text-blue-500 uppercase tracking-widest hover:underline">Update</button>
                    </div>
                    <div className="flex items-center gap-6 p-6 bg-white/[0.02] rounded-2xl border border-white/5 group hover:border-blue-500/20 transition-all cursor-pointer">
                       <div className="w-14 h-9 bg-zinc-900 rounded-lg flex items-center justify-center text-[10px] font-black italic text-zinc-400 border border-white/5 group-hover:bg-blue-600 group-hover:text-white transition-colors">VISA</div>
                       <div>
                          <p className="text-lg font-black tracking-widest italic text-white">•••• 4242</p>
                          <p className="text-[9px] text-zinc-600 font-bold uppercase mt-1">Global Authorization • Exp 12/26</p>
                       </div>
                    </div>
                    <button 
                      onClick={handlePaymentAction}
                      className="w-full py-4 bg-blue-600 hover:bg-blue-500 text-white rounded-2xl font-black italic text-sm transition-all shadow-xl shadow-blue-500/20"
                    >
                      Process Settlement
                    </button>
                  </div>
                )}

                {selectedMethod === 'paypal' && (
                  <div className="text-center py-6">
                    <div className="w-14 h-14 bg-blue-500/10 rounded-full flex items-center justify-center mx-auto mb-6 border border-blue-500/10">
                      <ICONS.PayPal className="w-6 h-6 text-blue-400" />
                    </div>
                    <p className="text-sm font-bold text-zinc-400 italic mb-8 leading-relaxed px-10">Authorize via PayPal Secure Gateway to finalize node allocation.</p>
                    <button onClick={handlePaymentAction} className="bg-[#0070ba] hover:bg-[#005ea6] text-white px-10 py-4 rounded-2xl font-black italic flex items-center gap-3 mx-auto transition-all text-sm">
                      Connect PayPal Secure
                    </button>
                  </div>
                )}

                {selectedMethod === 'upi' && (
                  <div className="space-y-6">
                    <label className="block text-[10px] font-black text-zinc-700 uppercase tracking-[0.4em] mb-2">Virtual Payment Address (VPA)</label>
                    <input 
                      type="text" 
                      placeholder="shubham@okaxis" 
                      className="w-full bg-black border border-white/10 rounded-2xl px-6 py-4 text-lg focus:outline-none focus:ring-4 focus:ring-blue-500/10 transition-all font-mono placeholder:text-zinc-900 text-white"
                    />
                    <button onClick={handlePaymentAction} className="btn-deploy-gradient w-full py-4 rounded-2xl font-black italic text-sm">Validate & Pay via UPI</button>
                    <div className="flex justify-center gap-3 opacity-20 grayscale">
                      <div className="w-10 h-6 bg-zinc-800 rounded"></div>
                      <div className="w-10 h-6 bg-zinc-800 rounded"></div>
                      <div className="w-10 h-6 bg-zinc-800 rounded"></div>
                    </div>
                  </div>
                )}
             </div>
             
             <div className="mt-10 pt-8 border-t border-white/5">
                <div className="flex justify-between items-center text-[10px] font-black italic text-zinc-600 mb-2 uppercase tracking-widest">
                   <span>Authorization Cycle</span>
                   <span className="text-zinc-400">March 15 - April 15</span>
                </div>
                <div className="flex justify-between items-center text-2xl font-black italic text-white">
                   <span className="text-zinc-500">Total Settlement</span>
                   <span className="text-blue-400">$30.00 USD</span>
                </div>
             </div>
          </div>
        </div>

        {/* Audit Log */}
        <div className="glass-panel overflow-hidden bg-black/40 border-white/5 rounded-[48px] shadow-xl">
           <div className="px-10 py-6 border-b border-white/5 flex justify-between items-center bg-white/[0.01]">
              <h3 className="text-lg font-black italic text-white">Transaction Audit Log</h3>
              <span className="text-[9px] font-black text-zinc-700 uppercase tracking-widest">End-to-End Encrypted Handshake</span>
           </div>
           <div className="p-16 text-center">
              <div className="w-14 h-14 bg-white/[0.02] rounded-full flex items-center justify-center mx-auto mb-6 border border-white/5">
                <svg className="w-5 h-5 text-zinc-800" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              </div>
              <p className="text-zinc-700 text-xs font-black uppercase tracking-[0.4em] italic leading-relaxed">System Initialization Successful.<br />No previous signal settlements found on cluster.</p>
           </div>
        </div>
      </div>

      {isProcessing && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex flex-col items-center justify-center z-50">
           <div className="w-16 h-16 border-4 border-blue-500 border-t-transparent rounded-full animate-spin shadow-[0_0_40px_rgba(59,130,246,0.3)] mb-10"></div>
           <p className="text-xl font-black italic tracking-tighter animate-pulse text-white uppercase tracking-[0.2em]">Processing Signal Tunnel...</p>
        </div>
      )}
    </div>
  );
};

export default Billing;
