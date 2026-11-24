export const MACRO_REMINDER_MINUTES = [30, 5] as const;

export function dueMacroReminderMinutes(eventAt: Date, now: Date, graceMinutes = 5): number | null {
  const minutesUntilEvent = (eventAt.getTime() - now.getTime()) / 60_000;
  if (!Number.isFinite(minutesUntilEvent) || minutesUntilEvent <= 0) return null;

  return MACRO_REMINDER_MINUTES.find(
    offset => minutesUntilEvent <= offset && minutesUntilEvent >= offset - graceMinutes,
  ) ?? null;
}
