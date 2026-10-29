const API_BASE = '/api';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {};
  if (options?.body && typeof options.body === 'string') {
    headers['Content-Type'] = 'application/json';
  }
  const token = localStorage.getItem('terminalsql_token');
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  if (options?.headers) {
    Object.assign(headers, options.headers);
  }

  const res = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    ...options,
    headers,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: res.statusText }));
    throw new Error(err.message || err.error || 'Request failed');
  }

  return res.json();
}

// Auth
export const api = {
  auth: {
    login: (email: string, password: string, totpCode?: string) =>
      request('/auth/login', { method: 'POST', body: JSON.stringify({ email, password, totpCode }) }),
    register: (email: string, password: string) =>
      request('/auth/register', { method: 'POST', body: JSON.stringify({ email, password }) }),
    logout: () => request('/auth/logout', { method: 'POST' }),
    me: () => request<{ user: any }>('/auth/me'),
    setupMfa: () => request<{ secret: string; qrCode: string }>('/auth/mfa/setup', { method: 'POST' }),
    verifyMfa: (code: string) => request('/auth/mfa/verify', { method: 'POST', body: JSON.stringify({ code }) }),
  },

  connections: {
    list: () => request<{ connections: any[] }>('/connections'),
    get: (id: string) => request<{ connection: any }>(`/connections/${id}`),
    create: (data: any) => request('/connections', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: string, data: any) => request<{ message: string; connection?: any }>(`/connections/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    delete: (id: string) => request(`/connections/${id}`, { method: 'DELETE' }),
    test: (id: string) => request<{ success: boolean; message: string; durationMs?: number }>(`/connections/${id}/test`, { method: 'POST' }),
    testRaw: (data: any) => request<{ success: boolean; message: string; durationMs?: number }>('/connections/test-raw', { method: 'POST', body: JSON.stringify(data) }),
    export: (includeCredentials = false) =>
      request<{ version: string; exportedAt: string; connections: any[] }>(
        `/connections/export?includeCredentials=${includeCredentials}`
      ),
    importBulk: (connections: any[], onDuplicate: 'replace' | 'keep_both' | 'skip' = 'replace') =>
      request<{
        success: boolean;
        count: number;
        insertedCount: number;
        updatedCount: number;
        skippedCount: number;
        connections: any[];
      }>(
        '/connections/import/bulk',
        { method: 'POST', body: JSON.stringify({ connections, onDuplicate }) }
      ),
  },

  database: {
    query: (connectionId: string, query: string, readOnly = false, limit?: number, offset?: number, signal?: AbortSignal, database?: string) =>
      request<{ rows: any[]; fields: string[]; rowCount: number; totalRows?: number; durationMs: number; truncated: boolean }>(
        '/db/query', { method: 'POST', body: JSON.stringify({ connectionId, query, readOnly, limit, offset, database }), signal }
      ),
    history: (connectionId?: string) =>
      request<{ history: any[] }>(`/db/history${connectionId ? `?connectionId=${connectionId}` : ''}`),
    schema: (connectionId: string) =>
      request<{ databases?: any[]; tables: any[]; schema: Record<string, any[]> }>(`/db/schema/${connectionId}`),
    templates: {
      list: (dbType?: string) =>
        request<{ templates: any[] }>(`/db/templates${dbType ? `?dbType=${encodeURIComponent(dbType)}` : ''}`),
      create: (data: { name: string; description?: string; query: string; dbType?: string; tags?: string[] }) =>
        request<{ template: any }>('/db/templates', { method: 'POST', body: JSON.stringify(data) }),
      update: (id: string, data: { name?: string; description?: string; query?: string; dbType?: string; tags?: string[] }) =>
        request<{ template: any }>(`/db/templates/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
      delete: (id: string) =>
        request<{ success: boolean; message: string }>(`/db/templates/${id}`, { method: 'DELETE' }),
    },
  },

  sftp: {
    list: (connectionId: string, path = '/') =>
      request<{ files: any[]; path: string }>(`/sftp/list?connectionId=${connectionId}&path=${encodeURIComponent(path)}`),
    download: (connectionId: string, path: string) =>
      `/api/sftp/download?connectionId=${connectionId}&path=${encodeURIComponent(path)}`,
    upload: async (connectionId: string, path: string, file: File) => {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch(`${API_BASE}/sftp/upload?connectionId=${connectionId}&path=${encodeURIComponent(path)}`, {
        method: 'POST',
        credentials: 'include',
        body: form,
      });
      if (!res.ok) throw new Error((await res.json()).message || 'Upload failed');
      return res.json();
    },
    delete: (connectionId: string, path: string, type: 'file' | 'directory') =>
      request('/sftp/delete', { method: 'DELETE', body: JSON.stringify({ connectionId, path, type }) }),
    mkdir: (connectionId: string, path: string) =>
      request('/sftp/mkdir', { method: 'POST', body: JSON.stringify({ connectionId, path }) }),
    rename: (connectionId: string, oldPath: string, newPath: string) =>
      request('/sftp/rename', { method: 'POST', body: JSON.stringify({ connectionId, oldPath, newPath }) }),
  },
};
