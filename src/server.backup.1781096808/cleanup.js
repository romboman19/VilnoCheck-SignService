const fs = require('fs');
const path = require('path');

const STORAGE_DIR = process.env.SIGN_STORAGE_DIR || './storage';
const TTL_MS = 24 * 60 * 60 * 1000; // 24 години

function cleanupExpiredDocuments() {
  if (!fs.existsSync(STORAGE_DIR)) return;
  
  const now = Date.now();
  const entries = fs.readdirSync(STORAGE_DIR, { withFileTypes: true });
  
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dirPath = path.join(STORAGE_DIR, entry.name);
    
    try {
      const stat = fs.statSync(dirPath);
      if (now - stat.mtimeMs > TTL_MS) {
        fs.rmSync(dirPath, { recursive: true, force: true });
        console.log(`[cleanup] Removed expired document dir: ${entry.name}`);
      }
    } catch (err) {
      console.error(`[cleanup] Error removing ${entry.name}:`, err.message);
    }
  }
}

// Запускати при старті та кожну годину
cleanupExpiredDocuments();
setInterval(cleanupExpiredDocuments, 60 * 60 * 1000);

module.exports = { cleanupExpiredDocuments };
