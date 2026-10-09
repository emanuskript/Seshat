import {
  buildImageRequestUrl,
  loadIIIFSource,
  resolveOpenSeadragonSource,
} from './iiifService.js'

const manifests = [
  ['e-codices v2', 'https://www.e-codices.unifr.ch/metadata/iiif/csg-1394/manifest.json'],
  ['BSB v3', 'https://api.digitale-sammlungen.de/iiif/presentation/v3/bsb00075075/manifest'],
]

for (const [label, manifestUrl] of manifests) {
  const parsed = await loadIIIFSource(manifestUrl)
  const resolved = await resolveOpenSeadragonSource(parsed.pages[0], { maxFallbackWidth: 1200 })
  const imageUrl = resolved.tileSource?.url || buildImageRequestUrl(
    parsed.pages[0].image.service,
    resolved.imageInfo,
    { maxFallbackWidth: 1200 }
  )
  if (!imageUrl) throw new Error(`${label}: no testable first-page image URL was resolved`)

  const response = await fetch(imageUrl, { signal: AbortSignal.timeout(30000) })
  if (!response.ok) throw new Error(`${label}: first-page image returned HTTP ${response.status}`)
  const contentType = response.headers.get('content-type') || ''
  if (!contentType.toLowerCase().startsWith('image/')) {
    throw new Error(`${label}: first-page response was ${contentType || 'an unknown type'}`)
  }
  const bytes = (await response.arrayBuffer()).byteLength
  if (!bytes) throw new Error(`${label}: first-page image was empty`)

  console.log(`${label}: ${parsed.pages.length} pages; first image ${response.status} ${contentType} ${bytes} bytes`)
}
