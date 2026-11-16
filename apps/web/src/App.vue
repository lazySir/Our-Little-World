<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { useSession } from './stores/session';
const session = useSession(),
  route = useRoute(),
  router = useRouter();
const online = ref(navigator.onLine),
  more = ref(false);
const theme = computed(() => session.space?.theme || 'cream');
const nav = [
  { to: '/', name: '小世界', icon: 'home' },
  { to: '/wishes', name: '一起做', icon: 'wish' },
  { to: '/meals', name: '今天吃什么', icon: 'meal' },
  { to: '/ledger', name: '共同账本', icon: 'wallet' },
  { to: '/memories', name: '回忆相册', icon: 'photo' },
  { to: '/anniversaries', name: '纪念日', icon: 'calendar' },
  { to: '/baby', name: '宝宝成长', icon: 'baby' },
  { to: '/work', name: '工作手记', icon: 'work' },
  { to: '/letters', name: '时光信箱', icon: 'letter' },
];
function network() {
  online.value = navigator.onLine;
}
function expire() {
  session.clear();
  ElMessage.warning('登录已过期，请重新回家');
  router.replace('/auth');
}
async function logout() {
  await session.logout();
  router.replace('/auth');
}
onMounted(() => {
  window.addEventListener('online', network);
  window.addEventListener('offline', network);
  window.addEventListener('session-expired', expire);
});
onUnmounted(() => {
  window.removeEventListener('online', network);
  window.removeEventListener('offline', network);
  window.removeEventListener('session-expired', expire);
});
</script>
<template>
  <div class="app" :data-theme="theme">
    <div v-if="!online" class="offline-banner">
      现在没有网络，已保存的内容会留在小世界里。连接恢复后可继续操作。
    </div>
    <template v-if="session.authenticated && route.path !== '/auth'"
      ><aside class="sidebar">
        <router-link to="/" class="brand"
          ><span class="brand-mark"><AppIcon name="home" :size="27" /></span
          ><span>我们的小世界<small>OUR LITTLE WORLD</small></span></router-link
        >
        <div class="space-label">
          {{ session.space?.name || '我们的家' }}<span>两个人 · 一个家</span>
        </div>
        <nav aria-label="主导航">
          <router-link
            v-for="item in nav"
            :key="item.to"
            :to="item.to"
            :class="{ active: route.path === item.to }"
            ><AppIcon :name="item.icon" :size="20" /><span>{{ item.name }}</span
            ><span v-if="route.path === item.to" class="nav-dot"
          /></router-link>
        </nav>
        <div class="sidebar-bottom">
          <div class="sidebar-note">
            <AppIcon name="heart" :size="19" />
            <p>把小日子，<br />慢慢过成喜欢的样子。</p>
          </div>
          <router-link
            to="/settings"
            class="settings-link"
            :class="{ active: route.path === '/settings' }"
            ><AppIcon name="settings" :size="19" />我们的小设置</router-link
          ><button class="user-switch" @click="logout" title="退出登录">
            <span class="avatar">{{ session.user?.nickname?.slice(0, 1) }}</span
            ><span>{{ session.user?.nickname }}<small>今天也要好好生活</small></span
            ><AppIcon name="logout" :size="17" />
          </button>
        </div>
      </aside>
      <main class="main-content">
        <div class="topbar">
          <span><span class="status-dot" /> 欢迎回家，{{ session.user?.nickname }}</span
          ><span class="topbar-date"
            >{{
              new Date().toLocaleDateString('zh-CN', {
                month: 'long',
                day: 'numeric',
                weekday: 'long',
              })
            }}<AppIcon name="sun" :size="19"
          /></span>
        </div>
        <router-view v-slot="{ Component }"><component :is="Component" /></router-view>
        <footer class="page-footer">
          每一个平凡的今天，都值得被记住 <AppIcon name="heart" :size="12" />
        </footer>
      </main>
      <nav class="mobile-nav" aria-label="手机主导航">
        <router-link
          v-for="item in [nav[0], nav[1], nav[3], nav[4]]"
          :key="item.to"
          :to="item.to"
          :class="{ active: route.path === item.to }"
          ><AppIcon :name="item.icon" :size="22" /><span>{{ item.name }}</span></router-link
        ><button @click="more = true"><AppIcon name="more" /><span>更多</span></button>
      </nav>
      <el-drawer v-model="more" title="我们的小世界" direction="btt" size="auto" class="more-drawer"
        ><div class="more-grid">
          <router-link
            v-for="item in [
              ...nav.slice(2, 3),
              ...nav.slice(5),
              { to: '/settings', name: '我们的小设置', icon: 'settings' },
            ]"
            :key="item.to"
            :to="item.to"
            @click="more = false"
            ><AppIcon :name="item.icon" :size="28" />{{ item.name }}</router-link
          >
        </div></el-drawer
      ></template
    ><router-view v-else />
  </div>
</template>
