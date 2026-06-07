const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
const TOKEN_KEY = 'inventoryhq_access_token';
const LEGACY_TOKEN_KEY = 'base44_access_token';

const entityNames = [
  'CompanySettings',
  'CommissaryFulfillment',
  'InventoryCount',
  'InventoryItem',
  'InventorySnapshot',
  'Invoice',
  'ItemStorageArea',
  'ItemVariant',
  'Location',
  'LocationInventory',
  'Order',
  'ProductGroup',
  'StorageArea',
  'Transfer',
  'User',
  'UserPermission',
  'Vendor'
];

const getToken = () => {
  const token = localStorage.getItem(TOKEN_KEY) || localStorage.getItem(LEGACY_TOKEN_KEY);
  return token || null;
};

const setToken = (token) => {
  if (!token) return;
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.removeItem(LEGACY_TOKEN_KEY);
};

const clearToken = () => {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(LEGACY_TOKEN_KEY);
};

const consumeAccessTokenFromUrl = () => {
  const url = new URL(window.location.href);
  const token = url.searchParams.get('access_token');
  if (!token) return;

  setToken(token);
  url.searchParams.delete('access_token');
  url.searchParams.delete('google');
  window.history.replaceState({}, document.title, `${url.pathname}${url.search}${url.hash}`);
};

consumeAccessTokenFromUrl();

const buildUrl = (path, params = {}) => {
  const url = new URL(`${API_BASE_URL}${path}`, window.location.origin);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, value);
    }
  });
  return url.toString();
};

const request = async (path, { method = 'GET', body, formData, params } = {}) => {
  const headers = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (!formData && body !== undefined) headers['Content-Type'] = 'application/json';

  const response = await fetch(buildUrl(path, params), {
    method,
    headers,
    body: formData || (body !== undefined ? JSON.stringify(body) : undefined)
  });

  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json') ? await response.json() : await response.text();

  if (!response.ok) {
    const message = typeof payload === 'object' ? payload.error || payload.message : payload;
    throw Object.assign(new Error(message || `Request failed with status ${response.status}`), {
      status: response.status,
      data: payload
    });
  }

  return payload;
};

const entityClient = (entityName) => ({
  list: (sort, limit) => request(`/api/entities/${entityName}`, {
    params: { sort, limit }
  }),
  filter: (filters = {}, sort, limit) => request(`/api/entities/${entityName}`, {
    params: { filter: JSON.stringify(filters || {}), sort, limit }
  }),
  get: (id) => request(`/api/entities/${entityName}/${encodeURIComponent(id)}`),
  create: (data) => request(`/api/entities/${entityName}`, {
    method: 'POST',
    body: data
  }),
  bulkCreate: (rows = []) => request(`/api/entities/${entityName}/bulk`, {
    method: 'POST',
    body: rows
  }),
  update: (id, data) => request(`/api/entities/${entityName}/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: data
  }),
  delete: (id) => request(`/api/entities/${entityName}/${encodeURIComponent(id)}`, {
    method: 'DELETE'
  }),
  subscribe: () => () => {}
});

const entities = Object.fromEntries(entityNames.map((name) => [name, entityClient(name)]));

export const base44 = {
  auth: {
    getToken,
    setToken,
    async me() {
      return request('/api/auth/me');
    },
    async loginViaEmailPassword(email, password) {
      const result = await request('/api/auth/login', {
        method: 'POST',
        body: { email, password }
      });
      if (result.access_token) setToken(result.access_token);
      return result;
    },
    async register(credentials) {
      const result = await request('/api/auth/register', {
        method: 'POST',
        body: credentials
      });
      if (result.access_token) setToken(result.access_token);
      return result;
    },
    async verifyOtp(payload) {
      const result = await request('/api/auth/verify-otp', {
        method: 'POST',
        body: payload
      });
      if (result.access_token) setToken(result.access_token);
      return result;
    },
    resendOtp(email) {
      return request('/api/auth/resend-otp', {
        method: 'POST',
        body: { email }
      });
    },
    resetPasswordRequest(email) {
      return request('/api/auth/reset-request', {
        method: 'POST',
        body: { email }
      });
    },
    async resetPassword(payload) {
      const result = await request('/api/auth/reset', {
        method: 'POST',
        body: payload
      });
      if (result.access_token) setToken(result.access_token);
      return result;
    },
    async logout(redirectTo) {
      try {
        await request('/api/auth/logout', { method: 'POST' });
      } finally {
        clearToken();
        if (redirectTo) window.location.href = '/login';
      }
    },
    redirectToLogin() {
      window.location.href = '/login';
    },
    loginWithProvider(provider = 'google', redirectTo = '/') {
      if (provider !== 'google') {
        throw new Error(`${provider} sign-in is not configured`);
      }
      const redirect = typeof redirectTo === 'string' && redirectTo.startsWith('/') ? redirectTo : '/';
      window.location.href = buildUrl('/api/auth/google', { redirect });
    }
  },
  entities,
  functions: {
    invoke(name, payload = {}) {
      return request(`/api/functions/${encodeURIComponent(name)}`, {
        method: 'POST',
        body: payload
      });
    }
  },
  integrations: {
    Core: {
      async UploadFile({ file }) {
        const formData = new FormData();
        formData.append('file', file);
        return request('/api/integrations/upload-file', {
          method: 'POST',
          formData
        });
      },
      InvokeLLM(payload) {
        return request('/api/integrations/invoke-llm', {
          method: 'POST',
          body: payload
        });
      }
    }
  },
  users: {
    inviteUser(email, role = 'user') {
      return request('/api/users/invite', {
        method: 'POST',
        body: { email, role }
      });
    }
  }
};
