<script setup lang="ts">
import type { Dashboard, Memory } from '../types';
import { ref, computed, onMounted } from 'vue';
import { ElMessage } from 'element-plus';
import { useSession } from '../stores/session';
import { api, assetUrl } from '../api';
import { today, money, nextAnniversary, moodTypes } from '../domain';
import HouseArt from '../components/HouseArt.vue';
const session = useSession(),
  data = ref<Dashboard | null>(null),
  error = ref(''),
  loading = ref(true),
  saving = ref(false),
  mood = ref('good'),
  note = ref('');
const shortcuts = [
  { to: '/wishes', name: '一起做', detail: '把期待写下来', icon: 'wish', tone: 'gold' },
  { to: '/meals', name: '今天吃什么', detail: '好好吃饭的浪漫', icon: 'meal', tone: 'rose' },
  { to: '/ledger', name: '共同账本', detail: '柴米油盐也可爱', icon: 'wallet', tone: 'sage' },
  { to: '/memories', name: '回忆相册', detail: '把喜欢的瞬间留下', icon: 'photo', tone: 'blue' },
];
const ownMood = computed(() =>
  data.value?.moods?.find((m) => m.date === today() && m.authorId === session.user?.id),
);
const moods = computed(() => data.value?.moods?.filter((m) => m.date === today()) || []);
const upcoming = computed(() =>
  [...(data.value?.upcomingAnniversaries || [])]
    .map((i) => ({ ...i, next: nextAnniversary(i) }))
    .filter((i) => i.next.days >= 0)
    .sort((a, b) => a.next.days - b.next.days)
    .slice(0, 3),
);
async function load() {
  loading.value = true;
  error.value = '';
  try {
    data.value = await api.get('/dashboard');
    if (ownMood.value) {
      mood.value = ownMood.value.mood;
      note.value = ownMood.value.note;
    }
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}
async function saveMood() {
  saving.value = true;
  try {
    await api.post('/moods', { mood: mood.value, note: note.value, date: today() });
    ElMessage.success('今天的心情，已经传达给另一半');
    await load();
  } catch (e) {
    ElMessage.error(e.message);
  } finally {
    saving.value = false;
  }
}
function cover(item: Memory) {
  return assetUrl(item.assets?.[0]);
}
onMounted(load);
</script>
<template>
  <PageHeader
    title="平凡日子，也闪闪发光"
    description="这里收藏着我们的小事，和所有值得期待的明天。"
    ><router-link to="/memories"
      ><el-button type="primary"
        ><AppIcon name="plus" :size="16" />记录这一刻</el-button
      ></router-link
    ></PageHeader
  ><LoadState :loading="loading" :error="error" @retry="load"
    ><div class="dashboard-top">
      <section class="home-hero panel">
        <div>
          <p class="eyebrow">TOGETHER IS A BEAUTIFUL PLACE</p>
          <h2>{{ session.space?.name }}</h2>
          <p>
            我们在一起的第 <strong>{{ data?.daysTogether || 0 }}</strong> 天
          </p>
          <span class="hero-caption">一屋两人，三餐四季。<br />慢慢来，我们还有好多好多天。</span>
        </div>
        <HouseArt />
      </section>
      <section class="mood-panel panel">
        <div class="section-head">
          <h3><AppIcon name="sun" :size="18" />今天的心情</h3>
          <span class="muted">{{ today().slice(5).replace('-', '.') }}</span>
        </div>
        <p class="mood-prompt">嗨，今天过得怎么样？</p>
        <div class="mood-options">
          <button
            v-for="(item, key) in moodTypes"
            :key="key"
            :class="{ selected: mood === key }"
            :aria-label="item.label"
            :aria-pressed="mood === key"
            @click="mood = key"
          >
            <span class="mood-face">{{ item.symbol }}</span
            ><small>{{ item.label }}</small>
          </button>
        </div>
        <el-input v-model="note" maxlength="200" placeholder="留一句今天的小心情…" />
        <div class="mood-bottom">
          <span v-if="ownMood">今天也认真感受生活了</span><span v-else>让另一半知道你的小情绪</span
          ><el-button size="small" type="primary" :loading="saving" @click="saveMood">{{
            ownMood ? '更新心情' : '记下心情'
          }}</el-button>
        </div>
        <div v-if="moods.length" class="partner-moods">
          <span v-for="item in moods" :key="item.id" :title="item.note"
            >{{ item.author?.nickname || item.nickname || '家人' }}：{{ moodTypes[item.mood]?.label
            }}<small v-if="item.note"> · {{ item.note }}</small></span
          >
        </div>
      </section>
    </div>
    <div class="shortcut-grid">
      <router-link v-for="s in shortcuts" :key="s.to" :to="s.to" class="shortcut-card panel"
        ><span class="shortcut-icon" :class="s.tone"><AppIcon :name="s.icon" :size="24" /></span>
        <div>
          <h3>{{ s.name }}</h3>
          <p>{{ s.detail }}</p>
        </div>
        <AppIcon name="arrow" :size="16"
      /></router-link>
    </div>
    <div class="dashboard-middle">
      <section class="dashboard-section panel">
        <div class="section-head">
          <h3>
            <AppIcon name="wish" :size="18" />我们的待办愿望<span class="subtitle"
              >LITTLE WISHES</span
            >
          </h3>
          <router-link to="/wishes" class="text-link"
            >全部 <AppIcon name="arrow" :size="14"
          /></router-link>
        </div>
        <div v-if="data?.pendingWishes?.length" class="home-wishes">
          <router-link v-for="wish in data.pendingWishes.slice(0, 4)" :key="wish.id" to="/wishes"
            ><span class="wish-check" /><span>{{ wish.title }}</span
            ><small v-if="wish.targetDate">{{ wish.targetDate.slice(5).replace('-', '.') }}</small
            ><AppIcon name="arrow" :size="14"
          /></router-link>
        </div>
        <EmptyState
          v-else
          title="想和你做的事，都在这里"
          description="看一次日落，学一道菜，或是计划一场旅行。"
          icon="wish"
          action="写下第一个愿望"
          @action="$router.push('/wishes')"
        />
      </section>
      <section class="dashboard-section panel">
        <div class="section-head">
          <h3><AppIcon name="calendar" :size="18" />值得期待的日子</h3>
          <router-link to="/anniversaries" class="text-link"
            >全部 <AppIcon name="arrow" :size="14"
          /></router-link>
        </div>
        <div v-if="upcoming.length" class="home-anniversaries">
          <router-link v-for="ann in upcoming" :key="ann.id" to="/anniversaries"
            ><span class="ann-icon"
              ><AppIcon :name="ann.icon === 'heart' ? 'heart' : 'calendar'" :size="22" /></span
            ><span
              ><strong>{{ ann.title }}</strong
              ><small>{{ ann.next.date.replaceAll('-', '.') }}</small></span
            >
            <div class="countdown">
              <strong>{{ Math.abs(ann.next.days) }}</strong
              ><small>{{ ann.next.days < 0 ? '天前' : '天后' }}</small>
            </div></router-link
          >
        </div>
        <EmptyState
          v-else
          title="让重要日子，有被记住的仪式感"
          description="添加纪念日，下一份期待就有了日期。"
          icon="calendar"
          action="添加纪念日"
          @action="$router.push('/anniversaries')"
        />
      </section>
    </div>
    <section class="month-strip panel">
      <div class="month-caption">
        <span class="shortcut-icon sage"><AppIcon name="wallet" :size="23" /></span>
        <div>
          <h3>{{ Number(today().slice(5, 7)) }} 月的小账本</h3>
          <p>一粥一饭，都是生活</p>
        </div>
      </div>
      <div class="month-number">
        <small>本月收入</small><strong>¥ {{ money(data?.monthly?.incomeCents) }}</strong>
      </div>
      <div class="month-number">
        <small>本月支出</small><strong>¥ {{ money(data?.monthly?.expenseCents) }}</strong>
      </div>
      <div class="month-number balance">
        <small>本月结余</small><strong>¥ {{ money(data?.monthly?.balanceCents) }}</strong>
      </div>
      <router-link to="/ledger" class="text-link"
        >去记一笔 <AppIcon name="arrow" :size="14"
      /></router-link>
    </section>
    <section class="recent-section">
      <div class="section-head">
        <h3>
          <AppIcon name="photo" :size="19" />最近的小美好<span class="subtitle"
            >LIFE IN MOMENTS</span
          >
        </h3>
        <router-link to="/memories" class="text-link"
          >回忆相册 <AppIcon name="arrow" :size="14"
        /></router-link>
      </div>
      <div v-if="data?.recentMemories?.length" class="recent-grid">
        <router-link
          v-for="(item, index) in data.recentMemories.slice(0, 3)"
          :key="item.id"
          to="/memories"
          class="recent-memory panel"
          :class="`memory-tone-${index}`"
          ><el-image v-if="cover(item)" :src="cover(item)" fit="cover" />
          <div v-else class="memory-no-photo">
            <AppIcon name="photo" :size="35" /><span>A LITTLE MOMENT</span>
          </div>
          <div>
            <h3>{{ item.title }}</h3>
            <p>{{ item.date.replaceAll('-', '.') }}</p>
          </div></router-link
        >
      </div>
      <div v-else class="panel">
        <EmptyState
          title="美好的故事，从第一张回忆开始"
          description="一张照片，一句心情，都是以后会想念的今天。"
          icon="photo"
          action="收藏一个瞬间"
          @action="$router.push('/memories')"
        />
      </div>
    </section>
    <div class="extra-modules">
      <router-link
        v-for="item in [
          { to: '/baby', name: '宝宝成长', detail: '记录新生命的每一步', icon: 'baby' },
          { to: '/work', name: '工作手记', detail: '忙碌与成长，也与你分享', icon: 'work' },
          { to: '/letters', name: '时光信箱', detail: '给未来的我们，一点惊喜', icon: 'letter' },
        ]"
        :key="item.to"
        :to="item.to"
        ><AppIcon :name="item.icon" :size="22" />
        <div>
          <h3>{{ item.name }}</h3>
          <p>{{ item.detail }}</p>
        </div>
        <AppIcon name="arrow" :size="15"
      /></router-link></div
  ></LoadState>
</template>
