import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LogOut, ShieldCheck, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from '@spendscope/shared';

import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/field';
import { Alert, LoadingState } from '@/components/ui/feedback';
import { Label } from '@/components/ui/primitives';
import { Separator } from '@/components/ui/primitives';
import { errorMessage } from '@/lib/api';
import { useAuth } from '@/features/auth/auth-provider';
import {
  useChangePassword,
  useDeleteAccount,
  useLogout,
  useRevokeOtherSessions,
  useRevokeSession,
  useSessions,
  useUpdateProfile,
} from '@/features/auth/queries';

/**
 * Account screen: identity, password, active sessions and deletion.
 *
 * The "sign out everywhere" and "delete account" actions are deliberately
 * explicit and irreversible.
 */
export function AccountPage() {
  const navigate = useNavigate();
  const { user, workspace } = useAuth();
  const sessions = useSessions();
  const logout = useLogout();
  const updateProfile = useUpdateProfile();
  const changePassword = useChangePassword();
  const revokeSession = useRevokeSession();
  const revokeOthers = useRevokeOtherSessions();
  const deleteAccount = useDeleteAccount();

  const [name, setName] = useState(user?.name ?? '');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordDone, setPasswordDone] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function onSignOut() {
    await logout.mutateAsync();
    toast.success('Signed out');
    navigate('/sign-in', { replace: true });
  }

  async function onSaveName() {
    try {
      await updateProfile.mutateAsync({ name });
      toast.success('Name updated');
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

  async function onChangePassword() {
    setPasswordError(null);
    setPasswordDone(false);
    try {
      const result = await changePassword.mutateAsync({ currentPassword, newPassword });
      setCurrentPassword('');
      setNewPassword('');
      setPasswordDone(true);
      toast.success(
        result.revokedSessions > 0
          ? `Password changed. ${result.revokedSessions} other session(s) signed out.`
          : 'Password changed',
      );
    } catch (error) {
      setPasswordError(errorMessage(error));
    }
  }

  async function onDeleteAccount() {
    setDeleteError(null);
    try {
      await deleteAccount.mutateAsync({ confirm: 'DELETE' });
      toast.success('Account deleted');
      navigate('/sign-in', { replace: true });
    } catch (error) {
      setDeleteError(errorMessage(error));
    }
  }

  return (
    <>
      <PageHeader title="Account" description="Your sign-in details, active sessions and data controls." />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="size-4" aria-hidden="true" /> Profile
          </CardTitle>
          <CardDescription>
            Signed in as {user?.email}. Workspace: {workspace?.name ?? '—'}.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex max-w-sm flex-col gap-2">
            <Label htmlFor="account-name">Display name</Label>
            <Input id="account-name" value={name} onChange={(event) => setName(event.target.value)} />
          </div>
          <div className="flex items-center gap-2">
            <Button onClick={() => void onSaveName()} disabled={updateProfile.isPending || name.trim().length === 0}>
              Save name
            </Button>
            <Button variant="outline" onClick={() => void onSignOut()}>
              <LogOut aria-hidden="true" /> Sign out
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Change password</CardTitle>
          <CardDescription>
            Changing your password signs out every other session. Minimum {MIN_PASSWORD_LENGTH} characters, including a
            letter and a number.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {passwordError ? (
            <Alert variant="destructive" title="Could not change the password">
              {passwordError}
            </Alert>
          ) : null}
          {passwordDone ? (
            <Alert variant="success" title="Password updated">
              Your other sessions have been signed out.
            </Alert>
          ) : null}

          <div className="flex max-w-sm flex-col gap-2">
            <Label htmlFor="current-password">Current password</Label>
            <Input
              id="current-password"
              type="password"
              autoComplete="current-password"
              maxLength={MAX_PASSWORD_LENGTH}
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
            />
          </div>
          <div className="flex max-w-sm flex-col gap-2">
            <Label htmlFor="new-password">New password</Label>
            <Input
              id="new-password"
              type="password"
              autoComplete="new-password"
              maxLength={MAX_PASSWORD_LENGTH}
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
            />
          </div>
          <div>
            <Button
              onClick={() => void onChangePassword()}
              disabled={changePassword.isPending || currentPassword.length === 0 || newPassword.length === 0}
            >
              Change password
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Active sessions</CardTitle>
          <CardDescription>Sessions expire automatically. Revoke any you do not recognise.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {sessions.isPending ? <LoadingState label="Loading sessions…" /> : null}
          {sessions.data && sessions.data.length > 0 ? (
            <ul className="flex flex-col divide-y divide-border">
              {sessions.data.map((session) => (
                <li key={session.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {session.userAgent ?? 'Unknown client'}
                      {session.current ? <span className="ml-2 text-xs text-primary">This session</span> : null}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Started {new Date(session.createdAt).toLocaleString()} · expires{' '}
                      {new Date(session.expiresAt).toLocaleDateString()}
                    </p>
                  </div>
                  {session.current ? null : (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={revokeSession.isPending}
                      onClick={() => void revokeSession.mutateAsync(session.id)}
                    >
                      Revoke
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          ) : null}
          <div>
            <Button
              variant="outline"
              disabled={revokeOthers.isPending}
              onClick={() => void revokeOthers.mutateAsync()}
            >
              Sign out other sessions
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="border-destructive/40">
        <CardHeader>
          <CardTitle className="text-destructive">Delete account</CardTitle>
          <CardDescription>
            Permanently deletes your account, its workspace and every transaction, category, budget and import in it.
            This cannot be undone.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {deleteError ? (
            <Alert variant="destructive" title="Could not delete the account">
              {deleteError}
            </Alert>
          ) : null}
          <Separator />
          <div className="flex max-w-sm flex-col gap-2">
            <Label htmlFor="delete-confirm">Type DELETE to confirm</Label>
            <Input
              id="delete-confirm"
              value={confirmText}
              onChange={(event) => setConfirmText(event.target.value)}
              autoComplete="off"
            />
          </div>
          <div>
            <Button
              variant="destructive"
              disabled={confirmText !== 'DELETE' || deleteAccount.isPending}
              onClick={() => void onDeleteAccount()}
            >
              <Trash2 aria-hidden="true" /> Delete my account and data
            </Button>
          </div>
        </CardContent>
      </Card>
    </>
  );
}
