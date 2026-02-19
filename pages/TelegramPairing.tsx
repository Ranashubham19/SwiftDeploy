import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

const TelegramPairing: React.FC = () => {
  const navigate = useNavigate();

  useEffect(() => {
    const timer = window.setTimeout(() => {
      navigate('/connect/telegram?stage=success', { replace: true });
    }, 2200);

    return () => window.clearTimeout(timer);
  }, [navigate]);

  return (
    <div className="min-h-screen bg-[#050a16] flex items-center justify-center px-6">
      <div className="w-full max-w-[940px] bg-black/25 border border-white/10 rounded-3xl px-6 py-16 md:px-10 text-center shadow-[0_80px_160px_rgba(0,0,0,0.9)]">
        <div className="w-14 h-14 border-4 border-white/15 border-t-white rounded-full animate-spin mb-8 mx-auto"></div>
        <p className="text-white text-4xl font-black tracking-tight">Pairing Telegram</p>
        <p className="text-zinc-400 text-lg mt-4">Connecting your bot. Hang tight...</p>
      </div>
    </div>
  );
};

export default TelegramPairing;
