import { i18n } from "@lingui/core";
import { t } from "@lingui/core/macro";

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/**
 * When something happened or will happen, as short as stays clear: the time today, "Yesterday" or
 * "Tomorrow" with the time, otherwise the date (with the year when it is not this year).
 */
export function formatTimestamp(
  iso: string,
  now = new Date(),
  locale = i18n.locale || "en",
): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const time = date.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });
  if (sameDay(date, now)) return time;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(date, yesterday)) return t`Yesterday ${time}`;
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  if (sameDay(date, tomorrow)) return t`Tomorrow ${time}`;
  const day = date.toLocaleDateString(locale, {
    month: "short",
    day: "numeric",
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  });
  return `${day}, ${time}`;
}

/** The full date and time, for a tooltip. */
export function formatFullTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(i18n.locale || "en", { dateStyle: "full", timeStyle: "short" });
}
