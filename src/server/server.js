const express = require('express');
const multer = require('multer');
const archiver = require('archiver');
const crypto = require('crypto');
const fsp = require('fs/promises');
const path = require('path');
const { URL } = require('url');
const morgan = require('morgan');
const fs = require('fs');
const { setupSecurity, generalLimiter, documentLimiter, pkiLimiter, requireApiKey } = require('./middleware/security');
const { cleanupExpiredDocuments } = require('./cleanup');
const { verifyDetachedSignature } = require('./verify');
const { generateSignatureProtocol } = require('./generate-protocol');
const app = express();
const port = Number(process.env.PORT || 3017);
const host = process.env.HOST || '0.0.0.0';
const appRoot = process.cwd();
const packageJson = require(path.join(appRoot, 'package.json'));
const serviceVersion = packageJson.version || '0.0.0';
const storageRoot = path.resolve(process.env.SIGN_STORAGE_DIR || path.join(appRoot, 'storage'));
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });
const CLOUD_SIGN_ENABLED = process.env.CLOUD_SIGN_ENABLED === '1';
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
  ...(CLOUD_SIGN_ENABLED ? [{
    id: 'cloud-kep',
    family: 'cloud-signing',
    label: 'Хмарний КЕП',
    productionReady: false,
    experimental: true
  }] : [])
]);
const ALLOWED_SIGNING_METHODS = new Set(SIGNING_METHODS.map((method) => method.id));
const SIGNING_METHOD_ALIASES = new Map([
]);
const SENSITIVE_FIELD_PATTERN = /(password|pass|pin|secret|privatekey|private_key|signaturebase64|filebase64|raw|binary|content|buffer|data)$/i;
const EXTRA_PROXY_ALLOWED_HOSTS = new Set(['zc.bank.gov.ua']);
app.disable('x-powered-by');
// Security middleware
setupSecurity(app);
app.use(generalLimiter);
// Morgan logging
const logsDir = path.join(appRoot, 'logs');
if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
// Console logging (dev format) for non-production
if (process.env.NODE_ENV !== 'production') {
  app.use(morgan('dev'));
}
// File logging (combined format)
const accessLogStream = fs.createWriteStream(
  path.join(logsDir, 'access.log'),
  { flags: 'a' }
);
app.use(morgan('combined', { stream: accessLogStream }));
app.use(express.json({ limit: '10mb' }));
app.get('/vendor/euscp.worker.js', (_req, res) => {
  res.sendFile(path.join(appRoot, 'node_modules', '@it-enterprise', 'digital-signature', 'src', 'euscp.worker.js'));
});
function buildBootstrapPayload() {
  return {
    service: 'sign-service',
    version: serviceVersion,
    defaults: {
      signingMethod: 'iit-token'
    },
    signingMethods: SIGNING_METHODS.map((method) => ({
      ...method,
      enabled: true
    })),
    providers: {
    }
  };
}
app.get('/api/bootstrap', (req, res) => {
  res.json({
    ok: true,
    bootstrap: buildBootstrapPayload()
  });
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
app.all('/pki/ProxyHandler', pkiLimiter, express.text({ type: '*/*', limit: '10mb' }), async (req, res) => {
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
// Config endpoint for client-side API key
app.get('/config.js', (_req, res) => {
  res.type('application/javascript');
  const key = process.env.CLIENT_API_KEY || process.env.API_KEY || '';
  res.send(`window.__API_KEY__ = "${key}";`);
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
app.post('/api/documents', requireApiKey, documentLimiter, upload.single('document'), async (req, res, next) => {
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
app.patch('/api/documents/:documentId/session', requireApiKey, async (req, res, next) => {
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
app.post('/api/documents/:documentId/signature', requireApiKey, async (req, res, next) => {
  try {
    const { documentId } = req.params;
    let {
      signatures, // Object with base64 signatures for each format
      signatureInfo,
      keyMedia,
      client,
      signingMethod,
      methodState,
      session
    } = req.body || {};
    // signatures can be either:    // - object: { cadesDetached, cadesEnveloped, pades }
    // - array: [{ format, type, data }, ...]
    // Fallback: старий формат клієнта (v1)
    if (!signatures && req.body.signatureBase64) {
      signatures = { cadesDetached: req.body.signatureBase64 };
    }

    if (!signatures || typeof signatures !== 'object') {
      return res.status(400).json({ error: 'signatures object or array is required' });
    }
    // Convert array format to object format
    let sigObject = signatures;
    if (Array.isArray(signatures)) {
      sigObject = {};
      for (const sig of signatures) {
        if (sig.format === 'CAdES' && sig.type === 'detached') {
          sigObject.cadesDetached = sig.data;
        } else if (sig.format === 'CAdES' && sig.type === 'enveloped') {
          sigObject.cadesEnveloped = sig.data;
        } else if (sig.format === 'PAdES') {
          sigObject.pades = sig.data;
        }
      }
      signatures = sigObject;
    }
    const record = await loadRecord(documentId);
    const normalizedSigningMethod = normalizeSigningMethod(signingMethod || session?.signingMethod);
    const baseName = path.parse(record.document.originalName).name;
    // Storage for all signature files
    const sigFiles = {};
    const sigDir = path.join(storageRoot, documentId);
    // Save CAdES detached
    if (signatures.cadesDetached) {
      const buf = Buffer.from(signatures.cadesDetached, 'base64');
      const fileName = `${baseName}.p7s`;
      const filePath = path.join(sigDir, fileName);
      await fsp.writeFile(filePath, buf);
      sigFiles.cadesDetached = { fileName, path: filePath, size: buf.length, sha256: sha256(buf) };
    }
    // Save CAdES enveloped
    if (signatures.cadesEnveloped) {
      const buf = Buffer.from(signatures.cadesEnveloped, 'base64');
      const fileName = `${baseName}.cades.p7s`;
      const filePath = path.join(sigDir, fileName);
      await fsp.writeFile(filePath, buf);
      sigFiles.cadesEnveloped = { fileName, path: filePath, size: buf.length, sha256: sha256(buf) };
    }
    // Save PAdES (only for PDF)
    if (signatures.pades && record.document.mimeType === 'application/pdf') {
      const buf = Buffer.from(signatures.pades, 'base64');
      const fileName = `${baseName}.pades.pdf`;
      const filePath = path.join(sigDir, fileName);
      await fsp.writeFile(filePath, buf);
      sigFiles.pades = { fileName, path: filePath, size: buf.length, sha256: sha256(buf) };
    }
    // Verify at least one signature was provided
    if (Object.keys(sigFiles).length === 0) {
      return res.status(400).json({ error: 'at least one signature format required' });
    }
    // Use first signature for verification info
    const firstSig = Object.values(sigFiles)[0];
    const documentBytes = await fsp.readFile(record.document.path);
    const verifyResult = await verifyDetachedSignature(documentBytes, await fsp.readFile(firstSig.path));
    record.session = mergeSession(record.session, {
      ...(session && typeof session === 'object' ? session : {}),
      signingMethod: normalizedSigningMethod,
      status: 'signed',
      methodState: methodState ?? session?.methodState,
      client: client ?? session?.client
    });
    record.signatures = sigFiles;
    record.signature = {
      uploadedAt: new Date().toISOString(),
      fileName: firstSig.fileName,
      size: firstSig.size,
      sha256: firstSig.sha256,
      path: firstSig.path,
      signingMethod: normalizedSigningMethod,
      methodState: sanitizeSessionValue(methodState),
      signatureInfo: sanitizeSessionValue(signatureInfo || null),
      keyMedia: redactKeyMedia(keyMedia),
      client: sanitizeSessionValue(client || null),
      verification: verifyResult.skipped ? { skipped: true, error: verifyResult.error } : {
        valid: true,
        signerCN: verifyResult.signerCN,
        signingTime: verifyResult.signingTime,
        certSerial: verifyResult.certSerial,
        issuer: verifyResult.issuer
      }
    };
    await saveRecord(documentId, record);
    res.json({
      ok: true,
      documentId,
      downloadUrl: `/api/documents/${documentId}/package`,
      packageFileName: `${baseName}.signed-package.zip`,
      signatures: Object.keys(sigFiles)
    });
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return res.status(404).json({ error: 'document not found' });
    }
    next(error);
  }
});
app.get('/api/documents/:documentId/package', requireApiKey, async (req, res, next) => {
  try {
    const { documentId } = req.params;
    const record = await loadRecord(documentId);
    // Support both old (record.signature) and new (record.signatures) structure
    const hasSignatures = record.signatures && Object.keys(record.signatures).length > 0;
    const hasLegacySignature = record.signature?.path;
    if (!hasSignatures && !hasLegacySignature) {
      return res.status(409).json({ error: 'signature has not been uploaded yet' });
    }
    const packageName = `${path.parse(record.document.originalName).name}.signed-package.zip`;
    const downloadName = asciiDownloadName(packageName);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${downloadName}"`);
    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.on('error', next);
    archive.pipe(res);
    const baseName = path.parse(record.document.originalName).name;
    // Original document in original/ folder only
    archive.file(record.document.path, { name: `original/${record.document.originalName}` });
    // CAdES folder
    if (hasSignatures) {
      if (record.signatures.cadesDetached) {
        archive.file(record.signatures.cadesDetached.path, { name: `CAdES/${record.signatures.cadesDetached.fileName}` });
      }
      if (record.signatures.cadesEnveloped) {
        archive.file(record.signatures.cadesEnveloped.path, { name: `CAdES/${record.signatures.cadesEnveloped.fileName}` });
      }
    } else if (hasLegacySignature) {
      // Legacy: put in CAdES folder
      archive.file(record.signature.path, { name: `CAdES/${record.signature.fileName}` });
    }
    // PAdES folder
    if (hasSignatures && record.signatures.pades) {
      archive.file(record.signatures.pades.path, { name: `PAdES/${record.signatures.pades.fileName}` });
    } else {
      // Add README for non-PDF or missing PAdES
      archive.append('PAdES format is not yet implemented.', { name: 'PAdES/README.txt' });
    }
    // Build manifest with all signatures
    const signaturesManifest = hasSignatures ? {
      cadesDetached: record.signatures.cadesDetached ? {
        fileName: record.signatures.cadesDetached.fileName,
        size: record.signatures.cadesDetached.size,
        sha256: record.signatures.cadesDetached.sha256
      } : null,
      cadesEnveloped: record.signatures.cadesEnveloped ? {
        fileName: record.signatures.cadesEnveloped.fileName,
        size: record.signatures.cadesEnveloped.size,
        sha256: record.signatures.cadesEnveloped.sha256
      } : null,
      pades: record.signatures.pades ? {
        fileName: record.signatures.pades.fileName,
        size: record.signatures.pades.size,
        sha256: record.signatures.pades.sha256
      } : null
    } : {
      // Legacy format
      cadesDetached: {
        fileName: record.signature.fileName,
        size: record.signature.size,
        sha256: record.signature.sha256
      },
      cadesEnveloped: null,
      pades: null
    };
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
      signatures: signaturesManifest,
      signature: {
        fileName: record.signature?.fileName,
        size: record.signature?.size,
        sha256: record.signature?.sha256,
        uploadedAt: record.signature?.uploadedAt,
        signingMethod: record.signature?.signingMethod || null,
        methodState: record.signature?.methodState || null,
        signatureInfo: record.signature?.signatureInfo,
        keyMedia: redactKeyMedia(record.signature?.keyMedia),
        client: record.signature?.client,
        verification: record.signature?.verification || null
      }
    }, null, 2), { name: 'manifest.json' });
    // Generate and add PDF protocol
    try {
      const protocolData = {
        generatedAt: new Date().toISOString(),
        version: serviceVersion,
        document: record.document,
        signer: record.signature?.signatureInfo?.OwnerInfo || record.session?.signer || null,
        cert: record.signature?.signatureInfo?.cert || null,
        signatures: signaturesManifest,
        signingMethod: record.signature?.signingMethod || record.session?.signingMethod,
        verification: record.signature?.verification || null,
        signedAt: record.signature?.signatureInfo?.DateTimeStr || record.session?.updatedAt || null,
        documentId: documentId
      };
      console.log("[protocol] document:", JSON.stringify(protocolData.document));
      const protocolResult = await generateSignatureProtocol(protocolData);
      archive.append(protocolResult.buffer, { name: protocolResult.fileName });
    } catch (err) {
      console.error("[protocol] Failed to generate PDF protocol:", err.message);
    }
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
    // Initialize cleanup
    require('./cleanup');
    
    app.listen(port, host, () => {
      console.log(`[sign-service] listening on http://${host}:${port}`);
      console.log(`[sign-service] storage: ${storageRoot}`);
      console.log(`[sign-service] cleanup TTL: 24h`);
    });
  })
  .catch((error) => {
    console.error('[sign-service] failed to initialize storage', error);
    process.exit(1);
  });