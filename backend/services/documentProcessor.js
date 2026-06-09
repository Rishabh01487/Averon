const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const C = require('../config/constants');

const MAGIC_BYTES = {
  '89504e470d0a1a0a': 'image/png',
  'ffd8ffe0': 'image/jpeg',
  'ffd8ffe1': 'image/jpeg',
  'ffd8ffe2': 'image/jpeg',
  'ffd8ffe3': 'image/jpeg',
  'ffd8ffe8': 'image/jpeg',
  '25504446': 'application/pdf',
  '52494646': 'image/webp',
};

function detectMimeType(filepath) {
  try {
    const fd = fs.openSync(filepath, 'r');
    const buf = Buffer.alloc(12);
    fs.readSync(fd, buf, 0, 12, 0);
    fs.closeSync(fd);
    const hex = buf.toString('hex').toLowerCase();
    for (const [magic, mime] of Object.entries(MAGIC_BYTES)) {
      if (hex.startsWith(magic)) return mime;
    }
    return null;
  } catch {
    return null;
  }
}

function getEncryptionKey() {
  const envKey = process.env.DOCUMENT_ENCRYPTION_KEY;
  if (envKey) return crypto.createHash('sha256').update(envKey).digest();
  return crypto.createHash('sha256').update('averon-doc-encryption-key-v1').digest();
}

function encryptFile(filepath) {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  const input = fs.readFileSync(filepath);
  const encrypted = Buffer.concat([cipher.update(input), cipher.final()]);
  const encryptedPath = filepath + '.enc';
  fs.writeFileSync(encryptedPath, Buffer.concat([iv, encrypted]));
  return encryptedPath;
}

function decryptFile(encryptedPath) {
  const key = getEncryptionKey();
  const data = fs.readFileSync(encryptedPath);
  const iv = data.subarray(0, 16);
  const encrypted = data.subarray(16);
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]);
}

function validateDocument(filepath) {
  if (!fs.existsSync(filepath)) throw new Error('File not found');
  const stat = fs.statSync(filepath);
  if (stat.size === 0) throw new Error('File is empty');
  if (stat.size > C.LIMITS.MAX_FILE_SIZE_BYTES) throw new Error(`File exceeds ${C.LIMITS.MAX_FILE_SIZE_BYTES / 1024 / 1024}MB limit`);
  const detectedMime = detectMimeType(filepath);
  if (!detectedMime) throw new Error('Unknown or unsupported file type');
  if (!C.LIMITS.ALLOWED_MIMETYPES.includes(detectedMime)) throw new Error(`File type ${detectedMime} is not allowed`);
  return { mimeType: detectedMime, size: stat.size, originalName: path.basename(filepath) };
}

function computeHash(filepath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filepath)).digest('hex');
}

function extractMetadata(filepath, mimetype) {
  const metadata = { filename: path.basename(filepath), size: fs.statSync(filepath).size, mimetype };
  if (mimetype === 'application/pdf') {
    const content = fs.readFileSync(filepath).toString('latin1');
    const titleMatch = content.match(/\/Title\s*\(([^)]*)\)/);
    if (titleMatch) metadata.pdfTitle = titleMatch[1];
    const pageMatch = content.match(/\/Type\s*\/Page[^s]/g);
    if (pageMatch) metadata.pdfPages = pageMatch.length;
  }
  return metadata;
}

function processDocument(filepath, options = {}) {
  const { encrypt = false, computeHash: doHash = true } = options;
  const validation = validateDocument(filepath);
  const result = { ...validation, filepath };
  if (doHash) result.hash = computeHash(filepath);
  result.metadata = extractMetadata(filepath, validation.mimeType);
  if (encrypt) {
    result.encryptedPath = encryptFile(filepath);
    result.encrypted = true;
  }
  return result;
}

module.exports = { validateDocument, detectMimeType, computeHash, processDocument, encryptFile, decryptFile, extractMetadata };
