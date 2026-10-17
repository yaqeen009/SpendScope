import { createContext, useCallback, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import type { AuthStateDTO, AuthUserDTO, WorkspaceDTO } from '@spendscope/shared';

import { setUnauthorizedHandler } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import { useAuthState } from './queries';

/**
 * Authentication context.
 *
 * The signed-in state comes from `GET /auth/me`; React Query owns the cache so
 * a login/registration updates every consumer at once. When any request is
 * rejected with 401 the cached state is cleared, which makes `RequireAuth`
 * redirect to the sign-in screen.
 */

export type AuthStatus = 'loading' | 'authenticated' | 'anonymous';

export interface AuthContextValue {
  status: AuthStatus;
  user: AuthUserDTO | null;
  workspace: WorkspaceDTO | null;
  state: AuthStateDTO | null;
  /** Clears the cached session state (used after 401 responses). */
  clearSession: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const { data, isPending } = useAuthState();

  const clearSession = useCallback(() => {
    queryClient.setQueryData(queryKeys.auth.me, null);
  }, [queryClient]);

  useEffect(() => {
    setUnauthorizedHandler(clearSession);
    return () => setUnauthorizedHandler(null);
  }, [clearSession]);

  const value = useMemo<AuthContextValue>(() => {
    const state = data ?? null;
    const status: AuthStatus = state ? 'authenticated' : isPending ? 'loading' : 'anonymous';
    return {
      status,
      user: state?.user ?? null,
      workspace: state?.workspace ?? null,
      state,
      clearSession,
    };
  }, [data, isPending, clearSession]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>');
  return context;
}
