<template>
  <view class="page auth-page">
    <image class="auth-art" src="/static/little-house.png" mode="aspectFit" />
    <view class="center">
      <view class="eyebrow">A HOME FOR TWO</view>
      <view class="title" style="margin-top: 15rpx">欢迎来到我们的小世界</view>
      <view class="subtitle">把平凡的日子，过成喜欢的模样。</view>
    </view>
    <view class="chips" style="justify-content: center; margin-top: 32rpx">
      <view
        v-for="tab in tabs"
        :key="tab.value"
        class="chip"
        :class="{ active: mode === tab.value }"
        @click="
          mode = tab.value;
          error = '';
        "
        >{{ tab.label }}</view
      >
    </view>
    <view class="card auth-form">
      <view v-if="mode === 'setup'" class="note">第一次来？为你们创建一个只属于两个人的空间。</view>
      <FormField
        v-if="mode === 'join'"
        v-model="form.code"
        label="对方发来的邀请码"
        required
        placeholder="粘贴 24 小时内有效的邀请码"
      />
      <FormField
        v-model="form.username"
        label="登录账号"
        required
        placeholder="给自己起一个账号"
        :maxlength="64"
      />
      <FormField
        v-model="form.password"
        label="密码"
        required
        kind="password"
        placeholder="至少 8 位，建议使用字母和数字"
        :maxlength="128"
      />
      <FormField
        v-if="mode !== 'login'"
        v-model="form.nickname"
        label="怎么称呼你"
        required
        placeholder="对方最熟悉的名字"
        :maxlength="40"
      />
      <template v-if="mode === 'setup'">
        <FormField
          v-model="form.spaceName"
          label="我们的小世界叫做"
          required
          placeholder="例如：小熊和兔子的家"
          :maxlength="60"
        />
        <FormField
          v-model="form.startDate"
          label="故事开始的那一天"
          required
          kind="date"
          :max="today()"
        /> </template
      ><view v-if="error" class="error-box">{{ error }}</view
      ><wd-button block :loading="saving" @click="submit">{{
        mode === 'setup' ? '创建我们的小世界' : mode === 'join' ? '加入对方的世界' : '回家啦'
      }}</wd-button></view
    ><view class="auth-bottom" @click="showServer = !showServer"
      >连接设置 · {{ getBase()
      }}<view class="accent">{{ showServer ? '收起' : '修改服务地址' }}</view></view
    ><view v-if="showServer" class="card"
      ><FormField
        v-model="apiBase"
        label="小世界服务地址"
        placeholder="http://192.168.1.10:3000/api"
        hint="手机请填写部署电脑的局域网 IP；微信正式版需要合法的 HTTPS 域名。"
      /><wd-button block plain @click="saveBase">保存地址并检查连接</wd-button></view
    ><view class="auth-bottom"
      >记录存放在你自己的服务中<br />愿这里装下你们的每一种日常 ✧</view
    ></view
  >
</template>
<script setup lang="ts">
import { reactive, ref, computed } from 'vue';
import { onLoad } from '@dcloudio/uni-app';
import FormField from '../../components/FormField.vue';
import { useSession } from '../../stores/session';
import { getBase, setBase, getToken, request, notify } from '../../lib/api';
import { today } from '../../lib/domain';
const session = useSession(),
  mode = ref('login'),
  initialized = ref(true),
  saving = ref(false),
  error = ref(''),
  showServer = ref(false),
  apiBase = ref(getBase());
const form = reactive({
  username: '',
  password: '',
  nickname: '',
  spaceName: '我们的小世界',
  startDate: today(),
  code: '',
});
const tabs = computed(() => [
  ...(!initialized.value ? [{ value: 'setup', label: '创建空间' }] : []),
  { value: 'login', label: '回到小世界' },
  { value: 'join', label: '加入另一半' },
]);
async function check() {
  try {
    const result = await request('/auth/status', 'GET', undefined, true);
    initialized.value = result.initialized;
    mode.value = result.initialized ? 'login' : 'setup';
    error.value = '';
  } catch (e) {
    error.value = e.message;
    showServer.value = true;
  }
}
onLoad(async () => {
  if (getToken()) {
    try {
      if (await session.load()) {
        uni.switchTab({ url: '/pages/home/index' });
        return;
      }
    } catch {}
  }
  await check();
});
async function saveBase() {
  try {
    setBase(apiBase.value);
    await check();
    notify('服务地址已保存');
  } catch (e) {
    error.value = e.message;
  }
}
async function submit() {
  error.value = '';
  if (!form.username.trim() || !form.password) {
    error.value = '请填写账号和密码';
    return;
  }
  if (mode.value !== 'login' && (!form.nickname.trim() || form.password.length < 8)) {
    error.value = '请填写昵称，并设置至少 8 位的密码';
    return;
  }
  if (mode.value === 'join' && !form.code.trim()) {
    error.value = '请先填写对方发来的邀请码';
    return;
  }
  saving.value = true;
  try {
    await session.authenticate(mode.value, {
      ...form,
      username: form.username.trim(),
      nickname: form.nickname.trim(),
      code: form.code.trim(),
    });
  } catch (e) {
    error.value = e.message;
  } finally {
    saving.value = false;
  }
}
</script>
