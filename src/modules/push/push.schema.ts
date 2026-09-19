import { z } from 'zod';
import { idSchema } from '../../utils/validation.js';

// Shape produced by PushSubscription.toJSON() in the browser.
export const subscribeSchema = z.object({
  endpoint: z.string().url().max(600),
  keys: z.object({
    p256dh: z.string().min(10).max(255),
    auth: z.string().min(5).max(255),
  }),
}).strict();

export const unsubscribeSchema = z.object({
  endpoint: z.string().url().max(600),
}).strict();

export const broadcastSchema = z.object({
  title: z.string().trim().min(3).max(100),
  body: z.string().trim().min(3).max(300),
  url: z.string().trim().max(500).optional(),
  categoryId: idSchema.optional(),
}).strict();

export const publicKeySchema = {
  type: 'object', additionalProperties: false, required: ['publicKey', 'enabled'],
  properties: { publicKey: { type: ['string', 'null'] }, enabled: { type: 'boolean' } },
} as const;

export const statusSchema = {
  type: 'object', additionalProperties: false, required: ['enabled', 'subscribers'],
  properties: { enabled: { type: 'boolean' }, subscribers: { type: 'integer' } },
} as const;

export const deliverySchema = {
  type: 'object', additionalProperties: false, required: ['sent', 'failed', 'removed'],
  properties: {
    sent: { type: 'integer' }, failed: { type: 'integer' }, removed: { type: 'integer' },
  },
} as const;

export const okSchema = {
  type: 'object', additionalProperties: false, required: ['ok'],
  properties: { ok: { type: 'boolean' } },
} as const;
