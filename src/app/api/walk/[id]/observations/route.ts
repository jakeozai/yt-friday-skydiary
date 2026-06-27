import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { createServerSupabase, hasServerSupabaseConfig } from '@/lib/supabase/server';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;

  const { id } = await params;

  try {
    const { elapsed_sec, description, image_url, audio_url } = await request.json();

    if (
      typeof elapsed_sec !== 'number' ||
      !Number.isInteger(elapsed_sec) ||
      elapsed_sec < 0 ||
      elapsed_sec > 60 * 60 * 6 ||
      typeof description !== 'string' ||
      description.length > 1000
    ) {
      return NextResponse.json({ error: 'Invalid observation payload' }, { status: 400 });
    }

    if (!hasServerSupabaseConfig() || id.startsWith('local-')) {
      return NextResponse.json({
        id: `local-observation-${Date.now()}`,
        walk_id: id,
        elapsed_sec,
        description,
        image_url: image_url ?? null,
        audio_url: audio_url ?? null,
        storage: 'local-fallback',
      });
    }

    const supabase = createServerSupabase();
    const { data, error } = await supabase
      .from('observations')
      .insert({
        walk_id: id,
        elapsed_sec,
        description,
        image_url: image_url ?? null,
        audio_url: audio_url ?? null,
      })
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: 'Failed to save observation' }, { status: 500 });
  }
}
