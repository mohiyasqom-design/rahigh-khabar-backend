import { z } from 'zod';

// Lowercase-only so that @mentions and profile URLs stay unambiguous, and so
// the unique index cannot be defeated by case variations.
export const USERNAME_PATTERN = /^[a-z0-9_]{3,20}$/;
export const usernameSchema = z.string().trim().toLowerCase()
  .regex(USERNAME_PATTERN, 'نام کاربری باید ۳ تا ۲۰ نویسه شامل حروف کوچک انگلیسی، عدد یا زیرخط باشد.');
export const displayNameSchema = z.string().trim().min(1).max(50);

// Every field optional: onboarding sends only `username`, profile editing sends
// only `displayName`. The previous all-required shape made both impossible.
export const updateProfileSchema = z.object({
  username: usernameSchema.optional(),
  displayName: displayNameSchema.optional(),
}).strict().refine(
  (value) => value.username !== undefined || value.displayName !== undefined,
  'حداقل یک فیلد برای بروزرسانی لازم است.',
);

export const usernameQuerySchema = z.object({ username: usernameSchema }).strict();

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export type UsernameQuery = z.infer<typeof usernameQuerySchema>;

export const siteUserResponseSchema = {
  type: 'object', additionalProperties: false,
  required: ['id', 'email', 'username', 'displayName', 'avatarUrl', 'role', 'usernameSetAt'],
  properties: {
    id: { type: 'string' },
    email: { type: 'string' },
    username: { type: ['string', 'null'] },
    displayName: { type: 'string' },
    avatarUrl: { type: ['string', 'null'] },
    role: { type: 'string', enum: ['USER', 'ADMIN', 'SUPER_ADMIN'] },
    usernameSetAt: { type: ['string', 'null'] },
  },
} as const;

export const usernameAvailabilityResponseSchema = {
  type: 'object', additionalProperties: false, required: ['username', 'available'],
  properties: { username: { type: 'string' }, available: { type: 'boolean' } },
} as const;
