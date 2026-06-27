import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { createServerSupabase, hasServerSupabaseConfig } from '@/lib/supabase/server';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;

  const { id } = await params;

  if (!hasServerSupabaseConfig() || id.startsWith('local-')) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  try {
    const supabase = createServerSupabase();
    const [{ data: walk, error: walkError }, { data: observations, error: observationsError }] =
      await Promise.all([
        supabase.from('walks').select('*').eq('id', id).single(),
        supabase
          .from('observations')
          .select('id, elapsed_sec, description, image_url')
          .eq('walk_id', id)
          .order('elapsed_sec', { ascending: true }),
      ]);

    if (walkError || !walk) {
      return NextResponse.json({ error: 'not found' }, { status: 404 });
    }

    if (observationsError) {
      return NextResponse.json({ error: observationsError.message }, { status: 500 });
    }

    return NextResponse.json({ ...walk, observations: observations ?? [] });
  } catch {
    return NextResponse.json({ error: 'Failed to load walk' }, { status: 500 });
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;

  const { id } = await params;

  try {
    const body = await request.json();
    const allowedBody = {
      end_time: typeof body.end_time === 'string' ? body.end_time : undefined,
    };

    if (!hasServerSupabaseConfig() || id.startsWith('local-')) {
      return NextResponse.json({ id, ...allowedBody, storage: 'local-fallback' });
    }

    const supabase = createServerSupabase();
    const { data, error } = await supabase
      .from('walks')
      .update(allowedBody)
      .eq('id', id)
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: 'Failed to update walk' }, { status: 500 });
  }
}
