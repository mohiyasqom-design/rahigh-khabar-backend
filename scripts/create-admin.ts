import { PrismaClient, Prisma } from '@prisma/client';
import { parseArgs } from 'node:util';
import { createInterface } from 'node:readline/promises';
import { emitKeypressEvents } from 'node:readline';
import { env } from '../src/config/env.js';
import { createAdminSchema } from '../src/modules/auth/auth.schema.js';
import { hashPassword } from '../src/modules/auth/password.js';

/** Passwords never enter argv, environment, terminal echo or shell history. */
async function hiddenPassword(label: string): Promise<string> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('TTY_REQUIRED');
  const input = process.stdin;
  emitKeypressEvents(input);
  const wasRaw = input.isRaw;
  input.setRawMode(true);
  input.resume();
  process.stdout.write(label);
  return new Promise((resolve, reject) => {
    let value = '';
    const cleanup = () => {
      input.off('keypress', onKey);
      input.off('end', onEnd);
      input.setRawMode(wasRaw);
      input.pause();
      process.stdout.write('\n');
    };
    const onEnd = () => { cleanup(); reject(new Error('CANCELLED')); };
    const onKey = (text: string | undefined, key: { name?: string; ctrl?: boolean; meta?: boolean }) => {
      if (key.ctrl && (key.name === 'c' || key.name === 'd')) return onEnd();
      if (key.name === 'return' || key.name === 'enter') {
        cleanup(); resolve(value);
      } else if (key.name === 'backspace') {
        value = [...value].slice(0, -1).join('');
      } else if (!key.ctrl && !key.meta && text && !/[-\u001f\u007f]/.test(text)) {
        if (Buffer.byteLength(value + text, 'utf8') <= 1024) value += text;
      }
    };
    input.on('keypress', onKey);
    input.once('end', onEnd);
  });
}

async function main() {
  let values: { email?: string; 'display-name'?: string; help?: boolean };
  try {
    ({ values } = parseArgs({
      options: {
        email: { type: 'string' }, 'display-name': { type: 'string' }, help: { type: 'boolean' },
      }, strict: true, allowPositionals: false,
    }));
  } catch {
    process.stderr.write('Invalid arguments. Use --email and --display-name; passwords are prompted securely.\n');
    process.exitCode = 1; return;
  }
  if (values.help) {
    process.stdout.write('npm run create-admin -- --email admin@example.com --display-name "Admin"\nPassword is requested twice without echo. No --password option.\n');
    return;
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    process.stderr.write('A secure interactive terminal is required. Run on a trusted host with database access.\n');
    process.exitCode = 1; return;
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  let email: string;
  let displayName: string;
  try {
    email = values.email ?? await rl.question('Email: ');
    displayName = values['display-name'] ?? await rl.question('Display name: ');
  } finally { rl.close(); }
  const password = await hiddenPassword('Password (12+ characters, hidden): ');
  const confirmation = await hiddenPassword('Confirm password (hidden): ');
  if (password !== confirmation) {
    process.stderr.write('Passwords do not match. Nothing was created.\n');
    process.exitCode = 1; return;
  }
  const parsed = createAdminSchema.safeParse({ email, displayName, password });
  if (!parsed.success) {
    process.stderr.write('Invalid input: valid email, display name (1-100 characters), password (12+ characters, at most 1024 UTF-8 bytes) required.\n');
    process.exitCode = 1; return;
  }
  const url = new URL(env.DATABASE_URL);
  url.searchParams.set('connect_timeout', '5');
  url.searchParams.set('pool_timeout', '5');
  url.searchParams.set('socket_timeout', '5');
  const prisma = new PrismaClient({ datasourceUrl: url.toString(), log: [] });
  try {
    const passwordHash = await hashPassword(parsed.data.password);
    await prisma.user.create({
      data: { email: parsed.data.email, displayName: parsed.data.displayName, passwordHash, role: 'SUPER_ADMIN' },
      select: { id: true },
    });
    process.stdout.write('Super Admin created. Sign in through POST /auth/login.\n');
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      process.stderr.write('A user with this email already exists. No changes were made.\n');
    } else {
      process.stderr.write('Admin creation failed. Check database availability and applied migrations. Sensitive details omitted.\n');
    }
    process.exitCode = 1;
  } finally { await prisma.$disconnect().catch(() => undefined); }
}
main().catch(() => {
  process.stderr.write('Admin creation cancelled or failed. Sensitive details omitted.\n');
  process.exitCode = 1;
});
