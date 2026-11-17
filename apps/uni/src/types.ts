export interface Asset {
  id: string;
  url: string;
  mime?: string;
  size?: number;
  originalName?: string;
}
export interface Member {
  id: string;
  username: string;
  nickname: string;
  role: 'owner' | 'member';
}
export interface Space {
  id: string;
  name: string;
  startDate: string;
  theme: 'cream' | 'rose' | 'sage';
}
export interface SessionData {
  user: Member;
  space: Space;
  partner: Member | null;
  token?: string;
}
export interface LivingRecord {
  id: string;
  authorId?: string;
  createdAt?: string;
  updatedAt?: string;
  title?: string;
  name?: string;
  description?: string;
  content?: string;
  note?: string;
  date?: string;
  category?: string;
  type?: string;
  status?: string;
  targetDate?: string;
  completedAt?: string;
  priceCents?: number;
  amountCents?: number;
  payer?: string;
  favorite?: boolean;
  assetId?: string;
  assetIds?: string[];
  assets?: Asset[];
  asset?: Asset;
  tags?: string[];
  kind?: string;
  recurring?: boolean;
  nextDate?: string;
  icon?: string;
  heightCm?: number;
  weightKg?: number;
  amountMl?: number;
  durationMinutes?: number;
  unlockDate?: string;
  recipient?: string;
  isLocked?: boolean;
  author?: {
    id?: string;
    nickname: string;
  };
  mood?: string;
  items?: OrderItem[];
  totalCents?: number;
}
export interface OrderItem {
  menuItemId: string;
  name: string;
  quantity: number;
}
export interface Baby {
  id: string;
  name: string;
  birthday: string | null;
  gender: string;
  notes: string;
  avatarId: string | null;
  asset?: Asset;
  avatar?: Asset;
}
export interface Dashboard {
  date: string;
  daysTogether: number;
  counts: Record<string, number>;
  monthly: {
    incomeCents: number;
    expenseCents: number;
    balanceCents: number;
  };
  recentMemories: LivingRecord[];
  upcomingAnniversaries: LivingRecord[];
  pendingWishes: LivingRecord[];
  moods: LivingRecord[];
}
export interface ApiError extends Error {
  status?: number;
}
