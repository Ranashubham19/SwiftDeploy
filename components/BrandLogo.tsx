import React from 'react';
import { ICONS } from '../constants';

interface BrandLogoProps {
  compact?: boolean;
  className?: string;
}

const BrandLogo: React.FC<BrandLogoProps> = ({ compact = false, className = '' }) => {
  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <div className="w-10 h-10 flex items-center justify-center bg-[#101114] border border-white/20 rounded-xl shadow-[inset_0_0_0_1px_rgba(255,255,255,0.1)]">
        <ICONS.LogoMark className="w-6 h-6 opacity-95" />
      </div>
      {!compact && (
        <div className="leading-none">
          <p className="text-lg font-heading font-black uppercase tracking-wide text-white">SwiftDeploy</p>
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500">AI OPERATIONS CLOUD</p>
        </div>
      )}
    </div>
  );
};

export default BrandLogo;
