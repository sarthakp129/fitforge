/**
 * Tiny shared validators. Dates are the easiest field to smuggle garbage in
 * through (they are string-concatenated into SQL date functions), so every
 * body-supplied date is checked here and rejected with 400.
 */
export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** True only for real calendar dates in YYYY-MM-DD form. */
export const validDate = (v) =>
  typeof v === 'string' && ISO_DATE.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));

/** Coerce a query-param date to a safe default when absent or malformed. */
export const queryDate = (v, fallback) => (validDate(v) ? v : fallback);
