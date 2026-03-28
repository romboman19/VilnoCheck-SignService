const express = require('express');
const multer = require('multer');
const archiver = require('archiver');
const crypto = require('crypto');
const fsp = require('fs/promises');
const path = require('path');
const { URL } = require('url');
const { buildSmartIdProviderConfig, probeSmartIdProvider } = require('./providers/privatbank-smartid');

const app = express();
const port = Number(process.env.PORT || 3017);
const host = process.env.HOST || '0.0.0.0';
const appRoot = process.cwd();
const packageJson = require(path.join(appRoot, 'package.json'));
const serviceVersion = packageJson.version || '0.0.0';
const storageRoot = path.resolve(process.env.SIGN_STORAGE_DIR || path.join(appRoot, 'storage'));
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });
const SIGNING_METHODS = Object.freeze([
  {
    id: 'iit-token',
    family: 'hardware-token',
    label: 'IIT token',
    productionReady: true,
    experimental: false
  },
  {
    id: 'privatbank-jks',
    family: 'file-key',
    label: 'PrivatBank JKS',
    productionReady: true,
    experimental: false
  },
  {
    id: 'smartid',
    family: 'cloud-signing',
    label: 'SmartID',
    providerId: 'pb-smartid',
    productionReady: false,
    experimental: true
  }
]);
const ALLOWED_SIGNING_METHODS = new Set(SIGNING_METHODS.map((method) => method.id));
const SIGNING_METHOD_ALIASES = new Map([
  ['privatbank-smartid', 'smartid']
]);
const SENSITIVE_FIELD_PATTERN = /(password|pass|pin|secret|privatekey|private_key|signaturebase64|filebase64|raw|binary|content|buffer|data)$/i;
const EXTRA_PROXY_ALLOWED_HOSTS = new Set(['zc.bank.gov.ua']);

app.disable('x-powered-by');
app.use(express.json({ limit: '10mb' }));
app.get('/vendor/euscp.worker.js', (_req, res) => {
  res.sendFile(path.join(appRoot, 'node_modules', '@it-enterprise', 'digital-signature', 'src', 'euscp.worker.js'));
});

function buildBootstrapPayload() {
  const smartIdProvider = buildSmartIdProviderConfig();
  return {
    service: 'sign-service',
    version: serviceVersion,
    defaults: {
      signingMethod: 'iit-token'
    },
    signingMethods: SIGNING_METHODS.map((method) => ({
      ...method,
      enabled: method.id === 'smartid' ? Boolean(smartIdProvider.enabled) : true
    })),
    providers: {
      smartId: smartIdProvider
    }
  };
}

app.get('/api/bootstrap', (req, res) => {
  res.json({
    ok: true,
    bootstrap: buildBootstrapPayload()
  });
});

app.get('/api/providers/privatbank-smartid', async (req, res, next) => {
  try {
    const config = buildSmartIdProviderConfig();
    const probe = String(req.query.probe || '').trim();
    const includeProbe = ['1', 'true', 'yes'].includes(probe.toLowerCase());

    res.json({
      ok: true,
      methodId: 'smartid',
      provider: config,
      probe: includeProbe ? await probeSmartIdProvider(config) : null
    });
  } catch (error) {
    next(error);
  }
});

let proxyAllowedHostsPromise = null;

function normalizeProxyTarget(rawAddress) {
  const trimmed = String(rawAddress || '').trim();
  if (!trimmed) {
    throw new Error('PKI proxy target is missing.');
  }

  const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  const url = new URL(withProtocol);

  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error(`Unsupported PKI proxy protocol: ${url.protocol}`);
  }

  return url;
}

function addHostToAllowList(target, hosts) {
  if (!target) return;
  try {
    const url = normalizeProxyTarget(target);
    if (url.hostname) {
      hosts.add(url.hostname.toLowerCase());
    }
  } catch {
    // ignore malformed CA endpoints
  }
}

async function getProxyAllowedHosts() {
  if (!proxyAllowedHostsPromise) {
    proxyAllowedHostsPromise = (async () => {
      const caFile = path.join(appRoot, 'public', 'data', 'CAs.json');
      const raw = await fsp.readFile(caFile, 'utf8');
      const data = JSON.parse(raw);
      const hosts = new Set();

      for (const ca of Array.isArray(data) ? data : []) {
        addHostToAllowList(ca?.address, hosts);
        addHostToAllowList(ca?.ocspAccessPointAddress, hosts);
        addHostToAllowList(ca?.cmpAddress, hosts);
        addHostToAllowList(ca?.tspAddress, hosts);
        addHostToAllowList(ca?.ldapAddress, hosts);
      }

      for (const host of EXTRA_PROXY_ALLOWED_HOSTS) hosts.add(host);
      return hosts;
    })().catch((error) => {
      proxyAllowedHostsPromise = null;
      throw error;
    });
  }

  return proxyAllowedHostsPromise;
}

app.all('/pki/ProxyHandler', express.text({ type: '*/*', limit: '10mb' }), async (req, res) => {
  try {
    const upstreamUrl = normalizeProxyTarget(req.query.address);
    const allowedHosts = await getProxyAllowedHosts();

    if (!allowedHosts.has(upstreamUrl.hostname.toLowerCase())) {
      return res.status(403).type('text/plain; charset=utf-8').send('PKI proxy host is not allowed.');
    }

    const requestContentType = String(req.query.contentType || '').trim() || 'application/octet-stream';
    const requestHeaders = {
      Accept: '*/*',
      'User-Agent': `VilnoCheck-SignService/${serviceVersion} ProxyHandler`
    };

    let requestBody;
    if (!['GET', 'HEAD'].includes(req.method)) {
      const incomingBody = typeof req.body === 'string' ? req.body.trim() : '';
      requestBody = incomingBody ? Buffer.from(incomingBody, 'base64') : Buffer.alloc(0);
      requestHeaders['Content-Type'] = requestContentType;
      requestHeaders['Content-Length'] = String(requestBody.length);
    }

    const upstreamResponse = await fetch(upstreamUrl, {
      method: req.method,
      headers: requestHeaders,
      body: requestBody,
      redirect: 'follow'
    });

    const responseBuffer = Buffer.from(await upstreamResponse.arrayBuffer());
    if (!upstreamResponse.ok) {
      console.warn(`[pki-proxy] ${req.method} ${upstreamUrl} -> ${upstreamResponse.status}`);
      return res.status(502).type('text/plain; charset=utf-8').send(`PKI upstream error: ${upstreamResponse.status}`);
    }

    res.set('Cache-Control', 'no-store');
    res.type('text/plain; charset=utf-8').send(responseBuffer.toString('base64'));
  } catch (error) {
    console.error('[pki-proxy] request failed', error);
    res.status(502).type('text/plain; charset=utf-8').send('PKI proxy request failed.');
  }
});

app.use(express.static(path.join(appRoot, 'public')));

function decodeUploadFileName(fileName) {
  const value = String(fileName || '');
  if (!value) return value;
  if (/^[\u0000-\u007F]*$/.test(value)) return value;
  if (!/[ÐÑ]/.test(value)) return value;
  try {
    return Buffer.from(value, 'latin1').toString('utf8');
  } catch {
    return value;
  }
}

function safeFileName(fileName, fallback = 'document.bin') {
  const raw = String(fileName || fallback)
    .replace(/[\\/]+/g, '_')
    .replace(/[\x00-\x1F\x7F]+/g, ' ')
    .trim();
  const cleaned = raw.replace(/\s+/g, ' ').replace(/^\.+/, '').trim();
  return cleaned || fallback;
}

function redactKeyMedia(keyMedia) {
  if (!keyMedia || typeof keyMedia !== 'object') return null;
  const { password, pass, pin, secret, ...rest } = keyMedia;
  return rest;
}

function sanitizeSessionValue(value, depth = 0) {
  if (value == null) return value;
  if (depth > 6) return null;

  if (Array.isArray(value)) {
    return value.slice(0, 25).map((entry) => sanitizeSessionValue(entry, depth + 1));
  }

  if (Buffer.isBuffer(value)) {
    return `[buffer:${value.length}]`;
  }

  if (typeof value === 'object') {
    const output = {};
    for (const [key, nestedValue] of Object.entries(value)) {
      if (SENSITIVE_FIELD_PATTERN.test(key)) continue;
      output[key] = sanitizeSessionValue(nestedValue, depth + 1);
    }
    return output;
  }

  if (typeof value === 'string' && value.length > 2000) {
    return `${value.slice(0, 2000)}…`;
  }

  return value;
}

function normalizeSigningMethod(method) {
  const value = String(method || '').trim();
  if (!value) return null;
  const normalized = SIGNING_METHOD_ALIASES.get(value) || value;
  return ALLOWED_SIGNING_METHODS.has(normalized) ? normalized : null;
}

function normalizeStatus(value) {
  if (value == null) return null;
  const status = String(value).trim();
  if (!status) return null;
  return status.slice(0, 64);
}

function mergeSession(record, patch = {}) {
  const previous = record && typeof record === 'object' ? record : {};
  const next = { ...previous };

  if (Object.prototype.hasOwnProperty.call(patch, 'signingMethod')) {
    next.signingMethod = normalizeSigningMethod(patch.signingMethod);
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'status')) {
    next.status = normalizeStatus(patch.status);
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'methodState')) {
    next.methodState = sanitizeSessionValue(patch.methodState);
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'signer')) {
    next.signer = sanitizeSessionValue(patch.signer);
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'client')) {
    next.client = sanitizeSessionValue(patch.client);
  }

  next.updatedAt = new Date().toISOString();
  return next;
}

function asciiDownloadName(fileName, fallback = 'signed-package.zip') {
  const base = String(fileName || fallback)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return base || fallback;
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function jsonFile(documentId) {
  return path.join(storageRoot, documentId, 'record.json');
}

async function ensureDir(dirPath) {
  await fsp.mkdir(dirPath, { recursive: true });
}

async function loadRecord(documentId) {
  const filePath = jsonFile(documentId);
  const raw = await fsp.readFile(filePath, 'utf8');
  return JSON.parse(raw);
}

async function saveRecord(documentId, record) {
  const dirPath = path.dirname(jsonFile(documentId));
  await ensureDir(dirPath);
  await fsp.writeFile(jsonFile(documentId), JSON.stringify(record, null, 2));
}

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'sign-service',
    version: serviceVersion,
    signingMethods: SIGNING_METHODS.map((method) => method.id)
  });
});

app.post('/api/documents', upload.single('document'), async (req, res, next) => {
  try {
    if (!req.file || !req.file.buffer?.length) {
      return res.status(400).json({ error: 'document file is required' });
    }

    const documentId = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const originalName = safeFileName(decodeUploadFileName(req.file.originalname) || 'document.bin');
    const directory = path.join(storageRoot, documentId);
    const originalPath = path.join(directory, originalName);
    const buffer = req.file.buffer;

    await ensureDir(directory);
    await fsp.writeFile(originalPath, buffer);

    const record = {
      id: documentId,
      createdAt,
      document: {
        originalName,
        mimeType: req.file.mimetype || 'application/octet-stream',
        size: buffer.length,
        sha256: sha256(buffer),
        path: originalPath
      },
      session: {
        signingMethod: null,
        availableSigningMethods: SIGNING_METHODS,
        status: 'document-uploaded',
        methodState: null,
        signer: null,
        client: null,
        updatedAt: createdAt
      },
      signature: null
    };

    await saveRecord(documentId, record);

    res.json({
      ok: true,
      documentId,
      fileName: originalName,
      mimeType: record.document.mimeType,
      size: buffer.length,
      sha256: record.document.sha256,
      signingPayloadBase64: buffer.toString('base64'),
      session: record.session,
      bootstrap: buildBootstrapPayload()
    });
  } catch (error) {
    next(error);
  }
});

app.patch('/api/documents/:documentId/session', async (req, res, next) => {
  try {
    const { documentId } = req.params;
    const record = await loadRecord(documentId);
    record.session = mergeSession(record.session, req.body || {});
    await saveRecord(documentId, record);

    res.json({
      ok: true,
      documentId,
      session: record.session
    });
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return res.status(404).json({ error: 'document not found' });
    }
    next(error);
  }
});

app.post('/api/documents/:documentId/signature', async (req, res, next) => {
  try {
    const { documentId } = req.params;
    const {
      signatureBase64,
      signatureInfo,
      keyMedia,
      client,
      signatureFileName,
      signingMethod,
      methodState,
      session
    } = req.body || {};

    if (!signatureBase64 || typeof signatureBase64 !== 'string') {
      return res.status(400).json({ error: 'signatureBase64 is required' });
    }

    const record = await loadRecord(documentId);
    const normalizedSigningMethod = normalizeSigningMethod(signingMethod || session?.signingMethod);
    const signatureBuffer = Buffer.from(signatureBase64, 'base64');
    const signatureName = safeFileName(signatureFileName || `${record.document.originalName}.p7s`, 'signature.p7s');
    const signaturePath = path.join(storageRoot, documentId, signatureName);

    await fsp.writeFile(signaturePath, signatureBuffer);

    record.session = mergeSession(record.session, {
      ...(session && typeof session === 'object' ? session : {}),
      signingMethod: normalizedSigningMethod,
      status: 'signed',
      methodState: methodState ?? session?.methodState,
      client: client ?? session?.client
    });

    record.signature = {
      uploadedAt: new Date().toISOString(),
      fileName: signatureName,
      size: signatureBuffer.length,
      sha256: sha256(signatureBuffer),
      path: signaturePath,
      signingMethod: normalizedSigningMethod,
      methodState: sanitizeSessionValue(methodState),
      signatureInfo: sanitizeSessionValue(signatureInfo || null),
      keyMedia: redactKeyMedia(keyMedia),
      client: sanitizeSessionValue(client || null)
    };

    await saveRecord(documentId, record);

    res.json({
      ok: true,
      documentId,
      downloadUrl: `/api/documents/${documentId}/package`,
      packageFileName: `${path.parse(record.document.originalName).name}.signed-package.zip`
    });
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return res.status(404).json({ error: 'document not found' });
    }
    next(error);
  }
});

app.get('/api/documents/:documentId/package', async (req, res, next) => {
  try {
    const { documentId } = req.params;
    const record = await loadRecord(documentId);

    if (!record.signature?.path) {
      return res.status(409).json({ error: 'signature has not been uploaded yet' });
    }

    const packageName = `${path.parse(record.document.originalName).name}.signed-package.zip`;
    const downloadName = asciiDownloadName(packageName);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${downloadName}"`);

    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.on('error', next);
    archive.pipe(res);

    archive.file(record.document.path, { name: record.document.originalName });
    archive.file(record.signature.path, { name: record.signature.fileName });
    archive.file(record.document.path, { name: `original/${record.document.originalName}` });
    archive.file(record.signature.path, { name: `signature/${record.signature.fileName}` });
    archive.append(JSON.stringify({
      generatedAt: new Date().toISOString(),
      service: 'sign-service',
      version: serviceVersion,
      documentId: record.id,
      document: {
        fileName: record.document.originalName,
        mimeType: record.document.mimeType,
        size: record.document.size,
        sha256: record.document.sha256
      },
      session: record.session || null,
      signature: {
        fileName: record.signature.fileName,
        size: record.signature.size,
        sha256: record.signature.sha256,
        uploadedAt: record.signature.uploadedAt,
        signingMethod: record.signature.signingMethod || null,
        methodState: record.signature.methodState || null,
        signatureInfo: record.signature.signatureInfo,
        keyMedia: redactKeyMedia(record.signature.keyMedia),
        client: record.signature.client
      }
    }, null, 2), { name: 'manifest.json' });

    await archive.finalize();
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return res.status(404).json({ error: 'package not found' });
    }
    next(error);
  }
});

app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'not found' });
  }
  res.sendFile(path.join(appRoot, 'public', 'index.html'));
});

app.use((error, _req, res, _next) => {
  console.error('[sign-service]', error);
  res.status(500).json({ error: error?.message || 'internal server error' });
});

ensureDir(storageRoot)
  .then(() => {
    app.listen(port, host, () => {
      console.log(`[sign-service] listening on http://${host}:${port}`);
      console.log(`[sign-service] storage: ${storageRoot}`);
    });
  })
  .catch((error) => {
    console.error('[sign-service] failed to initialize storage', error);
    process.exit(1);
  });
