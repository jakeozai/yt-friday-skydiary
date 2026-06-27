'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setError('');

    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });

    setLoading(false);

    if (!res.ok) {
      setError('비밀번호가 맞지 않아요.');
      return;
    }

    const next = new URLSearchParams(window.location.search).get('next');
    router.replace(next || '/');
  };

  return (
    <main className="flex min-h-screen flex-col justify-center p-6">
      <div className="mb-8">
        <p className="text-sm font-medium text-green-600">Sky Diary</p>
        <h1 className="mt-2 text-2xl font-bold text-gray-900">앱 잠금 해제</h1>
        <p className="mt-2 text-sm leading-6 text-gray-500">
          가족 산책 기록과 사진 업로드를 보호하기 위해 비밀번호가 필요합니다.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <input
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="비밀번호"
          autoFocus
          className="w-full rounded-xl border border-gray-200 px-4 py-3 text-gray-900 outline-none focus:border-green-300 focus:ring-2 focus:ring-green-200"
        />
        {error && <p className="text-sm text-red-500">{error}</p>}
        <button
          type="submit"
          disabled={loading || !password}
          className="w-full rounded-xl bg-green-400 py-3 font-semibold text-white shadow-sm disabled:opacity-50"
        >
          {loading ? '확인 중...' : '들어가기'}
        </button>
      </form>
    </main>
  );
}
