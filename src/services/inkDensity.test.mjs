import test from 'node:test'
import assert from 'node:assert/strict'

import {
  analyzeInkPixels,
  buildInkMaskRgba,
  calculateBoxAspectRatio,
  normalizePixelBounds,
  otsuThreshold,
  summarizeBoxMeasurements,
} from '../utils/inkDensity.mjs'

test('counts dark and light pixels with an explicit threshold', () => {
  const pixels = new Uint8ClampedArray([
    0, 0, 0, 255,
    60, 60, 60, 255,
    200, 200, 200, 255,
    255, 255, 255, 255,
  ])
  const result = analyzeInkPixels(pixels, { threshold: 100 })
  assert.equal(result.darkPixelCount, 2)
  assert.equal(result.sampledPixelCount, 4)
  assert.equal(result.inkDensity, 0.5)
  assert.equal(result.thresholdMethod, 'manual')
})

test('Otsu separates a two-tone glyph sample deterministically', () => {
  const histogram = new Uint32Array(256)
  histogram[20] = 3
  histogram[230] = 7
  assert.equal(otsuThreshold(histogram, 10), 20)

  const pixels = new Uint8ClampedArray([
    20, 20, 20, 255,
    20, 20, 20, 255,
    20, 20, 20, 255,
    230, 230, 230, 255,
    230, 230, 230, 255,
    230, 230, 230, 255,
    230, 230, 230, 255,
    230, 230, 230, 255,
    230, 230, 230, 255,
    230, 230, 230, 255,
  ])
  const result = analyzeInkPixels(pixels)
  assert.equal(result.threshold, 20)
  assert.equal(result.inkDensity, 0.3)
  assert.equal(result.thresholdMethod, 'otsu')
})

test('transparent pixels are excluded and masks preserve transparency', () => {
  const pixels = new Uint8ClampedArray([
    0, 0, 0, 0,
    0, 0, 0, 255,
    255, 255, 255, 255,
  ])
  const result = analyzeInkPixels(pixels, { threshold: 127 })
  assert.equal(result.darkPixelCount, 1)
  assert.equal(result.sampledPixelCount, 2)

  const mask = buildInkMaskRgba(pixels, 127)
  assert.deepEqual(Array.from(mask), [
    255, 255, 255, 0,
    0, 0, 0, 255,
    255, 255, 255, 255,
  ])
})

test('automatic analysis treats a uniform light box as empty parchment', () => {
  const pixels = new Uint8ClampedArray([
    255, 255, 255, 255,
    255, 255, 255, 255,
  ])
  const result = analyzeInkPixels(pixels)
  assert.equal(result.threshold, 254)
  assert.equal(result.inkDensity, 0)
})

test('normalizes reversed and clipped source-image bounds', () => {
  assert.deepEqual(
    normalizePixelBounds({ x: 12.8, y: 9.2, width: -20, height: 30.1 }, 100, 25),
    { x: 0, y: 9, width: 13, height: 16 },
  )
})

test('calculates W/H aspect ratio and summarizes each normalized class', () => {
  assert.equal(calculateBoxAspectRatio(32, 50), 0.64)
  const rows = summarizeBoxMeasurements([
    { label: ' T ', aspectRatio: 0.6, inkDensity: 0.3, darkPixelCount: 30, sampledPixelCount: 100 },
    { label: 'T', aspectRatio: 0.8, inkDensity: 0.5, darkPixelCount: 50, sampledPixelCount: 100 },
    { label: ' A ', aspectRatio: 1, inkDensity: 0.2, darkPixelCount: 20, sampledPixelCount: 100 },
    { label: 'B', aspectRatio: 0.93621, inkDensity: 0.6622, darkPixelCount: 66, sampledPixelCount: 100 },
  ])
  assert.equal(rows.length, 3)
  assert.equal(rows[0].label, 'A')
  assert.equal(rows[1].label, 'B')
  assert.equal(rows[1].aspectRatio.mean, 0.93621)
  assert.equal(rows[1].inkDensity.mean, 0.6622)
  assert.equal(rows[2].label, 'T')
  assert.equal(rows[2].count, 2)
  assert.equal(rows[2].aspectRatio.mean, 0.7)
  assert.equal(rows[2].inkDensity.mean, 0.4)
  assert.equal(rows[2].darkPixelCount, 80)
})
