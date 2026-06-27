import { NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { requireAuth } from '@/lib/auth';
import { createServerSupabase, hasServerSupabaseConfig } from '@/lib/supabase/server';

function getDiaryDevelopmentalGuidance(months: number): string {
  if (months < 1) return '빛과 소리, 온도처럼 감각으로 느끼는 세상을 중심으로 표현해주세요. 이 시기는 엄마 아빠의 목소리와 온기가 세상의 전부예요.';
  if (months < 3) return '움직이는 것과 밝은 빛에 반응하는 아이의 모습을 담아주세요. 엄마 아빠 얼굴을 알아보고 미소 짓기 시작하는 시기예요.';
  if (months < 6) return '색깔과 움직임에 눈을 반짝이고, 손을 뻗어 세상을 잡으려는 아이의 호기심을 표현해주세요.';
  if (months < 9) return '소리 나는 곳을 찾아 고개를 돌리고, 새로운 것을 발견할 때 놀라는 표정을 담아주세요.';
  if (months < 12) return '손가락으로 가리키고 눈을 빛내며 탐색하는 아이의 활발한 호기심을 표현해주세요.';
  if (months < 18) return '걸음마를 내딛으며 넓어진 세상을 탐험하는 아이의 설렘과 성취감을 담아주세요.';
  if (months < 24) return '뛰어다니며 본 것을 짧은 말로 표현하려는 아이의 성장과 생동감을 담아주세요.';
  return '세상을 배워가는 아이의 눈에 비친 산책 풍경을 생생하게 표현해주세요.';
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;

  const { id: walkId } = await params;

  if (walkId.startsWith('local-') || !hasServerSupabaseConfig()) {
    return NextResponse.json({ error: 'not configured' }, { status: 503 });
  }

  if (!process.env.GEMINI_API_KEY) {
    return NextResponse.json({ error: 'GEMINI_API_KEY missing' }, { status: 503 });
  }

  let weather: string | null = null;
  let clientBabyName: string | null = null;
  let clientBirthDate: string | null = null;
  try {
    const body = await request.json();
    weather = typeof body.weather === 'string' && body.weather.length <= 80 ? body.weather : null;
    clientBabyName = typeof body.babyName === 'string' && body.babyName.trim() ? body.babyName.trim() : null;
    clientBirthDate = typeof body.birthDate === 'string' ? body.birthDate : null;
  } catch {}

  const supabase = createServerSupabase();

  try {
    await supabase
      .from('walks')
      .update({ diary_status: 'generating', ...(weather ? { weather } : {}) })
      .eq('id', walkId);

    const [{ data: walk }, { data: observations }, { data: settings }] = await Promise.all([
      supabase.from('walks').select('*').eq('id', walkId).single(),
      supabase
        .from('observations')
        .select('elapsed_sec, description')
        .eq('walk_id', walkId)
        .order('elapsed_sec', { ascending: true }),
      supabase.from('baby_settings').select('*').eq('id', 'singleton').single(),
    ]);

    if (!walk) {
      return NextResponse.json({ error: 'walk not found' }, { status: 404 });
    }

    const babyName: string = settings?.baby_name ?? clientBabyName ?? '아기';
    const babyAgeDays: number = settings?.birth_date
      ? Math.floor((Date.now() - new Date(settings.birth_date).getTime()) / 86400000)
      : clientBirthDate
      ? Math.floor((Date.now() - new Date(clientBirthDate).getTime()) / 86400000)
      : (walk.baby_age_days ?? 0);

    const startMs = new Date(walk.start_time).getTime();
    const endMs = walk.end_time ? new Date(walk.end_time).getTime() : Date.now();
    const durationMin = Math.max(1, Math.round((endMs - startMs) / 60000));

    const date = new Date(walk.date).toLocaleDateString('ko-KR', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      weekday: 'long',
    });

    const weatherStr = weather ?? walk.weather ?? '맑음';
    const obsLines = (observations ?? [])
      .map((observation, index) => {
        const minutes = Math.floor(observation.elapsed_sec / 60);
        const seconds = observation.elapsed_sec % 60;
        const time = minutes > 0 ? `${minutes}분 ${seconds}초` : `${seconds}초`;
        return `${index + 1}. [${time}] ${observation.description}`;
      })
      .join('\n');

    const months = Math.floor(babyAgeDays / 30);
    const devGuidance = getDiaryDevelopmentalGuidance(months);

    const prompt = `오늘 ${babyName}와 함께한 산책 기록입니다.
날짜: ${date}
${babyName} 나이: ${babyAgeDays}일 (${months}개월 ${babyAgeDays % 30}일)
산책 시간: ${durationMin}분
날씨: ${weatherStr}
${obsLines ? `\n[산책 중 관찰된 것들]\n${obsLines}` : ''}

[이 시기 ${babyName}의 발달 단계]
${devGuidance}

위 기록과 발달 단계를 바탕으로, 따뜻하고 자연스러운 한국어 산책 일기를 작성해주세요.
- ${babyName}의 이름을 자연스럽게 사용해주세요.
- 이 개월 수 아이의 감각과 정서 발달에 맞게 표현해주세요.
- 오늘 산책에서 인상적인 장면을 ${babyName}의 눈높이로 담아주세요.
- 300~400자 분량으로 써주세요.
- 제목 없이 본문만 작성해주세요.`;

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.0-flash',
      generationConfig: {
        temperature: 0.8,
        maxOutputTokens: 600,
      },
    });

    const result = await Promise.race([
      model.generateContent(prompt),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 30000)),
    ]);

    const diary = result.response.text().trim();

    await supabase
      .from('walks')
      .update({
        diary,
        diary_status: 'done',
        end_time: walk.end_time ?? new Date().toISOString(),
        baby_age_days: babyAgeDays,
        ...(weather ? { weather } : {}),
      })
      .eq('id', walkId);

    return NextResponse.json({ diary });
  } catch (err) {
    console.error('[diary]', err);
    await supabase.from('walks').update({ diary_status: 'failed' }).eq('id', walkId);
    return NextResponse.json({ error: 'diary generation failed' }, { status: 500 });
  }
}
