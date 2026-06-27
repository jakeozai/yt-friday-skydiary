import { NextResponse } from 'next/server';
import { createSessionToken, setAuthCookie } from '@/lib/auth';

export async function POST(request: Request) {
  const { password } = await request.json().catch(() => ({ password: '' }));
  const appPassword = process.env.APP_PASSWORD;

  if (!appPassword) {
    return NextResponse.json({ error: 'APP_PASSWORD is not configured' }, { status: 500 });
  }

  if (password !== appPassword) {
    return NextResponse.json({ error: 'Invalid password' }, { status: 401 });
  }

  const response = NextResponse.json({ ok: true });
  setAuthCookie(response, await createSessionToken());
  return response;
}
