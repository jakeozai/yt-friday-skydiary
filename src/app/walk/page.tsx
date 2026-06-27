'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getGeolocation, fetchWeatherByCoords } from '@/lib/weather';

const INITIAL_DELAY_MS = 5000;
const CAPTURE_INTERVAL_MS = 30000;
const MAX_IMAGE_WIDTH = 640;
const JPEG_QUALITY = 0.5;

type SubtitleEntry = { id: number; text: string; elapsed: number };

// ─── Browser TTS fallback ─────────────────────────────────────────────────────

function pickKoreanVoice() {
  if (!('speechSynthesis' in window)) return null;
  const voices = window.speechSynthesis.getVoices();
  return (
    voices.find((v) => v.lang === 'ko-KR' && /female|woman|sunhi|유나|서연/i.test(v.name)) ||
    voices.find((v) => v.lang === 'ko-KR') ||
    voices.find((v) => v.lang.startsWith('ko')) ||
    null
  );
}

function speakKorean(text: string): Promise<void> {
  return new Promise((resolve) => {
    if (!('speechSynthesis' in window)) { resolve(); return; }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'ko-KR';
    utterance.rate = 0.95;
    const voice = pickKoreanVoice();
    if (voice) utterance.voice = voice;
    const fallback = setTimeout(resolve, 30000);
    utterance.onend = () => { clearTimeout(fallback); resolve(); };
    utterance.onerror = () => { clearTimeout(fallback); resolve(); };
    window.speechSynthesis.speak(utterance);
  });
}

// ─── API TTS via Gemini ───────────────────────────────────────────────────────

async function playApiTts(text: string): Promise<boolean> {
  try {
    const res = await fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) return false;

    const arrayBuffer = await res.arrayBuffer();
    return new Promise<boolean>((resolve) => {
      const blob = new Blob([arrayBuffer], { type: 'audio/mpeg' });
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.onended = () => { URL.revokeObjectURL(url); resolve(true); };
      audio.onerror = () => { URL.revokeObjectURL(url); resolve(false); };
      audio.play().catch(() => { URL.revokeObjectURL(url); resolve(false); });
    });
  } catch {
    return false;
  }
}

async function speak(text: string): Promise<void> {
  const ok = await playApiTts(text);
  if (!ok) await speakKorean(text);
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function WalkPage() {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const walkIdRef = useRef<string | null>(null);
  const babyAgeDaysRef = useRef<number>(0);
  const babyNameRef = useRef<string>('아기');
  const birthDateRef = useRef<string | null>(null);
  const weatherRef = useRef<string | null>(null);
  const isActiveRef = useRef(false);
  const elapsedRef = useRef(0);
  const subtitleCountRef = useRef(0);
  const historyRef = useRef<HTMLDivElement>(null);

  const [status, setStatus] = useState<'loading' | 'active' | 'generating' | 'error'>('loading');
  const [elapsed, setElapsed] = useState(0);
  const [subtitles, setSubtitles] = useState<SubtitleEntry[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [voiceReady, setVoiceReady] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  const formatTime = (s: number) =>
    `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`;

  const captureFrame = useCallback((): string | null => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.readyState < 2) return null;
    const scale = Math.min(1, MAX_IMAGE_WIDTH / video.videoWidth);
    canvas.width = Math.floor(video.videoWidth * scale);
    canvas.height = Math.floor(video.videoHeight * scale);
    canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', JPEG_QUALITY).split(',')[1] ?? null;
  }, []);

  const captureAndAnalyze = useCallback(async (): Promise<void> => {
    if (!walkIdRef.current) return;
    setIsAnalyzing(true);
    try {
      const imageBase64 = captureFrame();
      if (!imageBase64) return;

      const analyzeRes = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageBase64,
          babyAgeDays: babyAgeDaysRef.current,
          babyName: babyNameRef.current,
          walkId: walkIdRef.current,
          elapsedSec: elapsedRef.current,
        }),
      });
      if (!analyzeRes.ok) return;

      const { text, image_url } = await analyzeRes.json();
      if (!text) return;

      subtitleCountRef.current += 1;
      const entry: SubtitleEntry = {
        id: subtitleCountRef.current,
        text,
        elapsed: elapsedRef.current,
      };
      setSubtitles((prev) => [...prev, entry]);

      fetch(`/api/walk/${walkIdRef.current}/observations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          elapsed_sec: elapsedRef.current,
          description: text,
          image_url: image_url ?? null,
        }),
      }).catch(() => {});

      await speak(text);
    } finally {
      setIsAnalyzing(false);
    }
  }, [captureFrame]);

  // Auto-scroll history to bottom when new entry arrives
  useEffect(() => {
    if (historyRef.current) {
      historyRef.current.scrollTop = historyRef.current.scrollHeight;
    }
  }, [subtitles]);

  useEffect(() => {
    const reacquire = async () => {
      if (document.visibilityState === 'visible' && 'wakeLock' in navigator) {
        wakeLockRef.current = await navigator.wakeLock.request('screen').catch(() => null);
      }
    };
    document.addEventListener('visibilitychange', reacquire);
    return () => document.removeEventListener('visibilitychange', reacquire);
  }, []);

  useEffect(() => {
    if (!('speechSynthesis' in window)) return;
    const mark = () => setVoiceReady(window.speechSynthesis.getVoices().length > 0);
    mark();
    window.speechSynthesis.addEventListener('voiceschanged', mark);
    return () => window.speechSynthesis.removeEventListener('voiceschanged', mark);
  }, []);

  useEffect(() => {
    let active = true;

    const setup = async () => {
      try {
        const settings = await fetch('/api/settings')
          .then((res) => (res.ok ? res.json() : null))
          .catch(() => null);

        let birthDate: string | null = settings?.birth_date ?? null;
        let babyName: string = settings?.baby_name ?? '아기';

        if (!birthDate) {
          try {
            const local = JSON.parse(localStorage.getItem('baby_settings') || 'null');
            if (local?.birth_date) {
              birthDate = local.birth_date;
              babyName = local.baby_name ?? '아기';
            }
          } catch {}
        }

        if (birthDate) {
          babyAgeDaysRef.current = Math.floor(
            (Date.now() - new Date(birthDate).getTime()) / 86400000
          );
        }
        babyNameRef.current = babyName;
        birthDateRef.current = birthDate;

        const walkRes = await fetch('/api/walk', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ baby_age_days: babyAgeDaysRef.current }),
        });
        if (walkRes.status === 401) { router.replace('/login?next=/walk'); return; }
        const walk = await walkRes.json();
        walkIdRef.current = walk.id;

        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1280, max: 1920 },
            height: { ideal: 720, max: 1080 },
          },
          audio: false,
        });
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;

        if ('wakeLock' in navigator) {
          wakeLockRef.current = await navigator.wakeLock.request('screen').catch(() => null);
        }

        getGeolocation().then((coords) => {
          if (!coords) return;
          fetchWeatherByCoords(coords.latitude, coords.longitude).then((w) => {
            weatherRef.current = w;
          });
        });

        timerRef.current = setInterval(() => {
          elapsedRef.current += 1;
          setElapsed(elapsedRef.current);
        }, 1000);

        isActiveRef.current = true;
        setStatus('active');

        const loop = async () => {
          await new Promise<void>((r) => setTimeout(r, INITIAL_DELAY_MS));
          while (active && isActiveRef.current) {
            const nextAt = Date.now() + CAPTURE_INTERVAL_MS;
            await captureAndAnalyze();
            const wait = nextAt - Date.now();
            if (wait > 0 && active && isActiveRef.current) {
              await new Promise<void>((r) => setTimeout(r, wait));
            }
          }
        };
        loop();
      } catch (err) {
        setStatus('error');
        setErrorMsg(
          err instanceof Error && err.message.toLowerCase().includes('permission')
            ? '카메라 권한을 허용해주세요.'
            : '카메라를 시작할 수 없어요.'
        );
      }
    };

    setup();

    return () => {
      active = false;
      isActiveRef.current = false;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      wakeLockRef.current?.release().catch(() => {});
      if (timerRef.current) clearInterval(timerRef.current);
      window.speechSynthesis?.cancel();
    };
  }, [captureAndAnalyze, router]);

  const handleStop = async () => {
    isActiveRef.current = false;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    wakeLockRef.current?.release().catch(() => {});
    if (timerRef.current) clearInterval(timerRef.current);
    window.speechSynthesis?.cancel();

    const walkId = walkIdRef.current;
    if (!walkId || walkId.startsWith('local-')) { router.replace('/'); return; }

    setStatus('generating');
    try {
      await fetch(`/api/walk/${walkId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ end_time: new Date().toISOString() }),
      });
      await fetch(`/api/walk/${walkId}/diary`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          weather: weatherRef.current,
          babyName: babyNameRef.current,
          birthDate: birthDateRef.current,
        }),
      });
      router.replace(`/walk/${walkId}`);
    } catch {
      router.replace('/');
    }
  };

  const latestSubtitle = subtitles[subtitles.length - 1];

  // ── Always render video so srcObject is assignable during setup ──
  return (
    <div className="relative h-screen overflow-hidden bg-black">
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className="absolute inset-0 h-full w-full object-cover"
      />
      <canvas ref={canvasRef} className="hidden" />

      {/* ── Error overlay ── */}
      {status === 'error' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-white p-6 text-center">
          <p className="mb-4 text-5xl">!</p>
          <p className="text-lg font-semibold text-gray-800">카메라를 사용할 수 없어요.</p>
          <p className="mt-2 text-sm text-gray-400">{errorMsg}</p>
          <button
            onClick={() => router.back()}
            className="mt-8 rounded-xl bg-green-300 px-8 py-3 font-medium text-white"
          >
            돌아가기
          </button>
        </div>
      )}

      {/* ── Generating diary overlay ── */}
      {status === 'generating' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-[#FAFAF8]">
          <p className="text-5xl">🌿</p>
          <p className="text-lg font-semibold text-gray-800">일기를 쓰고 있어요</p>
          <p className="text-sm text-gray-400">오늘 산책을 기록으로 남겨드릴게요...</p>
          <div className="mt-4 flex gap-1">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="h-2 w-2 animate-bounce rounded-full bg-green-300"
                style={{ animationDelay: `${i * 0.15}s` }}
              />
            ))}
          </div>
        </div>
      )}

      {/* ── Loading overlay ── */}
      {status === 'loading' && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="text-sm text-white/60">카메라 준비 중...</div>
        </div>
      )}

      {/* ── Active walk UI ── */}
      {status === 'active' && (
        <>
          {/* Top bar */}
          <div className="absolute left-0 right-0 top-0 flex items-center justify-between bg-gradient-to-b from-black/60 to-transparent px-5 pb-6 pt-10">
            <span className="font-mono text-2xl font-bold tracking-widest text-white">
              {formatTime(elapsed)}
            </span>
            <div className="flex items-center gap-3">
              {subtitles.length > 0 && (
                <button
                  onClick={() => setShowHistory((v) => !v)}
                  className="rounded-full bg-white/20 px-3 py-1 text-xs text-white backdrop-blur-sm"
                >
                  해설 {subtitles.length}회 {showHistory ? '▲' : '▼'}
                </button>
              )}
              <span className="text-sm text-white/70">
                {isAnalyzing ? '분석 중...' : ''}
              </span>
            </div>
          </div>

          {/* History panel */}
          {showHistory && subtitles.length > 0 && (
            <div
              ref={historyRef}
              className="absolute left-0 right-0 top-20 mx-4 max-h-56 overflow-y-auto rounded-2xl bg-black/60 backdrop-blur-md"
            >
              <div className="space-y-2 p-3">
                {subtitles.map((entry) => (
                  <div key={entry.id} className="flex gap-2">
                    <span className="mt-0.5 shrink-0 font-mono text-[10px] text-white/40">
                      {formatTime(entry.elapsed)}
                    </span>
                    <p className="text-xs leading-relaxed text-white/80">{entry.text}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Bottom: latest subtitle + controls */}
          <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent px-5 pb-10 pt-8">
            {latestSubtitle ? (
              <p className="mb-5 px-2 text-center text-sm leading-relaxed text-white">
                {latestSubtitle.text}
              </p>
            ) : (
              <p className="mb-5 text-center text-xs text-white/40">
                {isAnalyzing ? '분석 중입니다...' : '아이 눈높이로 주변을 기록하고 있어요.'}
              </p>
            )}

            {!voiceReady && (
              <p className="mb-3 text-center text-xs text-white/45">
                이 브라우저에서 한국어 음성이 늦게 준비될 수 있어요.
              </p>
            )}

            <button
              onClick={handleStop}
              className="w-full rounded-2xl border border-white/25 bg-white/15 py-4 font-semibold text-white backdrop-blur-md transition-transform active:scale-95"
            >
              산책 종료
            </button>
          </div>
        </>
      )}
    </div>
  );
}
