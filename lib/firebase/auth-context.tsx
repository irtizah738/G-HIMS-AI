'use client';

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { 
  User, 
  GoogleAuthProvider, 
  signInWithPopup, 
  signOut as firebaseSignOut, 
  onAuthStateChanged 
} from 'firebase/auth';
import { auth } from './config';

// Authentication requests identity only. Workspace/Drive scopes must be requested
// separately and just-in-time by the feature that actually needs them.
export const WORKSPACE_SCOPES: string[] = [];

interface AuthContextType {
  user: User | null;
  loading: boolean;
  accessToken: string | null;
  signInWithGoogle: () => Promise<string | null>;
  signOut: () => Promise<void>;
  getAccessToken: () => Promise<string | null>;
}

// In-memory token cache (never stored in localStorage or sessionStorage per security guidelines)
let cachedAccessToken: string | null = null;

export const getGoogleAccessToken = (): string | null => {
  return cachedAccessToken;
};

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  accessToken: null,
  signInWithGoogle: async () => null,
  signOut: async () => {},
  getAccessToken: async () => null,
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      if (!currentUser) {
        cachedAccessToken = null;
        setAccessToken(null);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const signInWithGoogle = useCallback(async (): Promise<string | null> => {
    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      
      const popupPromise = signInWithPopup(auth, provider);
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('auth/popup-timeout')), 30000)
      );

      const result = await Promise.race([popupPromise, timeoutPromise]);
      const credential = GoogleAuthProvider.credentialFromResult(result);
      const token = credential?.accessToken || null;
      
      cachedAccessToken = token;
      setAccessToken(token);
      setUser(result.user);
      return token;
    } catch (error: any) {
      const errorCode = error?.code || '';
      const errorMessage = error?.message || '';
      
      // User cancellation is benign. Browser-blocked or timed-out popups
      // are actionable failures and must reach the login portal.
      if (
        errorCode === 'auth/popup-closed-by-user' ||
        errorCode === 'auth/cancelled-popup-request' ||
        errorCode === 'auth/user-cancelled' ||
        errorMessage.includes('popup-closed-by-user') ||
        errorMessage.includes('cancelled-popup-request')
      ) {
        console.info('Google Sign In popup was cancelled by the user.');
        return null;
      }

      console.error('Google Sign In / Scope Error:', error);
      throw error;
    }
  }, []);

  const signOut = useCallback(async () => {
    try {
      await firebaseSignOut(auth);
      cachedAccessToken = null;
      setAccessToken(null);
      setUser(null);
    } catch (error) {
      console.error('Sign Out Error:', error);
      throw error;
    }
  }, []);

  const getAccessTokenAsync = useCallback(async (): Promise<string | null> => {
    return cachedAccessToken;
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        accessToken,
        signInWithGoogle,
        signOut,
        getAccessToken: getAccessTokenAsync,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
