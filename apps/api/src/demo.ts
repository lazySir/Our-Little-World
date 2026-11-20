/** Explicit opt-in sample content; never runs during production initialization. */
import config from './config';
import { createPrismaClient } from './db/client';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
const db = createPrismaClient();
async function main() {
  if (await db.space.count())
    throw new Error('数据库已有空间，演示数据不会覆盖现有内容。请使用独立数据库路径。');
  const password = process.env.DEMO_PASSWORD || randomBytes(10).toString('base64url');
  const space = await db.space.create({
    data: { id: 'home', name: '小林与小禾的小世界', startDate: '2024-05-20', theme: 'cream' },
  });
  const user = await db.user.create({
    data: {
      username: 'demo',
      nickname: '小林',
      passwordHash: await bcrypt.hash(password, 12),
      spaceId: space.id,
      role: 'owner',
    },
  });
  await db.user.create({
    data: {
      username: 'demo-partner',
      nickname: '小禾',
      passwordHash: await bcrypt.hash(randomBytes(32).toString('hex'), 12),
      spaceId: space.id,
    },
  });
  const date = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(new Date());
  const entries: Array<[string, Record<string, unknown>]> = [
    [
      'wishes',
      {
        title: '一起去海边等日出',
        description: '带上相机和热咖啡，听一整晚的海。',
        category: 'travel',
        status: 'todo',
        targetDate: null,
        completedAt: null,
      },
    ],
    [
      'wishes',
      {
        title: '把阳台变成小花园',
        description: '薄荷、迷迭香，还有你喜欢的绣球。',
        category: 'life',
        status: 'todo',
        targetDate: null,
        completedAt: null,
      },
    ],
    [
      'wishes',
      {
        title: '第一次一起烤饼干',
        description: '虽然形状很奇怪，但我们都吃光了。',
        category: 'food',
        status: 'done',
        targetDate: null,
        completedAt: new Date().toISOString(),
      },
    ],
    [
      'menu',
      {
        name: '番茄牛腩',
        category: 'dish',
        description: '周末慢慢炖，配两碗米饭。',
        priceCents: 4800,
        assetId: null,
        favorite: true,
      },
    ],
    [
      'menu',
      {
        name: '桂花乌龙奶茶',
        category: 'drink',
        description: '少冰，三分糖。',
        priceCents: 1800,
        assetId: null,
        favorite: true,
      },
    ],
    [
      'menu',
      {
        name: '巷口的小面馆',
        category: 'restaurant',
        description: '再来一碗招牌牛肉面。',
        priceCents: 2500,
        assetId: null,
        favorite: false,
      },
    ],
    [
      'anniversaries',
      {
        title: '我们在一起的日子',
        date: '2024-05-20',
        recurring: true,
        description: '每一个普通日子，都因为你变得特别。',
        icon: 'heart',
      },
    ],
    [
      'anniversaries',
      {
        title: '小禾的生日',
        date: '2000-12-08',
        recurring: true,
        description: '记得买一束花。',
        icon: 'gift',
      },
    ],
    [
      'memories',
      {
        title: '把普通的周末，过成小小的节日',
        content: '一起买菜、做饭，傍晚去公园散步。回家的路上，你说今天很开心。',
        date,
        assetIds: [],
        tags: ['日常', '周末'],
        kind: 'couple',
      },
    ],
    [
      'memories',
      {
        title: '第一次一起看日落',
        content: '天色慢慢变成橘子汽水的颜色。',
        date: '2026-10-03',
        assetIds: [],
        tags: ['旅行'],
        kind: 'couple',
      },
    ],
    [
      'ledger',
      {
        type: 'income',
        amountCents: 800000,
        category: '工资',
        date,
        note: '这个月也要好好生活',
        payer: '小林',
      },
    ],
    [
      'ledger',
      {
        type: 'expense',
        amountCents: 16800,
        category: '餐饮',
        date,
        note: '周末的双人晚餐',
        payer: '小禾',
      },
    ],
    [
      'ledger',
      {
        type: 'expense',
        amountCents: 8600,
        category: '日用',
        date,
        note: '给家里添一点绿意',
        payer: '小林',
      },
    ],
    [
      'work',
      {
        title: '完成一个小目标',
        date,
        content: '把复杂的事情拆成一件件可以完成的小事。今天的自己也很棒。',
        tags: ['成长'],
        assetIds: [],
      },
    ],
    ['moods', { mood: 'great', note: '和你一起的今天，刚刚好。', date }],
    [
      'letters',
      {
        title: '写给下一年的我们',
        content: '希望打开这封信时，我们依旧可以为生活里的小事开心。',
        unlockDate: '2099-05-20',
        recipient: 'both',
      },
    ],
  ];
  for (const [kind, data] of entries)
    await db.entry.create({
      data: { kind, data: JSON.stringify(data), spaceId: space.id, authorId: user.id },
    });
  console.log(
    `演示空间已创建：账号 demo，临时密码 ${password}\n请保存密码，并在设置中修改。服务端：${config.port}`,
  );
}
main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
