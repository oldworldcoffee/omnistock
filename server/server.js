import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import crypto from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
if (typeof process.loadEnvFile === 'function') {
  try {
    process.loadEnvFile(path.join(rootDir, '.env'));
  } catch (error) {
    if (error.code !== 'ENOENT') console.warn('Unable to load .env:', error.message);
  }
}
const vercelEnv = process.env.VERCEL_ENV || (process.env.VERCEL === '1' ? 'vercel' : 'local');
const isVercel = process.env.VERCEL === '1' || vercelEnv !== 'local';
const defaultDataDir = isVercel ? path.join('/tmp', 'omnistock-data') : path.join(rootDir, 'data');
const dataDir = path.resolve(process.env.DATA_DIR || defaultDataDir);
const uploadDir = path.join(dataDir, 'uploads');
const dbFile = path.join(dataDir, 'db.json');
const port = Number(process.env.PORT || 8787);
const supabaseUrl = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const defaultSupabaseStateId = vercelEnv === 'preview' ? 'preview' : 'default';
const supabaseStateId = process.env.SUPABASE_STATE_ID || defaultSupabaseStateId;
const supabaseStorageBucket = process.env.SUPABASE_STORAGE_BUCKET || '';
const useSupabase = Boolean(supabaseUrl && supabaseServiceRoleKey);

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
  'UserPermission',
  'Vendor'
];

const companyScopedEntities = new Set([
  'CompanySettings',
  'CommissaryFulfillment',
  'InventoryCount',
  'InventoryItem',
  'InventorySnapshot',
  'Invoice',
  'ItemVariant',
  'Location',
  'LocationInventory',
  'Order',
  'ProductGroup',
  'Transfer',
  'UserPermission',
  'Vendor'
]);

let writeQueue = Promise.resolve();

const defaultDb = () => ({
  users: [],
  sessions: {},
  googleOAuthStates: {},
  resetTokens: {},
  sentEmails: [],
  entities: Object.fromEntries(entityNames.map((name) => [name, []]))
});

const normalizeEmail = (email) => String(email || '').trim().toLowerCase();

const makeId = (prefix) => {
  const cleanPrefix = String(prefix || 'id').replace(/[^a-z0-9]/gi, '').toLowerCase() || 'id';
  return `${cleanPrefix}_${crypto.randomBytes(8).toString('hex')}`;
};

const nowIso = () => new Date().toISOString();

const ensureDbShape = (db) => {
  const next = { ...defaultDb(), ...db };
  next.entities = { ...defaultDb().entities, ...(db?.entities || {}) };
  for (const name of entityNames) {
    if (!Array.isArray(next.entities[name])) next.entities[name] = [];
  }
  if (!Array.isArray(next.users)) next.users = [];
  if (!Array.isArray(next.sentEmails)) next.sentEmails = [];
  next.sessions = next.sessions || {};
  next.googleOAuthStates = next.googleOAuthStates || {};
  next.resetTokens = next.resetTokens || {};
  return next;
};

const supabaseRequest = async (pathname, { method = 'GET', body, headers = {} } = {}) => {
  if (!useSupabase) throw new Error('Supabase is not configured');
  const response = await fetch(`${supabaseUrl}${pathname}`, {
    method,
    headers: {
      apikey: supabaseServiceRoleKey,
      Authorization: `Bearer ${supabaseServiceRoleKey}`,
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...headers
    },
    body: body !== undefined ? JSON.stringify(body) : undefined
  });

  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json')
    ? await response.json().catch(() => null)
    : await response.text().catch(() => '');

  if (!response.ok) {
    const message = typeof payload === 'object' ? payload?.message || payload?.error : payload;
    throw new Error(message || `Supabase request failed with ${response.status}`);
  }

  return payload;
};

const loadSupabaseDb = async () => {
  const rows = await supabaseRequest(`/rest/v1/app_state?id=eq.${encodeURIComponent(supabaseStateId)}&select=data&limit=1`);
  if (Array.isArray(rows) && rows[0]?.data) return ensureDbShape(rows[0].data);
  const db = defaultDb();
  await saveSupabaseDb(db);
  return db;
};

const saveSupabaseDb = async (db) => {
  await supabaseRequest('/rest/v1/app_state', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates' },
    body: [{
      id: supabaseStateId,
      data: ensureDbShape(db),
      updated_at: nowIso()
    }]
  });
};

const loadDb = async () => {
  if (useSupabase) return loadSupabaseDb();

  await mkdir(dataDir, { recursive: true });
  await mkdir(uploadDir, { recursive: true });
  try {
    return ensureDbShape(JSON.parse(await readFile(dbFile, 'utf8')));
  } catch (error) {
    if (error.code !== 'ENOENT') console.warn('Unable to read database, starting clean:', error.message);
    const db = defaultDb();
    await saveDb(db);
    return db;
  }
};

const saveDb = async (db) => {
  if (useSupabase) {
    await saveSupabaseDb(db);
    return;
  }

  await mkdir(dataDir, { recursive: true });
  await writeFile(dbFile, `${JSON.stringify(ensureDbShape(db), null, 2)}\n`);
};

const withDb = async (mutator) => {
  const run = writeQueue.then(async () => {
    const db = await loadDb();
    const result = await mutator(db);
    await saveDb(db);
    return result;
  });
  writeQueue = run.catch(() => {});
  return run;
};

const hashPassword = (password) => {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
};

const verifyPassword = (password, storedHash) => {
  if (!storedHash?.startsWith('scrypt$')) return false;
  const [, salt, hash] = storedHash.split('$');
  const candidate = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(candidate, 'hex'));
};

const publicUser = (user) => {
  if (!user) return null;
  const { password_hash, ...safeUser } = user;
  return safeUser;
};

const issueSession = (db, user) => {
  const token = crypto.randomBytes(32).toString('hex');
  db.sessions[token] = { user_id: user.id, created_date: nowIso() };
  return token;
};

const tokenFromRequest = (req) => {
  const auth = req.headers.authorization || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7);
  return null;
};

const currentUser = (db, req) => {
  const token = tokenFromRequest(req);
  if (!token) return null;
  const session = db.sessions[token];
  if (!session) return null;
  return db.users.find((user) => user.id === session.user_id && user.verified !== false) || null;
};

const firstCompany = (db) => db.entities.CompanySettings[0] || null;

const companyIdForUser = (db, user) => {
  if (!user) return null;
  if (user.company_id) return user.company_id;
  const perm = db.entities.UserPermission.find((row) => normalizeEmail(row.email) === normalizeEmail(user.email));
  return perm?.company_id || firstCompany(db)?.company_id || firstCompany(db)?.id || null;
};

const ensureCompanyForAdmin = (db, user) => {
  if (db.entities.CompanySettings.length > 0) return db.entities.CompanySettings[0];
  const id = makeId('companysettings');
  const record = {
    id,
    company_id: id,
    company_name: 'My Company',
    subscription_plan: 'starter',
    subscription_status: 'trial',
    created_date: nowIso(),
    updated_date: nowIso(),
    created_by: user.email
  };
  db.entities.CompanySettings.push(record);
  user.company_id = id;
  return record;
};

const ensureUserPermission = (db, user) => {
  if (!user || user.role === 'admin') return;
  const email = normalizeEmail(user.email);
  const existing = db.entities.UserPermission.find((row) => normalizeEmail(row.email) === email);
  if (existing) {
    existing.status = 'active';
    existing.company_id = existing.company_id || companyIdForUser(db, user);
    existing.updated_date = nowIso();
    return;
  }
  db.entities.UserPermission.push({
    id: makeId('userpermission'),
    email: user.email,
    full_name: user.full_name || '',
    role: 'staff',
    status: 'active',
    company_id: companyIdForUser(db, user),
    permissions: { master_catalog: false, hq_reports: false, all_locations: false, location_ids: [] },
    created_date: nowIso(),
    updated_date: nowIso()
  });
};

const exchangeGoogleCode = async (req, code) => {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('Google OAuth is not configured');
  }

  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: getGoogleRedirectUri(req),
      grant_type: 'authorization_code'
    })
  });
  const tokenPayload = await tokenResponse.json().catch(() => ({}));
  if (!tokenResponse.ok) {
    throw new Error(tokenPayload.error_description || tokenPayload.error || 'Google token exchange failed');
  }

  const profileResponse = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${tokenPayload.access_token}` }
  });
  const profile = await profileResponse.json().catch(() => ({}));
  if (!profileResponse.ok || !profile.email) {
    throw new Error(profile.error_description || profile.error || 'Google profile lookup failed');
  }

  return profile;
};

const upsertGoogleUser = (db, profile) => {
  const email = normalizeEmail(profile.email);
  const firstUser = db.users.filter((row) => row.verified !== false).length === 0;
  const company = firstCompany(db);
  let user = db.users.find((row) => normalizeEmail(row.email) === email);

  if (!user) {
    user = {
      id: makeId('user'),
      email,
      role: firstUser ? 'admin' : 'user',
      company_id: company?.company_id || company?.id || null,
      created_date: nowIso()
    };
    db.users.push(user);
  }

  user.full_name = profile.name || user.full_name || email.split('@')[0];
  user.avatar_url = profile.picture || user.avatar_url || '';
  user.google_sub = profile.sub || user.google_sub || '';
  user.auth_provider = 'google';
  user.verified = true;
  user.status = 'active';
  user.role = user.role || (firstUser ? 'admin' : 'user');
  user.updated_date = nowIso();

  if (user.role === 'admin') {
    ensureCompanyForAdmin(db, user);
  } else {
    user.company_id = user.company_id || company?.company_id || company?.id || null;
  }
  ensureUserPermission(db, user);
  return user;
};

const sendJson = (res, statusCode, payload, headers = {}) => {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
    ...headers
  });
  res.end(JSON.stringify(payload));
};

const sendText = (res, statusCode, text, contentType = 'text/plain; charset=utf-8') => {
  res.writeHead(statusCode, {
    'Content-Type': contentType,
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS'
  });
  res.end(text);
};

const sendRedirect = (res, location) => {
  res.writeHead(302, {
    Location: location,
    'Access-Control-Allow-Origin': '*'
  });
  res.end();
};

const getRequestOrigin = (req) => {
  if (process.env.PUBLIC_APP_URL) return process.env.PUBLIC_APP_URL.replace(/\/$/, '');
  const proto = req.headers['x-forwarded-proto'] || 'http';
  const host = req.headers['x-forwarded-host'] || req.headers.host || `localhost:${port}`;
  return `${proto}://${host}`;
};

const getGoogleRedirectUri = (req) => (
  process.env.GOOGLE_REDIRECT_URI || `${getRequestOrigin(req)}/api/auth/google/callback`
);

const safeRedirectPath = (redirect) => {
  if (typeof redirect !== 'string') return '/';
  if (!redirect.startsWith('/') || redirect.startsWith('//')) return '/';
  return redirect;
};

const withQueryParams = (pathValue, params) => {
  const url = new URL(safeRedirectPath(pathValue), 'http://local.app');
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, value);
    }
  });
  return `${url.pathname}${url.search}${url.hash}`;
};

const readRawBody = (req) => new Promise((resolve, reject) => {
  const chunks = [];
  req.on('data', (chunk) => chunks.push(chunk));
  req.on('end', () => resolve(Buffer.concat(chunks)));
  req.on('error', reject);
});

const readJsonBody = async (req) => {
  const raw = await readRawBody(req);
  if (raw.length === 0) return {};
  return JSON.parse(raw.toString('utf8'));
};

const parseQueryJson = (value, fallback) => {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
};

const matchesFilter = (row, filters) => {
  for (const [key, value] of Object.entries(filters || {})) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      if (!value.includes(row[key])) return false;
    } else if (row[key] !== value) {
      return false;
    }
  }
  return true;
};

const sortRows = (rows, sort) => {
  if (!sort) return rows;
  const descending = sort.startsWith('-');
  const key = descending ? sort.slice(1) : sort;
  return [...rows].sort((a, b) => {
    const av = a?.[key] ?? '';
    const bv = b?.[key] ?? '';
    const result = typeof av === 'number' && typeof bv === 'number'
      ? av - bv
      : String(av).localeCompare(String(bv));
    return descending ? -result : result;
  });
};

const csvEscape = (value) => {
  const text = value == null ? '' : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

const parseCsv = (text) => {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (quoted) {
      if (char === '"' && next === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (char !== '\r') {
      field += char;
    }
  }

  row.push(field);
  rows.push(row);
  const headers = rows.shift()?.map((header) => header.trim()) || [];
  return rows
    .filter((cells) => cells.some((cell) => String(cell || '').trim()))
    .map((cells) => Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ''])));
};

const getColumn = (row, names, fallback = '') => {
  for (const name of names) {
    if (row[name] != null && row[name] !== '') return row[name];
  }
  return fallback;
};

const toNumber = (value, fallback = 0) => {
  const parsed = Number.parseFloat(String(value ?? '').replace(/[$,]/g, ''));
  return Number.isFinite(parsed) ? parsed : fallback;
};

const toBool = (value, fallback = false) => {
  if (value == null || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  return ['yes', 'true', '1', 'y', 'active'].includes(normalized);
};

const uploadedPathFromUrl = (fileUrl) => {
  const raw = String(fileUrl || '');
  let pathname = raw;
  try {
    pathname = new URL(raw).pathname;
  } catch {
    pathname = raw;
  }
  if (!pathname.startsWith('/uploads/')) return null;
  return path.join(uploadDir, path.basename(pathname));
};

const supabasePublicFileUrl = (storedName) => (
  `${supabaseUrl}/storage/v1/object/public/${encodeURIComponent(supabaseStorageBucket)}/${encodeURIComponent(storedName)}`
);

const uploadSupabaseFile = async ({ storedName, buffer, contentType }) => {
  if (!useSupabase || !supabaseStorageBucket) return null;
  const response = await fetch(`${supabaseUrl}/storage/v1/object/${encodeURIComponent(supabaseStorageBucket)}/${encodeURIComponent(storedName)}`, {
    method: 'POST',
    headers: {
      apikey: supabaseServiceRoleKey,
      Authorization: `Bearer ${supabaseServiceRoleKey}`,
      'Content-Type': contentType || 'application/octet-stream',
      'x-upsert': 'true'
    },
    body: buffer
  });

  if (!response.ok) {
    const message = await response.text().catch(() => '');
    throw new Error(message || `Supabase upload failed with ${response.status}`);
  }

  return supabasePublicFileUrl(storedName);
};

const parseMultipartFile = async (req) => {
  const contentType = req.headers['content-type'] || '';
  const match = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!match) throw new Error('Missing multipart boundary');
  const boundary = match[1] || match[2];
  const body = await readRawBody(req);
  const bodyText = body.toString('binary');
  const parts = bodyText.split(`--${boundary}`);

  for (const part of parts) {
    if (!part.includes('filename=')) continue;
    const headerEnd = part.indexOf('\r\n\r\n');
    if (headerEnd === -1) continue;
    const headers = part.slice(0, headerEnd);
    const filenameMatch = headers.match(/filename="([^"]*)"/i);
    const typeMatch = headers.match(/Content-Type:\s*([^\r\n]+)/i);
    const originalName = filenameMatch?.[1] || 'upload.bin';
    const safeName = path.basename(originalName).replace(/[^a-z0-9._-]/gi, '_');
    const storedName = `${Date.now()}_${crypto.randomBytes(4).toString('hex')}_${safeName}`;
    let content = part.slice(headerEnd + 4);
    if (content.endsWith('\r\n')) content = content.slice(0, -2);
    if (content.endsWith('--')) content = content.slice(0, -2);
    const buffer = Buffer.from(content, 'binary');
    const parsedContentType = typeMatch?.[1]?.trim() || 'application/octet-stream';
    const supabaseFileUrl = await uploadSupabaseFile({
      storedName,
      buffer,
      contentType: parsedContentType
    });

    if (!supabaseFileUrl) {
      const storedPath = path.join(uploadDir, storedName);
      await mkdir(uploadDir, { recursive: true });
      await writeFile(storedPath, buffer);
    }

    return {
      file_name: safeName,
      stored_name: storedName,
      file_url: supabaseFileUrl || `/uploads/${storedName}`,
      content_type: parsedContentType,
      size: buffer.length
    };
  }

  throw new Error('No uploaded file found');
};

const getEntityRows = (db, entityName) => {
  if (entityName === 'User') return db.users.filter((user) => user.verified !== false).map(publicUser);
  if (!db.entities[entityName]) db.entities[entityName] = [];
  return db.entities[entityName];
};

const getEntityRecord = (db, entityName, id) => getEntityRows(db, entityName).find((row) => row.id === id);

const countRowHasRecordedQuantity = (row) => {
  if (Number(row.counted_quantity || 0) !== 0) return true;
  if (Object.values(row.unit_inputs || {}).some((value) => Number(value || 0) !== 0)) return true;
  return (row.area_counts || []).some((areaCount) => (
    Number(areaCount.quantity || 0) !== 0 ||
    Object.values(areaCount.unit_inputs || {}).some((value) => Number(value || 0) !== 0)
  ));
};

const repairSubmittedInventoryCount = (db, count) => {
  if (count?.status !== 'submitted' || !Array.isArray(count.items) || count.items.length === 0) return count;
  if (count.items.some(countRowHasRecordedQuantity)) return count;

  const inventoryByItem = new Map(
    db.entities.LocationInventory
      .filter((row) => row.location_id === count.location_id)
      .map((row) => [row.item_id, row])
  );
  let recoveredAny = false;

  const repairedItems = count.items.map((row) => {
    if (row.has_variants && Array.isArray(row.grouped_items)) {
      const unitInputs = {};
      const total = row.grouped_items.reduce((sum, variant) => {
        const quantity = Number(inventoryByItem.get(variant.item_id)?.on_hand_quantity || 0);
        if (quantity !== 0) {
          recoveredAny = true;
          unitInputs[variant.variant_name] = quantity;
        }
        return sum + quantity;
      }, 0);
      const areaCounts = Array.isArray(row.area_counts) && row.area_counts.length > 0
        ? row.area_counts.map((areaCount, index) => index === 0
          ? {
            ...areaCount,
            quantity: total,
            unit_inputs: { ...(areaCount.unit_inputs || {}), ...unitInputs }
          }
          : areaCount)
        : row.area_counts;
      return {
        ...row,
        counted_quantity: total,
        unit_inputs: Object.keys(unitInputs).length ? unitInputs : row.unit_inputs,
        area_counts: areaCounts
      };
    }

    const quantity = Number(inventoryByItem.get(row.item_id)?.on_hand_quantity || 0);
    if (quantity !== 0) recoveredAny = true;
    const areaCounts = Array.isArray(row.area_counts) && row.area_counts.length > 0
      ? row.area_counts.map((areaCount, index) => index === 0 ? { ...areaCount, quantity } : areaCount)
      : row.area_counts;
    return {
      ...row,
      counted_quantity: quantity,
      area_counts: areaCounts
    };
  });

  if (!recoveredAny) return count;
  count.items = repairedItems;
  count.recovered_from_location_inventory = true;
  count.updated_date = nowIso();
  return count;
};

const createRecord = (db, entityName, body, user) => {
  if (!db.entities[entityName]) throw new Error(`Unknown entity "${entityName}"`);
  const id = makeId(entityName);
  const record = {
    ...body,
    id,
    created_date: nowIso(),
    updated_date: nowIso(),
    created_by: user?.email || 'system'
  };
  if (companyScopedEntities.has(entityName) && !record.company_id) {
    record.company_id = entityName === 'CompanySettings' ? id : companyIdForUser(db, user);
  }
  if (entityName === 'CompanySettings' && !record.company_id) record.company_id = id;
  db.entities[entityName].push(record);
  return record;
};

const updateRecord = (db, entityName, id, body) => {
  if (!db.entities[entityName]) throw new Error(`Unknown entity "${entityName}"`);
  const index = db.entities[entityName].findIndex((row) => row.id === id);
  if (index === -1) return null;
  db.entities[entityName][index] = {
    ...db.entities[entityName][index],
    ...body,
    id,
    updated_date: nowIso()
  };
  return db.entities[entityName][index];
};

const deleteRecord = (db, entityName, id) => {
  if (!db.entities[entityName]) throw new Error(`Unknown entity "${entityName}"`);
  const before = db.entities[entityName].length;
  db.entities[entityName] = db.entities[entityName].filter((row) => row.id !== id);
  return before !== db.entities[entityName].length;
};

const importCatalog = async (db, user, fileUrl) => {
  const filePath = uploadedPathFromUrl(fileUrl);
  const text = filePath
    ? await readFile(filePath, 'utf8')
    : await fetch(fileUrl).then((response) => {
      if (!response.ok) throw new Error(`Unable to download catalog file (${response.status})`);
      return response.text();
    });
  const rows = parseCsv(text);
  const companyId = companyIdForUser(db, user);
  const results = {
    items: { created: 0, updated: 0, errors: [] },
    vendors: { created: 0, updated: 0, errors: [] }
  };

  const vendorByName = new Map(db.entities.Vendor.map((vendor) => [String(vendor.name || '').toLowerCase(), vendor]));
  const itemByName = new Map(db.entities.InventoryItem.map((item) => [String(item.name || '').toLowerCase(), item]));
  const grouped = new Map();

  for (const row of rows) {
    const itemName = getColumn(row, ['Item Name', 'Inventory item', 'Inventory Item', 'Name']);
    if (!itemName) continue;
    if (!grouped.has(itemName)) grouped.set(itemName, []);
    grouped.get(itemName).push(row);
  }

  for (const [itemName, itemRows] of grouped) {
    try {
      const first = itemRows[0];
      const purchaseOptions = [];

      for (const row of itemRows) {
        const vendorName = getColumn(row, ['Vendor Name', 'Supplier', 'Vendor']);
        if (!vendorName) continue;
        let vendor = vendorByName.get(vendorName.toLowerCase());
        if (!vendor) {
          vendor = createRecord(db, 'Vendor', {
            company_id: companyId,
            name: vendorName,
            email: getColumn(row, ['Vendor Email', 'Supplier Email']),
            is_active: true,
            notes: 'Auto-created during catalog import'
          }, user);
          vendorByName.set(vendorName.toLowerCase(), vendor);
          results.vendors.created += 1;
        }
        purchaseOptions.push({
          vendor_id: vendor.id,
          vendor_name: vendor.name,
          product_name: getColumn(row, ['Product Name', 'Purchase options', 'Purchase Options'], itemName),
          product_code: getColumn(row, ['Product Code', 'SKU']),
          pack_size: getColumn(row, ['Pack Size']),
          unit_cost: toNumber(getColumn(row, ['Unit Cost', 'Price after discount', 'Price'])),
          unit_of_measure: getColumn(row, ['Unit of Measure', 'UOM'], 'EA'),
          inner_pack_units: toNumber(getColumn(row, ['Inner Pack Units', 'Inner pack quantity']), null),
          inner_pack_name: getColumn(row, ['Inner Pack Name', 'Pack nickname']),
          packs_per_case: toNumber(getColumn(row, ['Packs Per Case', 'Packs per case']), null),
          is_preferred: purchaseOptions.length === 0,
          location_ids: null,
          notes: ''
        });
      }

      const bestCost = purchaseOptions.length
        ? Math.min(...purchaseOptions.map((option) => Number(option.unit_cost || 0)).filter(Number.isFinite))
        : toNumber(getColumn(first, ['Unit Cost', 'Price after discount', 'Price']));

      const itemData = {
        company_id: companyId,
        name: itemName,
        sku: getColumn(first, ['SKU', 'Product Code']),
        category: getColumn(first, ['Category']),
        unit_of_measure: getColumn(first, ['Unit of Measure', 'UOM'], 'EA'),
        unit_cost: Number.isFinite(bestCost) ? bestCost : 0,
        is_commissary_item: toBool(getColumn(first, ['Is Commissary Item']), false),
        commissary_price: toNumber(getColumn(first, ['Commissary Price']), null),
        description: getColumn(first, ['Description']),
        is_active: toBool(getColumn(first, ['Is Active', 'Ordering enabled'], 'Yes'), true),
        purchase_options: purchaseOptions,
        ai_suggested_par: toNumber(getColumn(first, ['AI Suggested Par', 'Par level']), null),
        minimum_reorder_volume: toNumber(getColumn(first, ['Minimum Reorder Volume', 'Min On Hand', 'Min order quantity']), null)
      };

      const existing = itemByName.get(itemName.toLowerCase());
      if (existing) {
        const existingVendors = new Set((existing.purchase_options || []).map((option) => normalizeEmail(option.vendor_name)));
        const newOptions = purchaseOptions.filter((option) => !existingVendors.has(normalizeEmail(option.vendor_name)));
        updateRecord(db, 'InventoryItem', existing.id, {
          ...itemData,
          purchase_options: [...(existing.purchase_options || []), ...newOptions]
        });
        results.items.updated += 1;
      } else {
        const created = createRecord(db, 'InventoryItem', itemData, user);
        itemByName.set(itemName.toLowerCase(), created);
        results.items.created += 1;
      }
    } catch (error) {
      results.items.errors.push(`${itemName}: ${error.message}`);
    }
  }

  return { success: true, results };
};

const exportCatalog = (format, items = []) => {
  const headers = ['Item Name', 'SKU', 'Category', 'Unit of Measure', 'Unit Cost', 'Is Commissary Item', 'Commissary Price', 'Vendor', 'Is Active'];
  const rows = [
    headers.map(csvEscape).join(','),
    ...items.map((item) => {
      const preferred = (item.purchase_options || []).find((option) => option.is_preferred) || (item.purchase_options || [])[0];
      return [
        item.name,
        item.sku,
        item.category,
        item.unit_of_measure,
        Number(preferred?.unit_cost || item.unit_cost || 0).toFixed(2),
        item.is_commissary_item ? 'Yes' : 'No',
        Number(item.commissary_price || 0).toFixed(2),
        preferred?.vendor_name || '',
        item.is_active === false ? 'No' : 'Yes'
      ].map(csvEscape).join(',');
    })
  ];

  if (format !== 'pdf') return rows.join('\n');
  return makePdf('Master Catalog', items.map((item) => {
    const preferred = (item.purchase_options || []).find((option) => option.is_preferred) || (item.purchase_options || [])[0];
    return `${item.name || ''} | ${item.category || ''} | ${item.unit_of_measure || ''} | $${Number(preferred?.unit_cost || item.unit_cost || 0).toFixed(2)}`;
  }));
};

const makePdf = (title, lines) => {
  const escapePdf = (value) => String(value).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  const visibleLines = [title, `Generated: ${new Date().toLocaleDateString()}`, '', ...lines].slice(0, 42);
  const content = `BT /F1 11 Tf 50 760 Td ${visibleLines.map((line, index) => `${index ? 'T* ' : ''}(${escapePdf(line)}) Tj`).join(' ')} ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach((offset) => {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  });
  pdf += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return pdf;
};

const sendEmail = async (db, payload) => {
  const to = String(payload.toEmail || '').split(',').map((email) => email.trim()).filter(Boolean);
  const cc = String(payload.ccEmail || '').split(',').map((email) => email.trim()).filter(Boolean);
  const emailRecord = {
    id: makeId('email'),
    to,
    cc,
    subject: payload.subject || '',
    html: payload.htmlBody || '',
    status: 'logged',
    provider: 'local-log',
    created_date: nowIso()
  };

  if (process.env.RESEND_API_KEY && process.env.EMAIL_FROM && to.length > 0) {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM,
        to,
        cc: cc.length ? cc : undefined,
        subject: emailRecord.subject,
        html: emailRecord.html
      })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.message || `Email provider returned ${response.status}`);
    emailRecord.status = 'sent';
    emailRecord.provider = 'resend';
    emailRecord.provider_id = result.id;
  }

  db.sentEmails.push(emailRecord);
  return emailRecord;
};

const functionHandlers = {
  downloadCatalogTemplate: async () => {
    const csv = [
      'Item Name,SKU,Category,Unit of Measure,Unit Cost,Is Commissary Item,Commissary Price,Description,Vendor Name,Vendor Email,Product Name,Product Code,Pack Size,Inner Pack Units,Inner Pack Name,Packs Per Case,AI Suggested Par,Minimum Reorder Volume,Is Active',
      '"Sample Item","SKU001","Produce","EA",2.50,No,,"Fresh produce item","Example Vendor","vendor@example.com","Product ABC","ABC123","6x10oz",6,"Pack",10,100,50,Yes',
      '"Another Item","SKU002","Dairy","EA",5.75,No,,"Dairy product","Dairy Supplier","dairy@example.com","Milk Carton","MILK001","12 pack",12,"Carton",1,50,25,Yes'
    ].join('\n');
    return { data: csv };
  },

  importCatalog: async ({ db, user, body }) => ({ data: await importCatalog(db, user, body.file_url) }),

  exportCatalog: async ({ body }) => ({ data: exportCatalog(body.format, body.items || []) }),

  mergeDuplicateItems: async ({ db, body }) => {
    const { item1_id, item2_id, keep_id } = body;
    const item1 = getEntityRecord(db, 'InventoryItem', item1_id);
    const item2 = getEntityRecord(db, 'InventoryItem', item2_id);
    if (!item1 || !item2) throw new Error('Both items must exist');
    const keep = keep_id === item1.id ? item1 : item2;
    const remove = keep_id === item1.id ? item2 : item1;
    const purchaseOptions = [...(keep.purchase_options || []), ...(remove.purchase_options || [])];
    updateRecord(db, 'InventoryItem', keep.id, { purchase_options: purchaseOptions });
    deleteRecord(db, 'InventoryItem', remove.id);
    return { data: { success: true, kept_name: keep.name, removed_name: remove.name } };
  },

  manageProductGroups: async ({ db, user, body }) => {
    const action = body.action;
    const companyId = companyIdForUser(db, user);

    if (action === 'create') {
      const group = createRecord(db, 'ProductGroup', {
        company_id: companyId,
        name: String(body.name || '').trim(),
        description: body.description || ''
      }, user);
      return { data: { success: true, group }, group };
    }

    if (action === 'update') {
      let group = getEntityRecord(db, 'ProductGroup', body.groupId);
      let migrated = false;
      if (!group) {
        group = createRecord(db, 'ProductGroup', {
          company_id: companyId,
          name: String(body.name || '').trim(),
          description: body.description || ''
        }, user);
        migrated = true;
      } else {
        group = updateRecord(db, 'ProductGroup', group.id, {
          name: String(body.name || group.name || '').trim(),
          description: body.description ?? group.description ?? ''
        });
      }
      return { data: { success: true, group, migrated }, group };
    }

    if (action === 'delete') {
      db.entities.InventoryItem
        .filter((item) => item.product_group_id === body.groupId)
        .forEach((item) => updateRecord(db, 'InventoryItem', item.id, { product_group_id: null, group_sort_order: 0 }));
      deleteRecord(db, 'ProductGroup', body.groupId);
      return { data: { success: true } };
    }

    if (action === 'add_items') {
      const itemIds = Array.isArray(body.itemIds) ? body.itemIds : [];
      itemIds.forEach((itemId, index) => {
        updateRecord(db, 'InventoryItem', itemId, {
          product_group_id: body.groupId,
          group_sort_order: index
        });
      });
      return { data: { success: true, updated: itemIds.length } };
    }

    throw new Error(`Unknown product group action "${action}"`);
  },

  sendVendorOrderEmail: async ({ db, body }) => {
    if (body.orderId) {
      const order = getEntityRecord(db, 'Order', body.orderId);
      if (order) {
        const token = order.vendor_public_token || crypto.randomBytes(24).toString('hex');
        const appUrl = String(body.appUrl || '').replace(/\/$/, '');
        const orderUrl = appUrl ? `${appUrl}/vendor/order?token=${token}` : `/vendor/order?token=${token}`;
        body.htmlBody = String(body.htmlBody || '').replaceAll('TRACKING_PLACEHOLDER_CONFIRM', orderUrl);
        updateRecord(db, 'Order', order.id, {
          vendor_public_token: token,
          vendor_public_token_created_at: order.vendor_public_token_created_at || nowIso(),
          vendor_public_token_expires_at: order.vendor_public_token_expires_at || new Date(Date.now() + 1000 * 60 * 60 * 24 * 90).toISOString()
        });
      }
    }
    const email = await sendEmail(db, body);
    if (body.orderId) {
      updateRecord(db, 'Order', body.orderId, {
        status: 'sent',
        sent_at: nowIso(),
        email_sent_at: nowIso(),
        email_status: email.status,
        email_log_id: email.id
      });
    }
    return { data: { success: true, email } };
  },

  validateVendorToken: async ({ db, body }) => {
    const token = String(body.token || '').trim();
    if (!token) return { data: { error: 'Missing order token' } };
    const order = db.entities.Order.find((row) => row.vendor_public_token === token);
    if (!order) return { data: { error: 'Invalid or expired order link' } };
    if (order.vendor_public_token_expires_at && new Date(order.vendor_public_token_expires_at).getTime() < Date.now()) {
      return { data: { error: 'Invalid or expired order link' } };
    }
    updateRecord(db, 'Order', order.id, {
      status: order.status === 'sent' ? 'viewed' : order.status,
      viewed_at: order.viewed_at || nowIso()
    });
    const freshOrder = getEntityRecord(db, 'Order', order.id);
    const location = freshOrder?.location_id ? getEntityRecord(db, 'Location', freshOrder.location_id) : null;
    const settings = db.entities.CompanySettings.find((row) => !freshOrder?.company_id || row.company_id === freshOrder.company_id) || db.entities.CompanySettings[0] || null;
    return { data: { success: true, order: freshOrder, location, settings } };
  },

  cancelVendorOrderEmail: async ({ db, body }) => {
    const email = await sendEmail(db, body);
    if (body.orderId) {
      updateRecord(db, 'Order', body.orderId, {
        status: 'cancelled',
        cancelled_at: nowIso(),
        cancellation_email_status: email.status,
        cancellation_email_log_id: email.id
      });
    }
    return { data: { success: true, email } };
  },

  reviewOrderBeforeSend: async ({ db, body }) => {
    const locInv = db.entities.LocationInventory;
    const items = db.entities.InventoryItem;
    const previousOrders = db.entities.Order.filter((order) => order.location_id === body.location_id);
    const review = (body.order_items || []).map((orderItem) => {
      const item = items.find((row) => row.id === orderItem.item_id);
      const stock = locInv.find((row) => row.location_id === body.location_id && row.item_id === orderItem.item_id);
      const historical = previousOrders
        .flatMap((order) => order.items || [])
        .filter((row) => row.item_id === orderItem.item_id)
        .map((row) => Number(row.quantity_ordered || 0))
        .filter((quantity) => quantity > 0);
      const avg = historical.length ? historical.reduce((sum, quantity) => sum + quantity, 0) / historical.length : 0;
      const orderQuantity = Number(orderItem.quantity_ordered || 0);
      const aiPar = Number(item?.ai_suggested_par || stock?.par_level || 0);
      const highComparedToHistory = avg > 0 && orderQuantity > avg * 1.75;
      const abovePar = aiPar > 0 && (Number(stock?.on_hand_quantity || 0) + orderQuantity) > aiPar * 1.5;
      const status = highComparedToHistory || abovePar ? 'warning' : avg === 0 ? 'question' : 'ok';
      return {
        item_name: orderItem.item_name,
        order_quantity: orderQuantity,
        on_hand: Number(stock?.on_hand_quantity || 0),
        ai_par: aiPar,
        avg_historical_order: avg,
        status,
        message: status === 'ok' ? 'Order quantity looks reasonable.' : status === 'question' ? 'No order history yet for this item.' : 'This quantity is higher than recent patterns or current par levels.',
        recommendation: status === 'warning' ? 'Double-check the quantity before sending.' : ''
      };
    });
    return { data: { success: true, review } };
  },

  calculateSmartParsAfterCount: async ({ db, body }) => {
    const locationId = body.location_id;
    const items = db.entities.InventoryItem.filter((item) => item.is_active !== false);
    const orders = db.entities.Order.filter((order) => order.location_id === locationId);
    const results = [];

    for (const item of items) {
      const quantities = orders
        .flatMap((order) => order.items || [])
        .filter((row) => row.item_id === item.id)
        .map((row) => Number(row.quantity_ordered || 0))
        .filter((quantity) => quantity > 0);
      if (!quantities.length) {
        results.push({ item_name: item.name, status: 'no_history' });
        continue;
      }
      const avg = quantities.reduce((sum, quantity) => sum + quantity, 0) / quantities.length;
      const suggested = Math.ceil(avg * 1.25);
      const minimum = Math.max(1, Math.floor(suggested * 0.35));
      updateRecord(db, 'InventoryItem', item.id, {
        ai_suggested_par: suggested,
        minimum_reorder_volume: minimum,
        last_par_calculation_date: nowIso()
      });
      results.push({ item_name: item.name, status: 'updated', suggested_par: suggested, minimum_reorder_volume: minimum });
    }

    return {
      data: {
        success: true,
        items_processed: items.length,
        items_updated: results.filter((row) => row.status === 'updated').length,
        results
      }
    };
  },

  submitInventoryCount: async ({ db, user, body }) => {
    const itemQtyMap = body.itemQtyMap || {};
    const locationId = body.locationId || body.location_id;
    const companyId = body.companyId || companyIdForUser(db, user);
    const existingCount = body.countId ? getEntityRecord(db, 'InventoryCount', body.countId) : null;
    const submittedItems = Array.isArray(body.items)
      ? body.items
      : Array.isArray(existingCount?.items)
        ? existingCount.items.map((row) => {
          if (row.has_variants && Array.isArray(row.grouped_items)) {
            const unitInputs = { ...(row.unit_inputs || {}) };
            const countedQuantity = row.grouped_items.reduce((sum, variant) => {
              const quantity = Number(itemQtyMap[variant.item_id] || 0);
              if (quantity !== 0) unitInputs[variant.variant_name] = quantity;
              return sum + quantity;
            }, 0);
            return { ...row, counted_quantity: countedQuantity, unit_inputs: unitInputs };
          }
          return {
            ...row,
            counted_quantity: Number(itemQtyMap[row.item_id] ?? row.counted_quantity ?? 0)
          };
        })
        : undefined;
    let updated = 0;
    let created = 0;

    for (const [itemId, rawQuantity] of Object.entries(itemQtyMap)) {
      const quantity = Number(rawQuantity || 0);
      const existingId = body.locInvMap?.[itemId];
      const existing = existingId
        ? getEntityRecord(db, 'LocationInventory', existingId)
        : db.entities.LocationInventory.find((row) => row.location_id === locationId && row.item_id === itemId);
      const data = {
        company_id: companyId,
        location_id: locationId,
        item_id: itemId,
        on_hand_quantity: quantity,
        par_level: Number(existing?.par_level || 0),
        reorder_point: Number(existing?.reorder_point || 0),
        last_counted_at: nowIso()
      };

      if (existing) {
        updateRecord(db, 'LocationInventory', existing.id, data);
        updated += 1;
      } else {
        createRecord(db, 'LocationInventory', data, user);
        created += 1;
      }
    }

    if (body.countId) {
      updateRecord(db, 'InventoryCount', body.countId, {
        status: 'submitted',
        submitted_at: nowIso(),
        submitted_by: user?.email || 'system',
        ...(submittedItems ? { items: submittedItems } : {})
      });
    }

    return { data: { success: true, updated, created } };
  },

  fulfillCommissaryOrder: async ({ db, user, body }) => {
    const order = getEntityRecord(db, 'Order', body.order_id);
    if (!order) throw new Error('Order not found');
    const fulfillmentItems = body.fulfillment_items || [];
    const totalAmount = fulfillmentItems.reduce((sum, item) => sum + Number(item.quantity_fulfilled || 0) * Number(item.unit_cost || 0), 0);
    const allFulfilled = fulfillmentItems.every((item) => Number(item.quantity_fulfilled || 0) >= Number(item.quantity_ordered || 0));
    const fulfillment = createRecord(db, 'CommissaryFulfillment', {
      company_id: order.company_id || companyIdForUser(db, user),
      order_id: order.id,
      order_number: order.order_number,
      retail_location_id: order.location_id,
      commissary_location_id: body.commissary_location_id,
      items: fulfillmentItems,
      notes: body.notes || '',
      status: allFulfilled ? 'fulfilled' : 'partial',
      fulfillment_date: nowIso(),
      total_amount: totalAmount
    }, user);
    const invoice = createRecord(db, 'Invoice', {
      company_id: order.company_id || companyIdForUser(db, user),
      order_id: order.id,
      location_id: order.location_id,
      vendor_name: 'Commissary',
      invoice_number: `CI-${Date.now().toString().slice(-6)}`,
      invoice_date: new Date().toISOString().slice(0, 10),
      status: 'pending_review',
      extracted_items: fulfillmentItems
        .filter((item) => Number(item.quantity_fulfilled || 0) > 0)
        .map((item) => ({
          item_id: item.item_id,
          item_name: item.item_name,
          quantity: Number(item.quantity_fulfilled || 0),
          unit_cost: Number(item.unit_cost || 0),
          total_cost: Number(item.quantity_fulfilled || 0) * Number(item.unit_cost || 0),
          matched: true
        })),
      total_amount: totalAmount
    }, user);
    updateRecord(db, 'Order', order.id, {
      status: allFulfilled ? 'fulfilled' : 'partially_fulfilled',
      fulfilled_at: nowIso()
    });
    return { data: { success: true, fulfillment, invoice } };
  },

  scrapeProductImage: async ({ body }) => {
    if (!body.productUrl) return { data: { image_url: null, price: null } };
    try {
      const response = await fetch(body.productUrl, { headers: { 'User-Agent': 'InventoryHQ/1.0' } });
      const html = await response.text();
      const image = html.match(/property=["']og:image["'][^>]*content=["']([^"']+)["']/i)?.[1]
        || html.match(/content=["']([^"']+)["'][^>]*property=["']og:image["']/i)?.[1]
        || null;
      const price = html.match(/\$([0-9]+(?:\.[0-9]{2})?)/)?.[1] || null;
      return { data: { image_url: image, price: price ? Number(price) : null } };
    } catch {
      return { data: { image_url: null, price: null } };
    }
  },

  createDailySnapshot: async ({ db, user }) => {
    const date = new Date().toISOString().slice(0, 10);
    let created = 0;
    for (const location of db.entities.Location.filter((row) => row.is_active !== false)) {
      for (const item of db.entities.InventoryItem.filter((row) => row.is_active !== false)) {
        const existing = db.entities.InventorySnapshot.find((row) => row.snapshot_date === date && row.location_id === location.id && row.item_id === item.id);
        if (existing) continue;
        const stock = db.entities.LocationInventory.find((row) => row.location_id === location.id && row.item_id === item.id);
        createRecord(db, 'InventorySnapshot', {
          company_id: location.company_id || item.company_id || companyIdForUser(db, user),
          snapshot_date: date,
          location_id: location.id,
          item_id: item.id,
          quantity_on_hand: Number(stock?.on_hand_quantity || 0),
          unit_cost: Number(item.unit_cost || 0)
        }, user);
        created += 1;
      }
    }
    return { data: { success: true, created } };
  }
};

const handleAuth = async (req, res, pathname, searchParams) => {
  if (req.method === 'GET' && pathname === '/api/auth/google') {
    if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
      return sendRedirect(res, '/login?auth_error=google_not_configured');
    }

    const redirect = safeRedirectPath(searchParams.get('redirect') || '/');
    const state = crypto.randomBytes(24).toString('hex');
    await withDb(async (db) => {
      db.googleOAuthStates[state] = {
        redirect,
        expires_at: Date.now() + 1000 * 60 * 10
      };
      return null;
    });

    const googleUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    googleUrl.searchParams.set('client_id', process.env.GOOGLE_CLIENT_ID);
    googleUrl.searchParams.set('redirect_uri', getGoogleRedirectUri(req));
    googleUrl.searchParams.set('response_type', 'code');
    googleUrl.searchParams.set('scope', 'openid email profile');
    googleUrl.searchParams.set('state', state);
    googleUrl.searchParams.set('prompt', 'select_account');
    return sendRedirect(res, googleUrl.toString());
  }

  if (req.method === 'GET' && pathname === '/api/auth/google/callback') {
    const state = searchParams.get('state');
    const code = searchParams.get('code');
    const googleError = searchParams.get('error');

    if (googleError) {
      return sendRedirect(res, '/login?auth_error=google_denied');
    }
    if (!state || !code) {
      return sendRedirect(res, '/login?auth_error=google_missing_code');
    }

    try {
      const profile = await exchangeGoogleCode(req, code);
      const result = await withDb(async (db) => {
        const savedState = db.googleOAuthStates[state];
        delete db.googleOAuthStates[state];
        if (!savedState || savedState.expires_at < Date.now()) {
          throw new Error('Invalid or expired Google sign-in state');
        }

        const user = upsertGoogleUser(db, profile);
        const accessToken = issueSession(db, user);
        return {
          accessToken,
          redirect: savedState.redirect || '/'
        };
      });
      return sendRedirect(res, withQueryParams(result.redirect, {
        access_token: result.accessToken,
        google: '1'
      }));
    } catch (error) {
      console.error('Google sign-in failed:', error.message);
      return sendRedirect(res, '/login?auth_error=google_failed');
    }
  }

  if (req.method === 'POST' && pathname === '/api/auth/register') {
    const body = await readJsonBody(req);
    const result = await withDb(async (db) => {
      const email = normalizeEmail(body.email);
      if (!email || !body.password) throw new Error('Email and password are required');
      let user = db.users.find((row) => normalizeEmail(row.email) === email);
      if (user?.password_hash && user.verified !== false) throw new Error('An account already exists for that email');
      const firstUser = db.users.filter((row) => row.verified !== false).length === 0;
      const company = firstCompany(db);
      if (!user) {
        user = {
          id: makeId('user'),
          email,
          full_name: body.full_name || email.split('@')[0],
          role: firstUser ? 'admin' : 'user',
          company_id: company?.company_id || company?.id || null,
          created_date: nowIso()
        };
        db.users.push(user);
      }
      user.password_hash = hashPassword(body.password);
      user.verified = true;
      user.status = 'active';
      user.updated_date = nowIso();
      if (firstUser) ensureCompanyForAdmin(db, user);
      ensureUserPermission(db, user);
      const accessToken = issueSession(db, user);
      return { access_token: accessToken, user: publicUser(user) };
    });
    return sendJson(res, 200, result);
  }

  if (req.method === 'POST' && pathname === '/api/auth/login') {
    const body = await readJsonBody(req);
    const result = await withDb(async (db) => {
      const user = db.users.find((row) => normalizeEmail(row.email) === normalizeEmail(body.email) && row.verified !== false);
      if (!user || !verifyPassword(body.password, user.password_hash)) throw new Error('Invalid email or password');
      const accessToken = issueSession(db, user);
      return { access_token: accessToken, user: publicUser(user) };
    });
    return sendJson(res, 200, result);
  }

  if (req.method === 'GET' && pathname === '/api/auth/me') {
    const db = await loadDb();
    const user = currentUser(db, req);
    if (!user) return sendJson(res, 401, { error: 'Unauthorized' });
    return sendJson(res, 200, publicUser(user));
  }

  if (req.method === 'POST' && pathname === '/api/auth/logout') {
    await withDb(async (db) => {
      const token = tokenFromRequest(req);
      if (token) delete db.sessions[token];
      return null;
    });
    return sendJson(res, 200, { success: true });
  }

  if (req.method === 'POST' && pathname === '/api/auth/verify-otp') {
    const body = await readJsonBody(req);
    const result = await withDb(async (db) => {
      const user = db.users.find((row) => normalizeEmail(row.email) === normalizeEmail(body.email));
      if (!user) throw new Error('Account not found');
      user.verified = true;
      const accessToken = issueSession(db, user);
      return { access_token: accessToken, user: publicUser(user) };
    });
    return sendJson(res, 200, result);
  }

  if (req.method === 'POST' && pathname === '/api/auth/resend-otp') {
    await readJsonBody(req);
    return sendJson(res, 200, { success: true });
  }

  if (req.method === 'POST' && pathname === '/api/auth/reset-request') {
    const body = await readJsonBody(req);
    const result = await withDb(async (db) => {
      const user = db.users.find((row) => normalizeEmail(row.email) === normalizeEmail(body.email));
      if (!user) return { success: true };
      const token = crypto.randomBytes(24).toString('hex');
      db.resetTokens[token] = { user_id: user.id, email: user.email, expires_at: Date.now() + 1000 * 60 * 60 * 24 };
      const resetUrl = `/reset-password?token=${token}&email=${encodeURIComponent(user.email)}`;
      console.log(`Password reset link for ${user.email}: ${resetUrl}`);
      return { success: true, reset_url: resetUrl };
    });
    return sendJson(res, 200, result);
  }

  if (req.method === 'POST' && pathname === '/api/auth/reset') {
    const body = await readJsonBody(req);
    const result = await withDb(async (db) => {
      const token = db.resetTokens[body.resetToken];
      if (!token || token.expires_at < Date.now()) throw new Error('Invalid or expired reset link');
      const user = db.users.find((row) => row.id === token.user_id);
      if (!user) throw new Error('User not found');
      user.password_hash = hashPassword(body.newPassword);
      user.verified = true;
      user.status = 'active';
      user.updated_date = nowIso();
      delete db.resetTokens[body.resetToken];
      ensureUserPermission(db, user);
      const accessToken = issueSession(db, user);
      return { access_token: accessToken, user: publicUser(user) };
    });
    return sendJson(res, 200, result);
  }

  return false;
};

const handleUsers = async (req, res, pathname) => {
  if (req.method !== 'POST' || pathname !== '/api/users/invite') return false;
  const body = await readJsonBody(req);
  const result = await withDb(async (db) => {
    const user = currentUser(db, req);
    if (!user || user.role !== 'admin') throw new Error('Admin access required');
    const email = normalizeEmail(body.email);
    if (!email) throw new Error('Email is required');
    let invited = db.users.find((row) => normalizeEmail(row.email) === email);
    if (!invited) {
      invited = {
        id: makeId('user'),
        email,
        full_name: body.full_name || '',
        role: body.role === 'admin' ? 'admin' : 'user',
        company_id: companyIdForUser(db, user),
        verified: false,
        status: 'pending',
        created_date: nowIso(),
        updated_date: nowIso()
      };
      db.users.push(invited);
    }
    invited.role = body.role === 'admin' ? 'admin' : 'user';
    const token = crypto.randomBytes(24).toString('hex');
    db.resetTokens[token] = { user_id: invited.id, email, expires_at: Date.now() + 1000 * 60 * 60 * 24 * 14 };
    const inviteUrl = `/reset-password?token=${token}&email=${encodeURIComponent(email)}&invite=true`;
    console.log(`Invite link for ${email}: ${inviteUrl}`);
    return { success: true, invite_url: inviteUrl };
  });
  return sendJson(res, 200, result);
};

const handleEntities = async (req, res, pathname, searchParams) => {
  const match = pathname.match(/^\/api\/entities\/([^/]+)(?:\/([^/]+))?$/);
  if (!match) return false;
  const [, entityName, id] = match;
  const db = await loadDb();
  const user = currentUser(db, req);
  if (!user) return sendJson(res, 401, { error: 'Unauthorized' });

  if (req.method === 'GET' && entityName === 'InventoryCount') {
    const result = await withDb(async (writeDb) => {
      const writeUser = currentUser(writeDb, req);
      if (!writeUser) throw new Error('Unauthorized');

      if (id) {
        const record = getEntityRecord(writeDb, entityName, id);
        return record ? repairSubmittedInventoryCount(writeDb, record) : null;
      }

      let rows = getEntityRows(writeDb, entityName).map((row) => repairSubmittedInventoryCount(writeDb, row));
      const filters = parseQueryJson(searchParams.get('filter'), {});
      const sort = searchParams.get('sort') || '';
      const limit = Number(searchParams.get('limit') || 0);
      rows = rows.filter((row) => matchesFilter(row, filters));
      rows = sortRows(rows, sort);
      if (limit > 0) rows = rows.slice(0, limit);
      return rows;
    });

    if (id && !result) return sendJson(res, 404, { error: 'Not found' });
    return sendJson(res, 200, result);
  }

  if (req.method === 'GET' && !id) {
    let rows = getEntityRows(db, entityName);
    const filters = parseQueryJson(searchParams.get('filter'), {});
    const sort = searchParams.get('sort') || '';
    const limit = Number(searchParams.get('limit') || 0);
    rows = rows.filter((row) => matchesFilter(row, filters));
    rows = sortRows(rows, sort);
    if (limit > 0) rows = rows.slice(0, limit);
    return sendJson(res, 200, rows);
  }

  if (req.method === 'GET' && id) {
    const record = getEntityRecord(db, entityName, id);
    if (!record) return sendJson(res, 404, { error: 'Not found' });
    return sendJson(res, 200, record);
  }

  if (req.method === 'POST' && id === 'bulk') {
    const rows = await readJsonBody(req);
    if (!Array.isArray(rows)) throw new Error('Bulk create expects an array');
    const records = await withDb(async (writeDb) => {
      const writeUser = currentUser(writeDb, req);
      return rows.map((row) => createRecord(writeDb, entityName, row, writeUser));
    });
    return sendJson(res, 200, records);
  }

  if (req.method === 'POST' && !id) {
    const body = await readJsonBody(req);
    const record = await withDb(async (writeDb) => createRecord(writeDb, entityName, body, currentUser(writeDb, req)));
    return sendJson(res, 200, record);
  }

  if (req.method === 'PATCH' && id) {
    const body = await readJsonBody(req);
    const record = await withDb(async (writeDb) => updateRecord(writeDb, entityName, id, body));
    if (!record) return sendJson(res, 404, { error: 'Not found' });
    return sendJson(res, 200, record);
  }

  if (req.method === 'DELETE' && id) {
    const deleted = await withDb(async (writeDb) => deleteRecord(writeDb, entityName, id));
    if (!deleted) return sendJson(res, 404, { error: 'Not found' });
    return sendJson(res, 200, { success: true });
  }

  return false;
};

const handleFunctions = async (req, res, pathname) => {
  const match = pathname.match(/^\/api\/functions\/([^/]+)$/);
  if (!match || req.method !== 'POST') return false;
  const functionName = match[1];
  const handler = functionHandlers[functionName];
  if (!handler) return sendJson(res, 404, { error: `Function "${functionName}" is not implemented locally` });
  const publicFunctions = new Set(['validateVendorToken']);
  const body = await readJsonBody(req);
  const result = await withDb(async (db) => {
    const user = currentUser(db, req);
    if (!user && !publicFunctions.has(functionName)) throw new Error('Unauthorized');
    return handler({ db, user, body });
  });
  return sendJson(res, 200, result);
};

const handleIntegrations = async (req, res, pathname) => {
  if (req.method === 'POST' && pathname === '/api/integrations/upload-file') {
    const db = await loadDb();
    const user = currentUser(db, req);
    if (!user) return sendJson(res, 401, { error: 'Unauthorized' });
    const file = await parseMultipartFile(req);
    return sendJson(res, 200, file);
  }

  if (req.method === 'POST' && pathname === '/api/integrations/invoke-llm') {
    await readJsonBody(req);
    return sendJson(res, 200, {
      vendor_name: '',
      invoice_number: '',
      invoice_date: '',
      total_amount: 0,
      items: []
    });
  }

  return false;
};

const serveUploads = async (req, res, pathname) => {
  if (!pathname.startsWith('/uploads/')) return false;
  if (useSupabase && supabaseStorageBucket) {
    return sendRedirect(res, supabasePublicFileUrl(path.basename(pathname)));
  }

  const filePath = path.join(uploadDir, path.basename(pathname));
  try {
    await stat(filePath);
  } catch {
    sendJson(res, 404, { error: 'File not found' });
    return true;
  }
  res.writeHead(200, { 'Access-Control-Allow-Origin': '*' });
  createReadStream(filePath).pipe(res);
  return true;
};

const serveStatic = async (req, res, pathname) => {
  if (!['GET', 'HEAD'].includes(req.method)) return false;
  const distDir = path.join(rootDir, 'dist');
  const requested = pathname === '/' ? '/index.html' : pathname;
  const candidate = path.normalize(path.join(distDir, requested));
  const safePath = candidate.startsWith(distDir) ? candidate : path.join(distDir, 'index.html');
  let filePath = safePath;
  try {
    const info = await stat(filePath);
    if (info.isDirectory()) filePath = path.join(filePath, 'index.html');
  } catch {
    filePath = path.join(distDir, 'index.html');
  }

  try {
    await stat(filePath);
  } catch {
    return sendText(res, 404, 'Build output not found. Run "npm run build" first.');
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentTypes = {
    '.css': 'text/css',
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.webp': 'image/webp'
  };
  res.writeHead(200, { 'Content-Type': contentTypes[ext] || 'application/octet-stream' });
  createReadStream(filePath).pipe(res);
  return true;
};

export const requestHandler = async (req, res) => {
  if (req.method === 'OPTIONS') {
    return sendJson(res, 204, {});
  }

  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;

  try {
    if (pathname === '/api/health') {
      return sendJson(res, 200, {
        ok: true,
        environment: vercelEnv,
        persistence: useSupabase ? 'supabase' : isVercel ? 'temporary' : 'local-file',
        supabase_configured: useSupabase,
        supabase_state_id: supabaseStateId,
        storage_configured: Boolean(useSupabase && supabaseStorageBucket),
        warning: !useSupabase && isVercel
          ? 'Supabase environment variables are not configured; data will not persist between Vercel function instances.'
          : undefined
      });
    }
    if (await handleAuth(req, res, pathname, url.searchParams) !== false) return;
    if (await handleUsers(req, res, pathname) !== false) return;
    if (await handleEntities(req, res, pathname, url.searchParams) !== false) return;
    if (await handleFunctions(req, res, pathname) !== false) return;
    if (await handleIntegrations(req, res, pathname) !== false) return;
    if (await serveUploads(req, res, pathname) !== false) return;
    if (await serveStatic(req, res, pathname) !== false) return;
    return sendJson(res, 404, { error: 'Not found' });
  } catch (error) {
    const status = error.message === 'Unauthorized' ? 401 : error.message.includes('Admin access') ? 403 : 400;
    return sendJson(res, status, { error: error.message || 'Request failed' });
  }
};

const isMainModule = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainModule) {
  const server = createServer(requestHandler);
  server.listen(port, () => {
    console.log(`InventoryHQ server listening on http://localhost:${port}`);
    console.log(useSupabase
      ? `Using Supabase app_state row: ${supabaseStateId}`
      : `Data directory: ${dataDir}`);
  });
}
