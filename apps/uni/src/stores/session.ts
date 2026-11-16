import { defineStore } from 'pinia';
import { request, getToken, setToken } from '../lib/api';
import type { Member, Space, SessionData } from '../types';
export const useSession = defineStore('session', {
    state: () => ({ user: null as Member | null, space: null as Space | null, partner: null as Member | null, loaded: false }),
    getters: { theme: state => state.space?.theme || 'cream' },
    actions: {
        async load() {
            if (!getToken()) {
                uni.reLaunch({ url: '/pages/auth/index' });
                return false;
            }
            const data = await request<SessionData>('/auth/me');
            Object.assign(this, data, { loaded: true });
            return true;
        },
        async authenticate(mode, data) { const result = await request(`/auth/${mode}`, 'POST', data, true); setToken(result.token); this.user = result.user; this.space = result.space; await this.load(); uni.switchTab({ url: '/pages/home/index' }); },
        async logout() { try {
            await request('/auth/logout', 'POST');
        }
        finally {
            setToken('');
            this.$reset();
            uni.reLaunch({ url: '/pages/auth/index' });
        } },
    },
});
