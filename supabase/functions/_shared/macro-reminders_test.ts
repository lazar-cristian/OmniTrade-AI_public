import { dueMacroReminderMinutes } from "./macro-reminders.ts";

Deno.test("schedules high-impact reminders at 30 and 5 minutes", () => {
  const now = new Date("2026-11-24T12:00:00Z");
  const thirtyMinutes = new Date("2026-11-24T12:29:00Z");
  const fiveMinutes = new Date("2026-11-24T12:04:00Z");

  if (dueMacroReminderMinutes(thirtyMinutes, now) !== 30) {
    throw new Error("Expected the 30-minute reminder inside the 5-minute scheduler window.");
  }
  if (dueMacroReminderMinutes(fiveMinutes, now) !== 5) {
    throw new Error("Expected the 5-minute reminder inside the 5-minute scheduler window.");
  }
});

Deno.test("does not schedule reminders for past events or outside the grace window", () => {
  const now = new Date("2026-11-24T12:00:00Z");
  const thirtyOneMinutesAway = new Date("2026-11-24T12:31:00Z");
  const twentyFiveMinutesAway = new Date("2026-11-24T12:25:00Z");
  const twentyFourMinutesAway = new Date("2026-11-24T12:24:00Z");
  const past = new Date("2026-11-24T11:59:00Z");

  if (dueMacroReminderMinutes(thirtyOneMinutesAway, now) !== null
    || dueMacroReminderMinutes(twentyFiveMinutesAway, now) !== 30
    || dueMacroReminderMinutes(twentyFourMinutesAway, now) !== null
    || dueMacroReminderMinutes(past, now) !== null) {
    throw new Error("An event outside a reminder window was scheduled.");
  }
});
