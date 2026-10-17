import { Suspense, useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import {
  BarChart3,
  ChevronLeft,
  LayoutDashboard,
  Menu,
  Receipt,
  Settings as SettingsIcon,
  Tags,
  Target,
  Upload,
  Wallet,
  X,
} from 'lucide-react';

import { ThemeToggle } from '@/components/layout/theme-toggle';
import { Button } from '@/components/ui/button';
import { TooltipHint } from '@/components/ui/controls';
import { LoadingState } from '@/components/ui/feedback';
import { cn } from '@/lib/utils';

const NAV_ITEMS = [
  { to: '/', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/transactions', label: 'Transactions', icon: Receipt, end: false },
  { to: '/analytics', label: 'Analytics', icon: BarChart3, end: false },
  { to: '/budgets', label: 'Budgets', icon: Target, end: false },
  { to: '/categories', label: 'Categories', icon: Tags, end: false },
  { to: '/import', label: 'Import CSV', icon: Upload, end: false },
  { to: '/settings', label: 'Settings', icon: SettingsIcon, end: false },
] as const;

const COLLAPSE_KEY = 'spendscope-sidebar-collapsed';

function Brand({ collapsed = false }: { collapsed?: boolean }) {
  return (
    <div className="flex items-center gap-2 px-1">
      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground">
        <Wallet className="size-4" aria-hidden="true" />
      </span>
      {collapsed ? null : (
        <span className="text-sm font-semibold tracking-tight">
          Spend<span className="text-primary">Scope</span>
        </span>
      )}
    </div>
  );
}

function NavList({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }) {
  return (
    <nav aria-label="Main" className="flex flex-1 flex-col gap-1">
      {NAV_ITEMS.map((item) => {
        const link = (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            onClick={onNavigate}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                collapsed && 'justify-center px-2',
                isActive
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
              )
            }
          >
            <item.icon className="size-4 shrink-0" aria-hidden="true" />
            {collapsed ? <span className="sr-only">{item.label}</span> : <span>{item.label}</span>}
          </NavLink>
        );
        return collapsed ? (
          <TooltipHint key={item.to} label={item.label}>
            {link}
          </TooltipHint>
        ) : (
          link
        );
      })}
    </nav>
  );
}

/** Desktop sidebar + mobile off-canvas navigation + the main content area. */
export function AppShell() {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(COLLAPSE_KEY) === 'true';
    } catch {
      return false;
    }
  });
  // The drawer is open for the current path only, so navigating (including via
  // the back button) closes it without a synchronising effect.
  const [mobileOpenPath, setMobileOpenPath] = useState<string | null>(null);
  const location = useLocation();
  const mobileOpen = mobileOpenPath === location.pathname;

  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSE_KEY, String(collapsed));
    } catch {
      /* ignore */
    }
  }, [collapsed]);

  return (
    <div className="flex min-h-full bg-background">
      <a
        href="#main-content"
        className="sr-only-focusable absolute left-4 top-4 z-50 rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground"
      >
        Skip to main content
      </a>

      <aside
        className={cn(
          'sticky top-0 hidden h-screen shrink-0 flex-col gap-6 border-r border-border bg-card p-4 lg:flex',
          collapsed ? 'w-[4.5rem]' : 'w-60',
        )}
      >
        <Brand collapsed={collapsed} />
        <NavList collapsed={collapsed} />
        <Button
          variant="ghost"
          size="sm"
          className="justify-center"
          onClick={() => setCollapsed((value) => !value)}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          <ChevronLeft className={cn('size-4 transition-transform', collapsed && 'rotate-180')} />
          {collapsed ? null : <span>Collapse</span>}
        </Button>
      </aside>

      {mobileOpen ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            aria-label="Close navigation"
            className="absolute inset-0 bg-black/50"
            onClick={() => setMobileOpenPath(null)}
          />
          <div className="relative flex h-full w-64 max-w-[80%] flex-col gap-5 border-r border-border bg-card p-4">
            <div className="flex items-center justify-between">
              <Brand />
              <Button variant="ghost" size="icon" onClick={() => setMobileOpenPath(null)} aria-label="Close navigation">
                <X className="size-4" />
              </Button>
            </div>
            <NavList collapsed={false} onNavigate={() => setMobileOpenPath(null)} />
          </div>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-border bg-background/90 px-4 py-3 backdrop-blur lg:hidden">
          <Button variant="ghost" size="icon" onClick={() => setMobileOpenPath(location.pathname)} aria-label="Open navigation">
            <Menu className="size-4" />
          </Button>
          <Brand />
          <div className="ml-auto">
            <ThemeToggle />
          </div>
        </header>

        <main id="main-content" className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8">
          <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
            <Suspense fallback={<LoadingState label="Loading page…" />}>
              <Outlet />
            </Suspense>
          </div>
        </main>

        <footer className="border-t border-border px-4 py-4 text-xs text-muted-foreground sm:px-6 lg:px-8">
          <p>
            SpendScope runs entirely on your machine. Data stays in your local PostgreSQL database; nothing is sent
            to external services.
          </p>
        </footer>
      </div>
    </div>
  );
}

export { Brand };
