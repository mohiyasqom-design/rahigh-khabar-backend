// Legacy parser errors remain valid, preserving Auth's existing error payloads.
export const errorResponseSchema = {
  anyOf: [
    { type: 'object', additionalProperties: false, required: ['code', 'message'],
      properties: { code: { type: 'string' }, message: { type: 'string' }, statusCode: { type: 'integer' } } },
    { type: 'object', additionalProperties: false, required: ['error'], properties: { error: { type: 'string' } } },
  ],
} as const;
export const errorResponses = {
  400: errorResponseSchema, 401: errorResponseSchema, 403: errorResponseSchema,
  404: errorResponseSchema, 409: errorResponseSchema, 413: errorResponseSchema,
  415: errorResponseSchema, 429: errorResponseSchema, 500: errorResponseSchema,
} as const;
