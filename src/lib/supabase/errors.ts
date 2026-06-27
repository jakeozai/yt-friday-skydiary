export function isMissingSupabaseTable(error: { message?: string } | null) {
  return Boolean(
    error?.message?.includes('Could not find the table') ||
      error?.message?.includes('schema cache')
  );
}
