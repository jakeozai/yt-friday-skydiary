import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';

const MAX_TTS_TEXT_LENGTH = 500;

export async function POST(request: Request) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;

  try {
    const { text } = await request.json();
    if (typeof text !== 'string' || text.length > MAX_TTS_TEXT_LENGTH) {
      return NextResponse.json({ error: 'Invalid TTS text' }, { status: 400 });
    }

    const apiKey = process.env.GOOGLE_TTS_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'GOOGLE_TTS_API_KEY not configured' }, { status: 503 });
    }

    const res = await fetch(
      `https://texttospeech.googleapis.com/v1/text:synthesize?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input: { text },
          voice: {
            languageCode: 'ko-KR',
            name: 'ko-KR-Wavenet-A',  // 고품질 한국어 여성 음성
            ssmlGender: 'FEMALE',
          },
          audioConfig: {
            audioEncoding: 'MP3',
            speakingRate: 0.92,
            pitch: 0,
          },
        }),
      }
    );

    if (!res.ok) {
      const err = await res.text();
      console.error('[tts] Google API error:', err);
      return NextResponse.json({ error: 'TTS failed' }, { status: 500 });
    }

    const data = await res.json();
    const audioBuffer = Buffer.from(data.audioContent as string, 'base64');

    return new Response(new Uint8Array(audioBuffer), {
      headers: { 'Content-Type': 'audio/mpeg' },
    });
  } catch (err) {
    console.error('[tts]', err);
    return NextResponse.json({ error: 'TTS error' }, { status: 500 });
  }
}
