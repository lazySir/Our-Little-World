<script setup lang="ts">
import { reactive, ref, computed } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { useRouter } from 'vue-router';
import { useSession } from '../stores/session';
import { api, getBase, connectBase, download, request } from '../api';
import { today } from '../domain';
const session = useSession(),
  router = useRouter();
const profile = reactive({ nickname: session.user?.nickname || '' }),
  space = reactive({
    name: session.space?.name || '',
    startDate: session.space?.startDate || today(),
    theme: session.space?.theme || 'cream',
  });
const password = reactive({ currentPassword: '', newPassword: '', confirm: '' });
const endpoint = ref(getBase()),
  invite = ref<{ code: string; expiresAt: string } | null>(null),
  busy = ref(''),
  restoreInput = ref<HTMLInputElement>();
const themes = [
  { key: 'cream', name: '奶油手账', color: '#dfe3cc' },
  { key: 'rose', name: '温柔玫瑰', color: '#e7c8bf' },
  { key: 'sage', name: '鼠尾草绿', color: '#bfd2c6' },
];
const inviteLink = computed(() => {
  if (!invite.value) return '';
  const u = new URL('/auth', location.origin);
  u.searchParams.set('code', invite.value.code);
  return u.href;
});
async function perform(key: string, task: () => Promise<unknown>, message: string) {
  if (busy.value) return;
  busy.value = key;
  try {
    await task();
    ElMessage.success(message);
  } catch (e) {
    ElMessage.error(e.message);
  } finally {
    busy.value = '';
  }
}
async function saveProfile() {
  if (!profile.nickname.trim()) {
    ElMessage.warning('昵称不能为空');
    return;
  }
  await perform(
    'profile',
    async () => {
      await api.patch('/auth/profile', profile);
      await session.refresh();
    },
    '昵称更新了，还是最熟悉的你',
  );
}
async function saveSpace() {
  if (!space.name.trim() || !space.startDate) {
    ElMessage.warning('请填写空间名称和在一起日期');
    return;
  }
  await perform(
    'space',
    async () => {
      await api.patch('/space', space);
      await session.refresh();
    },
    '家的样子，已经更新',
  );
}
async function createInvite() {
  await perform(
    'invite',
    async () => {
      invite.value = await api.post('/auth/invite');
    },
    '邀请码已准备好，有效期 24 小时',
  );
}
async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    ElMessage.success('已复制，可以分享给另一半');
  } catch {
    ElMessage.info('请手动复制下方邀请码');
  }
}
async function savePassword() {
  if (password.newPassword.length < 8) {
    ElMessage.warning('新密码至少 8 位');
    return;
  }
  if (password.newPassword !== password.confirm) {
    ElMessage.warning('两次输入的新密码不一致');
    return;
  }
  await perform(
    'password',
    async () => {
      await api.patch('/auth/password', {
        currentPassword: password.currentPassword,
        newPassword: password.newPassword,
      });
      Object.assign(password, { currentPassword: '', newPassword: '', confirm: '' });
    },
    '密码已修改，其他设备需要重新登录',
  );
}
async function saveEndpoint() {
  if (busy.value) return;
  busy.value = 'endpoint';
  const previous = getBase();
  try {
    await connectBase(endpoint.value);
    if (previous !== getBase()) {
      session.clear();
      await router.replace('/auth');
      ElMessage.success('已连接到新服务，请登录这个空间的账号');
    } else {
      await session.refresh();
      ElMessage.success('已连接到小世界');
    }
  } catch (e) {
    ElMessage.error(e.message);
  } finally {
    busy.value = '';
  }
}
async function exportData(kind: string) {
  await perform(
    kind,
    () =>
      download(
        kind === 'export' ? '/backup/export' : '/backup/download',
        `小世界-${today()}.${kind === 'export' ? 'json' : 'zip'}`,
      ),
    kind === 'export' ? '数据导出已下载' : '完整备份已下载',
  );
}
async function restore(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file) return;
  try {
    await ElMessageBox.confirm(
      '恢复会以备份中的生活记录替换当前记录。系统会先备份现有数据，请确认选择的是我们自己的备份文件。',
      '恢复我们的小世界',
      { type: 'warning', confirmButtonText: '确认恢复', cancelButtonText: '取消' },
    );
  } catch {
    (event.target as HTMLInputElement).value = '';
    return;
  }
  await perform(
    'restore',
    async () => {
      const form = new FormData();
      form.append('file', file);
      const result = await request<{ safetyMissingAssets?: number; safetyDamagedAssets?: number }>(
        '/backup/restore',
        {
          method: 'POST',
          body: form,
        },
      );
      await session.refresh();
      const affectedPhotos = (result.safetyMissingAssets || 0) + (result.safetyDamagedAssets || 0);
      if (affectedPhotos) {
        ElMessage.warning({
          message: `恢复前已有 ${affectedPhotos} 张照片文件缺失或大小异常，保护副本已标记这些问题；本次已按所选备份恢复。`,
          duration: 0,
          showClose: true,
        });
      }
    },
    '备份已恢复，记录已回到小世界',
  );
  (event.target as HTMLInputElement).value = '';
}
async function logout() {
  await session.logout();
  router.replace('/auth');
}
</script>
<template>
  <PageHeader title="我们的小设置" description="家的名字、喜欢的颜色，还有把故事好好保管的小事。" />
  <div class="settings-grid">
    <section class="panel settings-panel">
      <div class="section-head">
        <h3><AppIcon name="people" :size="19" />我们两个人</h3>
        <span class="tag green">{{ session.partner ? '已经成双' : '等待另一半' }}</span>
      </div>
      <div class="members-row">
        <div>
          <span class="avatar">{{ session.user?.nickname.slice(0, 1) }}</span><strong>{{
            session.user?.nickname
          }}</strong
          ><small>我 · {{ session.isOwner ? '空间创建者' : '家庭成员' }}</small>
        </div>
        <AppIcon name="heart" :size="24" />
        <div>
          <span class="avatar partner">{{
            session.partner?.nickname.slice(0, 1) || '?'
          }}</span><strong>{{ session.partner?.nickname || '等待另一半' }}</strong
          ><small>{{ session.partner ? '故事里的另一个主角' : '让故事更完整' }}</small>
        </div>
      </div>
      <el-form label-position="top" @submit.prevent="saveProfile"
        ><el-form-item label="我的昵称"
          ><el-input v-model="profile.nickname" maxlength="30" /></el-form-item
        ><el-button type="primary" native-type="submit" :loading="busy === 'profile'"
          >保存昵称</el-button
        ></el-form
      >
      <div class="invite-block">
        <template v-if="!session.partner"
          ><h4>邀请另一半回家</h4>
          <p class="muted">邀请码 24 小时内有效，只能使用一次。我们的家最多容纳两个人。</p>
          <el-button :loading="busy === 'invite'" @click="createInvite"
            ><AppIcon name="plus" :size="15" />{{
              invite ? '重新生成邀请码' : '生成邀请码'
            }}</el-button
          >
          <div v-if="invite" class="invite-code">
            <strong>{{ invite.code }}</strong><el-button
              link
              type="primary"
              @click="copy(invite.code)"
              >复制暗号</el-button
            ><el-button link @click="copy(inviteLink)">复制邀请链接</el-button
            ><small>有效期至 {{ new Date(invite.expiresAt).toLocaleString('zh-CN') }}</small>
          </div></template
        >
        <p v-else class="together-note">
          <AppIcon name="heart" :size="17" />两个人，一个家，刚刚好。
        </p>
      </div>
    </section>
    <section class="panel settings-panel">
      <div class="section-head">
        <h3><AppIcon name="home" :size="19" />家的模样</h3>
      </div>
      <el-form label-position="top" @submit.prevent="saveSpace"
        ><el-form-item label="小世界的名字"
          ><el-input v-model="space.name" maxlength="60" /></el-form-item
        ><el-form-item label="我们在一起的日子"
          ><el-date-picker
            v-model="space.startDate"
            type="date"
            value-format="YYYY-MM-DD" /></el-form-item
        ><el-form-item label="喜欢的主题"
          ><div class="theme-options">
            <button
              type="button"
              v-for="t in themes"
              :key="t.key"
              :class="{ selected: space.theme === t.key }"
              :aria-pressed="space.theme === t.key"
              @click="space.theme = t.key as typeof space.theme"
            >
              <span :style="{ background: t.color }"
                ><AppIcon v-if="space.theme === t.key" name="check" :size="22" /></span
              ><small>{{ t.name }}</small>
            </button>
          </div></el-form-item
        ><el-button type="primary" native-type="submit" :loading="busy === 'space'"
          >保存家的模样</el-button
        ></el-form
      >
    </section>
    <section class="panel settings-panel">
      <div class="section-head">
        <h3><AppIcon name="lock" :size="19" />保管好我们的故事</h3>
      </div>
      <el-form label-position="top" @submit.prevent="savePassword"
        ><el-form-item label="当前密码"
          ><el-input
            v-model="password.currentPassword"
            type="password"
            show-password
            autocomplete="current-password"
            :disabled="busy === 'password'" /></el-form-item
        ><el-form-item label="新密码"
          ><el-input
            v-model="password.newPassword"
            type="password"
            show-password
            autocomplete="new-password"
            :disabled="busy === 'password'"
            placeholder="至少 8 位" /></el-form-item
        ><el-form-item label="再输入一次新密码"
          ><el-input
            v-model="password.confirm"
            type="password"
            show-password
            autocomplete="new-password"
            :disabled="busy === 'password'" /></el-form-item
        ><el-button native-type="submit" :loading="busy === 'password'"
          >修改密码</el-button
        ></el-form
      >
    </section>
    <section class="panel settings-panel">
      <div class="section-head">
        <h3><AppIcon name="photo" :size="19" />给回忆一份备份</h3>
      </div>
      <p class="muted">把共同生活的记录带走，或把一份完整的备份好好保存。</p>
      <div class="portability-row">
        <div>
          <h4>导出生活记录</h4>
          <p>下载 JSON 数据，包含所有生活记录和附件信息。</p>
        </div>
        <el-button :loading="busy === 'export'" @click="exportData('export')">导出数据</el-button>
      </div>
      <div class="portability-row">
        <div>
          <h4>完整备份</h4>
          <p>
            {{
              session.isOwner
                ? '包含数据库与服务内处理后的照片，相机原片请另行保存。'
                : '完整备份由空间创建者下载。'
            }}
          </p>
        </div>
        <el-button
          :disabled="!session.isOwner"
          :loading="busy === 'backup'"
          @click="exportData('backup')"
          >下载备份</el-button
        >
      </div>
      <div class="portability-row">
        <div>
          <h4>从备份恢复</h4>
          <p>选择 ZIP 备份文件，恢复前自动备份当前数据。</p>
        </div>
        <el-button
          :disabled="!session.isOwner"
          :loading="busy === 'restore'"
          @click="restoreInput?.click()"
          >选择备份</el-button
        ><input
          ref="restoreInput"
          type="file"
          accept=".zip,application/zip"
          class="hidden"
          @change="restore"
        />
      </div>
      <div class="private-note">
        <AppIcon name="lock" :size="16" />记录只属于这个小世界的两个人。
      </div>
    </section>
    <section class="panel settings-panel settings-wide">
      <div class="section-head">
        <h3><AppIcon name="settings" :size="19" />连接我的私人服务</h3>
      </div>
      <p class="muted mb-4">
        本地部署使用 /api；连接家中其他设备时，填写完整接口地址。更换服务后可能需要重新登录。
      </p>
      <div class="endpoint-row">
        <el-input v-model="endpoint" placeholder="http://192.168.1.10:3000/api" /><el-button
          :loading="busy === 'endpoint'"
          @click="saveEndpoint"
          >保存并连接</el-button
        >
      </div>
    </section>
  </div>
  <div class="settings-logout">
    <el-button text @click="logout"><AppIcon name="logout" :size="16" />暂时离开小世界</el-button>
    <p>下次回家，我们的故事还在这里。</p>
  </div>
</template>
