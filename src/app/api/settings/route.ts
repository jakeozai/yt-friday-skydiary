import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { isMissingSupabaseTable } from '@/lib/supabase/errors';
import { createServerSupabase } from '@/lib/supabase/server';

export async function GET(request: Request) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;

  try {
    const supabase = createServerSupabase();
    const { data, error } = await supabase
      .from('baby_settings')
      .select('*')
      .eq('id', 'singleton')
      .single();

    if (isMissingSupabaseTable(error) || !data) {
      return NextResponse.json(null);
    }

    return NextResponse.json(data);
  } catch {
    return NextResponse.json(null);
  }
}

export async function PUT(request: Request) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;

  try {
    const body = await request.json();
    const { baby_name, birth_date } = body;

    if (!birth_date || typeof birth_date !== 'string') {
      return NextResponse.json({ error: 'birth_date is required' }, { status: 400 });
    }

    const supabase = createServerSupabase();
    const { data, error } = await supabase
      .from('baby_settings')
      .upsert({
        id: 'singleton',
        baby_name: typeof baby_name === 'string' && baby_name.trim() ? baby_name.trim() : '아기',
        birth_date,
        updated_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (isMissingSupabaseTable(error)) {
      return NextResponse.json({
        id: 'local-settings',
        baby_name: typeof baby_name === 'string' && baby_name.trim() ? baby_name.trim() : '아기',
        birth_date,
        storage: 'local-fallback',
      });
    }

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
