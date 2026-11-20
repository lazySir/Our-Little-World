<template>
  <view class="page" :class="`theme-${session.theme}`">
    <PageHeading
      eyebrow="OUR DAYS"
      title="我们的日常"
      description="生活有很多面，慢慢记录就会有自己的形状。"
      symbol="⌂"
    />
    <view class="feature-grid">
      <button
        v-for="feature in features"
        :key="feature.path"
        class="feature ui-reset"
        :aria-label="`${feature.name}：${feature.desc}`"
        @click="go(feature.path)"
      >
        <view class="feature-icon">{{ feature.icon }}</view>
        <view class="feature-name">{{ feature.name }}</view>
        <view class="feature-desc">{{ feature.desc }}</view>
      </button>
    </view>
    <view class="section-head">
      <view class="section-title">空间信息</view>
      <button class="text-action ui-reset" @click="go('/pages/settings/index')">去设置 →</button>
    </view>
    <view class="card">
      <view class="between">
        <view>
          <view class="muted">小世界名称</view>
          <view class="card-title">{{ session.space?.name || '还没有名字' }}</view>
        </view>
        <view class="avatar">{{ (session.space?.name || '我').slice(0, 1) }}</view>
      </view>
      <view class="divider" />
      <view class="between">
        <view>
          <view class="muted">故事开始于</view>
          <view class="card-title">{{ session.space?.startDate || '还没有写下' }}</view>
        </view>
        <view class="pill">{{
          session.partner ? `已和 ${session.partner.nickname} 配对` : '等待另一半加入'
        }}</view>
      </view>
    </view>
    <wd-button block plain @click="session.logout">离开这个设备</wd-button>
  </view>
</template>
<script setup lang="ts">
import { onShow } from '@dcloudio/uni-app';
import { useSession } from '../../stores/session';
import PageHeading from '../../components/PageHeading.vue';
const session = useSession();
const features = [
  { path: '/pages/menu/index', name: '今天吃什么', desc: '菜品、饮品和下馆子的愿望', icon: '♨' },
  { path: '/pages/ledger/index', name: '共同账本', desc: '收入、支出和每月的小结', icon: '¥' },
  { path: '/pages/anniversaries/index', name: '纪念日', desc: '重要的日子，一个都不漏', icon: '♡' },
  { path: '/pages/calendar/index', name: '共享日历', desc: '把接下来的日子放在一起', icon: '⌑' },
  { path: '/pages/baby/index', name: '宝宝成长', desc: '可选的家庭成长档案', icon: '⌂' },
  { path: '/pages/pregnancy/index', name: '孕期手记', desc: '记录重要时刻与此刻心情', icon: '♡' },
  { path: '/pages/work/index', name: '工作手记', desc: '给工作留下轻量记录', icon: '▤' },
  { path: '/pages/letters/index', name: '时光信箱', desc: '写给未来某一天的信', icon: '✉' },
];
onShow(() => session.load());
function go(path) {
  uni.navigateTo({ url: path });
}
</script>
