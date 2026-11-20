import { z } from 'zod';
const { isValidDate } = require('@our-little-world/shared/date');
const text = (max = 200) => z.string().trim().max(max);
const title = text(120).min(1, '请填写标题');
const date = z.string().refine(isValidDate, '日期格式应为有效的 YYYY-MM-DD');
const id = z.string().min(1).max(100);
const note = text(10000).default('');
const assets = z.array(id).max(12).default([]);
const tags = z.array(text(30).min(1)).max(10).default([]);
const positive = z.number().finite().positive();
const optional = <T extends z.ZodType>(s: T) => s.nullable().default(null);
const passwordInput = z
  .string()
  .max(128)
  .refine(
    (value) => Buffer.byteLength(value, 'utf8') <= 72,
    '密码过长，请缩短（最多72个英文字符或24个汉字）',
  );
const credentials = {
  username: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9_.-]{3,32}$/, '账号为3–32位字母、数字、点或下划线'),
  password: passwordInput.min(8, '密码至少8位'),
};
const schemas = {
  wishes: z.object({
    title,
    description: note,
    category: z.enum(['travel', 'food', 'life', 'other']).default('life'),
    status: z.enum(['todo', 'done']).default('todo'),
    targetDate: optional(date),
    completedAt: optional(z.string().max(40)),
  }),
  menu: z.object({
    name: title,
    category: z.enum(['dish', 'drink', 'restaurant']).default('dish'),
    description: note,
    priceCents: z.number().int().min(0).max(100000000).default(0),
    assetId: optional(id),
    favorite: z.boolean().default(false),
  }),
  orders: z.object({
    items: z
      .array(
        z.object({
          menuItemId: id,
          name: text(120).optional(),
          quantity: z.number().int().min(1).max(99),
        }),
      )
      .min(1)
      .max(100),
    note,
    status: z.enum(['pending', 'done']).default('pending'),
  }),
  ledger: z.object({
    type: z.enum(['income', 'expense']),
    amountCents: z.number().int().positive().max(100000000000),
    category: text(40).min(1),
    date,
    note,
    payer: text(60).min(1),
  }),
  anniversaries: z.object({
    title,
    date,
    recurring: z.boolean().default(true),
    description: note,
    icon: text(30).default('heart'),
  }),
  memories: z.object({
    title,
    content: note,
    date,
    assetIds: assets,
    tags,
    kind: z.enum(['couple', 'baby']).default('couple'),
  }),
  growth: z.object({
    title,
    date,
    type: z.enum(['growth', 'feeding', 'sleep', 'health', 'milestone']),
    content: note,
    heightCm: optional(positive.max(250)),
    weightKg: optional(positive.max(200)),
    amountMl: optional(positive.max(5000)),
    durationMinutes: optional(positive.max(1440)),
    assetIds: assets,
  }),
  pregnancy: z.object({
    title,
    date,
    type: z.enum(['checkup', 'milestone', 'mood', 'note']),
    content: note,
    assetIds: assets,
  }),
  work: z.object({ title, date, content: note, tags, assetIds: assets }),
  letters: z.object({
    title,
    content: text(20000).min(1),
    unlockDate: date,
    recipient: z.enum(['partner', 'both']).default('partner'),
  }),
  moods: z.object({
    mood: z.enum(['great', 'good', 'okay', 'low', 'tired']),
    note: text(500).default(''),
    date,
  }),
  baby: z.object({
    name: title,
    birthday: optional(date),
    gender: z.enum(['unknown', 'girl', 'boy']).default('unknown'),
    notes: note,
    avatarId: optional(id),
  }),
};
export { z, text, title, date, credentials, passwordInput, schemas };
