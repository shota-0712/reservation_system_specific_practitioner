/**
 * reservation-time.ts
 * v3 canonical time helpers: startsAt/endsAt/timezone <-> local display
 */

/**
 * Get the UTC offset in minutes for a given timezone at a specific UTC instant.
 * Returns negative values for timezones ahead of UTC (e.g. Asia/Tokyo = -540).
 */
function _tzOffsetMin(timezone: string, utcDate: Date): number {
    const dtf = new Intl.DateTimeFormat("en-US", {
        timeZone: timezone,
        year: "numeric",
        month: "numeric",
        day: "numeric",
        hour: "numeric",
        minute: "numeric",
        second: "numeric",
        hour12: false,
    });
    const parts = dtf.formatToParts(utcDate);
    const get = (type: string) =>
        parseInt(parts.find((p) => p.type === type)?.value ?? "0", 10);
    const hour = get("hour") % 24; // Intl may return 24 for midnight
    const localMs = Date.UTC(get("year"), get("month") - 1, get("day"), hour, get("minute"), get("second"));
    return (utcDate.getTime() - localMs) / 60_000;
}

/**
 * Convert an ISO 8601 datetime string to a local date string (YYYY-MM-DD)
 * in the given timezone.
 */
export function toLocalDate(startsAt: string, timezone = "Asia/Tokyo"): string {
    const d = new Date(startsAt);
    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).formatToParts(d);
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
    return `${get("year")}-${get("month")}-${get("day")}`;
}

/**
 * Convert an ISO 8601 datetime string to a local time string (HH:mm)
 * in the given timezone.
 */
export function toLocalTime(startsAt: string, timezone = "Asia/Tokyo"): string {
    const d = new Date(startsAt);
    const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: timezone,
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
    }).formatToParts(d);
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
    const hour = String(parseInt(get("hour"), 10) % 24).padStart(2, "0");
    return `${hour}:${get("minute")}`;
}

/**
 * Convert a local date (YYYY-MM-DD) + local time (HH:mm) in the given timezone
 * to a UTC ISO 8601 string.
 *
 * This is the v3 contract: the admin form collects date + time + (implicit) timezone,
 * and we submit startsAt to the backend.
 */
export function toStartsAt(date: string, time: string, timezone = "Asia/Tokyo"): string {
    // Treat the input as UTC first, then correct for timezone offset
    const naiveUtc = new Date(`${date}T${time}:00Z`);
    // _tzOffsetMin returns negative for ahead-of-UTC zones, so negate to get local-UTC diff
    const localAheadMin = -_tzOffsetMin(timezone, naiveUtc);
    const utcMs = naiveUtc.getTime() - localAheadMin * 60_000;
    return new Date(utcMs).toISOString();
}
