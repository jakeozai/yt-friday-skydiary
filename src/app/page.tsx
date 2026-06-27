'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

type WalkSummary = {
  id: string;
  date: string;
  start_time: string;
  end_time: string | null;
  diary_status: string;
  weather: string | null;
  diary: string | null;
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

export default function Home() {
  const router = useRouter();
  const [hasSettings, setHasSettings] = useState<boolean | null>(null);
  const [walks, setWalks] = useState<WalkSummary[]>([]);
  const [walksLoading, setWalksLoading] = useState(true);

  useEffect(() => {
    fetch('/api/settings')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data?.birth_date) {
          try {
            const local = JSON.parse(localStorage.getItem('baby_settings') || 'null');
            if (local?.birth_date) {
              setHasSettings(true);
              return;
            }
          } catch {}
          router.replace('/settings');
          return;
        }
        setHasSettings(true);
      })
      .catch(() => setHasSettings(true));
  }, [router]);

  useEffect(() => {
    fetch('/api/walk')
      .then((res) => {
        if (res.status === 401) {
          router.replace('/login?next=/');
          return [];
        }
        return res.ok ? res.json() : [];
      })
      .then((data) => {
        setWalks(Array.isArray(data) ? data : []);
        setWalksLoading(false);
      })
      .catch(() => setWalksLoading(false));
  }, [router]);

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.replace('/login');
  };

  if (hasSettings === null) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-sm text-gray-400">로딩 중...</div>
      </div>
    );
  }

  return (
    <main className="flex min-h-screen flex-col p-6">
      <div className="mb-6 flex items-center justify-between pt-2">
        <h1 className="text-2xl font-bold text-gray-800">산책 일기</h1>
        <div className="flex items-center gap-4">
          <Link href="/settings" className="text-sm font-medium text-gray-400">
            설정
          </Link>
          <button onClick={handleLogout} className="text-sm font-medium text-gray-400">
            잠금
          </button>
        </div>
      </div>

      <div className="flex flex-col items-center py-6">
        <button
          onClick={() => router.push('/walk')}
          className="h-44 w-44 rounded-full bg-green-300 text-xl font-bold text-white shadow-lg shadow-green-200 transition-transform active:scale-95"
        >
          산책 시작
        </button>
      </div>

      <section className="mt-2">
        <h2 className="mb-3 text-base font-semibold text-gray-700">산책 기록</h2>

        {walksLoading ? (
          <div className="py-6 text-center text-sm text-gray-300">불러오는 중...</div>
        ) : walks.length === 0 ? (
          <div className="py-10 text-center text-gray-400">
            <p className="mb-3 text-5xl">🌿</p>
            <p className="text-sm">아직 산책 기록이 없어요.</p>
            <p className="mt-1 text-xs text-gray-300">첫 산책을 시작해보세요.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {walks.map((walk) => {
              const dateStr = new Date(walk.date).toLocaleDateString('ko-KR', {
                month: 'long',
                day: 'numeric',
                weekday: 'short',
              });
              const durationMin = walk.end_time
                ? Math.max(
                    1,
                    Math.round(
                      (new Date(walk.end_time).getTime() -
                        new Date(walk.start_time).getTime()) /
                        60000
                    )
                  )
                : null;
              const weatherLabel = walk.weather ?? '맑음';
              const weatherEmoji = WEATHER_EMOJI[weatherLabel] ?? '🌤️';

              return (
                <Link
                  key={walk.id}
                  href={`/walk/${walk.id}`}
                  className="block rounded-2xl border border-gray-100 bg-white p-4 shadow-sm transition-transform active:scale-[0.98]"
                >
                  <div className="mb-1.5 flex items-center justify-between">
                    <span className="text-sm font-semibold text-gray-700">{dateStr}</span>
                    <span className="text-xs text-gray-400">
                      {weatherEmoji} {weatherLabel}
                      {durationMin != null && ` · ${durationMin}분`}
                    </span>
                  </div>
                  {walk.diary && (
                    <p className="line-clamp-2 text-xs leading-relaxed text-gray-500">
                      {walk.diary}
                    </p>
                  )}
                </Link>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}
