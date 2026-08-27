'use client';

import React, { useState, useRef, useEffect } from 'react';
import { useTheme, Theme } from '@/lib/theme/theme-context';
import { Sun, Moon, Laptop, Check, ChevronDown } from 'lucide-react';

interface ThemeToggleProps {
  variant?: 'button' | 'dropdown' | 'segmented';
  className?: string;
  showLabel?: boolean;
}

export function ThemeToggle({
  variant = 'button',
  className = '',
  showLabel = false,
}: ThemeToggleProps) {
  const { theme, resolvedTheme, setTheme, toggleTheme, isDark } = useTheme();
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  if (variant === 'segmented') {
    return (
      <div
        id="theme-segmented-control"
        className={`inline-flex items-center p-1 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 ${className}`}
        role="group"
        aria-label="Theme selection"
      >
        <button
          type="button"
          id="btn-theme-light"
          onClick={() => setTheme('light')}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
            theme === 'light'
              ? 'bg-white dark:bg-slate-700 text-amber-600 dark:text-amber-400 shadow-xs'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
          }`}
          title="Light Mode"
        >
          <Sun className="w-3.5 h-3.5" />
          {showLabel && <span>Light</span>}
        </button>

        <button
          type="button"
          id="btn-theme-dark"
          onClick={() => setTheme('dark')}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
            theme === 'dark'
              ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-400 shadow-xs'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
          }`}
          title="Dark Mode"
        >
          <Moon className="w-3.5 h-3.5" />
          {showLabel && <span>Dark</span>}
        </button>

        <button
          type="button"
          id="btn-theme-system"
          onClick={() => setTheme('system')}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
            theme === 'system'
              ? 'bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-400 shadow-xs'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
          }`}
          title="System Preference"
        >
          <Laptop className="w-3.5 h-3.5" />
          {showLabel && <span>System</span>}
        </button>
      </div>
    );
  }

  if (variant === 'dropdown') {
    return (
      <div className={`relative inline-block ${className}`} ref={dropdownRef}>
        <button
          type="button"
          id="btn-theme-dropdown-toggle"
          onClick={() => setIsOpen(!isOpen)}
          className="h-9 px-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-750 text-slate-700 dark:text-slate-200 text-xs font-bold flex items-center gap-2 transition-colors cursor-pointer shadow-2xs"
          aria-haspopup="true"
          aria-expanded={isOpen}
          title="Change UI Theme"
        >
          {resolvedTheme === 'dark' ? (
            <Moon className="w-4 h-4 text-indigo-400" />
          ) : (
            <Sun className="w-4 h-4 text-amber-500" />
          )}
          <span className="capitalize hidden sm:inline">{theme}</span>
          <ChevronDown className="w-3 h-3 text-slate-400" />
        </button>

        {isOpen && (
          <div
            id="theme-dropdown-menu"
            className="absolute right-0 mt-1.5 w-36 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-xl py-1 z-50 animate-in fade-in slide-in-from-top-1 duration-150"
          >
            {(['light', 'dark', 'system'] as Theme[]).map((t) => (
              <button
                key={t}
                type="button"
                id={`theme-option-${t}`}
                onClick={() => {
                  setTheme(t);
                  setIsOpen(false);
                }}
                className={`w-full px-3 py-2 text-xs flex items-center justify-between transition-colors cursor-pointer ${
                  theme === t
                    ? 'bg-blue-50 dark:bg-slate-700/60 text-blue-700 dark:text-blue-400 font-bold'
                    : 'text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/40'
                }`}
              >
                <div className="flex items-center gap-2 capitalize">
                  {t === 'light' && <Sun className="w-3.5 h-3.5 text-amber-500" />}
                  {t === 'dark' && <Moon className="w-3.5 h-3.5 text-indigo-400" />}
                  {t === 'system' && <Laptop className="w-3.5 h-3.5 text-slate-400" />}
                  <span>{t}</span>
                </div>
                {theme === t && <Check className="w-3.5 h-3.5" />}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  // Default button variant (compact toggle)
  return (
    <button
      type="button"
      id="btn-theme-toggle"
      onClick={toggleTheme}
      className={`relative h-9 px-2.5 rounded-xl border border-slate-200 dark:border-slate-700/80 bg-white/90 dark:bg-slate-800/90 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-semibold flex items-center justify-center gap-2 transition-all cursor-pointer shadow-2xs active:scale-95 ${className}`}
      aria-label={`Switch to ${isDark ? 'light' : 'dark'} mode`}
      title={`Switch to ${isDark ? 'light' : 'dark'} mode (stored in localStorage)`}
    >
      <div className="relative w-4 h-4 flex items-center justify-center">
        {/* Sun Icon */}
        <Sun
          className={`w-4 h-4 text-amber-500 transition-all duration-300 transform ${
            isDark
              ? 'scale-0 rotate-90 opacity-0 absolute'
              : 'scale-100 rotate-0 opacity-100'
          }`}
        />
        {/* Moon Icon */}
        <Moon
          className={`w-4 h-4 text-indigo-400 transition-all duration-300 transform ${
            isDark
              ? 'scale-100 rotate-0 opacity-100'
              : 'scale-0 -rotate-90 opacity-0 absolute'
          }`}
        />
      </div>
      {showLabel && (
        <span className="hidden sm:inline font-medium">
          {isDark ? 'Dark Mode' : 'Light Mode'}
        </span>
      )}
    </button>
  );
}
