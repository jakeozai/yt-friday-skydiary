import { createServerSupabase } from './supabase/server';
import { isMissingSupabaseTable } from './supabase/errors';

// Monthly hard limit: ₩2,500 at ₩1,380/USD ≈ $1.81
// Use 31 days so even the longest months stay under ₩2,500
const DAILY_LIMIT_USD = 1.81 / 31; // ≈ $0.0584

// Cost estimates with 2x safety margin over actual Gemini 2.5 Flash pricing
export const ANALYZE_COST_USD = 0.0001;  // ~$0.000058 actual, rounded up
export const DIARY_COST_USD   = 0.0005;  // ~$0.00029 actual, rounded up

const OVER_LIMIT_MESSAGE =
  '오늘은 친구들이 너무 많이 와서 AI가 많이 지쳤어요 😴 ' +
  '엄마 아빠, 한국 시간으로 자정이 지나면 다시 산책 나가요! 🌙';

/** Returns today's date string in KST (UTC+9), e.g. "2026-06-28" */
function todayKST(): string {
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

/**
 * Check whether adding `costUsd` would exceed today's budget.
 * If allowed, records the cost atomically (read-then-write — acceptable for low traffic).
 * If the daily_costs table doesn't exist yet, allows the call (graceful degradation).
 *
 * Returns { allowed: true } or { allowed: false, message: string }
 */
export async function checkAndCharge(
  costUsd: number
): Promise<{ allowed: true } | { allowed: false; message: string }> {
  try {
    const supabase = createServerSupabase();
    const today = todayKST();

    const { data, error: readError } = await supabase
      .from('daily_costs')
      .select('cost_usd')
      .eq('date', today)
      .maybeSingle();

    if (readError) {
      if (isMissingSupabaseTable(readError)) return { allowed: true }; // table not created yet
      console.error('[budget] read error:', readError);
      return { allowed: true }; // fail open on unexpected errors
    }

    const current = data?.cost_usd ?? 0;

    if (current + costUsd > DAILY_LIMIT_USD) {
      return { allowed: false, message: OVER_LIMIT_MESSAGE };
    }

    // Record the cost
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
    return { allowed: true }; // fail open so a DB issue doesn't break the app
  }
}
