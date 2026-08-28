'use client';

import React from 'react';
import { Bot, Sparkles } from 'lucide-react';

interface FloatingCopilotBotProps {
  isOpen: boolean;
  onToggle: () => void;
  title?: string;
  badgeText?: string;
}

export function FloatingCopilotBot({
  isOpen,
  onToggle,
  title = 'Open Clinical AI Copilot & Ambient Scribe (⌘J)',
  badgeText,
}: FloatingCopilotBotProps) {
  return (
    <div className="fixed bottom-5 right-5 sm:bottom-6 sm:right-6 z-40 flex items-center gap-2">
      <button
        id="btn-floating-copilot-bot"
        type="button"
        onClick={onToggle}
        className={`group relative flex items-center gap-2 px-3 py-1.5 sm:px-3 sm:py-2 rounded-xl shadow-lg transition-all duration-200 cursor-pointer select-none active:scale-95 ${
          isOpen
            ? 'bg-slate-900 text-white ring-2 ring-indigo-500 shadow-indigo-500/20'
            : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-indigo-600/20 hover:shadow-indigo-600/30 hover:-translate-y-0.5'
        }`}
        title={title}
        aria-label="Toggle Clinical AI Copilot"
        aria-expanded={isOpen}
      >
        {/* Bot Icon */}
        <div className="relative shrink-0 flex items-center justify-center">
          <Bot className="w-4 h-4 text-white group-hover:scale-110 transition-transform duration-200" />
        </div>

        {/* Text Label */}
        <div className="flex items-center gap-1.5 leading-none">
          <span className="text-xs font-bold tracking-tight">AI Copilot</span>
          {badgeText && (
            <span className="text-[9px] font-extrabold uppercase px-1.5 py-0.5 rounded-md bg-amber-400/20 text-amber-200 border border-amber-300/30">
              {badgeText}
            </span>
          )}
        </div>
      </button>
    </div>
  );
}
