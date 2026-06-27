'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getGeolocation, fetchWeatherByCoords } from '@/lib/weather';

const INITIAL_DELAY_MS = 5000;
const CAPTURE_INTERVAL_MS = 30000;
const MAX_IMAGE_WIDTH = 640;
const JPEG_QUALITY = 0.5;

type SubtitleEntry = { id: number; text: string; elapsed: number };

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = 20_000
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

// ─── Audio unlock (required for mobile browsers) ──────────────────────────────
// iOS/Android block audio.play() unless called from a direct user gesture.
// We keep a singleton AudioContext that is resumed on the first user tap.
let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
  }
  return audioCtx;
}

async function unlockAudio(): Promise<void> {
  try {
    const ctx = getAudioContext();
    if (ctx.state === 'suspended') await ctx.resume();
    // Play a silent buffer to fully unlock on iOS
    const buffer = ctx.createBuffer(1, 1, 22050);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.start(0);
  } catch {}
}

// ─── Browser TTS fallback ────────────────────────────────────────────────────

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

// ─── API TTS ─────────────────────────────────────────────────────────────────
// Uses AudioContext.decodeAudioData + AudioBufferSourceNode to completely bypass
// mobile browser autoplay restrictions (no HTMLMediaElement involved).

async function playApiTts(text: string): Promise<boolean> {
  try {
    const res = await fetchWithTimeout('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    }, 12_000);
    if (!res.ok) return false;

    const arrayBuffer = await res.arrayBuffer();
    const ctx = getAudioContext();
    if (ctx.state === 'suspended') await ctx.resume();

    const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
    return new Promise<boolean>((resolve) => {
      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(ctx.destination);
      source.onended = () => resolve(true);
      source.start(0);
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
  const analysisTaskRef = useRef<Promise<void> | null>(null);
  // Resolves when user taps the start button (to unlock audio before analysis)
  const startResolveRef = useRef<(() => void) | null>(null);

  const [status, setStatus] = useState<'loading' | 'ready' | 'active' | 'generating' | 'error'>('loading');
  const [elapsed, setElapsed] = useState(0);
  const [subtitles, setSubtitles] = useState<SubtitleEntry[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [voiceReady, setVoiceReady] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [pipelineNotice, setPipelineNotice] = useState('');

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
      if (!imageBase64) {
        setPipelineNotice('카메라 화면을 읽지 못했어요. 잠시 후 다시 시도할게요.');
        return;
      }

      const analyzeRes = await fetchWithTimeout('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageBase64,
          babyAgeDays: babyAgeDaysRef.current,
          babyName: babyNameRef.current,
          walkId: walkIdRef.current,
          elapsedSec: elapsedRef.current,
        }),
      }, 22_000);
      if (!analyzeRes.ok) {
        throw new Error(`해설 API 오류 (${analyzeRes.status})`);
      }

      const { text, image_url, source } = await analyzeRes.json();
      if (!text) throw new Error('해설 내용이 비어 있어요.');

      subtitleCountRef.current += 1;
      const entry: SubtitleEntry = {
        id: subtitleCountRef.current,
        text,
        elapsed: elapsedRef.current,
      };
      setSubtitles((prev) => [...prev, entry]);

      if (source === 'fallback') {
        setPipelineNotice('AI 연결이 불안정해 기본 해설로 기록했어요.');
      } else {
        setPipelineNotice('');
      }

      if (isActiveRef.current) void speak(text);

      const observationRes = await fetchWithTimeout(`/api/walk/${walkIdRef.current}/observations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          elapsed_sec: elapsedRef.current,
          description: text,
          image_url: image_url ?? null,
        }),
      }, 10_000);
      if (!observationRes.ok) {
        throw new Error(`해설 저장 오류 (${observationRes.status})`);
      }
    } catch (error) {
      console.error('[walk pipeline]', error);
      setPipelineNotice(
        error instanceof Error ? error.message : '해설을 처리하지 못했어요. 잠시 후 다시 시도할게요.'
      );
    } finally {
      setIsAnalyzing(false);
    }
  }, [captureFrame]);

  // Auto-scroll history to bottom
  useEffect(() => {
    if (historyRef.current) {
      historyRef.current.scrollTop = historyRef.current.scrollHeight;
    }
  }, [subtitles]);

  // Re-acquire wake lock on visibility change
  useEffect(() => {
    const reacquire = async () => {
      if (document.visibilityState === 'visible' && 'wakeLock' in navigator) {
        wakeLockRef.current = await navigator.wakeLock.request('screen').catch(() => null);
      }
    };
    document.addEventListener('visibilitychange', reacquire);
    return () => document.removeEventListener('visibilitychange', reacquire);
  }, []);

  // Pre-load browser TTS voices
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
        if (!walkRes.ok) throw new Error(`산책 생성 오류 (${walkRes.status})`);
        const walk = await walkRes.json();
        if (!walk?.id) throw new Error('산책 ID를 받지 못했어요.');
        walkIdRef.current = walk.id;

        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1280, max: 1920 },
            height: { ideal: 720, max: 1080 },
          },
          audio: false,
        });
        if (!active) { stream.getTracks().forEach((t) => t.stop()); return; }
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

        // Show ready screen — wait for user tap to unlock audio before starting
        setStatus('ready');
        await new Promise<void>((resolve) => { startResolveRef.current = resolve; });
        if (!active) return;

        // User tapped: start timer and analysis loop
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
            const task = captureAndAnalyze();
            analysisTaskRef.current = task;
            await task;
            if (analysisTaskRef.current === task) analysisTaskRef.current = null;
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
      startResolveRef.current?.(); // unblock setup if waiting for tap
      streamRef.current?.getTracks().forEach((t) => t.stop());
      wakeLockRef.current?.release().catch(() => {});
      if (timerRef.current) clearInterval(timerRef.current);
      window.speechSynthesis?.cancel();
    };
  }, [captureAndAnalyze, router]);

  const handleStart = useCallback(async () => {
    // Unlock audio on this direct user gesture before analysis begins
    await unlockAudio();
    startResolveRef.current?.();
  }, []);

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
      // Do not generate the diary before an in-flight observation is saved.
      const activeAnalysis = analysisTaskRef.current;
      if (activeAnalysis) {
        await Promise.race([
          activeAnalysis,
          new Promise<void>((resolve) => setTimeout(resolve, 22_000)),
        ]);
      }

      const endRes = await fetchWithTimeout(`/api/walk/${walkId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ end_time: new Date().toISOString() }),
      }, 10_000);
      if (!endRes.ok) throw new Error(`산책 종료 저장 오류 (${endRes.status})`);

      const diaryRes = await fetchWithTimeout(`/api/walk/${walkId}/diary`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          weather: weatherRef.current,
          babyName: babyNameRef.current,
          birthDate: birthDateRef.current,
        }),
      }, 45_000);
      if (!diaryRes.ok) {
        // diary failed but walk exists — navigate to walk page anyway (shows failed state)
        router.replace(`/walk/${walkId}`);
        return;
      }
      router.replace(`/walk/${walkId}`);
    } catch {
      router.replace('/');
    }
  };

  const latestSubtitle = subtitles[subtitles.length - 1];

  // ── Always render video so srcObject can be set during setup ──
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

      {/* ── Ready overlay: tap to unlock audio and start ── */}
      {status === 'ready' && (
        <div className="absolute inset-0 flex flex-col items-end justify-end bg-black/30 pb-10">
          <div className="w-full px-5">
            <p className="mb-4 text-center text-sm text-white/70">
              카메라가 준비됐어요. 시작하면 30초마다 해설이 시작됩니다.
            </p>
            <button
              onClick={handleStart}
              className="w-full rounded-2xl bg-green-400 py-5 text-lg font-bold text-white shadow-lg transition-transform active:scale-95"
            >
              해설 시작
            </button>
          </div>
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
            {pipelineNotice && (
              <p className="mb-3 rounded-xl bg-black/45 px-3 py-2 text-center text-xs text-amber-100">
                {pipelineNotice}
              </p>
            )}
            {latestSubtitle ? (
              <p className="mb-5 px-2 text-center text-sm leading-relaxed text-white">
                {latestSubtitle.text}
              </p>
            ) : (
              <p className="mb-5 text-center text-xs text-white/40">
                {isAnalyzing ? '분석 중입니다...' : '5초 후 첫 해설이 시작돼요.'}
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
