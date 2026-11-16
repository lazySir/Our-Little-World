const DAY_MS = 24 * 60 * 60 * 1000;

function isLeapYear(year) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function monthDays(year, month) {
  return [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}

/** Dates are calendar values, never timestamps or time-zone conversions. */
export function isValidDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  return year >= 1 && month >= 1 && month <= 12 && day >= 1 && day <= monthDays(year, month);
}

function dateParts(value) {
  if (!isValidDate(value)) throw new TypeError('Expected a valid calendar date in YYYY-MM-DD format');
  return value.split('-').map(Number);
}

function epochDay(value) {
  const [year, month, day] = dateParts(value);
  const date = new Date(0);
  // setUTCFullYear preserves years 0001–0099, unlike Date.UTC's 1900 offset.
  date.setUTCFullYear(year, month - 1, day);
  return date.getTime() / DAY_MS;
}

export function daysBetween(from, to) {
  return epochDay(to) - epochDay(from);
}

/** The relationship start date is day one; future starts show zero. */
export function daysTogether(startDate, today) {
  return Math.max(0, daysBetween(startDate, today) + 1);
}

function dateInYear(year, month, day) {
  if (year > 9999) throw new RangeError('Anniversary is outside the supported calendar range');
  const safeDay = Math.min(day, monthDays(year, month));
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(safeDay).padStart(2, '0')}`;
}

/** February 29 recurs on February 28 in common years. */
export function anniversaryInfo(date, today, { recurring = true } = {}) {
  const [startYear, month, day] = dateParts(date);
  const [todayYear] = dateParts(today);
  let nextDate = date;
  let years = 0;

  if (recurring) {
    let nextYear = Math.max(startYear, todayYear);
    nextDate = dateInYear(nextYear, month, day);
    if (nextDate < today) nextDate = dateInYear(++nextYear, month, day);
    years = nextYear - startYear;
  }

  const daysUntil = daysBetween(today, nextDate);
  return { date, nextDate, daysUntil, isToday: daysUntil === 0, years };
}
