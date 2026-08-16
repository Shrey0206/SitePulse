import { useContext } from 'react';
import { AuthContext } from './AuthContext';
import { LiveContext } from './LiveContext';

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}

/** Returns null outside a LiveProvider -- pages that work without live updates can ignore it. */
export function useLive() {
  return useContext(LiveContext);
}
