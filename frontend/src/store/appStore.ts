import { create } from 'zustand';

export interface User {
  id: string;
  email: string;
  totpEnabled: boolean;
}

export interface Connection {
  id: string;
  name: string;
  type: 'ssh' | 'database' | 'sftp';
  dbType?: 'clickhouse' | 'postgres' | 'mysql' | 'sqlite' | string;
  host: string;
  port: number;
  username: string;
  tags: string[];
  color: string;
  folder?: string | null;
  hasBastion?: boolean;
  lastUsed?: string;
}

export type TabType = 'ssh' | 'database' | 'sftp';

export interface Tab {
  id: string;
  type: TabType;
  label: string;
  connectionId: string;
  connection: Connection;
  initialQuery?: string;
  initialDatabase?: string;
}

interface AppState {
  user: User | null;
  setUser: (user: User | null) => void;

  connections: Connection[];
  setConnections: (connections: Connection[]) => void;
  addConnection: (conn: Connection) => void;
  updateConnection: (conn: Connection) => void;
  removeConnection: (id: string) => void;

  tabs: Tab[];
  activeTabId: string | null;
  openTab: (tab: Omit<Tab, 'id'>) => void;
  closeTab: (id: string) => void;
  setActiveTab: (id: string) => void;
  duplicateTab: (id: string) => string | null;
  renameTab: (id: string, newLabel: string) => void;
  closeOtherTabs: (id: string) => void;
  closeAllTabs: () => void;

  // Multi-screen / Split Screen
  splitMode: 'single' | 'split-horizontal' | 'split-vertical';
  splitTabId: string | null;
  setSplitMode: (mode: 'single' | 'split-horizontal' | 'split-vertical', tabId?: string) => void;
  setSplitTabId: (id: string | null) => void;

  tabStatuses: Record<string, 'connected' | 'connecting' | 'disconnected'>;
  setTabStatus: (tabId: string, status: 'connected' | 'connecting' | 'disconnected') => void;

  draggingTabId: string | null;
  setDraggingTabId: (id: string | null) => void;

  activeModule: 'connections' | 'settings';
  setActiveModule: (m: 'connections' | 'settings') => void;

  theme: 'dark' | 'light';
  setTheme: (theme: 'dark' | 'light') => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  user: null,
  setUser: (user) => {
    set({ user });
    if (user) {
      const savedTheme = (localStorage.getItem(`terminalsql_theme_${user.id}`) as 'dark' | 'light') || 'dark';
      get().setTheme(savedTheme);
    }
  },

  theme: (() => {
    try {
      const themeKey = Object.keys(localStorage).find((k) => k.startsWith('terminalsql_theme_'));
      const saved = themeKey ? (localStorage.getItem(themeKey) as 'dark' | 'light') : 'dark';
      if (saved === 'light') {
        document.documentElement.classList.remove('dark');
        document.documentElement.classList.add('light');
        return 'light';
      }
    } catch {}
    return 'dark';
  })(),
  setTheme: (theme) => {
    const user = get().user;
    const key = user ? `terminalsql_theme_${user.id}` : 'terminalsql_theme_guest';
    localStorage.setItem(key, theme);
    localStorage.setItem('terminalsql_theme_guest', theme);
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
      document.documentElement.classList.remove('light');
    } else {
      document.documentElement.classList.remove('dark');
      document.documentElement.classList.add('light');
    }
    set({ theme });
  },

  connections: [],
  setConnections: (connections) => set({ connections }),
  addConnection: (conn) => set((s) => ({ connections: [...s.connections, conn] })),
  updateConnection: (conn) => set((s) => ({
    connections: s.connections.map((c) => (c.id === conn.id ? { ...c, ...conn } : c)),
  })),
  removeConnection: (id) => set((s) => {
    const remainingTabs = s.tabs.filter((t) => t.connectionId !== id);
    const newActive = s.activeTabId && remainingTabs.some((t) => t.id === s.activeTabId)
      ? s.activeTabId
      : remainingTabs[0]?.id || null;
    try {
      localStorage.setItem('terminalsql_saved_tabs', JSON.stringify(remainingTabs));
      if (newActive) localStorage.setItem('terminalsql_active_tab', newActive);
      else localStorage.removeItem('terminalsql_active_tab');
      localStorage.removeItem(`terminalsql_sqldraft_${id}`);
    } catch {}
    return {
      connections: s.connections.filter((c) => c.id !== id),
      tabs: remainingTabs,
      activeTabId: newActive,
    };
  }),

  tabs: (() => {
    try {
      const saved = localStorage.getItem('terminalsql_saved_tabs');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          return parsed
            .filter((t: any) => t && t.id && t.type)
            .map((t: any) => ({ ...t, connection: t.connection || {} }));
        }
      }
    } catch {}
    return [];
  })(),
  activeTabId: (() => {
    try {
      const savedTabs = localStorage.getItem('terminalsql_saved_tabs');
      const active = localStorage.getItem('terminalsql_active_tab') || null;
      if (savedTabs && active) {
        const parsed = JSON.parse(savedTabs);
        if (Array.isArray(parsed) && parsed.some((t: any) => t?.id === active)) {
          return active;
        }
        return (Array.isArray(parsed) && parsed[0]?.id) || null;
      }
    } catch {}
    return null;
  })(),
  splitMode: 'single',
  splitTabId: null,

  tabStatuses: {},
  setTabStatus: (tabId, status) => {
    set((state) => {
      if (state.tabStatuses[tabId] === status) return state;
      return {
        tabStatuses: {
          ...state.tabStatuses,
          [tabId]: status,
        },
      };
    });
  },

  openTab: (tabData) => {
    const id = `${tabData.connectionId}-${tabData.type}-${Date.now()}`;
    const tab: Tab = { id, ...tabData };
    const newTabs = [...get().tabs, tab];
    set({ tabs: newTabs, activeTabId: id });
    try {
      localStorage.setItem('terminalsql_saved_tabs', JSON.stringify(newTabs));
      localStorage.setItem('terminalsql_active_tab', id);
    } catch {}
  },

  closeTab: (id) => {
    const { tabs, activeTabId, splitTabId } = get();
    const newTabs = tabs.filter((t) => t.id !== id);
    let newActiveId = activeTabId;
    if (activeTabId === id) {
      const idx = tabs.findIndex((t) => t.id === id);
      newActiveId = newTabs[idx - 1]?.id ?? newTabs[0]?.id ?? null;
    }

    let newSplitId = splitTabId;
    let newSplitMode = get().splitMode;
    if (splitTabId === id) {
      const fallback = newTabs.find((t) => t.id !== newActiveId);
      if (fallback) {
        newSplitId = fallback.id;
      } else {
        newSplitId = null;
        newSplitMode = 'single';
      }
    }

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('terminalsql:tab-closed', { detail: { tabId: id } }));
    }

    const newStatuses = { ...get().tabStatuses };
    delete newStatuses[id];

    set({ tabs: newTabs, activeTabId: newActiveId, splitTabId: newSplitId, splitMode: newSplitMode, tabStatuses: newStatuses });
    try {
      localStorage.setItem('terminalsql_saved_tabs', JSON.stringify(newTabs));
      if (newActiveId) localStorage.setItem('terminalsql_active_tab', newActiveId);
      else localStorage.removeItem('terminalsql_active_tab');
    } catch {}
  },

  setActiveTab: (id) => {
    set({ activeTabId: id });
    try {
      localStorage.setItem('terminalsql_active_tab', id);
    } catch {}
  },

  duplicateTab: (id) => {
    const { tabs } = get();
    const sourceTab = tabs.find((t) => t.id === id);
    if (!sourceTab) return null;

    // Generate duplicate label
    const baseLabel = sourceTab.label.replace(/\s*\(\d+\)$/, '');
    const count = tabs.filter((t) => t.label.startsWith(baseLabel)).length + 1;
    const newLabel = `${baseLabel} (${count})`;
    const newId = `${sourceTab.connectionId}-${sourceTab.type}-${Date.now()}`;

    const newTab: Tab = {
      ...sourceTab,
      id: newId,
      label: newLabel,
    };

    // Insert after current tab
    const sourceIndex = tabs.findIndex((t) => t.id === id);
    const updatedTabs = [...tabs];
    updatedTabs.splice(sourceIndex + 1, 0, newTab);

    set({ tabs: updatedTabs, activeTabId: newId });
    try {
      localStorage.setItem('terminalsql_saved_tabs', JSON.stringify(updatedTabs));
      localStorage.setItem('terminalsql_active_tab', newId);
    } catch {}
    return newId;
  },

  renameTab: (id, newLabel) => {
    set((s) => {
      const updated = s.tabs.map((t) => (t.id === id ? { ...t, label: newLabel } : t));
      try {
        localStorage.setItem('terminalsql_saved_tabs', JSON.stringify(updated));
      } catch {}
      return { tabs: updated };
    });
  },

  closeOtherTabs: (id) => {
    const { tabs } = get();
    tabs.filter((t) => t.id !== id).forEach((t) => {
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('terminalsql:tab-closed', { detail: { tabId: t.id } }));
      }
    });

    const remaining = tabs.filter((t) => t.id === id);
    const newStatuses: Record<string, 'connected' | 'connecting' | 'disconnected'> = {};
    if (get().tabStatuses[id]) {
      newStatuses[id] = get().tabStatuses[id];
    }

    set({
      tabs: remaining,
      activeTabId: id,
      splitMode: 'single',
      splitTabId: null,
      tabStatuses: newStatuses,
    });
    try {
      localStorage.setItem('terminalsql_saved_tabs', JSON.stringify(remaining));
      localStorage.setItem('terminalsql_active_tab', id);
    } catch {}
  },

  closeAllTabs: () => {
    const { tabs } = get();
    tabs.forEach((t) => {
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('terminalsql:tab-closed', { detail: { tabId: t.id } }));
      }
    });

    set({
      tabs: [],
      activeTabId: null,
      splitMode: 'single',
      splitTabId: null,
      tabStatuses: {},
    });
    try {
      localStorage.removeItem('terminalsql_saved_tabs');
      localStorage.removeItem('terminalsql_active_tab');
    } catch {}
  },

  setSplitMode: (mode, tabId) => {
    const { tabs, activeTabId, splitTabId, duplicateTab } = get();
    if (mode === 'single') {
      set({ splitMode: 'single', splitTabId: null });
      return;
    }

    let targetSplitTabId = tabId || splitTabId;
    if (!targetSplitTabId || targetSplitTabId === activeTabId) {
      // Find another tab
      const other = tabs.find((t) => t.id !== activeTabId);
      if (other) {
        targetSplitTabId = other.id;
      } else if (activeTabId) {
        // Automatically duplicate the active tab so user instantly has 2 side-by-side!
        targetSplitTabId = duplicateTab(activeTabId) || null;
      }
    }

    set({ splitMode: mode, splitTabId: targetSplitTabId });
  },

  setSplitTabId: (id) => set({ splitTabId: id }),

  draggingTabId: null,
  setDraggingTabId: (draggingTabId) => set({ draggingTabId }),

  activeModule: 'connections',
  setActiveModule: (activeModule) => set({ activeModule }),
}));
