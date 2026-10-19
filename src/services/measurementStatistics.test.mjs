import test from 'node:test'
import assert from 'node:assert/strict'

import {
  UNLABELED_MEASUREMENT,
  axisGuideCandidate,
  calculateAngleDegrees,
  measurementLabelsEqual,
  normalizeMeasurementLabel,
  scaledPointDistance,
  summarizeMeasurements,
  uniqueMeasurementLabels,
} from '../utils/measurementStatistics.mjs'

test('narrow angles keep their measured value before optional snapping', () => {
  const first = { x: 50, y: 0 }
  const vertex = { x: 0, y: 0 }
  const pointer = { x: 50, y: 7 }

  assert.equal(calculateAngleDegrees(first, vertex, pointer), 7.97)

  const guide = axisGuideCandidate(pointer, vertex, 8)
  assert.equal(guide.type, 'horizontal')
  assert.deepEqual(guide.position, { x: 50, y: 0 })
  assert.equal(calculateAngleDegrees(first, vertex, guide.position), 0)
})

test('axis-guide tolerance can be scaled to screen space and chooses the nearest axis', () => {
  assert.equal(axisGuideCandidate({ x: 20, y: 9 }, { x: 0, y: 0 }, 8), null)
  assert.equal(axisGuideCandidate({ x: 3, y: 4 }, { x: 0, y: 0 }, 8).type, 'vertical')
  assert.equal(axisGuideCandidate({ x: 5, y: 2 }, { x: 0, y: 0 }, 8).type, 'horizontal')
})

test('measurement labels normalize whitespace and compare case-insensitively', () => {
  assert.equal(normalizeMeasurementLabel('  Main   Hand '), 'Main Hand')
  assert.equal(normalizeMeasurementLabel(''), UNLABELED_MEASUREMENT)
  assert.equal(measurementLabelsEqual('Main Hand', ' main   hand '), true)
  assert.deepEqual(
    uniqueMeasurementLabels(['Main Hand', ' main  hand ', '', 'Corrector']),
    ['Main Hand', UNLABELED_MEASUREMENT, 'Corrector']
  )
})

test('distance conversion supports anisotropic page calibration', () => {
  assert.ok(Math.abs(scaledPointDistance({ x: 0, y: 0 }, { x: 20, y: 30 }, 10, 10) - Math.sqrt(13)) < 1e-12)
  assert.ok(Math.abs(scaledPointDistance({ x: 0, y: 0 }, { x: 20, y: 30 }, 20, 10) - Math.sqrt(10)) < 1e-12)
})

test('measurement summaries expose angle-compatible metrics', () => {
  assert.deepEqual(summarizeMeasurements([2, 4, 4, 6]), {
    count: 4,
    mean: 4,
    median: 4,
    stdDev: 1.41,
    min: 2,
    max: 6,
    mode: 4,
  })
})
