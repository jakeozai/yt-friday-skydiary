'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';

type Observation = {
  id: string;
  elapsed_sec: number;
  description: string;
  image_url: string | null;
};

type WalkData = {
  id: string;
  date: string;
  start_time: string;
  end_time: string | null;
  diary: string | null;
  diary_status: string;
  weather: string | null;
  baby_age_days: number | null;
  observations: Observation[];
};

const WEATHER_EMOJI: Record<string, string> = {
  맑음: '☀️',
  '대체로 맑음': '🌤️',
  '구름 많음': '⛅',
  흐림: '☁️',
  안개: '🌫️',
  이슬비: '🌦️',
  비: '🌧️',
  '강한 비': '⛈️',
  눈: '❄️',
  소나기: '🌦️',
  뇌우: '⛈️',
};

function formatElapsed(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}:${rest.toString().padStart(2, '0')}`;
}

export default function DiaryPage() {
  const router = useRouter();
  const params = useParams();
  const walkId = params.id as string;
  const [walk, setWalk] = useState<WalkData | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    fetch(`/api/walk/${walkId}`)
      .then((res) => {
        if (res.status === 401) {
          router.replace(`/login?next=/walk/${walkId}`);
          return null;
        }
        if (!res.ok) throw new Error('not found');
        return res.json();
      })
      .then((data) => {
        if (data) setWalk(data);
        setLoading(false);
      })
      .catch(() => {
        setNotFound(true);
        setLoading(false);
      });
  }, [router, walkId]);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#FAFAF8]">
        <p className="text-sm text-gray-400">불러오는 중...</p>
      </div>
    );
  }

  if (notFound || !walk) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4 bg-[#FAFAF8]">
        <p className="text-gray-500">일기를 찾을 수 없어요.</p>
        <Link href="/" className="text-sm text-green-500">
          홈으로 가기
        </Link>
      </div>
    );
  }

  const dateStr = new Date(walk.date).toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  });
  const weatherLabel = walk.weather ?? '맑음';
  const weatherEmoji = WEATHER_EMOJI[weatherLabel] ?? '🌤️';
  const durationMin = walk.end_time
    ? Math.max(
        1,
        Math.round(
          (new Date(walk.end_time).getTime() - new Date(walk.start_time).getTime()) / 60000
        )
      )
    : null;

  return (
    <div className="flex min-h-screen flex-col bg-[#FAFAF8]">
      <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-gray-100 bg-white px-5 py-4">
        <button onClick={() => router.replace('/')} className="text-xl leading-none text-gray-400">
          ←
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-semibold text-gray-800">{dateStr}</p>
          <p className="text-xs text-gray-400">
            {weatherEmoji} {weatherLabel}
            {walk.baby_age_days != null && ` · ${walk.baby_age_days}일`}
            {durationMin != null && ` · ${durationMin}분`}
          </p>
        </div>
      </div>

      <div className="space-y-5 p-5 pb-10">
        {walk.diary ? (
          <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
            <p className="whitespace-pre-line text-[15px] leading-[1.85] text-gray-700">
              {walk.diary}
            </p>
          </div>
        ) : walk.diary_status === 'failed' ? (
          <div className="rounded-2xl bg-red-50 p-5 text-center">
            <p className="text-sm text-red-500">일기 생성에 실패했어요.</p>
            <p className="mt-1 text-xs text-red-400">해설 기록은 아래에 남아 있어요.</p>
          </div>
        ) : null}

        {walk.observations.length > 0 && (
          <div>
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-400">
              해설 기록 ({walk.observations.length})
            </h2>
            <div className="space-y-3">
              {walk.observations.map((observation) => (
                <div
                  key={observation.id}
                  className="overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm"
                >
                  {observation.image_url && (
                    <img
                      src={observation.image_url}
                      alt={`산책 장면 ${formatElapsed(observation.elapsed_sec)}`}
                      className="h-40 w-full object-cover"
                      loading="lazy"
                    />
                  )}
                  <div className="flex gap-3 p-3">
                    <span className="mt-0.5 w-10 shrink-0 font-mono text-xs text-gray-400">
                      {formatElapsed(observation.elapsed_sec)}
                    </span>
                    <p className="text-sm leading-relaxed text-gray-600">{observation.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {walk.observations.length === 0 && !walk.diary && (
          <div className="py-10 text-center text-gray-400">
            <p className="text-sm">해설 기록이 없어요.</p>
          </div>
        )}
      </div>
    </div>
  );
}
