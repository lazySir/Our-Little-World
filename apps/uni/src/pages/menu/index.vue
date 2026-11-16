<template>
  <view class="page" :class="`theme-${session.theme}`">
    <PageHeading
      eyebrow="WHAT SHALL WE EAT"
      title="今天吃什么"
      description="把想吃的都收藏起来，下一顿就不必纠结啦。"
      symbol="♨"
    />
    <view class="toolbar">
      <input class="search" v-model="query" placeholder="搜索想吃的" />
      <wd-button size="small" @click="openNew">＋ 添加</wd-button>
    </view>
    <view class="chips">
      <view
        v-for="option in categories"
        :key="option.value"
        class="chip"
        :class="{ active: category === option.value }"
        @click="category = option.value"
        >{{ option.label }}</view
      >
      <view class="chip" :class="{ active: favoriteOnly }" @click="favoriteOnly = !favoriteOnly"
        >♡ 只看收藏</view
      >
    </view>
    <view v-if="error" class="error-box">{{ error }}</view>
    <view v-if="loading" class="loading">正在翻开菜单…</view>
    <template v-else>
      <view v-for="item in filtered" :key="item.id" class="card">
        <view class="row">
          <image
            v-if="item.asset"
            :src="assetUrl(item.asset)"
            mode="aspectFill"
            style="width: 130rpx; height: 130rpx; border-radius: 20rpx"
            @click="previewPhotos([item.asset])"
          />
          <view class="grow">
            <view class="card-title">{{ item.name }}</view>
            <view v-if="item.description" class="card-text">{{ item.description }}</view>
            <view class="meta"
              >{{ money(item.priceCents) }}
              <text class="accent" @click="favorite(item)">
                · {{ item.favorite ? '♥ 已收藏' : '♡ 收藏' }}</text
              >
            </view>
          </view>
          <view class="text-action" @click="edit(item)">编辑</view>
        </view>
        <view class="between" style="margin-top: 22rpx">
          <view class="muted">放入本次点单</view>
          <view class="quantity">
            <view class="quantity-btn" @click="change(item.id, -1)">−</view>
            <view>{{ cart[item.id] || 0 }}</view>
            <view class="quantity-btn" @click="change(item.id, 1)">＋</view>
          </view>
        </view>
      </view>
      <EmptyState
        v-if="!filtered.length"
        symbol="♨"
        title="菜单还没有这一类"
        description="从一碗面、一杯茶或者一家喜欢的小店开始吧。"
        action="添加想吃的"
        @action="openNew"
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
        label="给这一单留个备注"
        placeholder="例如：少糖，今晚一起吃" /></view
    ><view class="section-head"
      ><view class="section-title">我们的点单</view
      ><view class="muted">{{ orders.length }} 单</view></view
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
        ><view v-if="order.status === 'pending'" class="text-action" @click="completeOrder(order)"
          >✓ 完成这单</view
        ><view class="text-action delete" @click="deleteOrder(order)">删除</view></view
      ></view
    ><view v-if="!orders.length" class="no-data">想吃的选好后，在这里一起开饭。</view
    ><EditorSheet
      v-model="editor"
      :title="editing ? '编辑菜单' : '添一道想吃的'"
      :saving="saving"
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
      /><view v-if="editing" class="text-action delete" @click="remove(editing)"
        >删除这项菜单</view
      ></EditorSheet
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
import { request, notify, confirm, assetUrl, previewPhotos } from '../../lib/api';
import { money, centsFromInput, buildOrderItems } from '../../lib/domain';
const { session, items, loading, error, saving, editor, formError, load, save, remove } =
    useResource('menu'),
  category = ref('dish'),
  query = ref(''),
  favoriteOnly = ref(false),
  editing = ref(null),
  priceText = ref('0'),
  photos = ref([]),
  cart = reactive<Record<string, number>>({}),
  orders = ref([]),
  orderNote = ref(''),
  orderSaving = ref(false);
const categories = [
  { value: 'dish', label: '菜品' },
  { value: 'drink', label: '饮品' },
  { value: 'restaurant', label: '下馆子' },
];
const form = reactive({ name: '', category: 'dish', description: '', favorite: false });
const filtered = computed(() =>
  items.value.filter(
    (x) =>
      x.category === category.value &&
      (!favoriteOnly.value || x.favorite) &&
      `${x.name} ${x.description || ''}`.includes(query.value),
  ),
);
const cartCount = computed(() => Object.values(cart).reduce((a, b) => a + b, 0)),
  cartTotal = computed(() =>
    items.value.reduce((sum, item) => sum + (cart[item.id] || 0) * item.priceCents, 0),
  );
function change(id, amount) {
  cart[id] = Math.max(0, Math.min(99, (cart[id] || 0) + amount));
}
function openNew() {
  editing.value = null;
  Object.assign(form, { name: '', category: category.value, description: '', favorite: false });
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
async function loadOrders() {
  try {
    orders.value = await request('/orders');
  } catch (e) {
    notify(e.message);
  }
}
async function submitOrder() {
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
    notify('点单成功，等着开饭啦');
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
