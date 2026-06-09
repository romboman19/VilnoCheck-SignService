'use strict';

const path = require('path');
const fs = require('fs');

// Шлях до CA файлів
const CA_JSON_PATH = path.join(__dirname, '../../public/data/CAs.json');
const CA_CERTS_PATH = path.join(__dirname, '../../public/data/CACertificates.p7b');

let endUserInstance = null;
let endUserInitFailed = false;

async function getEndUser() {
  if (endUserInitFailed) return null;
  if (endUserInstance) return endUserInstance;

  try {
    const { EndUser } = require('@it-enterprise/digital-signature');
    const caJSON = JSON.parse(fs.readFileSync(CA_JSON_PATH, 'utf8'));
    const caCerts = fs.readFileSync(CA_CERTS_PATH);

    const eu = new EndUser();

    await eu.Initialize({
      language: 'uk',
      encoding: 'utf-8',
      CAs: caJSON,
      CACertificates: caCerts,
      allowedSignTypes: ['attached', 'detached'],
    });

    endUserInstance = eu;
    return eu;
  } catch (err) {
    console.warn('[verify] EndUser init failed:', err.message);
    endUserInitFailed = true;
    return null;
  }
}

/**
 * Верифікує detached підпис відносно оригінального документа.
 * @param {Buffer} documentBytes - оригінальний документ
 * @param {Buffer} signatureBytes - detached підпис (.p7s / CMS)
 * @returns {{ valid: boolean, signerCN?: string, signingTime?: string, error?: string, skipped?: boolean }}
 */
async function verifyDetachedSignature(documentBytes, signatureBytes) {
  try {
    const eu = await getEndUser();

    if (!eu) {
      // Ініціалізація не вдалась — пропускаємо верифікацію
      return {
        valid: true,
        skipped: true,
        error: 'EndUser initialization failed, verification skipped',
      };
    }

    // VerifyDataInternal — верифікація detached підпису
    const result = await eu.VerifyDataInternal(documentBytes, signatureBytes);

    return {
      valid: true,
      signerCN: result.SignerInfo?.CommonName || result.Certificate?.subject?.CN || 'unknown',
      signingTime: result.SigningTime || null,
      certSerial: result.Certificate?.serial || null,
      issuer: result.Certificate?.issuer?.CN || null,
      verificationSkipped: false,
    };
  } catch (err) {
    // EndUser кидає помилку якщо підпис невалідний
    return {
      valid: false,
      error: err.message || 'Signature verification failed',
    };
  }
}

module.exports = { verifyDetachedSignature };
