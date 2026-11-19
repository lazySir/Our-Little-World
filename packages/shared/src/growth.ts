import { isValidDate } from './date.js';

export interface GrowthMeasurement {
  id: string;
  date?: string;
  heightCm?: unknown;
  weightKg?: unknown;
  createdAt?: string;
}

export interface GrowthPoint {
  id: string;
  date: string;
  value: number;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isMeasurement(value: unknown, maximum: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= maximum;
}

/** Project valid measurements without changing source records or losing same-day entries. */
export function projectGrowthMeasurements(records: readonly GrowthMeasurement[]): {
  height: GrowthPoint[];
  weight: GrowthPoint[];
} {
  const ordered: { measurement: GrowthMeasurement; date: string; createdAt: number | null }[] = [];
  for (const measurement of records) {
    const { date } = measurement;
    if (typeof date !== 'string' || !isValidDate(date)) continue;
    const timestamp =
      typeof measurement.createdAt === 'string' ? Date.parse(measurement.createdAt) : NaN;
    ordered.push({
      measurement,
      date,
      createdAt: Number.isFinite(timestamp) ? timestamp : null,
    });
  }

  ordered.sort((left, right) => {
    const dateOrder = compareText(left.date, right.date);
    if (dateOrder !== 0) return dateOrder;
    // Invalid and missing times share a bucket before all valid timestamps.
    if (left.createdAt === null && right.createdAt !== null) return -1;
    if (left.createdAt !== null && right.createdAt === null) return 1;
    if (left.createdAt !== null && right.createdAt !== null) {
      const timeOrder = left.createdAt - right.createdAt;
      if (timeOrder !== 0) return timeOrder;
    }
    return compareText(left.measurement.id, right.measurement.id);
  });

  const height: GrowthPoint[] = [];
  const weight: GrowthPoint[] = [];
  for (const { measurement, date } of ordered) {
    if (isMeasurement(measurement.heightCm, 250)) {
      height.push({ id: measurement.id, date, value: measurement.heightCm });
    }
    if (isMeasurement(measurement.weightKg, 200)) {
      weight.push({ id: measurement.id, date, value: measurement.weightKg });
    }
  }
  return { height, weight };
}
