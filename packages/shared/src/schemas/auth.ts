import { z } from 'zod';

/**
 * Authentication request schemas.
 *
 * Validation happens at the API boundary; the password rules here are the
 * contract the API enforces (see `apps/api/src/lib/password.ts` for the
 * hashing parameters used once a password is accepted).
 */

export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 200;

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, 'An email address is required')
  .max(320)
  .email('Enter a valid email address');

export const passwordSchema = z
  .string()
  .min(MIN_PASSWORD_LENGTH, `Password must be at least ${MIN_PASSWORD_LENGTH} characters`)
  .max(MAX_PASSWORD_LENGTH, `Password must be at most ${MAX_PASSWORD_LENGTH} characters`)
  .refine((value) => /[A-Za-z]/.test(value), 'Password must contain a letter')
  .refine((value) => /\d/.test(value), 'Password must contain a number');

export const registerSchema = z.object({
  email: emailSchema,
  name: z.string().trim().min(1, 'A name is required').max(120),
  password: passwordSchema,
  /** Optional name for the workspace created for the new account. */
  workspaceName: z.string().trim().min(1).max(120).optional(),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'A password is required').max(MAX_PASSWORD_LENGTH),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const updateProfileSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field must be provided',
  });
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Your current password is required').max(MAX_PASSWORD_LENGTH),
  newPassword: passwordSchema,
});
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

/** Deletion requires the literal token so a stray request cannot destroy data. */
export const deleteAccountSchema = z.object({
  confirm: z.literal('DELETE'),
});
export type DeleteAccountInput = z.infer<typeof deleteAccountSchema>;
