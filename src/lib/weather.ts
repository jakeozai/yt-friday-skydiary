const WMO_MAP: Record<number, string> = {
  0: '맑음',
  1: '대체로 맑음',
  2: '구름 많음',
  3: '흐림',
  45: '안개',
  48: '안개',
  51: '이슬비',
  53: '이슬비',
  55: '이슬비',
  61: '비',
  63: '비',
  65: '강한 비',
  71: '눈',
  73: '눈',
  75: '강한 눈',
  77: '싸락눈',
  80: '소나기',
  81: '소나기',
  82: '강한 소나기',
  85: '눈 소나기',
  86: '눈 소나기',
  95: '뇌우',
  96: '뇌우',
  99: '뇌우',
};

export async function fetchWeatherByCoords(lat: number, lon: number): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    const res = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}&current=weather_code&timezone=auto`,
      { signal: controller.signal }
    );
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = await res.json();
    const code: number = data?.current?.weather_code ?? 0;
    return WMO_MAP[code] ?? '맑음';
  } catch {
    return null;
  }
}

export function getGeolocation(): Promise<{ latitude: number; longitude: number } | null> {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      resolve(null);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
      () => resolve(null),
      { timeout: 6000, maximumAge: 300000 }
    );
  });
}
