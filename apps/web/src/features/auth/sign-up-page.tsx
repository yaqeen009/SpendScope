import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { z } from 'zod';

import { MIN_PASSWORD_LENGTH, registerSchema } from '@spendscope/shared';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/field';
import { Alert } from '@/components/ui/feedback';
import { Label } from '@/components/ui/primitives';
import { errorMessage, validationIssues } from '@/lib/api';
import { AuthLayout } from './auth-layout';
import { useAuth } from './auth-provider';
import { useRegister } from './queries';

/** The shared schema plus a local confirmation field. */
const signUpSchema = registerSchema
  .extend({
    confirmPassword: z.string(),
    workspaceName: z.string().trim().max(120).optional(),
  })
  .refine((value) => value.password === value.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

type SignUpValues = z.infer<typeof signUpSchema>;

export function SignUpPage() {
  const navigate = useNavigate();
  const { status } = useAuth();
  const registerMutation = useRegister();
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<SignUpValues>({
    resolver: zodResolver(signUpSchema),
    defaultValues: { email: '', name: '', password: '', confirmPassword: '', workspaceName: '' },
  });

  if (status === 'authenticated') {
    return <Navigate to="/" replace />;
  }

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await registerMutation.mutateAsync({
        email: values.email,
        name: values.name,
        password: values.password,
        ...(values.workspaceName ? { workspaceName: values.workspaceName } : {}),
      });
      toast.success('Account created');
      navigate('/', { replace: true });
    } catch (error) {
      const issues = validationIssues(error);
      setFormError(issues.length > 0 ? issues.map((issue) => issue.message).join(' ') : errorMessage(error));
    }
  });

  return (
    <AuthLayout
      title="Create your account"
      description={`SpendScope creates a private workspace just for you. Passwords must be at least ${MIN_PASSWORD_LENGTH} characters and include a letter and a number.`}
      footer={
        <>
          Already have an account?{' '}
          <Link to="/sign-in" className="font-medium text-primary underline-offset-4 hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      {formError ? (
        <Alert variant="destructive" title="Could not create the account">
          {formError}
        </Alert>
      ) : null}

      <form className="flex flex-col gap-4" onSubmit={onSubmit} noValidate>
        <div className="flex flex-col gap-2">
          <Label htmlFor="name">Name</Label>
          <Input id="name" autoComplete="name" autoFocus aria-invalid={Boolean(errors.name)} {...register('name')} />
          {errors.name ? <p className="text-xs text-destructive">{errors.name.message}</p> : null}
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            autoComplete="username"
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
            autoComplete="new-password"
            aria-invalid={Boolean(errors.password)}
            {...register('password')}
          />
          {errors.password ? <p className="text-xs text-destructive">{errors.password.message}</p> : null}
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="confirmPassword">Confirm password</Label>
          <Input
            id="confirmPassword"
            type="password"
            autoComplete="new-password"
            aria-invalid={Boolean(errors.confirmPassword)}
            {...register('confirmPassword')}
          />
          {errors.confirmPassword ? (
            <p className="text-xs text-destructive">{errors.confirmPassword.message}</p>
          ) : null}
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="workspaceName">Workspace name (optional)</Label>
          <Input id="workspaceName" placeholder="Personal" {...register('workspaceName')} />
        </div>

        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Creating account…' : 'Create account'}
        </Button>
      </form>
    </AuthLayout>
  );
}
