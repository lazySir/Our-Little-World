<template>
  <view class="page" :class="`theme-${session.theme}`">
    <PageHeading
      eyebrow="MAKE IT YOURS"
      title="我们的设置"
      description="把这个小世界，慢慢变成你们喜欢的样子。"
      symbol="⚙"
    />
    <view class="section-head">
      <view class="section-title">我的小名片</view>
    </view>
    <view class="card">
      <FormField
        v-model="nickname"
        label="怎么称呼我"
        required
        :maxlength="40"
        :disabled="settingsLocked"
      />
      <view class="meta">登录账号 · {{ session.user?.username }}</view>
      <wd-button
        block
        :loading="busy === 'profile'"
        :disabled="settingsLocked"
        style="margin-top: 24rpx"
        @click="saveProfile"
        >保存昵称</wd-button
      >
    </view>
    <view class="section-head">
      <view class="section-title">小世界档案</view>
    </view>
    <view class="card">
      <FormField
        v-model="space.name"
        label="小世界的名字"
        required
        :maxlength="60"
        :disabled="settingsLocked"
      />
      <FormField
        v-model="space.startDate"
        label="故事开始的那一天"
        required
        kind="date"
        :max="today()"
        :disabled="settingsLocked"
      />
      <view class="form-label">喜欢哪种颜色</view>
      <view class="feature-grid" style="grid-template-columns: repeat(3, 1fr)">
        <view v-for="theme in themes" :key="theme.value" @click="selectTheme(theme.value)">
          <view
            class="theme-swatch"
            :style="{
              background: theme.background,
              border:
                space.theme === theme.value
                  ? '3rpx solid ' + theme.color
                  : '3rpx solid transparent',
            }"
          />
          <view class="center small" :class="{ accent: space.theme === theme.value }">{{
            theme.label
          }}</view>
        </view>
      </view>
      <wd-button
        block
        :loading="busy === 'space'"
        :disabled="settingsLocked"
        style="margin-top: 26rpx"
        @click="saveSpace"
        >保存小世界</wd-button
      >
    </view>
    <view class="section-head">
      <view class="section-title">邀请另一半</view>
    </view>
    <view class="card">
      <view v-if="session.partner" class="row">
        <view class="avatar">{{ session.partner.nickname.slice(0, 1) }}</view>
        <view>
          <view class="card-title">{{ session.partner.nickname }}</view>
          <view class="meta">已经在这里，陪你记录日常</view>
        </view>
      </view>
      <template v-else>
        <view class="card-text">这个空间最多住两个人。邀请码 24 小时有效，只能使用一次。</view>
        <view v-if="invitation" class="note" style="margin: 20rpx 0">
          <view class="card-title">{{ invitation.code }}</view>
          <view class="meta">有效至 {{ new Date(invitation.expiresAt).toLocaleString() }}</view>
          <view class="text-action" @click="copy(invitation.code)">复制邀请码</view>
        </view>
        <wd-button block plain :loading="busy === 'invite'" @click="invite"
          >生成专属邀请码</wd-button
        >
      </template></view
    ><view class="section-head"><view class="section-title">连接到自己的服务</view></view
    ><view class="card"
      ><FormField
        v-model="apiBase"
        label="接口地址"
        placeholder="http://192.168.1.10:3000/api"
        hint="手机上的 127.0.0.1 指手机自己，请填写部署电脑的局域网地址；微信正式版填写已配置的 HTTPS 域名。"
      /><wd-button block plain :loading="busy === 'server'" @click="saveServer"
        >检查并保存地址</wd-button
      ></view
    ><view class="section-head"><view class="section-title">修改密码</view></view
    ><view class="card"
      ><FormField
        v-model="password.currentPassword"
        label="当前密码"
        kind="password"
        required
        :maxlength="128"
      /><FormField
        v-model="password.newPassword"
        label="新密码"
        kind="password"
        required
        placeholder="至少 8 位"
        :maxlength="128"
      /><FormField
        v-model="password.confirmPassword"
        label="再输入一次新密码"
        kind="password"
        required
        :maxlength="128"
      /><wd-button block plain :loading="busy === 'password'" @click="changePassword"
        >更新密码</wd-button
      ></view
    ><view class="section-head"><view class="section-title">把回忆好好保存</view></view
    ><view class="card"
      ><view class="card-text"
        >数据导出用于阅读和迁移，完整备份包含数据库与服务内处理后的照片。相机原片请另行保存，备份请放在你信任的位置。</view
      ><view class="actions"
        ><wd-button size="small" plain :loading="busy === 'export'" @click="download('export')"
          >导出数据 JSON</wd-button
        ><wd-button
          v-if="session.user?.role === 'owner'"
          size="small"
          plain
          :loading="busy === 'backup'"
          @click="download('backup')"
          >下载完整 ZIP</wd-button
        ></view
      ><template v-if="session.user?.role === 'owner'"
        ><view class="divider" /><view class="card-title">从备份恢复</view
        ><view class="card-text"
          >选择本应用导出的
          ZIP。恢复会覆盖当前空间数据，服务端会先保存恢复前备份；成功后会回到首页查看恢复的记录。</view
        ><wd-button
          block
          plain
          type="warning"
          style="margin-top: 22rpx"
          :loading="busy === 'restore'"
          @click="restore"
          >选择 ZIP 并恢复</wd-button
        ></template
      ></view
    ><view v-if="error" class="error-box">{{ error }}</view
    ><wd-button v-if="!ready" block plain :loading="settingsLoading" @click="loadSettings"
      >重新读取设置</wd-button
    ><wd-button block plain type="error" @click="logout">退出当前设备</wd-button
    ><view class="auth-bottom">我们的小世界 · 1.0.0<br />只属于你们的生活手账 ♡</view></view
  >
</template>
<script setup lang="ts">
import { ref, reactive, computed } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import PageHeading from '../../components/PageHeading.vue';
import FormField from '../../components/FormField.vue';
import { useSession } from '../../stores/session';
import {
  request,
  getBase,
  connectBase,
  notify,
  confirm,
  copy,
  downloadArchive,
  chooseArchive,
  uploadFile,
} from '../../lib/api';
import { today } from '../../lib/domain';
import type { Space } from '../../types';
const session = useSession(),
  nickname = ref(session.user?.nickname || ''),
  space = reactive({
    name: session.space?.name || '',
    startDate: session.space?.startDate || '',
    theme: session.space?.theme || 'cream',
  }),
  ready = ref(session.loaded && !!session.user && !!session.space),
  settingsLoading = ref(false),
  apiBase = ref(getBase()),
  busy = ref(''),
  error = ref(''),
  invitation = ref<{
    code: string;
    expiresAt: string;
  } | null>(null),
  password = reactive({ currentPassword: '', newPassword: '', confirmPassword: '' });
let savedNickname = nickname.value,
  savedSpace = { ...space },
  loadVersion = 0,
  readError: string | null = null;
const settingsLocked = computed(() => !ready.value || !!busy.value);
function syncDrafts() {
  if (!session.user || !session.space) return;
  if (nickname.value === savedNickname) {
    nickname.value = session.user.nickname;
    savedNickname = nickname.value;
  }
  if (Object.keys(savedSpace).every((key) => space[key] === savedSpace[key])) {
    savedSpace = {
      name: session.space.name,
      startDate: session.space.startDate,
      theme: session.space.theme,
    };
    Object.assign(space, savedSpace);
  }
  ready.value = true;
}
function selectTheme(theme: Space['theme']) {
  if (!settingsLocked.value) space.theme = theme;
}
const themes = [
  { value: 'cream', label: '奶油手账', background: '#efe4ce', color: '#b99866' },
  { value: 'rose', label: '玫瑰日记', background: '#f3dfe5', color: '#b66e86' },
  { value: 'sage', label: '鼠尾草绿', background: '#e2ead9', color: '#6f8974' },
] as const;
async function action(key: string, work: () => Promise<void>) {
  if (busy.value) return;
  loadVersion++;
  settingsLoading.value = false;
  readError = null;
  busy.value = key;
  error.value = '';
  try {
    await work();
  } catch (e) {
    error.value = e.message;
    notify(e.message);
  } finally {
    busy.value = '';
  }
}
async function saveProfile() {
  if (!ready.value) return;
  await action('profile', async () => {
    if (!nickname.value.trim()) throw Error('昵称不能为空');
    const submitted = nickname.value.trim();
    await request('/auth/profile', 'PATCH', { nickname: submitted });
    nickname.value = submitted;
    savedNickname = submitted;
    if (await session.load()) syncDrafts();
    notify('昵称保存好啦');
  });
}
async function saveSpace() {
  if (!ready.value) return;
  await action('space', async () => {
    if (!space.name.trim() || !space.startDate) throw Error('请写下小世界名字和开始日期');
    const submitted = { ...space };
    await request('/space', 'PATCH', submitted);
    savedSpace = submitted;
    if (await session.load()) syncDrafts();
    notify('小世界更新好啦');
  });
}
async function invite() {
  await action('invite', async () => {
    invitation.value = await request('/auth/invite', 'POST');
  });
}
async function saveServer() {
  await action('server', async () => {
    const previous = getBase();
    await connectBase(apiBase.value);
    if (previous !== getBase()) {
      session.clear();
      uni.reLaunch({ url: '/pages/auth/index' });
      notify('已连接到新服务，请登录这个空间的账号');
    } else {
      notify('已经连接到服务');
    }
  });
}
async function changePassword() {
  await action('password', async () => {
    if (password.newPassword.length < 8) throw Error('新密码至少 8 位');
    if (password.newPassword !== password.confirmPassword) throw Error('两次新密码不一致');
    await request('/auth/password', 'PATCH', {
      currentPassword: password.currentPassword,
      newPassword: password.newPassword,
    });
    Object.assign(password, { currentPassword: '', newPassword: '', confirmPassword: '' });
    notify('密码已更新，其他设备需要重新登录');
  });
}
async function download(kind: string) {
  await action(kind, async () => {
    const result = await downloadArchive(
      kind === 'export' ? '/backup/export' : '/backup/download',
      `little-world-${today()}.${kind === 'export' ? 'json' : 'zip'}`,
    );
    if (result) notify('备份已导出，请在接收位置确认文件');
  });
}
async function restore() {
  await action('restore', async () => {
    const path = await chooseArchive();
    if (!path) return;
    if (
      !(await confirm(
        '恢复会覆盖当前空间的记录和照片。服务端会先保存恢复前备份，确定继续吗？',
        '恢复完整备份',
      ))
    )
      return;
    const result = await uploadFile<{ safetyMissingAssets?: number; safetyDamagedAssets?: number }>(
      path,
      '/backup/restore',
    );
    await session.load();
    const affectedPhotos = (result.safetyMissingAssets || 0) + (result.safetyDamagedAssets || 0);
    if (affectedPhotos) {
      await new Promise<void>((resolve) =>
        uni.showModal({
          title: '记录已经恢复',
          content: `恢复前已有 ${affectedPhotos} 张照片文件缺失或大小异常，保护副本已标记这些问题；本次已按所选备份恢复。`,
          showCancel: false,
          confirmText: '知道了',
          confirmColor: '#b8776e',
          complete: () => resolve(),
        }),
      );
    } else notify('恢复完成，记录已经回到小世界');
    uni.reLaunch({ url: '/pages/home/index' });
  });
}
async function logout() {
  if (busy.value) return;
  if (await confirm('退出这个设备？你们的记录仍保存在服务中。')) await session.logout();
}
async function loadSettings() {
  if (busy.value) return;
  const version = ++loadVersion;
  settingsLoading.value = true;
  try {
    if (!(await session.load()) || version !== loadVersion) return;
    syncDrafts();
    if (error.value === readError) error.value = '';
    readError = null;
  } catch (e) {
    if (version === loadVersion) error.value = readError = e.message;
  } finally {
    if (version === loadVersion) settingsLoading.value = false;
  }
}
onShow(loadSettings);
</script>
