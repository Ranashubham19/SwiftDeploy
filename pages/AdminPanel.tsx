
import React from 'react';

const AdminPanel: React.FC = () => {
  return (
    <div className="min-h-screen p-8 bg-zinc-950">
      <div className="max-w-7xl mx-auto">
        <header className="mb-12">
          <h1 className="text-4xl font-bold flex items-center gap-3">
             <span className="bg-red-500/10 text-red-500 text-xs px-2 py-1 rounded uppercase tracking-widest font-black">System Admin</span>
             Internal Dashboard
          </h1>
          <p className="text-zinc-500 mt-2">Monitor global health and user abuse status.</p>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-12">
           <div className="glass-card p-6 rounded-2xl border-l-4 border-l-blue-500">
              <p className="text-sm text-zinc-500 font-medium">Total Global Users</p>
              <p className="text-4xl font-bold mt-2">84,291</p>
              <p className="text-xs text-emerald-500 font-bold mt-1">+12% from last month</p>
           </div>
           <div className="glass-card p-6 rounded-2xl border-l-4 border-l-emerald-500">
              <p className="text-sm text-zinc-500 font-medium">Live Bots Across Fleet</p>
              <p className="text-4xl font-bold mt-2">12,492</p>
              <p className="text-xs text-emerald-500 font-bold mt-1">Status: Stable</p>
           </div>
           <div className="glass-card p-6 rounded-2xl border-l-4 border-l-purple-500">
              <p className="text-sm text-zinc-500 font-medium">Monthly Recurring Revenue</p>
              <p className="text-4xl font-bold mt-2">$294,821</p>
              <p className="text-xs text-emerald-500 font-bold mt-1">+8.4% WoW</p>
           </div>
        </div>

        <div className="glass-card rounded-2xl overflow-hidden">
          <div className="px-8 py-6 border-b border-zinc-800">
             <h3 className="text-xl font-bold">Recent Signups & Flags</h3>
          </div>
          <table className="w-full text-left">
             <thead className="bg-zinc-900/50 text-xs text-zinc-500 uppercase font-bold">
                <tr>
                   <th className="px-8 py-4">User</th>
                   <th className="px-8 py-4">Status</th>
                   <th className="px-8 py-4">Usage</th>
                   <th className="px-8 py-4 text-right">Actions</th>
                </tr>
             </thead>
             <tbody className="divide-y divide-zinc-800">
                {[
                  { name: 'Alex Johnson', email: 'alex@startup.io', status: 'Active', usage: 'High' },
                  { name: 'Maria Garcia', email: 'mgarcia@corp.com', status: 'Banned', usage: 'None' },
                  { name: 'Dev Team', email: 'dev@botnet.ai', status: 'Flagged', usage: 'Extreme' },
                ].map((user, idx) => (
                  <tr key={idx} className="hover:bg-zinc-900/30 transition-colors">
                    <td className="px-8 py-4">
                       <p className="font-bold">{user.name}</p>
                       <p className="text-xs text-zinc-500">{user.email}</p>
                    </td>
                    <td className="px-8 py-4">
                       <span className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase ${
                         user.status === 'Active' ? 'bg-emerald-500/10 text-emerald-500' : 
                         user.status === 'Banned' ? 'bg-red-500/10 text-red-500' : 'bg-amber-500/10 text-amber-500'
                       }`}>
                          {user.status}
                       </span>
                    </td>
                    <td className="px-8 py-4 text-sm font-medium">{user.usage}</td>
                    <td className="px-8 py-4 text-right">
                       <button className="text-xs font-bold text-zinc-400 hover:text-white px-3 py-1 border border-zinc-700 rounded-lg">View Profile</button>
                    </td>
                  </tr>
                ))}
             </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default AdminPanel;
