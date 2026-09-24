export type MarketSession = {
  id: string;
  label: string;
  city: string;
  timeZone: string;
  openMinute: number;
  closeMinute: number;
  localHours: string;
};

export const MARKET_SESSIONS: MarketSession[] = [
  { id: "tokyo", label: "TOKIO", city: "TSE · Japón", timeZone: "Asia/Tokyo", openMinute: 9 * 60, closeMinute: 15 * 60, localHours: "09:00–15:00" },
  { id: "london", label: "LONDRES", city: "LSE · Reino Unido", timeZone: "Europe/London", openMinute: 8 * 60, closeMinute: 16 * 60 + 30, localHours: "08:00–16:30" },
  { id: "europe", label: "MADRID / FRÁNCFORT", city: "BME · Xetra", timeZone: "Europe/Madrid", openMinute: 9 * 60, closeMinute: 17 * 60 + 30, localHours: "09:00–17:30" },
  { id: "new-york", label: "NUEVA YORK", city: "NYSE · Nasdaq", timeZone: "America/New_York", openMinute: 9 * 60 + 30, closeMinute: 16 * 60, localHours: "09:30–16:00" },
];

const UTC_TIME_ZONE = "UTC";

export function startOfUtcDay(now: number): number {
  const date = new Date(now);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

export function marketSessionState(now: number, session: MarketSession) {
  const local = timeParts(now, session.timeZone);
  const utc = timeParts(now, UTC_TIME_ZONE);
  const localMinute = local.hour * 60 + local.minute;
  const utcMinute = utc.hour * 60 + utc.minute;
  const utcOffset = utcMinute - localMinute;
  const businessDay = !["Sat", "Sun"].includes(local.weekday);
  return {
    open: businessDay && localMinute >= session.openMinute && localMinute < session.closeMinute,
    localTime: formatMinute(localMinute),
    utcHours: `${formatMinute(session.openMinute + utcOffset)}–${formatMinute(session.closeMinute + utcOffset)}`,
  };
}

function timeParts(now: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  return {
    weekday: parts.find((part) => part.type === "weekday")?.value ?? "Sun",
    hour: Number(parts.find((part) => part.type === "hour")?.value ?? 0) % 24,
    minute: Number(parts.find((part) => part.type === "minute")?.value ?? 0),
  };
}

function formatMinute(value: number) {
  const normalized = ((value % 1440) + 1440) % 1440;
  return `${String(Math.floor(normalized / 60)).padStart(2, "0")}:${String(normalized % 60).padStart(2, "0")}`;
}
