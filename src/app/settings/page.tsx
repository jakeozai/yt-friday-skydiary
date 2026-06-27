'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

export default function Settings() {
  const router = useRouter();
  const [babyName, setBabyName] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch('/api/settings')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.birth_date) {
          setBabyName(data.baby_name ?? '');
          setBirthDate(data.birth_date ?? '');
        } else {
          try {
            const local = JSON.parse(localStorage.getItem('baby_settings') || 'null');
            if (local?.birth_date) {
              setBabyName(local.baby_name ?? '');
              setBirthDate(local.birth_date ?? '');
            }
          } catch {}
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    if (!birthDate) {
      alert('생년월일을 입력해주세요.');
      return;
    }

    setSaving(true);
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          baby_name: babyName || '아기',
          birth_date: birthDate,
        }),
      });

      if (res.ok) {
        try {
          localStorage.setItem(
            'baby_settings',
            JSON.stringify({ baby_name: babyName || '아기', birth_date: birthDate })
          );
        } catch {}
        router.replace('/');
      } else {
        alert('저장 중 오류가 발생했어요.');
      }
    } catch {
      alert('저장 중 오류가 발생했어요.');
    } finally {
      setSaving(false);
    }
  };

  const today = new Date().toISOString().split('T')[0];

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-sm text-gray-400">로딩 중...</div>
      </div>
    );
  }

  return (
    <main className="flex min-h-screen flex-col p-6">
      <div className="mb-8 flex items-center pt-2">
        <button onClick={() => router.back()} className="mr-3 text-xl leading-none text-gray-400">
          ←
        </button>
        <h1 className="text-2xl font-bold text-gray-800">아이 정보</h1>
      </div>

      <div className="space-y-6">
        <div>
          <label className="mb-2 block text-sm font-medium text-gray-600">아이 이름</label>
          <input
            type="text"
            value={babyName}
            onChange={(event) => setBabyName(event.target.value)}
            placeholder="아기"
            className="w-full rounded-xl border border-gray-200 px-4 py-3 text-gray-800 placeholder-gray-300 outline-none focus:border-transparent focus:ring-2 focus:ring-green-300"
          />
        </div>

        <div>
          <label className="mb-2 block text-sm font-medium text-gray-600">생년월일</label>
          <input
            type="date"
            value={birthDate}
            onChange={(event) => setBirthDate(event.target.value)}
            max={today}
            className="w-full rounded-xl border border-gray-200 px-4 py-3 text-gray-800 outline-none focus:border-transparent focus:ring-2 focus:ring-green-300"
          />
        </div>
      </div>

      <div className="mt-auto pt-8">
        <button
          onClick={handleSave}
          disabled={saving || !birthDate}
          className="w-full rounded-xl bg-green-300 py-4 font-semibold text-white shadow-md shadow-green-100 transition-transform active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? '저장 중...' : '저장'}
        </button>
      </div>
    </main>
  );
}
