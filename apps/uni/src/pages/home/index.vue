<template>
  <view class="page" :class="`theme-${session.theme}`">
    <view class="greeting">
      <view class="avatar">{{ initial }}</view>
      <view class="grow">
        <view class="eyebrow">{{ session.space?.name || 'OUR LITTLE WORLD' }}</view>
        <view class="title" style="font-size: 38rpx; margin-top: 6rpx">今天，也在好好生活</view>
      </view>
      <view class="pill">{{ partnerLabel }}</view>
    </view>
    <view v-if="error" class="error-box">{{ error }}</view>
    <view v-if="loading" class="loading">正在把今天捧到你面前…</view>
    <template v-else>
      <view class="hero">
        <view class="hero-copy">
          <view class="tiny-stamp">我们已经一起</view>
          <view class="hero-number">{{ dashboard?.daysTogether ?? 0 }}</view>
          <view class="subtitle">天 · 每一天都值得被记住</view>
          <view class="meta" style="margin-top: 18rpx">{{ nextAnniversary }}</view>
        </view>
        <image class="hero-art" src="/static/little-house.png" mode="aspectFit" />
      </view>
      <view class="card">
        <view class="between">
          <view>
            <view class="section-title">今天的心情</view>
            <view class="muted" style="margin-top: 8rpx">给对方留一句轻轻的话</view>
          </view>
          <view class="pill">{{ moodLabel }}</view>
        </view>
        <view class="chips">
          <view
            v-for="item in moods"
            :key="item.value"
            class="chip"
            :class="{ active: myMood === item.value }"
            @click="chooseMood(item.value)"
            >{{ item.icon }} {{ item.label }}</view
          >
        </view>
        <view class="field-control">
          <wd-textarea
            :model-value="moodNote"
            placeholder="今天想让对方知道什么？"
            :maxlength="120"
            auto-height
            @update:model-value="moodNote = $event"
          />
        </view>
        <wd-button block style="margin-top: 18rpx" :loading="moodSaving" @click="saveMood"
          >保存今天的心情</wd-button
        >
        <view v-for="entry in partnerMoods" :key="entry.id" class="note" style="margin-top: 22rpx"
          ><view class="small strong"
            >{{ entry.author?.nickname || session.partner?.nickname || '另一半' }} ·
            {{ moods.find((mood) => mood.value === entry.mood)?.label || '今天的心情' }}</view
          ><view v-if="entry.note" style="margin-top: 10rpx">{{ entry.note }}</view></view
        >
      </view>
      <view class="section-head">
        <view class="section-title">今天去哪里</view>
        <view class="text-action" @click="go('/pages/more/index')">看看全部 →</view>
      </view>
      <view class="feature-grid">
        <view
          v-for="feature in features"
          :key="feature.path"
          class="feature"
          @click="go(feature.path)"
        >
          <view class="feature-icon">{{ feature.icon }}</view>
          <view class="feature-name">{{ feature.name }}</view>
          <view class="feature-desc">{{ feature.desc }}</view>
        </view>
      </view>
      <view class="section-head">
        <view class="section-title">最近的回忆</view>
        <view class="text-action" @click="go('/pages/memories/index')">查看全部 →</view>
      </view>
      <view v-if="dashboard?.recentMemories?.length" class="card">
        <view
          v-for="memory in dashboard.recentMemories.slice(0, 3)"
          :key="memory.id"
          class="mini-card"
        >
          <view class="between">
            <view class="card-title">{{ memory.title }}</view>
            <view class="meta">{{ memory.date }}</view>
          </view>
          <view v-if="memory.content" class="card-text">{{ memory.content }}</view>
        </view>
      </view>
      <EmptyState
        v-else
        symbol="♡"
        title="还没有回忆"
        description="今天拍一张照片，给未来的你们留一点线索吧。"
        action="写下第一篇"
        @action="go('/pages/memories/index')"
      />
      <view class="section-head">
        <view class="section-title">这个月的账本</view>
        <view class="text-action" @click="go('/pages/ledger/index')">去记一笔 →</view>
      </view>
      <view class="stat-grid">
        <view class="stat">
          <view class="stat-label">收入</view>
          <view class="stat-value amount-income">{{ money(dashboard?.monthly?.incomeCents) }}</view>
        </view>
        <view class="stat">
          <view class="stat-label">支出</view>
          <view class="stat-value amount-expense">{{
            money(dashboard?.monthly?.expenseCents)
          }}</view>
        </view>
        <view class="stat">
          <view class="stat-label">结余</view>
          <view class="stat-value">{{ money(dashboard?.monthly?.balanceCents) }}</view>
        </view>
      </view> </template
    ><view class="spacer"
  /></view>
</template>
<script setup lang="ts">
import { ref, computed } from 'vue';
import { onShow, onPullDownRefresh } from '@dcloudio/uni-app';
import EmptyState from '../../components/EmptyState.vue';
import { useSession } from '../../stores/session';
import { request, notify, navigate } from '../../lib/api';
import { money, today } from '../../lib/domain';
import type { Dashboard } from '../../types';
const session = useSession(),
  dashboard = ref<Dashboard | null>(null),
  loading = ref(true),
  error = ref(''),
  moodSaving = ref(false),
  myMood = ref(''),
  moodNote = ref('');
const dashboardDate = computed(() => dashboard.value?.date || today());
const partnerMoods = computed(() =>
  (dashboard.value?.moods || []).filter((entry) => entry.authorId !== session.user?.id),
);
const moods = [
  { value: 'great', label: '闪闪发光', icon: '☀' },
  { value: 'good', label: '还不错', icon: '🌿' },
  { value: 'okay', label: '平平的', icon: '☁' },
  { value: 'low', label: '有点低落', icon: '☾' },
  { value: 'tired', label: '需要休息', icon: '♡' },
];
const features = [
  { path: '/pages/wishes/index', name: '一起做', desc: '想去的地方和想完成的小事', icon: '✦' },
  { path: '/pages/menu/index', name: '今天吃什么', desc: '把想吃的都先收藏起来', icon: '♨' },
  { path: '/pages/ledger/index', name: '共同账本', desc: '每一笔都记得清清楚楚', icon: '¥' },
  { path: '/pages/anniversaries/index', name: '纪念日', desc: '把重要的日子放在心上', icon: '♡' },
  { path: '/pages/baby/index', name: '宝宝成长', desc: '可选的家庭成长档案', icon: '⌂' },
  { path: '/pages/work/index', name: '工作手记', desc: '给忙碌的自己留一点记录', icon: '▤' },
];
const initial = computed(() => session.user?.nickname?.slice(0, 1) || '我'),
  partnerLabel = computed(() => (session.partner ? `和 ${session.partner.nickname}` : '两个人')),
  moodLabel = computed(() => moods.find((item) => item.value === myMood.value)?.label || '还没写'),
  nextAnniversary = computed(() =>
    dashboard.value?.upcomingAnniversaries?.[0]
      ? `下一件重要的事：${dashboard.value.upcomingAnniversaries[0].title} · ${dashboard.value.upcomingAnniversaries[0].nextDate || dashboard.value.upcomingAnniversaries[0].date}`
      : '给你们的日子留一个纪念日吧',
  );
function go(url) {
  navigate(url);
}
async function load() {
  loading.value = true;
  error.value = '';
  try {
    if (!(await session.load())) return;
    dashboard.value = await request('/dashboard');
    const mine = (dashboard.value.moods || []).find(
      (item) => item.authorId === session.user?.id || item.author?.id === session.user?.id,
    );
    if (mine) {
      myMood.value = mine.mood;
      moodNote.value = mine.note || '';
    }
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = false;
    uni.stopPullDownRefresh();
  }
}
async function chooseMood(value) {
  myMood.value = value;
}
async function saveMood() {
  if (!myMood.value) {
    notify('先选一个今天的心情');
    return;
  }
  moodSaving.value = true;
  try {
    await request('/moods', 'POST', {
      mood: myMood.value,
      note: moodNote.value,
      date: dashboardDate.value,
    });
    notify('今天的心情收好啦');
    await load();
  } catch (e) {
    notify(e.message);
  } finally {
    moodSaving.value = false;
  }
}
onShow(load);
onPullDownRefresh(load);
</script>
