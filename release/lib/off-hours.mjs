/**
 * AN OFF-HOURS ADMIN READ, EXPLAINED — presentation only.
 *
 * WHY THIS EXISTS. The development server Admin and the Backend share runs only inside
 * the owner's AWS schedule. When a readiness evaluation runs outside it, Admin's
 * /release.txt cannot be read, the decision refuses `peers.admin_serving_unreadable`,
 * and the run goes red — correctly: nothing was observed, and that reason is not a
 * waiting condition (lib/readiness.mjs). The red run did not say why, so it read like
 * an outage. This module writes the sentence that says why (CI-signal design C, the
 * owner's decision of 26 October 2026, the variant that needs no new permission).
 *
 * WHAT IT CHANGES: two things a person reads — a note in the step summary and, when the
 * server is scheduled off, one `::warning::` annotation. NOTHING ELSE. It is handed the
 * finished decision as data and returns text. It cannot change the decision, its
 * reasons, the readiness classification, the exit status, the decisionDigest or any
 * retained artifact, and release/tests/off-hours-note.test.mjs pins each of those
 * byte-identical with the note removed. Red stays red.
 *
 * WHAT IT CLAIMS: the SCHEDULE, never the server's state. It says "scheduled off", never
 * "the server is off": it asks AWS nothing (no permission, no secret, no network), so
 * whether the instance is running is not known here.
 *
 * WHEN — only for a REFUSE whose reasons include `peers.admin_serving_unreadable`, and
 * then by the run's own decision time (`decide --now`), on the London wall clock:
 *   scheduled off, or in the window's end margin  -> the note, and the annotation
 *   inside the window                              -> one short line: treat it as an outage
 * Any other decision, or a decision time that cannot be read, gets nothing.
 *
 * Pure: no clock (the time is an argument), no filesystem, no network, no environment.
 * London time comes from the IANA tz database that Node carries in ICU — BST in summer,
 * GMT in winter — never from a fixed UTC offset. It never throws: an explanation must
 * not be able to change the exit status of the command that renders it.
 */

/**
 * THE DEVELOPMENT SERVER'S SCHEDULE, written once. It is a copy, not the authority: it
 * moves with the owner's AWS schedule for the server Admin and the Backend share, and
 * with the `DEV_SERVER_WINDOW: "11:00–23:00 Europe/London"` and
 * `DEV_SERVER_WINDOW_END_MARGIN_MINUTES: "20"` that the two deploy workflows carry (the
 * `window` jobs of Admin #49, in .github/workflows/deploy.yml, and of Backend #371).
 * When the schedule moves, change all three together, with the cases in
 * release/tests/off-hours-note.test.mjs. "Inside" is [start, end − margin) on the London
 * wall clock, minute by minute, exactly as those jobs read it.
 */
export const DEV_SERVER_WINDOW = Object.freeze({
  zone: 'Europe/London',
  start: '11:00',
  end: '23:00',
  endMarginMinutes: 20,
});

/** The one reason this module explains. */
export const ADMIN_UNREADABLE = 'peers.admin_serving_unreadable';

const ISO_Z = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const HH_MM = /^([01]\d|2[0-3]):([0-5]\d)$/;

const minuteOfDay = (hhmm) => {
  const m = HH_MM.exec(String(hhmm));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

/** `11:00–23:00 Europe/London` — the literal the deploy workflows carry. */
export function windowLiteral(window = DEV_SERVER_WINDOW) {
  return `${window.start}–${window.end} ${window.zone}`;
}

/**
 * The wall clock in `zone` at `now`, as {minuteOfDay, label}, where the label reads
 * `2026-10-27 03:12 GMT` (the form the deploy jobs print). Null when `now` is not a real
 * ISO-8601 UTC instant or the zone is unknown — never a guess, and never UTC by default.
 */
export function wallClock(now, zone = DEV_SERVER_WINDOW.zone) {
  if (typeof now !== 'string' || !ISO_Z.test(now)) return null;
  const ms = Date.parse(now);
  if (!Number.isFinite(ms)) return null;
  // Date.parse is lenient (30 February becomes 2 March): the instant must round-trip.
  if (new Date(ms).toISOString().slice(0, 19) !== now.slice(0, 19)) return null;
  let parts;
  try {
    parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
      timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZoneName: 'short',
    }).formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
  } catch {
    return null; // an unknown zone is a RangeError, never a silent fallback
  }
  const minute = minuteOfDay(`${parts.hour}:${parts.minute}`);
  if (minute === null || !parts.timeZoneName) return null;
  return { minuteOfDay: minute, label: `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute} ${parts.timeZoneName}` };
}

/**
 * Where `now` falls in the window: `on` in [start, end − margin), `end-margin` in
 * [end − margin, end), `off` otherwise. Null when the time or the window cannot be read.
 */
export function scheduleAt(now, window = DEV_SERVER_WINDOW) {
  const start = minuteOfDay(window?.start);
  const end = minuteOfDay(window?.end);
  const margin = window?.endMarginMinutes;
  if (start === null || end === null || !Number.isInteger(margin) || margin < 0 || start >= end - margin) return null;
  const clock = wallClock(now, window.zone);
  if (!clock) return null;
  const m = clock.minuteOfDay;
  const cutoff = end - margin;
  const state = m >= start && m < cutoff ? 'on' : m >= cutoff && m < end ? 'end-margin' : 'off';
  return { state, at: clock.label };
}

/** A workflow command's data, escaped as the GitHub toolkit escapes it. */
const commandData = (text) => String(text).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');

/**
 * The note for one finished decision, or null.
 *
 * @param {object} input
 * @param {unknown} input.decision  decide.mjs's output — read, never modified
 * @param {string}  input.now       the decision time `decide` was given (ISO-8601 Z)
 * @returns {null | {situation: 'scheduled-off'|'end-margin'|'in-window', at: string,
 *   headline: string, markdown: string, annotation: string|null}}
 *   `headline` is the note's first line; `annotation` is the `::warning::` command
 *   carrying that same line, or null inside the window.
 */
export function adminReadNote({ decision, now, window = DEV_SERVER_WINDOW } = {}) {
  try {
    if (decision?.decision !== 'REFUSE' || !Array.isArray(decision.reasons)) return null;
    if (!decision.reasons.some((r) => r?.code === ADMIN_UNREADABLE)) return null;
    const s = scheduleAt(now, window);
    if (!s) return null;
    const range = `${window.start}–${window.end} London`;
    if (s.state === 'on') {
      const headline = `Admin's release.txt couldn't be read at ${s.at}, inside the development server's window (${range}). `
        + 'The development server should be up now. Treat this as an outage and check Admin.';
      return { situation: 'in-window', at: s.at, headline, markdown: `> ${headline}`, annotation: null };
    }
    const headline = s.state === 'off'
      ? `Admin's release.txt couldn't be read: the development server is scheduled off at ${s.at} (window ${range}), so this is expected.`
      : `Admin's release.txt couldn't be read: at ${s.at} the development server is within ${window.endMarginMinutes} minutes `
        + `of its scheduled stop (window ${range}), so this is expected.`;
    const markdown = [
      `> **${headline}**`,
      '>',
      '> Re-run "Readiness evaluation" inside the window: "Re-run all jobs" on this run, or a `workflow_dispatch`. '
        + 'A dispatched run is a manual attempt, so it stays red by design, but it shows whether Admin can be read.',
      '>',
      "> _The time is this run's decision time, read in London from the tz database. The schedule is the likely cause, "
        + 'not an observation: nothing asked AWS whether the server is running, and this run stays red because nothing was observed._',
    ].join('\n');
    return {
      situation: s.state === 'off' ? 'scheduled-off' : 'end-margin',
      at: s.at,
      headline,
      markdown,
      annotation: `::warning::${commandData(headline)}`,
    };
  } catch {
    return null;
  }
}
