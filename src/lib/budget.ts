import { createServerSupabase } from './supabase/server';
import { isMissingSupabaseTable } from './supabase/errors';

// Monthly hard limit: ₩2,500 at ₩1,380/USD ≈ $1.81
// Use 31 days so even the longest months stay under ₩2,500
const DAILY_LIMIT_USD = 1.81 / 31; // ≈ $0.0584

// Cost estimates with 2x safety margin over actual Gemini 2.5 Flash pricing
export const ANALYZE_COST_USD = 0.0001;
export const DIARY_COST_USD   = 0.0005;

const OVER_LIMIT_MESSAGE = '현재 사용자가 많아 내일 다시 이용해주세요.';

// Unlimited access list — these babies are never subject to the budget cap
const UNLIMITED: Array<{ name: string; birthDate: string }> = [
  { name: '재이', birthDate: '2026-03-02' },
];

function isUnlimited(babyName?: string | null, birthDate?: string | null): boolean {
  if (!babyName || !birthDate) return false;
  return UNLIMITED.some(
    (u) => u.name === babyName.trim() && u.birthDate === birthDate.trim()
  );
}

/** Returns today's date string in KST (UTC+9), e.g. "2026-06-28" */
function todayKST(): string {
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

/**
 * Check whether adding `costUsd` would exceed today's budget, then record the cost.
 * Pass babyName + birthDate to skip the cap for whitelisted users.
 * Fails open (table missing or DB error → allow call).
 */
export async function checkAndCharge(
  costUsd: number,
  babyName?: string | null,
  birthDate?: string | null,
): Promise<{ allowed: true } | { allowed: false; message: string }> {
  if (isUnlimited(babyName, birthDate)) return { allowed: true };

  try {
    const supabase = createServerSupabase();
    const today = todayKST();

    const { data, error: readError } = await supabase
      .from('daily_costs')
      .select('cost_usd')
      .eq('date', today)
      .maybeSingle();

    if (readError) {
      if (isMissingSupabaseTable(readError)) return { allowed: true };
      console.error('[budget] read error:', readError);
      return { allowed: true };
    }

    const current = data?.cost_usd ?? 0;

    if (current + costUsd > DAILY_LIMIT_USD) {
      return { allowed: false, message: OVER_LIMIT_MESSAGE };
    }

    if (data) {
      await supabase
        .from('daily_costs')
        .update({ cost_usd: current + costUsd })
        .eq('date', today);
    } else {
      await supabase
        .from('daily_costs')
        .insert({ date: today, cost_usd: costUsd });
    }

    return { allowed: true };
  } catch (err) {
    console.error('[budget] unexpected error:', err);
    return { allowed: true };
  }
}
