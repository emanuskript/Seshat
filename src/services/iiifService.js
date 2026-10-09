const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_RETRIES = 2;
const DEFAULT_RETRY_DELAY_MS = 250;
const DEFAULT_MAX_JSON_BYTES = 20 * 1024 * 1024;
const DEFAULT_FALLBACK_WIDTH = 2400;

export class IIIFError extends Error {
  constructor(message, { code = 'iiif_error', url = '', status = null, retryable = false, cause = null } = {}) {
    super(message);
    this.name = 'IIIFError';
    this.code = code;
    this.url = url;
    this.status = status;
    this.retryable = retryable;
    if (cause) this.cause = cause;
  }
}

const asArray = (value) => {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
};

const getId = (node) => {
  if (typeof node === 'string') return node;
  return node?.id || node?.['@id'] || '';
};

const getType = (node) => String(node?.type || node?.['@type'] || '');

const sleep = (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs));

function validateHttpUrl(url, label = 'IIIF URL') {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new IIIFError(`${label} is not a valid URL.`, { code: 'invalid_url', url });
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new IIIFError(`${label} must use HTTP or HTTPS.`, { code: 'invalid_url', url });
  }
  return parsed.toString();
}

function isRetryableStatus(status) {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

async function fetchWithRetry(url, {
  fetchImpl = null,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  retries = DEFAULT_RETRIES,
  retryDelayMs = DEFAULT_RETRY_DELAY_MS,
  headers = {},
} = {}) {
  const request = fetchImpl || (typeof fetch === 'function' ? fetch : null);
  if (typeof request !== 'function') {
    throw new IIIFError('No Fetch API implementation is available.', { code: 'network_unavailable', url });
  }

  const requestUrl = validateHttpUrl(url);
  let lastError = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);

    try {
      const response = await request(requestUrl, {
        method: 'GET',
        headers: {
          Accept: 'application/ld+json, application/json;q=0.9, */*;q=0.1',
          ...headers,
        },
        mode: 'cors',
        redirect: 'follow',
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (!response?.ok) {
        const status = Number(response?.status) || 0;
        const retryable = isRetryableStatus(status);
        const error = new IIIFError(`Request failed with HTTP ${status || 'error'}.`, {
          code: 'http_error',
          url: requestUrl,
          status,
          retryable,
        });
        if (retryable && attempt < retries) {
          lastError = error;
          await sleep(retryDelayMs * (2 ** attempt));
          continue;
        }
        throw error;
      }

      if (response.url) validateHttpUrl(response.url, 'Redirect target');
      return response;
    } catch (error) {
      clearTimeout(timer);
      if (error instanceof IIIFError && !error.retryable) throw error;

      const normalized = timedOut
        ? new IIIFError(`Request timed out after ${timeoutMs} ms.`, {
            code: 'timeout', url: requestUrl, retryable: true, cause: error,
          })
        : (error instanceof IIIFError
            ? error
            : new IIIFError('Network request failed. The server may be unavailable or blocked by CORS.', {
                code: 'network_or_cors', url: requestUrl, retryable: true, cause: error,
              }));

      lastError = normalized;
      if (attempt < retries && normalized.retryable) {
        await sleep(retryDelayMs * (2 ** attempt));
        continue;
      }
      throw normalized;
    }
  }

  throw lastError || new IIIFError('IIIF request failed.', { code: 'network_error', url: requestUrl });
}

async function fetchJson(url, options = {}) {
  const response = await fetchWithRetry(url, options);
  const maxBytes = options.maxBytes || DEFAULT_MAX_JSON_BYTES;
  const declaredLength = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new IIIFError(`JSON response exceeds the ${maxBytes}-byte safety limit.`, {
      code: 'response_too_large', url,
    });
  }

  let text;
  try {
    text = await response.text();
  } catch (error) {
    throw new IIIFError('Could not read the IIIF response.', {
      code: 'response_read_error', url, cause: error,
    });
  }

  if (new TextEncoder().encode(text).length > maxBytes) {
    throw new IIIFError(`JSON response exceeds the ${maxBytes}-byte safety limit.`, {
      code: 'response_too_large', url,
    });
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    throw new IIIFError('The server returned invalid JSON.', {
      code: 'invalid_json', url, cause: error,
    });
  }
}

export function detectImageApiVersion(node) {
  if (!node) return null;
  const type = getType(node).toLowerCase();
  const contexts = asArray(node?.['@context']).join(' ').toLowerCase();
  const profile = asArray(node?.profile).join(' ').toLowerCase();
  const id = getId(node).toLowerCase();

  if (type.includes('imageservice3') || contexts.includes('/image/3/') || id.includes('/image/v3/')) return 3;
  if (type.includes('imageservice2') || contexts.includes('/image/2/') || profile.includes('/image/2/') || id.includes('/image/v2/')) return 2;
  if (contexts.includes('/image/1/') || profile.includes('/image/1/')) return 1;
  return null;
}

function normalizeService(service) {
  if (!service) return null;
  const source = typeof service === 'string' ? { id: service } : service;
  const id = getId(source).trim().replace(/\/+$/, '');
  if (!id) return null;
  return {
    id,
    type: getType(source) || null,
    profile: source.profile || null,
    version: detectImageApiVersion(source),
    raw: source,
  };
}

function labelToString(label, fallback) {
  if (typeof label === 'string' && label.trim()) return label.trim();
  if (Array.isArray(label)) {
    const first = label.find((entry) => typeof entry === 'string' && entry.trim());
    if (first) return first.trim();
  }
  if (label && typeof label === 'object') {
    for (const values of Object.values(label)) {
      const first = asArray(values).find((entry) => typeof entry === 'string' && entry.trim());
      if (first) return first.trim();
    }
  }
  return fallback;
}

function isPaintingMotivation(motivation) {
  return asArray(motivation).some((entry) => {
    const value = typeof entry === 'string' ? entry : getId(entry);
    return value === 'painting' || value === 'sc:painting' || value.endsWith('#painting');
  });
}

function isImageBody(body) {
  if (!body || typeof body !== 'object') return false;
  const type = getType(body).toLowerCase();
  const format = String(body.format || '').toLowerCase();
  const id = getId(body);
  const hasService = asArray(body.service).some((service) => !!getId(service));
  return type.includes('image') || format.startsWith('image/') || hasService || isLikelyDirectImageUrl(id);
}

function flattenImageBodies(body) {
  const bodies = [];
  const visit = (candidate) => {
    if (!candidate) return;
    if (Array.isArray(candidate)) {
      candidate.forEach(visit);
      return;
    }
    const type = getType(candidate).toLowerCase();
    if (type === 'choice' || type.endsWith(':choice')) {
      asArray(candidate.items || candidate.item || candidate.default).forEach(visit);
      return;
    }
    if (isImageBody(candidate)) bodies.push(candidate);
  };
  visit(body);
  return bodies;
}

function defaultServiceImageUrl(service) {
  if (!service?.id) return '';
  const size = service.version === 2 || service.version === 1 ? 'full' : 'max';
  return `${service.id}/full/${size}/0/default.jpg`;
}

function imageFromBody(body) {
  const services = asArray(body.service).map(normalizeService).filter(Boolean);
  const service = services[0] || null;
  const bodyId = getId(body).trim();
  return {
    id: bodyId || service?.id || '',
    bodyId,
    format: body.format || null,
    width: Number(body.width) || null,
    height: Number(body.height) || null,
    service,
    alternateServices: services.slice(1),
    displayUrl: bodyId || defaultServiceImageUrl(service),
  };
}

function pageFromCanvas(canvas, index, version) {
  const bodies = [];

  if (version === 2) {
    asArray(canvas?.images).forEach((annotation) => {
      if (annotation?.motivation && !isPaintingMotivation(annotation.motivation)) return;
      flattenImageBodies(annotation?.resource ?? annotation?.body).forEach((body) => bodies.push(body));
    });
  } else {
    asArray(canvas?.items).forEach((annotationPage) => {
      asArray(annotationPage?.items).forEach((annotation) => {
        if (!isPaintingMotivation(annotation?.motivation)) return;
        flattenImageBodies(annotation?.body ?? annotation?.resource).forEach((body) => bodies.push(body));
      });
    });
  }

  const images = [];
  const seen = new Set();
  bodies.forEach((body) => {
    const image = imageFromBody(body);
    if (!image.displayUrl) return;
    const identity = image.service?.id || image.bodyId;
    if (!identity || seen.has(identity)) return;
    seen.add(identity);
    images.push(image);
  });

  if (!images.length) return null;
  return {
    index,
    canvasId: getId(canvas) || `canvas-${index + 1}`,
    label: labelToString(canvas?.label, `Page ${index + 1}`),
    width: Number(canvas?.width) || images[0].width || null,
    height: Number(canvas?.height) || images[0].height || null,
    image: images[0],
    alternateImages: images.slice(1),
    canvas,
  };
}

export function parseIIIFManifest(manifest) {
  if (Array.isArray(manifest)) {
    const pages = manifest
      .filter((entry) => typeof entry === 'string' && isLikelyDirectImageUrl(entry))
      .map((url, index) => ({
        index,
        canvasId: `direct-image-${index + 1}`,
        label: `Page ${index + 1}`,
        width: null,
        height: null,
        image: { id: url, bodyId: url, displayUrl: url, service: null, alternateServices: [] },
        alternateImages: [],
        canvas: null,
      }));
    if (pages.length) return { version: null, manifestId: '', label: 'Image list', pages, manifest };
  }

  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new IIIFError('The JSON response is not a IIIF manifest.', { code: 'invalid_manifest' });
  }

  const v2Canvases = asArray(manifest?.sequences?.[0]?.canvases);
  const v3Canvases = asArray(manifest?.items).filter((item) => {
    const type = getType(item).toLowerCase();
    return type === 'canvas' || type.endsWith(':canvas') || Array.isArray(item?.items);
  });
  const version = v2Canvases.length ? 2 : (v3Canvases.length ? 3 : null);
  const canvases = version === 2 ? v2Canvases : v3Canvases;

  if (!version || !canvases.length) {
    throw new IIIFError('Valid JSON was returned, but it does not contain IIIF canvases.', {
      code: 'invalid_manifest',
    });
  }

  const pages = canvases
    .map((canvas, index) => pageFromCanvas(canvas, index, version))
    .filter(Boolean);

  if (!pages.length) {
    throw new IIIFError('The IIIF manifest contains no image-bearing painting annotations.', {
      code: 'no_images',
    });
  }

  return {
    version,
    manifestId: getId(manifest),
    label: labelToString(manifest.label, 'IIIF manuscript'),
    pages,
    manifest,
  };
}

export function isIIIFImageRequestUrl(value) {
  if (typeof value !== 'string') return false;
  try {
    const parsed = new URL(value);
    const parts = parsed.pathname.split('/').filter(Boolean);
    if (parts.length < 5) return false;
    const [region, size, rotation, qualityFormat] = parts.slice(-4);
    return /\.[a-z0-9]+$/i.test(qualityFormat)
      && /^(?:!?-?\d+(?:\.\d+)?)$/.test(rotation)
      && /^(?:full|max|square|pct:[^/]+|!?\d*,\d*|\d+)$/.test(size)
      && /^(?:full|square|pct:[^/]+|\d+,\d+,\d+,\d+)$/.test(region);
  } catch {
    return false;
  }
}

export function isLikelyDirectImageUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return false;
  if (/^(?:data|blob):/i.test(value)) return true;
  if (isIIIFImageRequestUrl(value)) return true;
  try {
    const pathname = new URL(value).pathname;
    return /\.(?:avif|bmp|gif|jpe?g|jp2|png|tiff?|webp)$/i.test(pathname);
  } catch {
    return false;
  }
}

export function extractServiceId(imageUrl) {
  if (!isIIIFImageRequestUrl(imageUrl)) return null;
  const parsed = new URL(imageUrl);
  const parts = parsed.pathname.split('/').filter(Boolean);
  parsed.pathname = `/${parts.slice(0, -4).join('/')}`;
  parsed.hash = '';
  return parsed.toString().replace(/\/$/, '');
}

export async function fetchIIIFManifest(manifestUrl, options = {}) {
  const url = validateHttpUrl(manifestUrl, 'Manifest URL');
  const manifest = await fetchJson(url, options);
  try {
    return parseIIIFManifest(manifest);
  } catch (error) {
    if (error instanceof IIIFError) {
      error.url = error.url || url;
      throw error;
    }
    throw new IIIFError('Could not parse the IIIF manifest.', {
      code: 'invalid_manifest', url, cause: error,
    });
  }
}

export async function loadIIIFSource(sourceUrl, options = {}) {
  const source = String(sourceUrl || '').trim();
  if (!source) throw new IIIFError('No IIIF source was provided.', { code: 'invalid_url' });

  if (isLikelyDirectImageUrl(source)) {
    const serviceId = extractServiceId(source);
    const service = serviceId ? normalizeService({ id: serviceId }) : null;
    return {
      kind: 'image',
      version: null,
      manifestId: '',
      label: 'Direct image',
      manifest: null,
      pages: [{
        index: 0,
        canvasId: source,
        label: 'Image',
        width: null,
        height: null,
        image: { id: source, bodyId: source, displayUrl: source, service, alternateServices: [] },
        alternateImages: [],
        canvas: null,
      }],
    };
  }

  const result = await fetchIIIFManifest(source, options);
  return { ...result, kind: 'manifest' };
}

export async function fetchIIIFImages(manifestUrl, options = {}) {
  const result = await fetchIIIFManifest(manifestUrl, options);
  return result.pages.map((page) => page.image.displayUrl);
}

function normalizeImageInfo(info, service) {
  if (!info || typeof info !== 'object') {
    throw new IIIFError('Image service returned invalid info.json.', {
      code: 'invalid_image_info', url: service?.id,
    });
  }
  const width = Number(info.width);
  const height = Number(info.height);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new IIIFError('Image service info.json is missing valid dimensions.', {
      code: 'invalid_image_info', url: service?.id,
    });
  }

  const profileDetails = Array.isArray(info.profile) && typeof info.profile[1] === 'object'
    ? info.profile[1]
    : {};
  const formats = [
    ...asArray(info.preferredFormats),
    ...asArray(info.extraFormats),
    ...asArray(profileDetails.formats),
    'jpg',
  ].filter((value, index, values) => typeof value === 'string' && values.indexOf(value) === index);

  return {
    id: getId(info) || service?.id,
    width,
    height,
    version: detectImageApiVersion(info) || service?.version || null,
    tileSupported: Array.isArray(info.tiles) && info.tiles.length > 0,
    tiles: Array.isArray(info.tiles) ? info.tiles : [],
    sizes: asArray(info.sizes)
      .map((size) => ({ width: Number(size?.width), height: Number(size?.height) }))
      .filter((size) => Number.isFinite(size.width) && Number.isFinite(size.height) && size.width > 0 && size.height > 0),
    formats,
    qualities: [...asArray(profileDetails.qualities), ...asArray(info.extraQualities), 'default']
      .filter((value, index, values) => typeof value === 'string' && values.indexOf(value) === index),
    rawInfo: info,
  };
}

export async function fetchImageInfo(serviceInput, options = {}) {
  const service = normalizeService(serviceInput);
  if (!service) {
    throw new IIIFError('Image service has no valid identifier.', { code: 'invalid_image_service' });
  }
  const infoUrl = `${service.id}/info.json`;
  const info = await fetchJson(infoUrl, { ...options, maxBytes: options.maxBytes || (2 * 1024 * 1024) });
  return normalizeImageInfo(info, service);
}

function selectAdvertisedSize(sizes, targetWidth) {
  if (!sizes.length) return null;
  const ordered = [...sizes].sort((left, right) => left.width - right.width);
  return ordered.find((size) => size.width >= targetWidth) || ordered[ordered.length - 1];
}

export function buildImageRequestUrl(serviceInput, imageInfo, {
  maxFallbackWidth = DEFAULT_FALLBACK_WIDTH,
} = {}) {
  const service = normalizeService(serviceInput);
  if (!service?.id) return '';
  const version = imageInfo?.version || service.version;
  const format = imageInfo?.formats?.find((candidate) => ['jpg', 'jpeg', 'png', 'webp'].includes(candidate)) || 'jpg';
  const quality = imageInfo?.qualities?.includes('default') === false && imageInfo.qualities[0]
    ? imageInfo.qualities[0]
    : 'default';

  const advertised = selectAdvertisedSize(imageInfo?.sizes || [], maxFallbackWidth);
  let size;
  if (advertised) {
    size = `${advertised.width},${advertised.height}`;
  } else if (imageInfo?.width && imageInfo.width <= maxFallbackWidth) {
    size = version === 3 ? 'max' : 'full';
  } else {
    size = `${maxFallbackWidth},`;
  }
  return `${service.id}/full/${size}/0/${quality}.${format}`;
}

export function buildRegionRequestUrl(serviceInput, imageInfo, region) {
  const service = normalizeService(serviceInput);
  if (!service?.id || !region) return '';
  const values = [region.x, region.y, region.width, region.height].map((value) => Math.round(Number(value)));
  if (values.some((value) => !Number.isFinite(value) || value < 0) || values[2] <= 0 || values[3] <= 0) return '';

  const version = imageInfo?.version || service.version;
  const format = imageInfo?.formats?.find((candidate) => ['jpg', 'jpeg', 'png', 'webp'].includes(candidate)) || 'jpg';
  const quality = imageInfo?.qualities?.includes('default') === false && imageInfo.qualities[0]
    ? imageInfo.qualities[0]
    : 'default';
  const size = version === 3 ? 'max' : 'full';
  return `${service.id}/${values.join(',')}/${size}/0/${quality}.${format}`;
}

export function buildTileSource(serviceInput, imageInfo, options = {}) {
  const service = normalizeService(serviceInput);
  if (imageInfo?.tileSupported) return imageInfo.rawInfo;

  const requestUrl = buildImageRequestUrl(service, imageInfo, options);
  const fallbackUrl = requestUrl || options.directUrl;
  if (!fallbackUrl) {
    throw new IIIFError('Image service provides neither tiles nor a usable image URL.', {
      code: 'unusable_image_service', url: service?.id,
    });
  }
  return { type: 'image', url: fallbackUrl };
}

export async function resolveOpenSeadragonSource(page, options = {}) {
  const image = page?.image;
  if (!image?.displayUrl) {
    throw new IIIFError('This canvas has no usable image.', { code: 'no_canvas_image' });
  }
  if (!image.service?.id) {
    return { tileSource: { type: 'image', url: image.displayUrl }, imageInfo: null, warning: null };
  }

  try {
    const imageInfo = await fetchImageInfo(image.service, options);
    return {
      tileSource: buildTileSource(image.service, imageInfo, {
        directUrl: image.displayUrl,
        maxFallbackWidth: options.maxFallbackWidth,
      }),
      imageInfo,
      warning: null,
    };
  } catch (error) {
    if (!image.bodyId) throw error;
    return {
      tileSource: { type: 'image', url: image.bodyId },
      imageInfo: null,
      warning: `Could not load ${image.service.id}/info.json; using the manifest image directly. ${formatIIIFError(error)}`,
    };
  }
}

export function formatIIIFError(error) {
  if (!(error instanceof Error)) return 'Unknown IIIF error.';
  if (error instanceof IIIFError) {
    const target = error.url ? ` (${error.url})` : '';
    return `${error.message}${target}`;
  }
  return error.message || 'Unknown IIIF error.';
}

export const IIIF_NETWORK_DEFAULTS = Object.freeze({
  timeoutMs: DEFAULT_TIMEOUT_MS,
  retries: DEFAULT_RETRIES,
  retryDelayMs: DEFAULT_RETRY_DELAY_MS,
  maxJsonBytes: DEFAULT_MAX_JSON_BYTES,
  maxFallbackWidth: DEFAULT_FALLBACK_WIDTH,
});
