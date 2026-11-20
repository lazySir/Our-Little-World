<template>
  <view class="page" :class="`theme-${session.theme}`">
    <PageHeading
      eyebrow="WHAT SHALL WE EAT"
      title="今天吃什么"
      description="把想吃的都收藏起来，下一顿就不必纠结啦。"
      symbol="♨"
    />
    <view class="toolbar">
      <input class="search" v-model="query" placeholder="搜索想吃的" aria-label="搜索想吃的" />
      <wd-button size="small" @click="openNew">＋ 添加</wd-button>
    </view>
    <view class="chips">
      <button
        v-for="option in filterCategories"
        :key="option.value"
        class="chip ui-reset"
        :class="{ active: category === option.value }"
        :aria-label="`${option.label}，${category === option.value ? '已选中' : '切换分类'}`"
        :aria-pressed="category === option.value"
        @click="category = option.value"
      >
        {{ option.label }}
      </button>
      <button
        class="chip ui-reset"
        :class="{ active: favoriteOnly }"
        aria-label="只看收藏"
        :aria-pressed="favoriteOnly"
        @click="favoriteOnly = !favoriteOnly"
      >
        ♡ 只看收藏
      </button>
    </view>
    <view v-if="error" class="error-box">
      <view>{{ error }}</view>
      <wd-button class="retry-button" size="small" plain @click="load">重新加载</wd-button>
    </view>
    <view v-if="loading && !hasLoaded" class="loading">正在翻开菜单…</view>
    <view v-else-if="loading" class="meta" role="status">正在更新菜单…</view>
    <template v-if="hasLoaded">
      <view v-for="item in filtered" :key="item.id" class="card">
        <view class="row">
          <button
            v-if="item.asset"
            class="photo-preview ui-reset"
            aria-label="预览菜单照片"
            @click="previewPhotos([item.asset])"
          >
            <image
              :src="assetUrl(item.asset)"
              @error="refreshAssetOnError(item.asset)"
              mode="aspectFill"
              style="width: 130rpx; height: 130rpx; border-radius: 20rpx"
            />
          </button>
          <view class="grow">
            <view class="card-title">{{ item.name }}</view>
            <view v-if="item.description" class="card-text">{{ item.description }}</view>
            <view class="meta"
              >{{ money(item.priceCents) }}
              <button
                class="accent ui-reset"
                :aria-label="item.favorite ? '取消收藏' : '收藏菜单'"
                :aria-pressed="item.favorite"
                @click="favorite(item)"
              >
                · {{ item.favorite ? '♥ 已收藏' : '♡ 收藏' }}
              </button>
            </view>
          </view>
          <button class="text-action ui-reset" @click="edit(item)">编辑</button>
        </view>
        <view class="between" style="margin-top: 22rpx">
          <view class="muted">放入本次点单</view>
          <view class="quantity">
            <button
              class="quantity-btn ui-reset"
              :aria-label="`减少 ${item.name} 数量`"
              @click="change(item.id, -1)"
            >
              −
            </button>
            <view>{{ cart[item.id] || 0 }}</view>
            <button
              class="quantity-btn ui-reset"
              :aria-label="`增加 ${item.name} 数量`"
              @click="change(item.id, 1)"
            >
              ＋
            </button>
          </view>
        </view>
      </view>
      <EmptyState
        v-if="!filtered.length"
        symbol="♨"
        :title="hasFilter ? '没有匹配的菜单' : '菜单还没有想吃的'"
        :description="hasFilter ? '试试其他关键词、分类或收藏条件。' : '从一碗面、一杯茶或者一家喜欢的小店开始吧。'"
        :action="hasFilter ? '清除筛选' : '添加想吃的'"
        @action="hasFilter ? clearFilters() : openNew()"
      /> </template
    ><view v-if="cartCount" class="sticky-cart"
      ><view class="between"
        ><view
          ><view class="card-title">这一顿 · {{ cartCount }} 份</view
          ><view class="accent">{{ money(cartTotal) }}</view></view
        ><wd-button size="small" :loading="orderSaving" @click="submitOrder"
          >提交点单</wd-button
        ></view
      ><FormField
        v-model="orderNote"
        :disabled="orderSaving"
        label="给这一单留个备注"
        placeholder="例如：少糖，今晚一起吃" /></view
    ><view class="section-head"
      ><view class="section-title">我们的点单</view
      ><view class="muted">{{ ordersLoaded ? orders.length + ' 单' : '' }}</view></view
    ><view v-if="ordersError" class="error-box">
      <view>{{ ordersError }}</view>
      <wd-button class="retry-button" size="small" plain @click="loadOrders">重新加载</wd-button>
    </view>
    ><view v-if="ordersLoading && !ordersLoaded" class="loading">点单记录打开中…</view
    ><view v-else-if="ordersLoading" class="meta" role="status">正在更新点单记录…</view
    ><view v-for="order in orders" :key="order.id" class="card"
      ><view class="between"
        ><view class="card-title">{{ money(order.totalCents) }}</view
        ><view class="pill" :class="{ sage: order.status === 'done' }">{{
          order.status === 'done' ? '已经吃好啦' : '等着开饭'
        }}</view></view
      ><view v-for="item in order.items" :key="item.menuItemId" class="meta"
        >{{ item.name }} × {{ item.quantity }}</view
      ><view v-if="order.note" class="card-text">{{ order.note }}</view
      ><view class="actions"
        ><button
          v-if="order.status === 'pending'"
          class="text-action ui-reset"
          @click="completeOrder(order)"
        >
          ✓ 完成这单</button
        ><button class="text-action delete ui-reset" @click="deleteOrder(order)">删除</button></view
      ></view
    ><view v-if="ordersLoaded && !ordersLoading && !orders.length" class="no-data"
      >想吃的选好后，在这里一起开饭。</view
    ><EditorSheet
      v-model="editor"
      :title="editing ? '编辑菜单' : '添一道想吃的'"
      :saving="saving"
      :uploading="uploading"
      :error="formError"
      @save="saveForm"
      ><FormField
        v-model="form.name"
        label="名字"
        required
        placeholder="菜名、饮品名或餐厅名"
      /><FormField
        v-model="form.category"
        label="分类"
        kind="select"
        :options="categories"
      /><FormField
        v-model="form.description"
        label="好吃在哪里"
        kind="textarea"
        placeholder="口味、地址或推荐点法"
      /><FormField
        v-model="priceText"
        label="价格（元）"
        kind="number"
        placeholder="0.00"
      /><FormField v-model="form.favorite" label="加入收藏" kind="switch" /><PhotoPicker
        v-model="photos"
        :max="1"
        :disabled="saving"
        @busy="uploading = $event"
      /><button v-if="editing" class="text-action delete ui-reset" @click="remove(editing)">
        删除这项菜单
      </button></EditorSheet
    ></view
  >
</template>
<script setup lang="ts">
import { ref, reactive, computed } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import PageHeading from '../../components/PageHeading.vue';
import EmptyState from '../../components/EmptyState.vue';
import EditorSheet from '../../components/EditorSheet.vue';
import FormField from '../../components/FormField.vue';
import PhotoPicker from '../../components/PhotoPicker.vue';
import { useResource } from '../../lib/useResource';
import { request, notify, confirm, assetUrl, previewPhotos, refreshAssetOnError } from '../../lib/api';
import { money, centsFromInput, buildOrderItems } from '../../lib/domain';
const { session, items, hasLoaded, loading, error, saving, editor, formError, load, save, remove } =
    useResource('menu'),
  category = ref('dish'),
  query = ref(''),
  favoriteOnly = ref(false),
  editing = ref(null),
  priceText = ref('0'),
  photos = ref([]),
  uploading = ref(false),
  cart = reactive<Record<string, number>>({}),
  orders = ref([]),
  orderNote = ref(''),
  orderSaving = ref(false),
  ordersLoaded = ref(false),
  ordersLoading = ref(false),
  ordersError = ref('');
const categories = [
  { value: 'dish', label: '菜品' },
  { value: 'drink', label: '饮品' },
  { value: 'restaurant', label: '下馆子' },
];
const filterCategories = [{ value: 'all', label: '全部' }, ...categories];
const form = reactive({ name: '', category: 'dish', description: '', favorite: false });
const normalizedQuery = computed(() => query.value.trim().toLowerCase());
const hasFilter = computed(
  () => !!normalizedQuery.value || category.value !== 'all' || favoriteOnly.value,
);
const filtered = computed(() =>
  items.value.filter(
    (x) =>
      (category.value === 'all' || x.category === category.value) &&
      (!favoriteOnly.value || x.favorite) &&
      `${x.name} ${x.description || ''}`.toLowerCase().includes(normalizedQuery.value),
  ),
);
function clearFilters() {
  query.value = '';
  category.value = 'all';
  favoriteOnly.value = false;
}
const cartCount = computed(() => items.value.reduce((sum, item) => sum + (cart[item.id] || 0), 0)),
  cartTotal = computed(() =>
    items.value.reduce((sum, item) => sum + (cart[item.id] || 0) * item.priceCents, 0),
  );
function change(id, amount) {
  if (orderSaving.value) return;
  cart[id] = Math.max(0, Math.min(99, (cart[id] || 0) + amount));
}
function openNew() {
  editing.value = null;
  Object.assign(form, {
    name: '',
    category: category.value === 'all' ? 'dish' : category.value,
    description: '',
    favorite: false,
  });
  photos.value = [];
  priceText.value = '0';
  editor.value = true;
}
function edit(item) {
  editing.value = item;
  Object.assign(form, {
    name: item.name,
    category: item.category,
    description: item.description,
    favorite: item.favorite,
  });
  photos.value = item.asset ? [item.asset] : [];
  priceText.value = String(item.priceCents / 100);
  editor.value = true;
}
async function saveForm() {
  try {
    if (!form.name.trim()) throw Error('先写下菜品或店铺的名字');
    await save(
      {
        ...form,
        name: form.name.trim(),
        priceCents: centsFromInput(priceText.value || '0'),
        assetId: photos.value[0]?.id || null,
      },
      editing.value?.id,
    );
  } catch (e) {
    formError.value = e.message;
  }
}
async function favorite(item) {
  try {
    await request(`/menu/${item.id}`, 'PATCH', { favorite: !item.favorite });
    await load();
  } catch (e) {
    notify(e.message);
  }
}
let orderLoadVersion = 0;
async function loadOrders() {
  const version = ++orderLoadVersion;
  ordersLoading.value = true;
  ordersError.value = '';
  try {
    const result = await request('/orders');
    if (version === orderLoadVersion) {
      orders.value = result;
      ordersLoaded.value = true;
    }
  } catch (e) {
    if (version === orderLoadVersion) ordersError.value = e.message;
  } finally {
    if (version === orderLoadVersion) ordersLoading.value = false;
  }
}
async function submitOrder() {
  if (orderSaving.value) return;
  orderSaving.value = true;
  try {
    const orderItems = buildOrderItems(items.value, cart);
    if (!orderItems.length) throw Error('先选一点想吃的');
    await request('/orders', 'POST', {
      items: orderItems,
      note: orderNote.value,
      status: 'pending',
    });
    Object.keys(cart).forEach((key) => delete cart[key]);
    orderNote.value = '';
    await loadOrders();
    notify('点单成功，等着开饭啦', 'success');
  } catch (e) {
    notify(e.message);
  } finally {
    orderSaving.value = false;
  }
}
async function completeOrder(order) {
  try {
    await request(`/orders/${order.id}`, 'PATCH', { status: 'done' });
    await loadOrders();
  } catch (e) {
    notify(e.message);
  }
}
async function deleteOrder(order) {
  if (!(await confirm('删除这次点单？'))) return;
  try {
    await request(`/orders/${order.id}`, 'DELETE');
    await loadOrders();
  } catch (e) {
    notify(e.message);
  }
}
onShow(loadOrders);
</script>
