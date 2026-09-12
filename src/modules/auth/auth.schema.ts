import { z } from 'zod';

// Login and CLI share normalization. Passwords are never trimmed or normalized.
export const emailSchema = z.string().trim().max(254).email().transform((value) => value.toLowerCase());
export const passwordSchema = z.string().min(1).max(1024)
  .refine((value) => Buffer.byteLength(value, 'utf8') <= 1024);
export const loginSchema = z.object({ email: emailSchema, password: passwordSchema }).strict();
export const createAdminSchema = z.object({
  email: emailSchema,
  password: passwordSchema.refine((value) => [...value].length >= 12),
  displayName: z.string().trim().min(1).max(100),
}).strict();
export type LoginInput = z.infer<typeof loginSchema>;
export const publicUserResponseSchema = {
  type: 'object', additionalProperties: false,
  required: ['id', 'email', 'displayName', 'role'],
  properties: {
    id: { type: 'string' }, email: { type: 'string' }, displayName: { type: 'string' },
    role: { type: 'string', enum: ['ADMIN', 'SUPER_ADMIN'] },
  },
} as const;
