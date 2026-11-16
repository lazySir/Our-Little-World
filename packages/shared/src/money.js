/** Convert a decimal amount to integer cents without floating point rounding. */
export function parseCents(value) {
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new TypeError('Amount must be a decimal string or number');
  }

  const match = /^([+-]?)(\d+)(?:\.(\d{1,2}))?$/.exec(String(value).trim());
  if (!match) {
    throw new TypeError('Amount must have at most two decimal places');
  }

  const [, sign, whole, fraction = ''] = match;
  const cents = Number(`${sign}${whole}${fraction.padEnd(2, '0')}`);
  if (!Number.isSafeInteger(cents)) {
    throw new RangeError('Amount is outside the safe integer cents range');
  }
  return cents === 0 ? 0 : cents;
}

/** Format integer cents for display or editing; currency symbols belong to UI. */
export function formatCents(cents) {
  if (!Number.isSafeInteger(cents)) {
    throw new TypeError('Cents must be a safe integer');
  }

  const absolute = Math.abs(cents);
  const whole = Math.floor(absolute / 100);
  const fraction = String(absolute % 100).padStart(2, '0');
  return `${cents < 0 ? '-' : ''}${whole}.${fraction}`;
}
