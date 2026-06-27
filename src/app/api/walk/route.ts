import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { isMissingSupabaseTable } from '@/lib/supabase/errors';
import { createServerSupabase, hasServerSupabaseConfig } from '@/lib/supabase/server';

export async function GET(request: Request) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;

  if (!hasServerSupabaseConfig()) {
    return NextResponse.json([]);
  }

  try {
    const supabase = createServerSupabase();
    const { data, error } = await supabase
      .from('walks')
      .select('id, date, start_time, end_time, diary_status, weather, diary')
      .order('start_time', { ascending: false })
      .limit(30);

    if (isMissingSupabaseTable(error)) return NextResponse.json([]);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data ?? []);
  } catch {
    return NextResponse.json({ error: 'Failed to list walks' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;

  try {
    if (!hasServerSupabaseConfig()) {
      return NextResponse.json({
        id: `local-${Date.now()}`,
        date: new Date().toISOString().split('T')[0],
        start_time: new Date().toISOString(),
        storage: 'local-fallback',
      });
    }

    const supabase = createServerSupabase();
    const { data, error } = await supabase
      .from('walks')
      .insert({
        date: new Date().toISOString().split('T')[0],
        start_time: new Date().toISOString(),
      })
      .select()
      .single();

    if (isMissingSupabaseTable(error)) {
      return NextResponse.json({
        id: `local-${Date.now()}`,
        date: new Date().toISOString().split('T')[0],
        start_time: new Date().toISOString(),
        storage: 'local-fallback',
      });
    }
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: 'Failed to create walk' }, { status: 500 });
  }
}
