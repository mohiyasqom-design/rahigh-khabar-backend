import { randomBytes } from 'node:crypto';
// Set before application imports. Default tests cannot touch a real database.
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgresql://test:test@127.0.0.1:5432/rahigh_test';
process.env.CORS_ORIGIN = 'http://localhost:3001';
process.env.JWT_SECRET = randomBytes(48).toString('base64url');
process.env.JWT_EXPIRES_IN = '1h';
process.env.AUTH_RATE_LIMIT_MAX = '5';
process.env.AUTH_RATE_LIMIT_WINDOW_MS = '900000';
process.env.TRUST_PROXY = '';
process.env.PUBLIC_SITE_URL = 'http://localhost:3001';
process.env.PUBLIC_API_URL = 'http://localhost:3000';
process.env.MAX_UPLOAD_SIZE_BYTES = '5242880';
process.env.UPLOAD_DIR = 'uploads';
