import { z } from 'zod';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, SUPPORTED_LOCALES } from '@/lib/auth/params';

/**
 * Request schemas, shared by client and server (Phase 1 §12 of Phase 0's stack
 * note). The SERVER is authoritative: the client uses these only to give
 * immediate feedback, and every endpoint re-parses on arrival.
 */
const email = z
  .string()
  .trim()
  .min(3)
  .max(320)
  // Deliberately permissive. Over-strict email regexes reject valid addresses,
  // and the authoritative test of an address is whether its verification email
  // arrives.
  .refine((v) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v), { message: 'Enter a valid email address.' });

const password = z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH);

const token = z.string().min(16).max(512);

export const registerSchema = z.object({
  email,
  password,
  full_name: z.string().trim().min(1).max(200),
  locale: z.enum(SUPPORTED_LOCALES).default('en'),
});

export const loginSchema = z.object({
  email,
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
});

export const forgotPasswordSchema = z.object({ email });

export const resetPasswordSchema = z.object({ token, password });

export const verifyEmailSchema = z.object({ token });

export const acceptInviteSchema = z.object({ token, password });

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
