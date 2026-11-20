import { createRouter, createWebHistory, type RouteLocationNormalized } from 'vue-router';
import { useSession } from './stores/session';
import { loadBusinessDate } from './composables/business-date';
const recordProps = (route: RouteLocationNormalized) => ({
  recordId: typeof route.query.record === 'string' ? route.query.record : undefined,
});
const router = createRouter({
  history: createWebHistory(),
  scrollBehavior: () => ({ top: 0 }),
  routes: [
    { path: '/auth', component: () => import('./pages/AuthPage.vue') },
    { path: '/', component: () => import('./pages/DashboardPage.vue'), meta: { title: '小世界' } },
    {
      path: '/wishes',
      component: () => import('./pages/WishesPage.vue'),
      props: recordProps,
      meta: { title: '一起做' },
    },
    {
      path: '/meals',
      component: () => import('./pages/MealsPage.vue'),
      meta: { title: '今天吃什么' },
    },
    {
      path: '/ledger',
      component: () => import('./pages/LedgerPage.vue'),
      meta: { title: '共同账本' },
    },
    {
      path: '/memories',
      component: () => import('./pages/MemoriesPage.vue'),
      props: recordProps,
      meta: { title: '回忆相册' },
    },
    {
      path: '/anniversaries',
      component: () => import('./pages/AnniversariesPage.vue'),
      props: recordProps,
      meta: { title: '纪念日' },
    },
    {
      path: '/calendar',
      component: () => import('./pages/CalendarPage.vue'),
      meta: { title: '共享日历' },
    },
    {
      path: '/baby',
      component: () => import('./pages/BabyPage.vue'),
      props: (route) => ({ ...recordProps(route), profileSource: route.query.source === 'baby' }),
      meta: { title: '宝宝成长' },
    },
    {
      path: '/pregnancy',
      component: () => import('./pages/PregnancyPage.vue'),
      meta: { title: '孕期手记' },
    },
    { path: '/work', component: () => import('./pages/WorkPage.vue'), meta: { title: '工作手记' } },
    {
      path: '/letters',
      component: () => import('./pages/LettersPage.vue'),
      props: recordProps,
      meta: { title: '时光信箱' },
    },
    {
      path: '/settings',
      component: () => import('./pages/SettingsPage.vue'),
      meta: { title: '我们的小设置' },
    },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
});
router.beforeEach(async (to) => {
  const session = useSession();
  await session.hydrate();
  try {
    await loadBusinessDate();
  } catch {
    // Device-local date remains a temporary fallback when the service is unavailable.
  }
  if (!session.authenticated && to.path !== '/auth')
    return { path: '/auth', query: { redirect: to.fullPath } };
  if (session.authenticated && to.path === '/auth') return '/';
  document.title = `${to.meta.title || '欢迎回家'} · 我们的小世界`;
});
export default router;
