export interface User { id: string; username: string; nickname: string; role: 'owner' | 'member'; }
export interface Space { id: string; name: string; startDate: string; theme: 'cream' | 'rose' | 'sage'; }
export interface Session { token?: string; user: User; space: Space; partner?: User | null; }
export interface Asset { id: string; url: string; mime?: string; size?: number; originalName?: string; }
export interface BaseRecord { id: string; authorId?: string; createdAt?: string; updatedAt?: string; }
export interface Wish extends BaseRecord { title: string; description: string; category: 'travel' | 'food' | 'life' | 'other'; status: 'todo' | 'done'; targetDate: string | null; completedAt: string | null; }
export interface MenuItem extends BaseRecord { name: string; description: string; category: 'dish' | 'drink' | 'restaurant'; priceCents: number; favorite: boolean; assetId: string | null; asset?: Asset; }
export interface Order extends BaseRecord { items: { menuItemId: string; name: string; quantity: number }[]; note: string; status: 'pending' | 'done'; totalCents: number; }
export interface LedgerRecord extends BaseRecord { type: 'income' | 'expense'; amountCents: number; category: string; date: string; note: string; payer: string; }
export interface Anniversary extends BaseRecord { title: string; date: string; recurring: boolean; description: string; icon: string; }
export interface Memory extends BaseRecord { title: string; date: string; content: string; assetIds: string[]; assets?: Asset[]; tags: string[]; kind: 'couple' | 'baby'; }
export interface WorkRecord extends BaseRecord { title: string; date: string; content: string; assetIds: string[]; assets?: Asset[]; tags: string[]; }
export interface Letter extends BaseRecord { title: string; content?: string; unlockDate: string; recipient: 'partner' | 'both'; isLocked: boolean; author: { nickname: string }; }
export interface Mood extends BaseRecord { mood: 'great' | 'good' | 'okay' | 'low' | 'tired'; note: string; date: string; author?: { nickname: string }; nickname?: string; }
export interface Baby { id?: string; name: string; birthday: string | null; gender: 'unknown' | 'girl' | 'boy'; notes: string; avatarId: string | null; asset?: Asset; }
export interface Growth extends BaseRecord { title: string; date: string; type: 'growth' | 'feeding' | 'sleep' | 'health' | 'milestone'; content: string; heightCm: number | null; weightKg: number | null; amountMl: number | null; durationMinutes: number | null; assetIds: string[]; assets?: Asset[]; }
export interface Dashboard { daysTogether: number; counts: Record<string, number>; monthly: { incomeCents: number; expenseCents: number; balanceCents: number }; recentMemories: Memory[]; upcomingAnniversaries: Anniversary[]; pendingWishes: Wish[]; moods: Mood[]; }
export interface ApiOptions extends Omit<RequestInit, 'body'> { body?: object | FormData; binary?: boolean; }
