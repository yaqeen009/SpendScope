import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';

import { loginSchema, type LoginInput } from '@spendscope/shared';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/field';
import { Alert } from '@/components/ui/feedback';
import { Label } from '@/components/ui/primitives';
import { errorMessage } from '@/lib/api';
import { AuthLayout } from './auth-layout';
import { useAuth } from './auth-provider';
import { useAuthConfig, useLogin } from './queries';

export function SignInPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { status } = useAuth();
  const config = useAuthConfig();
  const login = useLogin();
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });

  if (status === 'authenticated') {
    return <Navigate to="/" replace />;
  }

  const redirectTo = (location.state as { from?: string } | null)?.from ?? '/';

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await login.mutateAsync(values);
      toast.success('Signed in');
      navigate(redirectTo, { replace: true });
    } catch (error) {
      setFormError(errorMessage(error));
    }
  });

  /**
   * Registration state comes from the server. An unreachable or still-loading
   * configuration must never be reported as "disabled" — that is a statement
   * about the server, and claiming it while the answer is unknown sends people
   * away from an app that would have let them register.
   */
  const registrationFooter = (() => {
    if (config.isPending) return null;

    if (config.isError) {
      return (
        <span>
          Could not reach SpendScope to check registration.{' '}
          <Button
            type="button"
            variant="link"
            className="h-auto p-0 text-sm"
            onClick={() => void config.refetch()}
          >
            Try again
          </Button>
        </span>
      );
    }

    return config.data?.registrationEnabled ? (
      <>
        No account yet?{' '}
        <Link to="/sign-up" className="font-medium text-primary underline-offset-4 hover:underline">
          Create one
        </Link>
      </>
    ) : (
      'Registration is disabled on this installation.'
    );
  })();

  return (
    <AuthLayout
      title="Sign in"
      description="Track your income, spending and trends. Your financial data is private to your account."
      footer={registrationFooter}
    >
      {formError ? (
        <Alert variant="destructive" title="Could not sign in">
          {formError}
        </Alert>
      ) : null}

      <form className="flex flex-col gap-4" onSubmit={onSubmit} noValidate>
        <div className="flex flex-col gap-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            autoComplete="username"
            autoFocus
            aria-invalid={Boolean(errors.email)}
            {...register('email')}
          />
          {errors.email ? <p className="text-xs text-destructive">{errors.email.message}</p> : null}
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            aria-invalid={Boolean(errors.password)}
            {...register('password')}
          />
          {errors.password ? <p className="text-xs text-destructive">{errors.password.message}</p> : null}
        </div>

        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
    </AuthLayout>
  );
}
