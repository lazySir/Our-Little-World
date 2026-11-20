<script setup lang="ts">
import { ref, reactive, computed } from 'vue';
import { ElMessage } from 'element-plus';
import { useResource } from '../composables/resource';
import { useSession } from '../stores/session';
import { monthNow, today, money, parseMoney, groupLedger } from '../domain';
import type { LedgerRecord } from '../types';
import LedgerCharts from '../components/LedgerCharts.vue';
const session = useSession();
const { items, loading, error, saving, load, save, remove } = useResource<LedgerRecord>('/ledger');
const month = ref(monthNow()),
  type = ref('all'),
  query = ref(''),
  dialog = ref(false),
  editing = ref<LedgerRecord | null>(null);
const form = reactive({
  type: 'expense',
  amount: '',
  category: '餐饮',
  date: today(),
  note: '',
  payer: session.user?.nickname || '我',
});
const expenseCategories = ['餐饮', '购物', '居家', '出行', '娱乐', '健康', '宝宝', '礼物', '其他'];
const incomeCategories = ['工资', '奖金', '礼金', '其他'];
const categories = computed(() => (form.type === 'income' ? incomeCategories : expenseCategories));
const stats = computed(() => groupLedger(items.value, month.value || monthNow()));
const filtered = computed(() =>
  stats.value.rows
    .filter(
      (i) =>
        (type.value === 'all' || i.type === type.value) &&
        (!query.value || `${i.category} ${i.note} ${i.payer}`.includes(query.value)),
    )
    .sort((a, b) => b.date.localeCompare(a.date)),
);
const members = computed(() =>
  [session.user?.nickname, session.partner?.nickname, '共同账户'].filter(Boolean),
);
function edit(item: LedgerRecord | null = null) {
  if (saving.value) return;
  editing.value = item;
  Object.assign(
    form,
    item
      ? { ...item, amount: (item.amountCents / 100).toFixed(2) }
      : {
          type: 'expense',
          amount: '',
          category: '餐饮',
          date: today(),
          note: '',
          payer: session.user?.nickname || '我',
        },
  );
  dialog.value = true;
}
async function submit() {
  if (saving.value) return;
  let cents;
  try {
    cents = parseMoney(form.amount);
  } catch (e) {
    ElMessage.warning(e.message);
    return;
  }
  if (!form.date || !form.category.trim()) {
    ElMessage.warning('请填写日期和分类');
    return;
  }
  try {
    await save(
      {
        type: form.type,
        amountCents: cents,
        category: form.category,
        date: form.date,
        note: form.note,
        payer: form.payer,
      },
      editing.value?.id,
    );
    dialog.value = false;
  } catch {}
}
</script>
<template>
  <PageHeader title="共同账本" description="柴米油盐也可爱，一起把日子过得心中有数。"
    ><el-button type="primary" @click="edit()"
      ><AppIcon name="plus" :size="16" />记一笔</el-button
    ></PageHeader
  ><LoadState :loading="loading" :error="error" @retry="load"
    ><div class="ledger-month">
      <el-date-picker
        v-model="month"
        type="month"
        value-format="YYYY-MM"
        format="YYYY 年 MM 月"
        :clearable="false"
      /><span class="muted">每一笔小开支，都是我们认真生活的痕迹。</span>
    </div>
    <div class="ledger-stats">
      <article class="panel">
        <span class="shortcut-icon sage"><AppIcon name="wallet" :size="23" /></span>
        <div>
          <small>本月收入</small><strong>¥ {{ money(stats.income) }}</strong>
        </div>
      </article>
      <article class="panel">
        <span class="shortcut-icon rose"><AppIcon name="meal" :size="23" /></span>
        <div>
          <small>本月支出</small><strong>¥ {{ money(stats.expense) }}</strong>
        </div>
      </article>
      <article class="panel balance">
        <span class="shortcut-icon gold"><AppIcon name="wish" :size="23" /></span>
        <div>
          <small>本月结余</small><strong>¥ {{ money(stats.balance) }}</strong>
        </div>
      </article>
    </div>
    <LedgerCharts v-if="stats.rows.length" :stats="stats" />
    <section class="ledger-records">
      <div class="toolbar">
        <div class="filter-tabs" role="group" aria-label="账本类型筛选">
          <button
            v-for="[key, label] in [
              ['all', '全部记录'],
              ['expense', '支出'],
              ['income', '收入'],
            ]"
            :key="key"
            class="filter-tab"
            :class="{ active: type === key }"
            :aria-pressed="type === key"
            @click="type = key"
          >
            {{ label }}
          </button>
        </div>
        <el-input v-model="query" placeholder="搜索分类、备注、付款人" clearable
          ><template #prefix><AppIcon name="search" :size="15" /></template
        ></el-input>
      </div>
      <div v-if="filtered.length" class="panel ledger-list">
        <div v-for="item in filtered" :key="item.id" class="ledger-row">
          <span class="ledger-category-icon" :class="item.type"
            ><AppIcon
              :name="
                item.type === 'income' ? 'wallet' : item.category === '餐饮' ? 'meal' : 'heart'
              "
              :size="22"
          /></span>
          <div class="ledger-record-title">
            <h3>
              {{ item.category }}<span>{{ item.note }}</span>
            </h3>
            <p>{{ item.date }}<i />{{ item.payer }}</p>
          </div>
          <strong class="ledger-amount" :class="item.type"
            >{{ item.type === 'income' ? '+' : '−' }} {{ money(item.amountCents) }}</strong
          >
          <div class="flex gap-0.5">
            <button class="icon-button" title="编辑账目" @click="edit(item)">
              <AppIcon name="edit" :size="16" /></button
            ><button class="icon-button" title="删除账目" @click="remove(item, '这笔账目')">
              <AppIcon name="trash" :size="16" />
            </button>
          </div>
        </div>
      </div>
      <div v-else class="panel">
        <EmptyState
          title="这个月的小账本，还是空白的"
          description="从今天的一顿午饭开始，给共同生活记上第一笔。"
          icon="wallet"
          action="记下第一笔"
          @action="edit()"
        />
      </div></section></LoadState
  ><el-dialog
    v-model="dialog"
    :title="editing ? '修改这笔账' : '记一笔小账'"
    width="min(520px,94vw)"
    :close-on-click-modal="!saving"
    :close-on-press-escape="!saving"
    :show-close="!saving"
    ><el-form label-position="top" :model="form" :disabled="saving" @submit.prevent="submit"
      ><el-form-item label="收支类型"
        ><el-radio-group
          v-model="form.type"
          @change="form.category = form.type === 'income' ? '工资' : '餐饮'"
          ><el-radio-button value="expense">支出</el-radio-button
          ><el-radio-button value="income">收入</el-radio-button></el-radio-group
        ></el-form-item
      ><el-form-item label="金额（元）" required
        ><el-input v-model="form.amount" inputmode="decimal" placeholder="0.00" size="large"
          ><template #prefix>¥</template></el-input
        ></el-form-item
      >
      <div class="form-grid">
        <el-form-item label="分类" required
          ><el-select v-model="form.category" allow-create filterable
            ><el-option
              v-for="c in categories"
              :key="c"
              :value="c"
              :label="c" /></el-select></el-form-item
        ><el-form-item label="日期" required
          ><el-date-picker v-model="form.date" value-format="YYYY-MM-DD" type="date"
        /></el-form-item>
      </div>
      <el-form-item :label="form.type === 'income' ? '收款人' : '付款人'"
        ><el-select v-model="form.payer" allow-create filterable
          ><el-option
            v-for="p in members"
            :key="p"
            :value="p"
            :label="p" /></el-select></el-form-item
      ><el-form-item label="备注"
        ><el-input
          v-model="form.note"
          type="textarea"
          :rows="3"
          maxlength="500"
          placeholder="给这笔账留一句话"
      /></el-form-item>
      <div class="flex justify-end gap-2.5 pt-4">
        <el-button :disabled="saving" @click="dialog = false">取消</el-button
        ><el-button type="primary" native-type="submit" :loading="saving">记进账本</el-button>
      </div></el-form
    ></el-dialog
  >
</template>
