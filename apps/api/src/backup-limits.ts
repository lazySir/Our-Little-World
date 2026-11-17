export const BACKUP_LIMITS = {
  records: 10000,
  assets: 10000,
  users: 2,
  zipEntries: 10000,
  expandedBytes: 250 * 1024 * 1024,
  zipBytes: 100 * 1024 * 1024,
  assetBytes: 10 * 1024 * 1024,
} as const;

export type BackupBudget = Partial<Record<keyof typeof BACKUP_LIMITS, number>>;
type BackupLimits = Record<keyof typeof BACKUP_LIMITS, number>;

export class BackupLimitError extends Error {
  constructor() {
    super('数据超出网页备份或恢复范围，请停止服务后复制 data、storage 与 .env 进行离线备份或迁移');
  }
}

export function assertBackupBudget(budget: BackupBudget, limits: BackupLimits = BACKUP_LIMITS) {
  for (const key of Object.keys(budget) as (keyof BackupLimits)[]) {
    const value = budget[key]!;
    if (!Number.isSafeInteger(value) || value < 0 || value > limits[key])
      throw new BackupLimitError();
  }
}
