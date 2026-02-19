
import React, { useState, useEffect } from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import LandingPage from './pages/LandingPage';
import Dashboard from './pages/Dashboard';
import Login from './pages/Login';
import Billing from './pages/Billing';
import AdminPanel from './pages/AdminPanel';
import ConnectTelegram from './pages/ConnectTelegram';
import ConnectDiscord from './pages/ConnectDiscord';
import Contact from './pages/Contact';
import TermsOfService from './pages/TermsOfService';
import PrivacyPolicy from './pages/PrivacyPolicy';
import { User, Bot, Platform, AIModel, BotStatus } from './types';

const INITIAL_BOTS: Bot[] = [
  {
    id: 'bot_1',
    name: 'SimpleClaw-Alpha',
    platform: Platform.TELEGRAM,
    token: '••••••••••••••••',
    model: AIModel.CLAUDE_OPUS_4_5,
    status: BotStatus.ACTIVE,
    messageCount: 0,
    tokenUsage: 0,
    lastActive: new Date().toISOString(),
    memoryEnabled: true
  }
];

const App: React.FC = () => {
  const [user, setUser] = useState<User | null>(null);
  const [bots, setBots] = useState<Bot[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // With session-based auth, we don't restore from localStorage
    // Authentication state is managed by the backend session
    // Add small delay to ensure proper rendering
    const timer = setTimeout(() => {
      setIsLoading(false);
    }, 100);
    
    return () => clearTimeout(timer);
  }, []);

  const handleLogin = (userData: User) => {
    setUser(userData);
    if (userData.name.includes('Shubham') || userData.name.includes('Shubam')) {
      setBots(INITIAL_BOTS);
    }
  };

  const handleLogout = () => {
    setUser(null);
    setBots([]);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#050a16]">
        <div className="w-12 h-12 border-4 border-white/5 border-t-white rounded-full animate-spin"></div>
      </div>
    );
  }

  return (
    <HashRouter>
      <div className="min-h-screen bg-transparent text-zinc-50 font-sans selection:bg-cyan-400/30">
        <Routes>
          <Route path="/" element={<LandingPage user={user} />} />
          <Route path="/login" element={<Login onLogin={handleLogin} />} />
          <Route path="/dashboard" element={user ? <Dashboard user={user} bots={bots} setBots={setBots} onLogout={handleLogout} /> : <Navigate to="/login" />} />
          <Route path="/connect/telegram" element={user ? <ConnectTelegram user={user} bots={bots} setBots={setBots} /> : <Navigate to="/login" />} />
          <Route path="/connect/discord" element={user ? <ConnectDiscord user={user} bots={bots} setBots={setBots} /> : <Navigate to="/login" />} />
          <Route path="/contact" element={<Contact />} />
          <Route path="/terms" element={<TermsOfService />} />
          <Route path="/privacy" element={<PrivacyPolicy />} />
          <Route path="/billing" element={user ? <Billing user={user} /> : <Navigate to="/login" />} />
          <Route path="/admin" element={user?.email === 'admin@simpleclaw.com' ? <AdminPanel /> : <Navigate to="/" />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </div>
    </HashRouter>
  );
};

export default App;
