import { Navigate, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';

import { LoadingState } from '@/components/ui/feedback';
import { useAuth } from './auth-provider';

/**
 * Client-side route guard.
 *
 * This is a usability measure only — it hides pages a signed-out visitor cannot
 * use. The API enforces authentication independently for every data route, so
 * bypassing this component grants no access to any data.
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const location = useLocation();

  if (status === 'loading') {
    return (
      <div className="grid min-h-screen place-items-center bg-background">
        <LoadingState label="Checking your session…" />
      </div>
    );
  }

  if (status === 'anonymous') {
    return <Navigate to="/sign-in" replace state={{ from: location.pathname + location.search }} />;
  }

  return <>{children}</>;
}
