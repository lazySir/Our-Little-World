<template>
  <view class="page" :class="`theme-${session.theme}`">
    <PageHeading
      eyebrow="LITTLE HOUSEHOLD BOOK"
      title="共同账本"
      description="一起把日子过明白，每一笔都有自己的小去处。"
      symbol="¥"
    />
    <view class="toolbar">
      <picker mode="date" fields="month" :value="month" @change="month = $event.detail.value">
        <view class="chip">{{ month || '选择月份' }} ▾</view>
      </picker>
      <view class="grow" />
      <wd-button size="small" @click="openNew">＋ 记一笔</wd-button>
    </view>
    <view v-if="error" class="error-box">
      <view>{{ error }}</view>
      <wd-button class="retry-button" size="small" plain @click="load">重新加载</wd-button>
    </view>
    <view v-if="loading && !hasLoaded" class="loading">账本打开中…</view>
    <view v-else-if="loading" class="meta" role="status">正在更新账本…</view>
    <template v-if="hasLoaded">
      <view class="stat-grid">
        <view class="stat">
          <view class="stat-label">本月收入</view>
          <view class="stat-value amount-income">{{ money(summary.income) }}</view>
        </view>
        <view class="stat">
          <view class="stat-label">本月支出</view>
          <view class="stat-value amount-expense">{{ money(summary.expense) }}</view>
        </view>
        <view class="stat">
          <view class="stat-label">本月结余</view>
          <view class="stat-value">{{ money(summary.income - summary.expense) }}</view>
        </view>
      </view>
      <view class="section-head">
        <view class="section-title">支出去哪里了</view>
      </view>
      <view class="card">
        <view v-for="item in categoryStats" :key="item.name" style="margin-bottom: 22rpx">
          <view class="between">
            <view class="small">{{ item.name }}</view>
            <view class="muted">{{ money(item.total) }} · {{ item.percent }}%</view>
          </view>
          <view class="progress-track">
            <view class="progress-bar" :style="{ width: item.percent + '%' }" />
          </view>
        </view>
        <view v-if="!categoryStats.length" class="no-data">这个月还没有支出</view>
      </view>
      <view class="section-head">
        <view class="section-title">最近六个月</view>
      </view>
      <view class="card">
        <view v-for="point in trend" :key="point.month" class="between mini-card">
          <view class="small">{{ point.month }}</view>
          <view class="muted">
            <text class="amount-income">＋{{ money(point.income) }}</text> /
            <text class="amount-expense">−{{ money(point.expense) }}</text>
          </view>
        </view>
      </view>
      <view class="chips">
        <button
          v-for="option in filters"
          :key="option.value"
          class="chip ui-reset"
          :class="{ active: filter === option.value }"
          :aria-label="`${option.label}，${filter === option.value ? '已选中' : '切换筛选'}`"
          :aria-pressed="filter === option.value"
          @click="filter = option.value"
        >
          {{ option.label }}
        </button>
      </view>
      <view v-for="item in filtered" :key="item.id" class="card">
        <view class="between">
          <view>
            <view class="card-title">{{ item.category }}</view>
            <view class="meta">{{ item.date }} · {{ item.payer || '我们' }}</view>
          </view>
          <view
            :class="item.type === 'income' ? 'amount-income' : 'amount-expense'"
            class="section-title"
            >{{ item.type === 'income' ? '+' : '−' }}{{ money(item.amountCents) }}</view
          >
        </view>
        <view v-if="item.note" class="card-text">{{ item.note }}</view>
        <view class="actions">
          <button class="text-action ui-reset" @click="edit(item)">编辑</button>
          <button class="text-action delete ui-reset" @click="remove(item)">删除</button>
        </view>
      </view>
      <EmptyState
        v-if="hasLoaded && !loading && !filtered.length"
        symbol="¥"
        title="这一页账本还是空的"
        description="今天的一杯咖啡，也值得好好记下。"
        action="记第一笔"
        @action="openNew"
      />
    </template>
    <EditorSheet
      v-model="editor"
      :title="editing ? '编辑这一笔' : '记下一笔日常'"
      :saving="saving"
      :error="formError"
      @save="saveForm"
    >
      <FormField
        v-model="form.type"
        label="收入还是支出"
        kind="select"
        :options="filters.slice(1)"
      />
      <FormField v-model="amount" label="金额（元）" required kind="number" placeholder="0.00" />
      <FormField v-model="form.category" label="分类" required placeholder="餐饮、交通、工资……" />
      <FormField v-model="form.date" label="日期" required kind="date" />
      <FormField v-model="form.payer" label="谁付的 / 谁收到的" placeholder="我们或某个人的昵称" />
      <FormField
        v-model="form.note"
        label="备注"
        kind="textarea"
        placeholder="给这一笔加一点细节"
      />
    </EditorSheet>
  </view>
</template>
<script setup lang="ts">
import { ref, computed, reactive } from 'vue';
import PageHeading from '../../components/PageHeading.vue';
import EmptyState from '../../components/EmptyState.vue';
import EditorSheet from '../../components/EditorSheet.vue';
import FormField from '../../components/FormField.vue';
import { useResource } from '../../lib/useResource';
import { today, money, centsFromInput } from '../../lib/domain';
const { session, items, hasLoaded, loading, error, saving, editor, formError, load, save, remove } =
    useResource('ledger'),
  month = ref(today().slice(0, 7)),
  filter = ref('all'),
  editing = ref(null),
  amount = ref('');
const filters = [
    { value: 'all', label: '全部' },
    { value: 'expense', label: '支出' },
    { value: 'income', label: '收入' },
  ],
  form = reactive({ type: 'expense', category: '餐饮', date: today(), payer: '', note: '' });
const monthly = computed(() => items.value.filter((x) => x.date?.startsWith(month.value))),
  filtered = computed(() =>
    monthly.value
      .filter((x) => filter.value === 'all' || x.type === filter.value)
      .sort((a, b) => b.date.localeCompare(a.date)),
  ),
  summary = computed(() =>
    monthly.value.reduce(
      (s, x) => {
        s[x.type] += x.amountCents;
        return s;
      },
      { income: 0, expense: 0 },
    ),
  ),
  categoryStats = computed(() => {
    const groups: Record<string, number> = {};
    monthly.value
      .filter((x) => x.type === 'expense')
      .forEach((x) => (groups[x.category] = (groups[x.category] || 0) + x.amountCents));
    return Object.entries(groups)
      .map(([name, total]) => ({
        name,
        total,
        percent: Math.round((total / (summary.value.expense || 1)) * 100),
      }))
      .sort((a, b) => b.total - a.total);
  }),
  trend = computed(() =>
    Array.from({ length: 6 }, (_, i) => {
      const date = new Date(
          Number(month.value.slice(0, 4)),
          Number(month.value.slice(5, 7)) - 1 - (5 - i),
          1,
        ),
        key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      const records = items.value.filter((x) => x.date.startsWith(key));
      return {
        month: key,
        income: records.filter((x) => x.type === 'income').reduce((s, x) => s + x.amountCents, 0),
        expense: records.filter((x) => x.type === 'expense').reduce((s, x) => s + x.amountCents, 0),
      };
    }),
  );
function openNew() {
  editing.value = null;
  amount.value = '';
  Object.assign(form, {
    type: 'expense',
    category: '餐饮',
    date: today(),
    payer: session.user?.nickname || '',
    note: '',
  });
  editor.value = true;
}
function edit(item) {
  editing.value = item;
  amount.value = String(item.amountCents / 100);
  Object.assign(form, {
    type: item.type,
    category: item.category,
    date: item.date,
    payer: item.payer,
    note: item.note,
  });
  editor.value = true;
}
async function saveForm() {
  try {
    const amountCents = centsFromInput(amount.value);
    if (amountCents <= 0) throw Error('金额要大于 0');
    if (!form.category.trim()) throw Error('请写一个分类');
    await save({ ...form, amountCents }, editing.value?.id);
  } catch (e) {
    formError.value = e.message;
  }
}
</script>
