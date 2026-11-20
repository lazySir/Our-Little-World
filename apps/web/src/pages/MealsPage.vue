<script setup lang="ts">
import type { MenuItem, Order, Asset } from '../types';
import { computed, reactive, ref, onMounted } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { api, assetUrl, refreshAssetOnError } from '../api';
import { useResource } from '../composables/resource';
import { menuCategories, money } from '../domain';
import PhotoUpload from '../components/PhotoUpload.vue';
const { items, loading, error, load, save, remove } = useResource<MenuItem>('/menu');
const orders = ref<Order[]>([]),
  cart = reactive<Record<string, number>>({}),
  assets = ref<Asset[]>([]);
const query = ref(''),
  tab = ref('all'),
  showAllOrders = ref(false),
  dialog = ref(false),
  orderDialog = ref(false),
  editing = ref<MenuItem | null>(null),
  saving = ref(false),
  uploading = ref(false),
  orderBusy = ref(false),
  orderError = ref('');
const form = reactive({
  name: '',
  category: 'dish',
  description: '',
  priceCents: 0,
  favorite: false,
  assetId: null as string | null,
});
const orderNote = ref('');
const menuPhoto = computed({
  get: () => (form.assetId ? [form.assetId] : []),
  set: (v) => (form.assetId = v[0] || null),
});
const tabs = [
  ['all', '全部'],
  ['dish', '拿手菜'],
  ['drink', '想喝的'],
  ['restaurant', '好店收藏'],
  ['favorite', '已收藏'],
];
const filtered = computed(() =>
  items.value.filter(
    (i) =>
      (tab.value === 'all' || tab.value === 'favorite'
        ? tab.value === 'all' || i.favorite
        : i.category === tab.value) &&
      (!query.value ||
        `${i.name} ${i.description}`.toLowerCase().includes(query.value.toLowerCase())),
  ),
);
const cartRows = computed(() =>
  items.value.filter((i) => cart[i.id]).map((i) => ({ ...i, quantity: cart[i.id] })),
);
const total = computed(() => cartRows.value.reduce((sum, i) => sum + i.priceCents * i.quantity, 0));
const visibleOrders = computed(() =>
  showAllOrders.value ? orders.value : orders.value.slice(0, 6),
);
const editorBusy = computed(() => uploading.value || saving.value);
function edit(item: MenuItem | null = null) {
  if (editorBusy.value) return;
  editing.value = item;
  Object.assign(
    form,
    item
      ? { ...item, priceCents: item.priceCents / 100 }
      : {
          name: '',
          category: 'dish',
          description: '',
          priceCents: 0,
          favorite: false,
          assetId: null,
        },
  );
  dialog.value = true;
  api
    .get<Asset[]>('/assets')
    .then((a) => (assets.value = a))
    .catch(() => {});
}
async function submit() {
  if (editorBusy.value) return;
  if (!form.name.trim()) {
    ElMessage.warning('给美味起个名字吧');
    return;
  }
  saving.value = true;
  try {
    await save(
      {
        name: form.name,
        category: form.category,
        description: form.description,
        priceCents: Math.round(form.priceCents * 100),
        favorite: form.favorite,
        assetId: form.assetId,
      },
      editing.value?.id,
    );
    dialog.value = false;
  } catch {
  } finally {
    saving.value = false;
  }
}
function add(i: MenuItem) {
  if (orderBusy.value) return;
  if ((cart[i.id] || 0) >= 99) {
    ElMessage.warning('每项最多选择 99 份');
    return;
  }
  cart[i.id] = (cart[i.id] || 0) + 1;
}
function minus(i: MenuItem) {
  if (orderBusy.value) return;
  if (!cart[i.id]) return;
  if (cart[i.id] === 1) delete cart[i.id];
  else cart[i.id]--;
}
let orderLoadSequence = 0;
async function fetchOrders() {
  const sequence = ++orderLoadSequence;
  try {
    const result = await api.get<Order[]>('/orders');
    if (sequence !== orderLoadSequence) return;
    orders.value = result;
    orderError.value = '';
  } catch (e) {
    if (sequence === orderLoadSequence) orderError.value = e.message;
  }
}
async function submitOrder() {
  if (!cartRows.value.length || orderBusy.value) return;
  orderBusy.value = true;
  try {
    await api.post('/orders', {
      items: cartRows.value.map((i) => ({ menuItemId: i.id, quantity: i.quantity })),
      note: orderNote.value,
      status: 'pending',
    });
    Object.keys(cart).forEach((k) => delete cart[k]);
    orderNote.value = '';
    orderDialog.value = false;
    await fetchOrders();
    ElMessage.success('点单已记下，等我们一起开饭');
  } catch (e) {
    ElMessage.error(e.message);
  } finally {
    orderBusy.value = false;
  }
}
async function completeOrder(order: Order) {
  try {
    await api.patch(`/orders/${order.id}`, {
      status: order.status === 'done' ? 'pending' : 'done',
    });
    await fetchOrders();
    ElMessage.success(order.status === 'done' ? '点单已重新打开' : '这一餐，完成！');
  } catch (e) {
    ElMessage.error(e.message);
  }
}
async function deleteOrder(order: Order) {
  try {
    await ElMessageBox.confirm('删除这份点单后无法撤销。', '删除点单', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消',
    });
  } catch {
    return;
  }
  try {
    await api.delete(`/orders/${order.id}`);
    await fetchOrders();
    ElMessage.success('点单已删除');
  } catch (e) {
    ElMessage.error(e.message);
  }
}
async function editOrder(order: Order) {
  try {
    const result = await ElMessageBox.prompt('给这顿饭留一句备注', '修改点单', {
      inputValue: order.note,
      inputType: 'textarea',
      confirmButtonText: '保存',
      cancelButtonText: '取消',
    });
    await api.patch(`/orders/${order.id}`, { note: result.value });
    await fetchOrders();
    ElMessage.success('点单备注已修改');
  } catch (e) {
    if (e instanceof Error) ElMessage.error(e.message);
  }
}
onMounted(fetchOrders);
</script>
<template>
  <PageHeader title="今天吃什么" description="好好吃饭，是我们一起生活最朴素的浪漫。"
    ><div class="header-actions">
      <el-button @click="orderDialog = true" :disabled="!cartRows.length"
        ><AppIcon name="meal" :size="16" />购物篮
        <el-badge v-if="cartRows.length" :value="cartRows.length" /></el-button
      ><el-button type="primary" @click="edit()"
        ><AppIcon name="plus" :size="16" />添加收藏</el-button
      >
    </div></PageHeader
  ><LoadState :loading="loading" :error="error" @retry="load"
    ><div class="toolbar">
      <div class="filter-tabs">
        <button
          v-for="[key, label] in tabs"
          :key="key"
          class="filter-tab"
          :class="{ active: tab === key }"
          @click="tab = key"
        >
          {{ label
          }}<span class="count">{{
            items.filter((i) =>
              key === 'all' || key === 'favorite'
                ? key === 'all' || i.favorite
                : i.category === key,
            ).length
          }}</span>
        </button>
      </div>
      <el-input v-model="query" placeholder="搜索菜品、饮品或餐厅" clearable
        ><template #prefix><AppIcon name="search" :size="15" /></template
      ></el-input>
    </div>
    <div v-if="filtered.length" class="card-grid">
      <article v-for="item in filtered" :key="item.id" class="panel record-card meal-card">
        <div class="flex items-start justify-between gap-4">
          <div>
            <span class="tag" :class="item.favorite ? 'rose' : ''">{{
              menuCategories[item.category]
            }}</span>
            <h3>{{ item.name }}</h3>
          </div>
          <div class="flex shrink-0 gap-0.5">
            <button
              class="icon-button"
              :title="item.favorite ? '取消收藏' : '收藏'"
              @click="save({ ...item, favorite: !item.favorite }, item.id)"
            >
              <AppIcon name="heart" :size="16" /></button
            ><button class="icon-button" title="编辑" @click="edit(item)">
              <AppIcon name="edit" :size="16" /></button
            ><button class="icon-button" title="删除" @click="remove(item)">
              <AppIcon name="trash" :size="16" />
            </button>
          </div>
        </div>
        <el-image
          v-if="item.asset"
          :src="assetUrl(item.asset)"
          @error="refreshAssetOnError(item.asset)"
          fit="cover"
          class="meal-photo"
          :preview-src-list="[assetUrl(item.asset)]"
          preview-teleported
        />
        <p v-if="item.description" class="body-text">{{ item.description }}</p>
        <div class="meal-price" v-if="item.priceCents">¥ {{ money(item.priceCents) }}</div>
        <div class="card-footer">
          <span class="muted">{{ item.favorite ? '我们都喜欢' : '加入今晚的选择' }}</span><el-button
            size="small"
            type="primary"
            :disabled="orderBusy"
            @click="add(item)"
            ><AppIcon name="plus" :size="14" />加入购物篮</el-button
          >
        </div>
      </article>
    </div>
    <div v-else class="panel">
      <EmptyState
        title="好吃的，等我们一起收藏"
        description="记录一道拿手菜、一杯喜欢的饮品，或者下一次想去的餐厅。"
        icon="meal"
        action="添加第一道美味"
        @action="edit()"
      />
    </div>
    <el-alert v-if="orderError" :title="orderError" type="error" :closable="false" class="mt-6" />
    <section v-if="orders.length" class="orders-section">
      <div class="section-head">
        <h3><AppIcon name="meal" :size="18" />最近的点单<span class="subtitle">OUR TABLE</span></h3>
        <el-button
          v-if="orders.length > 6"
          text
          type="primary"
          :aria-expanded="showAllOrders"
          aria-controls="order-history"
          @click="showAllOrders = !showAllOrders"
          >{{ showAllOrders ? '收起点单' : `查看全部点单（${orders.length}）` }}</el-button
        >
      </div>
      <div id="order-history" class="orders-list panel">
        <div
          v-for="order in visibleOrders"
          :key="order.id"
          :data-order-id="order.id"
          class="order-row"
        >
          <div>
            <strong>{{
              order.items.map((i) => `${i.name} ×${i.quantity}`).join('、')
            }}</strong><small
              >{{ order.createdAt?.slice(0, 10) }} · {{ order.note || '没有备注' }}</small
            >
          </div>
          <span class="tag" :class="order.status === 'done' ? 'green' : ''">{{
            order.status === 'done' ? '已完成' : '等开饭'
          }}</span><el-button
            v-if="order.status !== 'done'"
            text
            size="small"
            @click="completeOrder(order)"
            ><AppIcon name="check" :size="14" />完成</el-button
          ><button class="icon-button" title="修改点单备注" @click="editOrder(order)">
            <AppIcon name="edit" :size="16" /></button
          ><button class="icon-button" title="删除点单" @click="deleteOrder(order)">
            <AppIcon name="trash" :size="16" />
          </button>
        </div>
      </div></section></LoadState
  ><el-dialog
    v-model="dialog"
    :title="editing ? '修改收藏' : '添加美味'"
    width="min(500px,94vw)"
    :show-close="!editorBusy"
    :close-on-click-modal="!editorBusy"
    :close-on-press-escape="!editorBusy"
    ><el-form :model="form" :disabled="saving" label-position="top" @submit.prevent="submit"
      ><el-form-item label="名称" required
        ><el-input
          v-model="form.name"
          maxlength="100"
          placeholder="例如：番茄牛腩、桂花拿铁、周末想去的店"
      /></el-form-item>
      <div class="form-grid">
        <el-form-item label="分类"
          ><el-select v-model="form.category"
            ><el-option
              v-for="(label, key) in menuCategories"
              :key="key"
              :label="label"
              :value="key" /></el-select></el-form-item
        ><el-form-item label="价格（元）"
          ><el-input-number
            v-model="form.priceCents"
            :min="0"
            :precision="2"
            :step="0.01"
            controls-position="right"
          /><span class="form-hint">不填写价格也可以收藏</span></el-form-item
        >
      </div>
      <el-form-item label="小备注"
        ><el-input
          v-model="form.description"
          type="textarea"
          :rows="3"
          maxlength="500" /></el-form-item
      ><el-form-item label="美味照片"
        ><PhotoUpload
          v-model="menuPhoto"
          :assets="[...assets, ...(editing?.asset ? [editing.asset] : [])]"
          :limit="1"
          :disabled="saving"
          @busy="uploading = $event" /></el-form-item
      ><el-form-item label="加入收藏"><el-switch v-model="form.favorite" /></el-form-item>
      <div class="dialog-footer">
        <el-button :disabled="editorBusy" @click="dialog = false">取消</el-button
        ><el-button type="primary" native-type="submit" :loading="saving" :disabled="uploading"
          >保存</el-button
        >
      </div></el-form
    ></el-dialog
  ><el-dialog
    v-model="orderDialog"
    title="今晚吃什么"
    width="min(500px,94vw)"
    :close-on-click-modal="!orderBusy"
    :close-on-press-escape="!orderBusy"
    :show-close="!orderBusy"
    ><div class="cart-list">
      <div v-for="i in cartRows" :key="i.id" class="cart-row">
        <span>{{ i.name }}</span>
        <div>
          <button class="quantity" :disabled="orderBusy" @click="minus(i)">−</button
          ><strong>{{ i.quantity }}</strong
          ><button class="quantity" :disabled="orderBusy" @click="add(i)">＋</button>
        </div>
        <strong>¥ {{ money(i.priceCents * i.quantity) }}</strong>
      </div>
    </div>
    <el-input
      v-model="orderNote"
      :disabled="orderBusy"
      type="textarea"
      :rows="3"
      placeholder="给今晚留一句备注，例如：记得加辣"
    />
    <div class="order-total">
      合计 <strong>¥ {{ money(total) }}</strong>
    </div>
    <template #footer
      ><el-button :disabled="orderBusy" @click="orderDialog = false">再选选</el-button
      ><el-button type="primary" :loading="orderBusy" @click="submitOrder"
        >一起下单</el-button
      ></template
    ></el-dialog
  >
</template>
