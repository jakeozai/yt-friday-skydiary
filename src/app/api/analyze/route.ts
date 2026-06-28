import { NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { requireAuth } from '@/lib/auth';
import { uploadToR2 } from '@/lib/r2';
import { checkAndCharge, ANALYZE_COST_USD } from '@/lib/budget';

export const maxDuration = 30;

const MAX_IMAGE_BASE64_CHARS = 900_000;
const WALK_ID_PATTERN = /^[a-zA-Z0-9_-]{1,80}$/;
const GEMINI_MODEL = process.env.GEMINI_MODEL?.trim() || 'gemini-2.5-flash';
const GEMINI_TIMEOUT_MS = 15_000;

const fallbackLines = [
  '산책 중이에요. 아이 눈높이에서 주변을 천천히 보고 있어요.',
  '바람과 빛이 지나가고 있어요. 지금 보이는 장면을 조용히 기록하고 있어요.',
  '앞에 보이는 풍경을 관찰하고 있어요. 오늘 산책의 한 순간을 남겨둘게요.',
];

function isValidElapsedSec(value: unknown) {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 60 * 60 * 6;
}

function getDevelopmentalContext(months: number): string {
  if (months < 1) return '시야가 약 30cm까지만 선명해요. 빛의 밝기 차이와 큰 소리, 목소리에 반응하는 시기예요.';
  if (months < 3) return '움직이는 것을 눈으로 따라가기 시작하고, 친숙한 목소리와 얼굴에 미소를 지어요.';
  if (months < 6) return '밝은 색과 움직임에 활발히 반응하고, 손을 뻗어 물건을 잡으려 시도해요.';
  if (months < 9) return '얼굴을 알아보고, 소리 나는 곳으로 고개를 돌려요. 새로운 것에 강한 호기심을 보여요.';
  if (months < 12) return '손가락으로 관심 있는 것을 가리키고, 이름을 부르면 반응해요. 물건의 형태와 질감을 탐색해요.';
  if (months < 18) return '혼자 서거나 걷기 시작해요. 모든 것을 만지고 탐색하며 간단한 단어를 따라 말해요.';
  if (months < 24) return '뛰어다니고 두 단어를 이어 말해요. 상상력이 풍부해지고 흉내내기를 즐겨요.';
  return '활발히 말하고 놀이로 세상을 배워요. 또래에게 관심을 가지기 시작해요.';
}

export async function POST(request: Request) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;

  try {
    const { imageBase64, babyAgeDays, babyName, walkId, elapsedSec } = await request.json();

    if (typeof imageBase64 !== 'string' || imageBase64.length > MAX_IMAGE_BASE64_CHARS) {
      return NextResponse.json({ error: 'Invalid image payload' }, { status: 413 });
    }

    const shouldUpload =
      typeof walkId === 'string' &&
      WALK_ID_PATTERN.test(walkId) &&
      isValidElapsedSec(elapsedSec);

    if (!process.env.GEMINI_API_KEY) {
      const text = fallbackLines[Math.floor(Math.random() * fallbackLines.length)];
      return NextResponse.json({ text, image_url: null, source: 'local-fallback' });
    }

    const budget = await checkAndCharge(ANALYZE_COST_USD);
    if (!budget.allowed) {
      return NextResponse.json({ error: 'daily_limit_exceeded', message: budget.message }, { status: 429 });
    }

    const ageDays = typeof babyAgeDays === 'number' && babyAgeDays >= 0 ? babyAgeDays : 0;
    const months = Math.floor(ageDays / 30);
    const name = typeof babyName === 'string' && babyName.trim() ? babyName.trim() : '아기';
    const devContext = getDevelopmentalContext(months);

    const prompt = `당신은 아기와 함께하는 순간을 따뜻하게 기록하는 해설자입니다.
지금 ${ageDays}일(${months}개월) 된 ${name}의 눈높이 카메라로 촬영한 장면입니다.

[이 시기 ${name}의 발달 특성]
${devContext}

카메라에 무엇이 보이든 — 자연, 거리, 사람, 건물, 가게, 자동차, 실내 공간, 사물 등 — 모두 ${name}에게는 처음 만나는 세상입니다.
지금 이 장면에서 ${name}가 무엇을 보고, 느끼고, 경험하고 있을지 아이의 시선으로 따뜻하게 표현해주세요.
기술적인 설명은 피하고, 2문장 이내로 짧게 말해주세요.`;

    const imagePart = {
      inlineData: { data: imageBase64, mimeType: 'image/jpeg' as const },
    };

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: GEMINI_MODEL });

    // Image storage is optional. A slow R2 upload must never block narration.
    const [analysisResult, uploadResult] = await Promise.allSettled([
      Promise.race([
        model.generateContent([prompt, imagePart]),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Gemini analysis timeout')), GEMINI_TIMEOUT_MS)
        ),
      ]),
      shouldUpload ? uploadToR2(imageBase64, walkId, elapsedSec) : Promise.resolve(null),
    ]);

    const image_url = uploadResult.status === 'fulfilled' ? uploadResult.value : null;

    if (analysisResult.status === 'rejected') {
      console.error('[analyze] Gemini failed, using fallback:', analysisResult.reason);
      const text = fallbackLines[Math.floor(Math.random() * fallbackLines.length)];
      return NextResponse.json({ text, image_url, source: 'fallback' });
    }

    const text = analysisResult.value.response.text().trim();
    if (!text) {
      const fallbackText = fallbackLines[Math.floor(Math.random() * fallbackLines.length)];
      return NextResponse.json({ text: fallbackText, image_url, source: 'fallback' });
    }

    return NextResponse.json({ text, image_url, source: 'gemini' });
  } catch (err) {
    console.error('[analyze]', err);
    // Return fallback so the client can still save the observation and speak something
    const text = fallbackLines[Math.floor(Math.random() * fallbackLines.length)];
    return NextResponse.json({ text, image_url: null, source: 'fallback' });
  }
}
