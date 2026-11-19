import { defineStore } from 'pinia';
import { request, getBase, getToken, setToken } from '../lib/api';
import type { Member, Space, SessionData } from '../types';
// Keep request ordering outside resettable state so clear() cannot revive an old load.
const loadVersions = new WeakMap<object, number>();
function nextLoad(session: object) {
  const version = (loadVersions.get(session) || 0) + 1;
  loadVersions.set(session, version);
  return version;
}
export const useSession = defineStore('session', {
  state: () => ({
    user: null as Member | null,
    space: null as Space | null,
    partner: null as Member | null,
    loaded: false,
  }),
  getters: { theme: (state) => state.space?.theme || 'cream' },
  actions: {
    clear() {
      nextLoad(this);
      setToken('');
      this.$reset();
    },
    async load() {
      const version = nextLoad(this),
        base = getBase(),
        token = getToken();
      const isCurrent = () =>
        version === loadVersions.get(this) && base === getBase() && token === getToken();
      if (!getToken()) {
        this.$reset();
        uni.reLaunch({ url: '/pages/auth/index' });
        return false;
      }
      try {
        const data = await request<SessionData>(
          '/auth/me',
          'GET',
          undefined,
          false,
          base,
          isCurrent,
        );
        if (!isCurrent()) return false;
        Object.assign(this, data, { loaded: true });
        return true;
      } catch (error) {
        if (!isCurrent()) return false;
        throw error;
      }
    },
    async authenticate(mode, data) {
      const result = await request(`/auth/${mode}`, 'POST', data, true);
      setToken(result.token);
      this.user = result.user;
      this.space = result.space;
      if (!(await this.load())) return;
      uni.switchTab({ url: '/pages/home/index' });
    },
    async logout() {
      try {
        await request('/auth/logout', 'POST');
      } finally {
        this.clear();
        uni.reLaunch({ url: '/pages/auth/index' });
      }
    },
  },
});
