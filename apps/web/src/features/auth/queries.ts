import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type {
  AuthSessionDTO,
  AuthStateDTO,
  AuthUserDTO,
  ChangePasswordInput,
  DeleteAccountInput,
  LoginInput,
  RegisterInput,
  UpdateProfileInput,
} from '@spendscope/shared';

import { apiGet, apiRequest } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';

/**
 * Authentication data access.
 *
 * The session lives in an `HttpOnly` cookie, so there is no token to store.
 * `GET /auth/me` is the single source of truth for the signed-in state; a 401
 * there is an expected outcome (not an error worth retrying), so the global
 * redirect handler is skipped for it.
 */

export interface AuthConfig {
  registrationEnabled: boolean;
  minPasswordLength: number;
  sessionTtlHours: number;
}

export function useAuthConfig() {
  return useQuery({
    queryKey: queryKeys.auth.config,
    queryFn: () => apiGet<{ data: AuthConfig }>('/auth/config').then((response) => response.data),
    staleTime: 30 * 60 * 1000,
  });
}

export async function fetchAuthState(): Promise<AuthStateDTO> {
  const response = await apiRequest<{ data: AuthStateDTO }>('/auth/me', { skipAuthRedirect: true });
  return response.data;
}

export function useAuthState() {
  return useQuery({
    queryKey: queryKeys.auth.me,
    queryFn: fetchAuthState,
    retry: false,
    staleTime: 60 * 1000,
  });
}

export function useLogin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: LoginInput) =>
      apiRequest<{ data: AuthStateDTO }>('/auth/login', { method: 'POST', body: input, skipAuthRedirect: true }).then(
        (response) => response.data,
      ),
    onSuccess: (state) => {
      queryClient.setQueryData(queryKeys.auth.me, state);
      void queryClient.invalidateQueries();
    },
  });
}

export function useRegister() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: RegisterInput) =>
      apiRequest<{ data: AuthStateDTO }>('/auth/register', {
        method: 'POST',
        body: input,
        skipAuthRedirect: true,
      }).then((response) => response.data),
    onSuccess: (state) => {
      queryClient.setQueryData(queryKeys.auth.me, state);
      void queryClient.invalidateQueries();
    },
  });
}

export function useLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiRequest<void>('/auth/logout', { method: 'POST', skipAuthRedirect: true }),
    onSuccess: () => {
      queryClient.setQueryData(queryKeys.auth.me, null);
      queryClient.clear();
    },
  });
}

export function useSessions() {
  return useQuery({
    queryKey: queryKeys.auth.sessions,
    queryFn: () => apiGet<{ data: AuthSessionDTO[] }>('/auth/sessions').then((response) => response.data),
  });
}

export function useRevokeSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiRequest<void>(`/auth/sessions/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.auth.sessions });
    },
  });
}

export function useRevokeOtherSessions() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiRequest<{ data: { revoked: number } }>('/auth/sessions/revoke-others', { method: 'POST' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.auth.sessions });
    },
  });
}

export function useUpdateProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateProfileInput) =>
      apiRequest<{ data: AuthUserDTO }>('/auth/me', { method: 'PATCH', body: input }).then((response) => response.data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.auth.me });
    },
  });
}

export function useChangePassword() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ChangePasswordInput) =>
      apiRequest<{ data: { revokedSessions: number } }>('/auth/me/password', { method: 'POST', body: input }).then(
        (response) => response.data,
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.auth.sessions });
    },
  });
}

export function useDeleteAccount() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: DeleteAccountInput) =>
      apiRequest<{ data: { workspaces: number } }>('/auth/me', { method: 'DELETE', body: input }).then(
        (response) => response.data,
      ),
    onSuccess: () => {
      queryClient.setQueryData(queryKeys.auth.me, null);
      queryClient.clear();
    },
  });
}
