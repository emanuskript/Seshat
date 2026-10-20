// ============================================================
// ANNOTATION EXPORT SERVICE
// Handles export/import for JSON, TEI XML, Plain Text, W3C Web Annotation
// ============================================================

export const SCHEMA_VERSION = '1.1.0'
export const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB

// ============================================================
// SHARED UTILITIES
// ============================================================

/**
 * Generate safe filename from document name
 */
export function generateFilename(documentName, extension) {
  const safeName = (documentName || 'annotations')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .substring(0, 50)
  const date = new Date().toISOString().slice(0, 10)
  return `${safeName}_${date}.${extension}`
}

/**
 * Trigger file download
 */
export function downloadFile(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType })
  const link = document.createElement('a')
  const url = URL.createObjectURL(blob)
  link.href = url
  link.download = filename
  link.style.display = 'none'
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/**
 * Ensure annotations object has all required keys
 */
function normalizeAnnotations(annotations) {
  const result = {
    highlights: [],
    underlines: [],
    comments: [],
    traces: [],
    angles: [],
    distances: [],
    boxMeasurements: [],
    horizontalBands: [],
    verticalBands: []
  }

  // Copy over existing annotations
  Object.keys(result).forEach(type => {
    if (annotations && annotations[type]) {
      result[type] = annotations[type]
    }
  })

  // Collaboration websocket messages historically used "measures" for angle
  // annotations. Treat it as an alias so older session snapshots still export.
  if (annotations?.measures) {
    result.angles = [
      ...result.angles,
      ...annotations.measures.filter(measure =>
        !measure?.id || !result.angles.some(angle => angle?.id === measure.id)
      )
    ]
  }

  return result
}

// ============================================================
// JSON EXPORT/IMPORT
// ============================================================

/**
 * Build JSON export data structure
 */
export function buildJsonExport(annotations, metadata, settings) {
  return {
    version: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    metadata,
    annotations: normalizeAnnotations(annotations),
    settings
  }
}

/**
 * Validate JSON import data
 */
export function validateJsonImport(data) {
  const errors = []
  const warnings = []

  if (!data.version) errors.push('Missing version field')
  if (!data.annotations) errors.push('Missing annotations field')

  // Version compatibility check
  if (data.version) {
    const [major] = data.version.split('.').map(Number)
    if (major > 1) errors.push(`Incompatible version: ${data.version}. Please update Seshat.`)
  }

  return { valid: errors.length === 0, errors, warnings }
}

/**
 * Export as JSON
 */
export function exportAsJson(annotations, metadata, settings, documentName) {
  const data = buildJsonExport(annotations, metadata, settings)
  const json = JSON.stringify(data, null, 2)
  const filename = generateFilename(documentName, 'json')
  downloadFile(json, filename, 'application/json')
}

function csvCell(value) {
  const text = String(value ?? '')
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function buildBoxMeasurementsCsv(annotations) {
  const boxes = normalizeAnnotations(annotations).boxMeasurements
  const headers = [
    'id', 'class', 'name', 'page', 'page_index', 'x', 'y', 'x2', 'y2', 'width', 'height',
    'aspect_ratio_w_h', 'ink_density_percent', 'dark_pixels', 'sampled_pixels',
    'threshold_method', 'threshold', 'algorithm_version', 'image_width', 'image_height', 'created_at'
  ]
  const rows = boxes.map(box => {
    const x = Number(box.x) || 0
    const y = Number(box.y) || 0
    const width = Number(box.width) || 0
    const height = Number(box.height) || 0
    return [
      box.id,
      box.label || 'Unlabeled',
      box.name || '',
      (Number(box.pageIndex) || 0) + 1,
      Number(box.pageIndex) || 0,
      formatNum(x),
      formatNum(y),
      formatNum(x + width),
      formatNum(y + height),
      formatNum(width),
      formatNum(height),
      formatNum(box.aspectRatio, 6),
      formatNum((Number(box.inkDensity) || 0) * 100, 4),
      Number(box.darkPixelCount) || 0,
      Number(box.sampledPixelCount) || 0,
      box.thresholdMethod || 'otsu',
      Number(box.threshold) || 0,
      box.algorithmVersion || '',
      Number(box.imageWidth) || 0,
      Number(box.imageHeight) || 0,
      box.createdAt || '',
    ].map(csvCell).join(',')
  })
  return [headers.join(','), ...rows].join('\n')
}

export function exportBoxMeasurementsAsCsv(annotations, documentName) {
  const csv = buildBoxMeasurementsCsv(annotations)
  downloadFile(csv, generateFilename(`${documentName || 'annotations'}_crop_count`, 'csv'), 'text/csv;charset=utf-8')
}

/**
 * Read and parse JSON file for import
 */
export async function readJsonFile(file) {
  if (file.size > MAX_FILE_SIZE) {
    throw new Error('File too large (max 10MB)')
  }
  const text = await file.text()
  return JSON.parse(text)
}

// ============================================================
// TEI XML EXPORT
// ============================================================

/**
 * Escape XML special characters
 */
function escapeXml(str) {
  if (!str) return ''
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/**
 * Convert color hex to readable name
 */
function colorToName(color) {
  const colors = {
    '#ffeb3b': 'yellow',
    '#4caf50': 'green',
    '#2196f3': 'blue',
    '#f44336': 'red',
    '#9c27b0': 'purple',
    '#ff9800': 'orange'
  }
  return colors[color?.toLowerCase()] || color || 'default'
}

/**
 * Format number safely
 */
function formatNum(val, decimals = 2) {
  const num = Number(val)
  if (!Number.isFinite(num)) return '0'
  return num.toFixed(decimals)
}

function distanceLengthPx(distance) {
  const points = distance?.points || []
  if (!Array.isArray(points) || points.length < 2) return Number(distance?.lengthPx) || 0
  const x1 = Number(points[0]?.x)
  const y1 = Number(points[0]?.y)
  const x2 = Number(points[1]?.x)
  const y2 = Number(points[1]?.y)
  if (![x1, y1, x2, y2].every(Number.isFinite)) return Number(distance?.lengthPx) || 0
  return Math.hypot(x2 - x1, y2 - y1)
}

/**
 * Build TEI XML export
 */
export function buildTeiExport(annotations, metadata) {
  const normalized = normalizeAnnotations(annotations)
  const date = new Date().toISOString().slice(0, 10)

  let xml = `<?xml version="1.0" encoding="UTF-8"?>
<TEI xmlns="http://www.tei-c.org/ns/1.0">
  <teiHeader>
    <fileDesc>
      <titleStmt>
        <title>Annotations: ${escapeXml(metadata.documentName || 'Untitled')}</title>
      </titleStmt>
      <publicationStmt>
        <p>Exported from Seshat</p>
        <date>${date}</date>
      </publicationStmt>
      <sourceDesc>
        <bibl>
          <ref target="${escapeXml(metadata.iiifManifest || '')}">IIIF Manifest</ref>
        </bibl>
      </sourceDesc>
    </fileDesc>
  </teiHeader>
  <text>
    <body>
`

  // Group annotations by page
  const pageGroups = {}
  const annotationTypes = ['comments', 'highlights', 'underlines', 'traces', 'angles', 'distances', 'boxMeasurements', 'horizontalBands', 'verticalBands']

  annotationTypes.forEach(type => {
    (normalized[type] || []).forEach(ann => {
      const page = ann.pageIndex ?? 0
      if (!pageGroups[page]) pageGroups[page] = {}
      if (!pageGroups[page][type]) pageGroups[page][type] = []
      pageGroups[page][type].push(ann)
    })
  })

  // Generate XML for each page
  const pages = Object.keys(pageGroups).map(Number).sort((a, b) => a - b)

  if (pages.length === 0) {
    xml += `      <div type="page" n="1">
        <head>Page 1</head>
        <p>(No annotations)</p>
      </div>
`
  } else {
    pages.forEach(pageNum => {
      const pageData = pageGroups[pageNum]
      xml += `      <div type="page" n="${pageNum + 1}">
        <head>Page ${pageNum + 1}</head>
`

      // Comments
      if (pageData.comments?.length) {
        pageData.comments.forEach(comment => {
          const place = comment.side === 'left' ? 'left' : 'right'
          xml += `        <note type="comment" place="${place}">
          <p>${escapeXml(comment.text || '')}</p>
        </note>
`
        })
      }

      // Highlights
      if (pageData.highlights?.length) {
        pageData.highlights.forEach(h => {
          xml += `        <span type="highlight" style="background-color: ${colorToName(h.color)}">
          <note type="coordinates">x:${formatNum(h.x)} y:${formatNum(h.y)} w:${formatNum(h.width)} h:${formatNum(h.height)}</note>
        </span>
`
        })
      }

      // Underlines
      if (pageData.underlines?.length) {
        pageData.underlines.forEach(u => {
          xml += `        <span type="underline" style="color: ${colorToName(u.color)}">
          <note type="coordinates">x:${formatNum(u.x)} y:${formatNum(u.y)} w:${formatNum(u.width)} h:${formatNum(u.height)}</note>
        </span>
`
        })
      }

      // Traces
      if (pageData.traces?.length) {
        pageData.traces.forEach(trace => {
          const pathData = trace.points?.map((p, i) =>
            `${i === 0 ? 'M' : 'L'}${formatNum(p.x)},${formatNum(p.y)}`
          ).join(' ') || ''
          xml += `        <figure type="trace">
          <figDesc>Pen trace with calligraphic nib</figDesc>
          <note type="penSettings">width:${trace.penWidth || 5} height:${trace.penHeight || 1} angle:${trace.nibAngle || 45}</note>
          <note type="path">${pathData}</note>
        </figure>
`
        })
      }

      // Angles
      if (pageData.angles?.length) {
        pageData.angles.forEach(angle => {
          const points = angle.points || []
          const coordStr = points.map((p, i) => `p${i + 1}:${formatNum(p.x)},${formatNum(p.y)}`).join(' ')
          xml += `        <measure type="angle" quantity="${formatNum(angle.angle, 1)}" unit="degrees">
          <label>${escapeXml(angle.label || 'Angle')}</label>
          <note type="coordinates">${coordStr}</note>
        </measure>
`
        })
      }

      // Distances
      if (pageData.distances?.length) {
        pageData.distances.forEach(distance => {
          const points = distance.points || []
          const coordStr = points.slice(0, 2).map((p, i) => `p${i + 1}:${formatNum(p.x)},${formatNum(p.y)}`).join(' ')
          xml += `        <measure type="distance" quantity="${formatNum(distanceLengthPx(distance), 2)}" unit="px">
          <label>${escapeXml(distance.label || 'Distance')}</label>
          <note type="coordinates">${coordStr}</note>
        </measure>
`
        })
      }

      // Crop & Count box measurements
      if (pageData.boxMeasurements?.length) {
        pageData.boxMeasurements.forEach(box => {
          const lrx = (Number(box.x) || 0) + (Number(box.width) || 0)
          const lry = (Number(box.y) || 0) + (Number(box.height) || 0)
          xml += `        <zone type="crop-count" ulx="${formatNum(box.x)}" uly="${formatNum(box.y)}" lrx="${formatNum(lrx)}" lry="${formatNum(lry)}">
          <label>${escapeXml(box.label || 'Unlabeled')}</label>
          <measure type="aspect-ratio" quantity="${formatNum(box.aspectRatio, 6)}" unit="w/h"/>
          <measure type="ink-density" quantity="${formatNum((Number(box.inkDensity) || 0) * 100, 4)}" unit="percent"/>
          <note type="ink-threshold" subtype="${escapeXml(box.thresholdMethod || 'otsu')}">${formatNum(box.threshold, 0)}</note>
        </zone>
`
        })
      }

      // Horizontal bands
      if (pageData.horizontalBands?.length) {
        pageData.horizontalBands.forEach(band => {
          const lrx = (band.x || 0) + (band.width || 0)
          const lry = (band.y || 0) + (band.height || 0)
          xml += `        <zone type="horizontal-band" ulx="${formatNum(band.x)}" uly="${formatNum(band.y)}" lrx="${formatNum(lrx)}" lry="${formatNum(lry)}">
          <label>${escapeXml(band.label || '')}</label>
        </zone>
`
        })
      }

      // Vertical bands
      if (pageData.verticalBands?.length) {
        pageData.verticalBands.forEach(band => {
          const lrx = (band.x || 0) + (band.width || 0)
          const lry = (band.y || 0) + (band.height || 0)
          xml += `        <zone type="vertical-band" ulx="${formatNum(band.x)}" uly="${formatNum(band.y)}" lrx="${formatNum(lrx)}" lry="${formatNum(lry)}">
          <label>${escapeXml(band.label || '')}</label>
        </zone>
`
        })
      }

      xml += `      </div>
`
    })
  }

  xml += `    </body>
  </text>
</TEI>`

  return xml
}

/**
 * Export as TEI XML
 */
export function exportAsTei(annotations, metadata, documentName) {
  const xml = buildTeiExport(annotations, metadata)
  const filename = generateFilename(documentName, 'xml')
  downloadFile(xml, filename, 'application/xml')
}

// ============================================================
// PLAIN TEXT EXPORT
// ============================================================

/**
 * Build plain text export
 */
export function buildPlainTextExport(annotations, metadata) {
  const normalized = normalizeAnnotations(annotations)
  const date = new Date().toISOString().replace('T', ' ').slice(0, 19)

  let text = `Seshat Annotations Export
Document: ${metadata.documentName || 'Untitled'}
Exported: ${date}
Source: ${metadata.iiifManifest || 'N/A'}
Total Pages: ${metadata.totalPages || 'Unknown'}

`

  // Group annotations by page
  const pageGroups = {}
  const annotationTypes = ['comments', 'highlights', 'underlines', 'traces', 'angles', 'distances', 'boxMeasurements', 'horizontalBands', 'verticalBands']

  annotationTypes.forEach(type => {
    (normalized[type] || []).forEach(ann => {
      const page = ann.pageIndex ?? 0
      if (!pageGroups[page]) pageGroups[page] = {}
      if (!pageGroups[page][type]) pageGroups[page][type] = []
      pageGroups[page][type].push(ann)
    })
  })

  // Count totals
  const totals = {
    comments: 0,
    highlights: 0,
    underlines: 0,
    traces: 0,
    angles: 0,
    distances: 0,
    boxMeasurements: 0,
    bands: 0
  }

  // Generate text for each page
  const pages = Object.keys(pageGroups).map(Number).sort((a, b) => a - b)

  if (pages.length === 0) {
    text += `${'='.repeat(80)}
NO ANNOTATIONS
${'='.repeat(80)}

This document has no annotations.
`
  } else {
    pages.forEach(pageNum => {
      const pageData = pageGroups[pageNum]
      text += `${'='.repeat(80)}
PAGE ${pageNum + 1}
${'='.repeat(80)}

`

      // Comments
      if (pageData.comments?.length) {
        text += `COMMENTS
--------
`
        pageData.comments.forEach(comment => {
          const side = comment.side === 'left' ? 'Left margin' : 'Right margin'
          text += `[${side}] ${comment.text || '(empty)'}\n`
          totals.comments++
        })
        text += '\n'
      }

      // Highlights
      if (pageData.highlights?.length) {
        text += `HIGHLIGHTS
----------
`
        pageData.highlights.forEach(h => {
          text += `- ${colorToName(h.color)} highlight at (${Math.round(h.x || 0)}, ${Math.round(h.y || 0)}) - ${Math.round(h.width || 0)}x${Math.round(h.height || 0)}px\n`
          totals.highlights++
        })
        text += '\n'
      }

      // Underlines
      if (pageData.underlines?.length) {
        text += `UNDERLINES
----------
`
        pageData.underlines.forEach(u => {
          text += `- ${colorToName(u.color)} underline at (${Math.round(u.x || 0)}, ${Math.round(u.y || 0)}) - ${Math.round(u.width || 0)}x${Math.round(u.height || 0)}px\n`
          totals.underlines++
        })
        text += '\n'
      }

      // Traces
      if (pageData.traces?.length) {
        text += `TRACES
------
`
        pageData.traces.forEach((trace, i) => {
          const pointCount = trace.points?.length || 0
          text += `- Trace #${i + 1}: ${pointCount} points, pen ${trace.penWidth || 5}x${trace.penHeight || 1}, nib angle ${trace.nibAngle || 45}\u00B0\n`
          totals.traces++
        })
        text += '\n'
      }

      // Angles
      if (pageData.angles?.length) {
        text += `ANGLE MEASUREMENTS
------------------
`
        pageData.angles.forEach(angle => {
          text += `- ${angle.label || 'Angle'}: ${formatNum(angle.angle, 1)}\u00B0\n`
          totals.angles++
        })
        text += '\n'
      }

      // Distances
      if (pageData.distances?.length) {
        text += `DISTANCE MEASUREMENTS
---------------------
`
        pageData.distances.forEach(distance => {
          text += `- ${distance.label || 'Distance'}: ${formatNum(distanceLengthPx(distance), 2)} px\n`
          totals.distances++
        })
        text += '\n'
      }

      if (pageData.boxMeasurements?.length) {
        text += `CROP & COUNT MEASUREMENTS
-------------------------
`
        pageData.boxMeasurements.forEach(box => {
          text += `- ${box.label || 'Unlabeled'} at (${formatNum(box.x)}, ${formatNum(box.y)}) ${formatNum(box.width)}x${formatNum(box.height)} px: W/H ${formatNum(box.aspectRatio, 4)}, ink ${formatNum((Number(box.inkDensity) || 0) * 100, 2)}%\n`
          totals.boxMeasurements++
        })
        text += '\n'
      }

      // Bands
      const hasBands = pageData.horizontalBands?.length || pageData.verticalBands?.length
      if (hasBands) {
        text += `BANDS
-----
`
        if (pageData.horizontalBands?.length) {
          pageData.horizontalBands.forEach(band => {
            const y1 = Math.round(band.y || 0)
            const y2 = Math.round((band.y || 0) + (band.height || 0))
            text += `- Horizontal: "${band.label || 'unlabeled'}" at y=${y1}-${y2}\n`
            totals.bands++
          })
        }
        if (pageData.verticalBands?.length) {
          pageData.verticalBands.forEach(band => {
            const x1 = Math.round(band.x || 0)
            const x2 = Math.round((band.x || 0) + (band.width || 0))
            text += `- Vertical: "${band.label || 'unlabeled'}" at x=${x1}-${x2}\n`
            totals.bands++
          })
        }
        text += '\n'
      }
    })
  }

  // Summary
  const totalCount = Object.values(totals).reduce((a, b) => a + b, 0)
  text += `${'='.repeat(80)}
SUMMARY
${'='.repeat(80)}
Total Annotations: ${totalCount}
- Comments: ${totals.comments}
- Highlights: ${totals.highlights}
- Underlines: ${totals.underlines}
- Traces: ${totals.traces}
- Angles: ${totals.angles}
- Distances: ${totals.distances}
- Crop & Count Boxes: ${totals.boxMeasurements}
- Bands: ${totals.bands}
`

  return text
}

/**
 * Export as plain text
 */
export function exportAsPlainText(annotations, metadata, documentName) {
  const text = buildPlainTextExport(annotations, metadata)
  const filename = generateFilename(documentName, 'txt')
  downloadFile(text, filename, 'text/plain')
}

// ============================================================
// W3C WEB ANNOTATION EXPORT
// ============================================================

/**
 * Generate unique annotation ID
 */
function generateAnnotationId(index) {
  return `urn:quillapp:annotation:${Date.now()}-${index}`
}

/**
 * Get canvas URL for a page from IIIF manifest URL
 */
function getCanvasUrl(manifestUrl, pageIndex) {
  // Generate a canvas-like URL from the manifest
  // In real IIIF, this would come from the manifest's canvases array
  const baseUrl = manifestUrl?.replace('/manifest.json', '').replace('/manifest', '') || 'https://example.org/iiif'
  return `${baseUrl}/canvas/p${pageIndex + 1}`
}

/**
 * Build W3C Web Annotation export
 */
export function buildWebAnnotationExport(annotations, metadata) {
  const normalized = normalizeAnnotations(annotations)
  const created = new Date().toISOString()
  const items = []
  let index = 0

  // Helper to create base annotation
  const createAnnotation = (motivation, body, target) => ({
    id: generateAnnotationId(index++),
    type: 'Annotation',
    motivation,
    created,
    ...(body && { body }),
    target
  });

  // Comments -> commenting motivation
  normalized.comments.forEach(comment => {
    const canvasUrl = getCanvasUrl(metadata.iiifManifest, comment.pageIndex ?? 0)
    items.push(createAnnotation(
      'commenting',
      {
        type: 'TextualBody',
        value: comment.text || '',
        format: 'text/plain'
      },
      {
        type: 'SpecificResource',
        source: canvasUrl,
        selector: {
          type: 'PointSelector',
          x: comment.x || 0,
          y: comment.y || 0
        }
      }
    ));
  });

  // Highlights -> highlighting motivation
  normalized.highlights.forEach(h => {
    const canvasUrl = getCanvasUrl(metadata.iiifManifest, h.pageIndex ?? 0)
    const ann = createAnnotation(
      'highlighting',
      null,
      {
        type: 'SpecificResource',
        source: canvasUrl,
        selector: {
          type: 'FragmentSelector',
          conformsTo: 'http://www.w3.org/TR/media-frags/',
          value: `xywh=${Math.round(h.x || 0)},${Math.round(h.y || 0)},${Math.round(h.width || 0)},${Math.round(h.height || 0)}`
        }
      }
    )
    if (h.color) {
      ann.stylesheet = {
        type: 'CssStylesheet',
        value: `background-color: ${h.color};`
      }
    }
    items.push(ann);
  });

  // Underlines -> highlighting motivation with underline style
  normalized.underlines.forEach(u => {
    const canvasUrl = getCanvasUrl(metadata.iiifManifest, u.pageIndex ?? 0)
    const ann = createAnnotation(
      'highlighting',
      null,
      {
        type: 'SpecificResource',
        source: canvasUrl,
        selector: {
          type: 'FragmentSelector',
          conformsTo: 'http://www.w3.org/TR/media-frags/',
          value: `xywh=${Math.round(u.x || 0)},${Math.round(u.y || 0)},${Math.round(u.width || 0)},${Math.round(u.height || 0)}`
        }
      }
    )
    ann.stylesheet = {
      type: 'CssStylesheet',
      value: `border-bottom: 2px solid ${u.color || '#000'};`
    }
    items.push(ann);
  });

  // Traces -> describing motivation with SVG path
  normalized.traces.forEach(trace => {
    const canvasUrl = getCanvasUrl(metadata.iiifManifest, trace.pageIndex ?? 0)
    const pathData = trace.points?.map((p, i) =>
      `${i === 0 ? 'M' : 'L'}${formatNum(p.x)},${formatNum(p.y)}`
    ).join(' ') || ''

    items.push(createAnnotation(
      'describing',
      {
        type: 'TextualBody',
        value: `Calligraphic trace (pen: ${trace.penWidth || 5}x${trace.penHeight || 1}, angle: ${trace.nibAngle || 45}\u00B0)`,
        format: 'text/plain'
      },
      {
        type: 'SpecificResource',
        source: canvasUrl,
        selector: {
          type: 'SvgSelector',
          value: `<svg xmlns="http://www.w3.org/2000/svg"><path d="${pathData}" fill="none" stroke="${trace.color || '#000'}" stroke-width="2"/></svg>`
        }
      }
    ));
  });

  // Angles -> describing motivation
  normalized.angles.forEach(angle => {
    const canvasUrl = getCanvasUrl(metadata.iiifManifest, angle.pageIndex ?? 0)
    const points = angle.points || []
    const pathData = points.map((p, i) =>
      `${i === 0 ? 'M' : 'L'}${formatNum(p.x)},${formatNum(p.y)}`
    ).join(' ')

    items.push(createAnnotation(
      'describing',
      {
        type: 'TextualBody',
        value: `${angle.label || 'Angle'}: ${formatNum(angle.angle, 1)}\u00B0`,
        format: 'text/plain'
      },
      {
        type: 'SpecificResource',
        source: canvasUrl,
        selector: {
          type: 'SvgSelector',
          value: `<svg xmlns="http://www.w3.org/2000/svg"><path d="${pathData}" fill="none" stroke="#000" stroke-width="1"/></svg>`
        }
      }
    ))
  })

  // Distances -> describing motivation
  normalized.distances.forEach(distance => {
    const canvasUrl = getCanvasUrl(metadata.iiifManifest, distance.pageIndex ?? 0)
    const points = (distance.points || []).slice(0, 2)
    const pathData = points.map((p, i) =>
      `${i === 0 ? 'M' : 'L'}${formatNum(p.x)},${formatNum(p.y)}`
    ).join(' ')

    items.push(createAnnotation(
      'describing',
      {
        type: 'TextualBody',
        value: `${distance.label || 'Distance'}: ${formatNum(distanceLengthPx(distance), 2)} px`,
        format: 'text/plain'
      },
      {
        type: 'SpecificResource',
        source: canvasUrl,
        selector: {
          type: 'SvgSelector',
          value: `<svg xmlns="http://www.w3.org/2000/svg"><path d="${pathData}" fill="none" stroke="#7c3aed" stroke-width="1"/></svg>`
        }
      }
    ))
  })

  // Crop & Count boxes -> classifying and describing a rectangular region
  normalized.boxMeasurements.forEach(box => {
    const canvasUrl = getCanvasUrl(metadata.iiifManifest, box.pageIndex ?? 0)
    items.push(createAnnotation(
      ['classifying', 'describing'],
      [
        {
          type: 'TextualBody',
          purpose: 'classifying',
          value: box.label || 'Unlabeled',
          format: 'text/plain'
        },
        {
          type: 'TextualBody',
          purpose: 'describing',
          value: `W/H ${formatNum(box.aspectRatio, 6)}; ink density ${formatNum((Number(box.inkDensity) || 0) * 100, 4)}%; threshold ${formatNum(box.threshold, 0)} (${box.thresholdMethod || 'otsu'})`,
          format: 'text/plain'
        }
      ],
      {
        type: 'SpecificResource',
        source: canvasUrl,
        selector: {
          type: 'FragmentSelector',
          conformsTo: 'http://www.w3.org/TR/media-frags/',
          value: `xywh=${Math.round(box.x || 0)},${Math.round(box.y || 0)},${Math.round(box.width || 0)},${Math.round(box.height || 0)}`
        }
      }
    ))
  })

  // Bands -> classifying motivation
  const processBands = (bands, orientation) => {
    (bands || []).forEach(band => {
      const canvasUrl = getCanvasUrl(metadata.iiifManifest, band.pageIndex ?? 0)
      items.push(createAnnotation(
        'classifying',
        {
          type: 'TextualBody',
          value: band.label || `${orientation} band`,
          format: 'text/plain'
        },
        {
          type: 'SpecificResource',
          source: canvasUrl,
          selector: {
            type: 'FragmentSelector',
            conformsTo: 'http://www.w3.org/TR/media-frags/',
            value: `xywh=${Math.round(band.x || 0)},${Math.round(band.y || 0)},${Math.round(band.width || 0)},${Math.round(band.height || 0)}`
          }
        }
      ))
    })
  }

  processBands(normalized.horizontalBands, 'Horizontal')
  processBands(normalized.verticalBands, 'Vertical')

  return {
    '@context': 'http://www.w3.org/ns/anno.jsonld',
    id: `urn:quillapp:annotation-page:${Date.now()}`,
    type: 'AnnotationPage',
    items
  }
}

/**
 * Export as W3C Web Annotation
 */
export function exportAsWebAnnotation(annotations, metadata, documentName) {
  const data = buildWebAnnotationExport(annotations, metadata)
  const json = JSON.stringify(data, null, 2)
  const filename = generateFilename(documentName, 'jsonld')
  downloadFile(json, filename, 'application/ld+json')
}
