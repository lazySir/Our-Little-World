import type { User, Space, Session } from '../types';
import { defineStore } from 'pinia';
import { api, getBase, TOKEN_KEY } from '../api';
let hydration: Promise<void> | undefined;
let generation = 0;
// Reads can supersede each other without changing login identity or hydration readiness.
let latestRead = 0;
function currentSession() {
  const base = getBase(),
    token = localStorage.getItem(TOKEN_KEY),
    started = generation;
  return () =>
    started === generation && base === getBase() && token === localStorage.getItem(TOKEN_KEY);
}
export const useSession = defineStore('session', {
  state: () => ({
    user: null as User | null,
    space: null as Space | null,
    partner: null as User | null,
    ready: false,
  }),
  getters: { authenticated: (s) => !!s.user, isOwner: (s) => s.user?.role === 'owner' },
  actions: {
    async hydrate() {
      if (this.ready) return;
      if (!hydration) {
        const current = currentSession();
        const read = ++latestRead;
        const currentRead = () => current() && read === latestRead;
        hydration = (async () => {
          try {
            if (localStorage.getItem(TOKEN_KEY)) {
              const data = await api.get('/auth/me', { canExpireSession: currentRead });
              if (currentRead()) Object.assign(this, data);
            }
          } catch {
            if (currentRead()) {
              localStorage.removeItem(TOKEN_KEY);
              this.ready = true;
            }
          } finally {
            if (current()) this.ready = true;
          }
        })();
      }
      const pending = hydration;
      try {
        await pending;
      } finally {
        if (hydration === pending) hydration = undefined;
      }
    },
    accept(result: Session) {
      generation++;
      localStorage.setItem(TOKEN_KEY, result.token);
      this.user = result.user;
      this.space = result.space;
      this.ready = true;
      hydration = null;
    },
    async refresh() {
      const current = currentSession();
      const read = ++latestRead;
      const currentRead = () => current() && read === latestRead;
      try {
        const data = await api.get('/auth/me', { canExpireSession: currentRead });
        if (!currentRead()) return false;
        Object.assign(this, data);
        return true;
      } catch (error) {
        if (current() && read !== latestRead) return false;
        throw error;
      }
    },
    clear() {
      generation++;
      localStorage.removeItem(TOKEN_KEY);
      this.$reset();
      this.ready = true;
      hydration = null;
    },
    async logout() {
      try {
        await api.post('/auth/logout');
      } catch {
        // Leaving this device must also work while the service is unreachable.
      } finally {
        this.clear();
      }
    },
  },
});
