const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

// Security headers (helmet без CSP бо заважає IIT SDK)
function setupSecurity(app) {
  app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  }));
}

// Rate limiters
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 хвилин
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests' }
});

const documentLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 хвилина
  max: 10,
  message: { error: 'Too many document uploads' }
});

const pkiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { error: 'Too many PKI requests' }
});

// API Key auth middleware
function requireApiKey(req, res, next) {
  // Якщо API_KEY не налаштований — пропускаємо (dev режим)
  if (!process.env.API_KEY) return next();
  
  const key = req.headers['x-api-key'] || req.query.apiKey;
  if (key !== process.env.API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

module.exports = {
  setupSecurity,
  generalLimiter,
  documentLimiter,
  pkiLimiter,
  requireApiKey
};
