import { Monitor, Moon, Sun } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useTheme } from '@/hooks/use-theme';
import { useUpdateSettings } from '@/features/settings/queries';
import type { ThemePreference } from '@spendscope/shared';

const OPTIONS: { value: ThemePreference; label: string; icon: typeof Sun }[] = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
];

/**
 * Theme switch. The preference is stored locally (so it applies before the
 * first paint) and mirrored to the server so it survives a fresh browser.
 */
export function ThemeToggle() {
  const { theme, resolvedTheme, setTheme } = useTheme();
  const updateSettings = useUpdateSettings();

  const change = (next: ThemePreference) => {
    setTheme(next);
    updateSettings.mutate({ theme: next });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="icon" aria-label={`Theme: ${theme}`}>
          {resolvedTheme === 'dark' ? <Moon className="size-4" /> : <Sun className="size-4" />}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {OPTIONS.map((option) => (
          <DropdownMenuItem key={option.value} onSelect={() => change(option.value)}>
            <option.icon className="size-4" aria-hidden="true" />
            <span>{option.label}</span>
            {theme === option.value ? <span className="ml-auto text-xs text-primary">Active</span> : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
