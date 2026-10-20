import test from 'node:test'
import assert from 'node:assert/strict'

import {
  SCHEMA_VERSION,
  buildBoxMeasurementsCsv,
  buildJsonExport,
  buildPlainTextExport,
  buildTeiExport,
  buildWebAnnotationExport,
} from './annotationExportService.js'

const box = {
  id: 'box-1',
  type: 'boxMeasurement',
  pageIndex: 1,
  label: 'T',
  name: 'First T',
  x: 10,
  y: 20,
  width: 30,
  height: 50,
  aspectRatio: 0.6,
  inkDensity: 0.375,
  darkPixelCount: 562,
  sampledPixelCount: 1500,
  thresholdMethod: 'otsu',
  threshold: 142,
  algorithmVersion: 'luminance-otsu-v1',
  imageWidth: 1200,
  imageHeight: 1800,
  createdAt: '2026-10-20T10:00:00.000Z',
}

const annotations = { boxMeasurements: [box] }
const metadata = { documentName: 'Test manuscript', iiifManifest: 'https://example.org/manifest', totalPages: 2 }

test('JSON export preserves Crop & Count measurements in schema 1.1', () => {
  const output = buildJsonExport(annotations, metadata, {})
  assert.equal(SCHEMA_VERSION, '1.1.0')
  assert.deepEqual(output.annotations.boxMeasurements, [box])
})

test('CSV export includes source coordinates and reproducibility fields', () => {
  const csv = buildBoxMeasurementsCsv(annotations)
  const lines = csv.split('\n')
  assert.match(lines[0], /page_index,x,y,x2,y2,width,height,aspect_ratio_w_h,ink_density_percent/)
  assert.match(lines[1], /box-1,T,First T,2,1,10\.00,20\.00,40\.00,70\.00,30\.00,50\.00,0\.600000,37\.5000/)
  assert.match(lines[1], /otsu,142,luminance-otsu-v1,1200,1800/)
})

test('TEI, plain-text, and W3C exports describe the measured box', () => {
  const tei = buildTeiExport(annotations, metadata)
  assert.match(tei, /zone type="crop-count" ulx="10\.00" uly="20\.00" lrx="40\.00" lry="70\.00"/)
  assert.match(tei, /measure type="ink-density" quantity="37\.5000" unit="percent"/)

  const plain = buildPlainTextExport(annotations, metadata)
  assert.match(plain, /CROP & COUNT MEASUREMENTS/)
  assert.match(plain, /T at \(10\.00, 20\.00\) 30\.00x50\.00 px: W\/H 0\.6000, ink 37\.50%/)

  const w3c = buildWebAnnotationExport(annotations, metadata)
  assert.equal(w3c.items.length, 1)
  assert.equal(w3c.items[0].target.selector.value, 'xywh=10,20,30,50')
  assert.equal(w3c.items[0].body[0].value, 'T')
})
