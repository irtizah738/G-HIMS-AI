'use client';

import React, { useEffect, useState } from 'react';

interface SystemInitializerProps {
  children: React.ReactNode;
}

export function SystemInitializer({ children }: SystemInitializerProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);

    // Global listener for unhandled errors to prevent white-screens
    const handleWindowError = (event: ErrorEvent) => {
      console.warn('[G-HIMS System Alert] Client runtime warning:', event.message);
    };

    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      console.warn('[G-HIMS System Alert] Unhandled promise rejection:', event.reason);
    };

    window.addEventListener('error', handleWindowError);
    window.addEventListener('unhandledrejection', handleUnhandledRejection);

    return () => {
      window.removeEventListener('error', handleWindowError);
      window.removeEventListener('unhandledrejection', handleUnhandledRejection);
    };
  }, []);

  return <>{children}</>;
}
