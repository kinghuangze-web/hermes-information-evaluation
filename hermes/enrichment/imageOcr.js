const fs = require('fs');

function pickFirstNonEmpty(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }

  return '';
}

async function loadImageInput({ imagePath, imageUrl }, deps = {}) {
  if (imagePath && fs.existsSync(imagePath)) {
    return imagePath;
  }

  if (imageUrl && fs.existsSync(imageUrl)) {
    return imageUrl;
  }

  if (!imageUrl) {
    throw new Error('No imagePath or imageUrl provided for OCR');
  }

  if (/^data:image\//i.test(imageUrl)) {
    const payload = imageUrl.split(',')[1] || '';
    return Buffer.from(payload, 'base64');
  }

  const fetchImpl = deps.fetchImpl || fetch;
  const response = await fetchImpl(imageUrl, {
    headers: {
      'user-agent': 'Mozilla/5.0',
      accept: 'image/*,*/*;q=0.8'
    }
  });

  if (!response.ok) {
    throw new Error(`Image fetch failed with status ${response.status}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

async function runTesseractOcr(input, deps = {}) {
  if (deps.ocrRunner) {
    return deps.ocrRunner(input);
  }

  const { recognize } = require('tesseract.js');
  const languages = process.env.HERMES_OCR_LANGUAGES || 'eng';
  const options = typeof deps.logger === 'function' ? { logger: deps.logger } : {};
  const result = await recognize(input, languages, options);

  return {
    text: result?.data?.text || '',
    confidence: result?.data?.confidence || 0,
    languages
  };
}

async function resolveImageText(input = {}, deps = {}) {
  const imagePath = pickFirstNonEmpty(input.imagePath);
  const imageUrl = pickFirstNonEmpty(input.imageUrl);

  if (!imagePath && !imageUrl) {
    return {
      imagePath: '',
      imageUrl: '',
      status: 'unresolved',
      fetchMethod: 'ocr',
      text: '',
      excerpt: '',
      confidence: 0,
      languages: process.env.HERMES_OCR_LANGUAGES || 'eng'
    };
  }

  try {
    const imageInput = await loadImageInput({ imagePath, imageUrl }, deps);
    const result = await runTesseractOcr(imageInput, deps);
    const text = String(result.text || '').replace(/\s+/g, ' ').trim();

    return {
      imagePath,
      imageUrl,
      status: text ? 'resolved' : 'unresolved',
      fetchMethod: 'ocr',
      text,
      excerpt: text.slice(0, 160),
      confidence: Number(result.confidence || 0),
      languages: result.languages || process.env.HERMES_OCR_LANGUAGES || 'eng'
    };
  } catch (error) {
    return {
      imagePath,
      imageUrl,
      status: 'failed',
      fetchMethod: 'ocr',
      text: '',
      excerpt: '',
      confidence: 0,
      languages: process.env.HERMES_OCR_LANGUAGES || 'eng',
      error: error.message
    };
  }
}

module.exports = {
  resolveImageText
};
