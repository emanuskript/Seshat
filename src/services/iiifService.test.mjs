import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

import {
  IIIFError,
  buildImageRequestUrl,
  buildRegionRequestUrl,
  buildTileSource,
  detectImageApiVersion,
  extractServiceId,
  fetchIIIFManifest,
  fetchImageInfo,
  isLikelyDirectImageUrl,
  loadIIIFSource,
  parseIIIFManifest,
  resolveOpenSeadragonSource,
} from './iiifService.js'

const fixture = async (name) => JSON.parse(
  await readFile(new URL(`./__fixtures__/${name}`, import.meta.url), 'utf8')
)

const jsonResponse = (value, { status = 200, headers = {}, url = '' } = {}) => {
  const response = new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })
  if (url) Object.defineProperty(response, 'url', { value: url })
  return response
}

test('parses the captured e-codices Presentation v2 canvases in order', async () => {
  const manifest = await fixture('ecodices-v2.json')
  const parsed = parseIIIFManifest(manifest)

  assert.equal(parsed.version, 2)
  assert.equal(parsed.pages.length, 2)
  assert.deepEqual(parsed.pages.map((page) => page.label), ['Front cover', 'Front paste-down'])
  assert.equal(parsed.pages[0].canvasId, 'https://e-codices.ch/metadata/iiif/csg-1394/canvas/csg-1394_e001.json')
  assert.equal(parsed.pages[0].image.service.version, 2)
  assert.match(parsed.pages[0].image.displayUrl, /\/full\/full\/0\/default\.jpg$/)
})

test('parses the captured BSB Presentation v3 canvases without duplicating pages', async () => {
  const manifest = await fixture('bsb-v3.json')
  const parsed = parseIIIFManifest(manifest)

  assert.equal(parsed.version, 3)
  assert.equal(parsed.pages.length, 2)
  assert.deepEqual(parsed.pages.map((page) => page.label), ['Vorderdeckel (0001)', 'Vorderer Spiegel (0002)'])
  assert.deepEqual(parsed.pages.map((page) => page.canvasId), [
    'https://api.digitale-sammlungen.de/iiif/presentation/v3/bsb00075075/canvas/1',
    'https://api.digitale-sammlungen.de/iiif/presentation/v3/bsb00075075/canvas/2',
  ])
  assert.equal(parsed.pages[0].image.service.version, 3)
  assert.equal(parsed.pages[1].alternateImages.length, 1)
  assert.doesNotMatch(parsed.pages[0].image.id, /ocr/)
})

test('handles missing labels, @id/id variants, service arrays, choices, and direct images', () => {
  const parsed = parseIIIFManifest({
    id: 'https://example.org/manifest',
    type: 'Manifest',
    items: [
      {
        '@id': 'https://example.org/canvas/1',
        '@type': 'Canvas',
        items: [{
          items: [{
            motivation: ['painting'],
            body: {
              type: 'Choice',
              items: [
                { id: 'https://example.org/page.jpg', type: 'Image', format: 'image/jpeg' },
                {
                  '@id': 'https://example.org/fallback.png',
                  '@type': 'dctypes:Image',
                  service: [{ '@id': 'https://example.org/iiif/page', '@type': 'ImageService2' }],
                },
              ],
            },
          }],
        }],
      },
    ],
  })

  assert.equal(parsed.pages.length, 1)
  assert.equal(parsed.pages[0].label, 'Page 1')
  assert.equal(parsed.pages[0].image.bodyId, 'https://example.org/page.jpg')
  assert.equal(parsed.pages[0].alternateImages[0].service.version, 2)
})

test('rejects JSON without canvases and canvases without painting images', () => {
  assert.throws(() => parseIIIFManifest({ type: 'Collection', items: [] }), (error) => {
    assert.equal(error.code, 'invalid_manifest')
    return true
  })
  assert.throws(() => parseIIIFManifest({
    type: 'Manifest',
    items: [{ type: 'Canvas', items: [{ items: [{ motivation: 'commenting', body: { id: 'https://example.org/a.jpg', type: 'Image' } }] }] }],
  }), (error) => {
    assert.equal(error.code, 'no_images')
    return true
  })
})

test('detects Image API versions and direct IIIF image requests', () => {
  assert.equal(detectImageApiVersion({ type: 'ImageService3' }), 3)
  assert.equal(detectImageApiVersion({ '@context': 'http://iiif.io/api/image/2/context.json' }), 2)
  assert.equal(isLikelyDirectImageUrl('https://example.org/image.jpg'), true)
  const request = 'https://example.org/iiif/book/page/full/max/0/default.jpg'
  assert.equal(isLikelyDirectImageUrl(request), true)
  assert.equal(extractServiceId(request), 'https://example.org/iiif/book/page')
  assert.equal(isLikelyDirectImageUrl('https://example.org/manifest.json'), false)
})

test('generates v3 and v2 request syntax without assuming full/full', async () => {
  const info = await fixture('bsb-image-info-v3.json')
  const normalizedInfo = await fetchImageInfo(
    { id: info.id, type: 'ImageService3' },
    { fetchImpl: async () => jsonResponse(info), retries: 0 }
  )
  const v3Url = buildImageRequestUrl({ id: info.id, type: 'ImageService3' }, normalizedInfo)
  assert.equal(v3Url, `${info.id}/full/2489,3505/0/default.jpg`)
  assert.doesNotMatch(v3Url, /\/full\/full\//)

  const v2Url = buildImageRequestUrl(
    { '@id': 'https://example.org/iiif/v2/page', '@type': 'ImageService2' },
    { version: 2, width: 1200, height: 1800, sizes: [], formats: ['jpg'], qualities: ['default'] }
  )
  assert.equal(v2Url, 'https://example.org/iiif/v2/page/full/full/0/default.jpg')
})

test('generates Image API v2/v3 region sizes correctly', () => {
  const region = { x: 10, y: 20, width: 300, height: 400 }
  assert.equal(
    buildRegionRequestUrl({ id: 'https://example.org/v3', type: 'ImageService3' }, null, region),
    'https://example.org/v3/10,20,300,400/max/0/default.jpg'
  )
  assert.equal(
    buildRegionRequestUrl({ '@id': 'https://example.org/v2', '@type': 'ImageService2' }, null, region),
    'https://example.org/v2/10,20,300,400/full/0/default.jpg'
  )
})

test('uses native IIIF tile metadata for tiled services and derivatives otherwise', async () => {
  const tiledRaw = {
    '@context': 'http://iiif.io/api/image/3/context.json',
    id: 'https://example.org/tiled',
    type: 'ImageService3',
    width: 4000,
    height: 6000,
    tiles: [{ width: 256, scaleFactors: [1, 2, 4, 8] }],
  }
  const tiledInfo = await fetchImageInfo(tiledRaw, {
    fetchImpl: async () => jsonResponse(tiledRaw), retries: 0,
  })
  assert.deepEqual(buildTileSource(tiledRaw, tiledInfo), tiledRaw)

  const bsbInfoRaw = await fixture('bsb-image-info-v3.json')
  const bsbInfo = await fetchImageInfo(bsbInfoRaw, {
    fetchImpl: async () => jsonResponse(bsbInfoRaw), retries: 0,
  })
  assert.deepEqual(buildTileSource(bsbInfoRaw, bsbInfo), {
    type: 'image',
    url: `${bsbInfoRaw.id}/full/2489,3505/0/default.jpg`,
  })
})

test('OpenSeadragon resolution supports page switching and an unavailable info.json fallback', async () => {
  const parsed = parseIIIFManifest(await fixture('bsb-v3.json'))
  const info = await fixture('bsb-image-info-v3.json')
  const first = await resolveOpenSeadragonSource(parsed.pages[0], {
    fetchImpl: async () => jsonResponse(info), retries: 0,
  })
  assert.match(first.tileSource.url, /bsb00075075_00001\/full\/2489,3505/)

  const secondInfo = { ...info, id: 'https://api.digitale-sammlungen.de/iiif/image/v3/bsb00075075_00002' }
  const second = await resolveOpenSeadragonSource(parsed.pages[1], {
    fetchImpl: async () => jsonResponse(secondInfo), retries: 0,
  })
  assert.match(second.tileSource.url, /bsb00075075_00002\/full\/2489,3505/)

  const fallback = await resolveOpenSeadragonSource(parsed.pages[0], {
    fetchImpl: async () => new Response('', { status: 404 }), retries: 0,
  })
  assert.equal(fallback.tileSource.url, parsed.pages[0].image.bodyId)
  assert.match(fallback.warning, /info\.json/)
})

test('retries transient HTTP responses with exponential-backoff support', async () => {
  const manifest = await fixture('bsb-v3.json')
  let calls = 0
  const result = await fetchIIIFManifest('https://example.org/manifest', {
    fetchImpl: async () => {
      calls += 1
      return calls < 3
        ? new Response('', { status: 503 })
        : jsonResponse(manifest)
    },
    retries: 2,
    retryDelayMs: 0,
  })
  assert.equal(calls, 3)
  assert.equal(result.pages.length, 2)
})

test('does not retry permanent HTTP errors or silently reinterpret a manifest as an image', async () => {
  let calls = 0
  await assert.rejects(
    loadIIIFSource('https://example.org/manifest.json', {
      fetchImpl: async () => {
        calls += 1
        return new Response('', { status: 404 })
      },
      retries: 2,
      retryDelayMs: 0,
    }),
    (error) => error instanceof IIIFError && error.code === 'http_error' && error.status === 404
  )
  assert.equal(calls, 1)
})

test('reports invalid JSON and valid non-manifest JSON distinctly', async () => {
  await assert.rejects(
    fetchIIIFManifest('https://example.org/bad-json', {
      fetchImpl: async () => new Response('{not json', { status: 200 }), retries: 0,
    }),
    (error) => error.code === 'invalid_json'
  )
  await assert.rejects(
    fetchIIIFManifest('https://example.org/not-manifest', {
      fetchImpl: async () => jsonResponse({ type: 'Collection', items: [] }), retries: 0,
    }),
    (error) => error.code === 'invalid_manifest'
  )
})

test('reports browser-style network or CORS failures after limited retries', async () => {
  let calls = 0
  await assert.rejects(
    fetchIIIFManifest('https://blocked.example.org/manifest', {
      fetchImpl: async () => {
        calls += 1
        throw new TypeError('Failed to fetch')
      },
      retries: 1,
      retryDelayMs: 0,
    }),
    (error) => error.code === 'network_or_cors'
  )
  assert.equal(calls, 2)
})

test('aborts slow requests with an explicit timeout', async () => {
  const neverCompletes = (_url, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
  })
  await assert.rejects(
    fetchIIIFManifest('https://slow.example.org/manifest', {
      fetchImpl: neverCompletes,
      timeoutMs: 5,
      retries: 0,
    }),
    (error) => error.code === 'timeout'
  )
})

test('preserves previously supported direct-image inputs without fetching them as manifests', async () => {
  let fetched = false
  const result = await loadIIIFSource('https://images.example.org/page-1.png', {
    fetchImpl: async () => {
      fetched = true
      throw new Error('should not be called')
    },
  })
  assert.equal(fetched, false)
  assert.equal(result.kind, 'image')
  assert.equal(result.pages[0].image.displayUrl, 'https://images.example.org/page-1.png')
})
