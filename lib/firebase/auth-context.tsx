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

export const WORKSPACE_SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/spreadsheets.readonly',
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/drive.readonly',
];

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
      // Add Google Sheets and Google Drive Workspace scopes
      WORKSPACE_SCOPES.forEach((scope) => {
        provider.addScope(scope);
      });
      provider.setCustomParameters({ prompt: 'consent select_account' });
      
      const popupPromise = signInWithPopup(auth, provider);
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('auth/popup-timeout')), 4500)
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
      
      // User closed the popup, cancelled, popup was blocked, or timed out in iframe sandbox
      if (
        errorCode === 'auth/popup-closed-by-user' ||
        errorCode === 'auth/cancelled-popup-request' ||
        errorCode === 'auth/user-cancelled' ||
        errorCode === 'auth/popup-blocked' ||
        errorMessage.includes('popup-closed-by-user') ||
        errorMessage.includes('cancelled-popup-request') ||
        errorMessage.includes('popup-timeout') ||
        errorMessage.includes('popup-blocked')
      ) {
        console.info('Google Sign In popup was cancelled, blocked, or timed out in iframe.');
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
