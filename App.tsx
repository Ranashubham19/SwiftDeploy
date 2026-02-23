
import React, { useState, useEffect } from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import LandingPage from './pages/LandingPage';
import Login from './pages/Login';
import ConnectTelegram from './pages/ConnectTelegram';
import ConnectDiscord from './pages/ConnectDiscord';
import TelegramPairing from './pages/TelegramPairing';
import Contact from './pages/Contact';
import TermsOfService from './pages/TermsOfService';
import PrivacyPolicy from './pages/PrivacyPolicy';
import { User, Bot, Platform, AIModel, BotStatus } from './types';
import { apiUrl } from './utils/api';

const mapTelegramModel = (providerRaw: string, modelRaw: string): AIModel => {
  const provider = String(providerRaw || '').trim().toLowerCase();
  const model = String(modelRaw || '').trim().toLowerCase();
  if (provider === 'openrouter' && model) return AIModel.OPENROUTER_FREE;
  return AIModel.OPENROUTER_FREE;
};

const mapApiBot = (raw: any): Bot | null => {
  const id = String(raw?.id || '').trim();
  if (!id) return null;

  const platformRaw = String(raw?.platform || '').trim().toUpperCase();
  const platform = platformRaw === 'DISCORD' ? Platform.DISCORD : Platform.TELEGRAM;
  const token = String(raw?.token || '').trim();

  const botUsername = String(raw?.botUsername || '').trim();
  const botName = String(raw?.botName || '').trim();
  const telegramLink = String(raw?.telegramLink || '').trim();

  const name =
    botName ||
    (botUsername ? `@${botUsername}` : '') ||
    (platform === Platform.DISCORD ? 'Discord Bot' : 'Telegram Bot');

  const model =
    platform === Platform.TELEGRAM
      ? mapTelegramModel(String(raw?.aiProvider || ''), String(raw?.aiModel || ''))
      : AIModel.OPENROUTER_FREE;

  return {
    id,
    name,
    platform,
    token: token || '********',
    model,
    status: BotStatus.ACTIVE,
    messageCount: 0,
    tokenUsage: 0,
    lastActive: new Date().toISOString(),
    memoryEnabled: true,
    telegramUsername: botUsername || undefined,
    telegramLink: telegramLink || (botUsername ? `https://t.me/${botUsername}` : undefined)
  };
};

const App: React.FC = () => {
  const [user, setUser] = useState<User | null>(null);
  const [bots, setBots] = useState<Bot[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const loadBots = async () => {
    try {
      const response = await fetch(apiUrl('/bots'), { credentials: 'include' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !Array.isArray(data?.bots)) {
        setBots([]);
        return;
      }
      const mapped = data.bots.map(mapApiBot).filter(Boolean) as Bot[];
      setBots(mapped);
    } catch {
      setBots([]);
    }
  };

  useEffect(() => {
    const restoreSession = async () => {
      try {
        const response = await fetch(apiUrl('/me'), {
          credentials: 'include'
        });
        if (response.ok) {
          const data = await response.json();
          if (data?.user?.email) {
            const restoredUser: User = {
              id: data.user.id,
              email: data.user.email,
              name: data.user.name
            };
            setUser(restoredUser);
            await loadBots();
          }
        }
      } catch {
        // Ignore unauthenticated state.
      } finally {
        setIsLoading(false);
      }
    };

    restoreSession();
  }, []);

  const handleLogin = (userData: User) => {
    setUser(userData);
    void loadBots();
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
          <Route path="/connect/telegram" element={user ? <ConnectTelegram user={user} bots={bots} setBots={setBots} /> : <Navigate to="/login" />} />
          <Route path="/connect/telegram/pairing" element={user ? <TelegramPairing /> : <Navigate to="/login" />} />
          <Route path="/connect/discord" element={user ? <ConnectDiscord user={user} bots={bots} setBots={setBots} /> : <Navigate to="/login" />} />
          <Route path="/contact" element={<Contact />} />
          <Route path="/terms" element={<TermsOfService />} />
          <Route path="/privacy" element={<PrivacyPolicy />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </div>
    </HashRouter>
  );
};

export default App;
