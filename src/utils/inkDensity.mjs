import {
  normalizeMeasurementLabel,
} from './measurementStatistics.mjs'

export const INK_DENSITY_ALGORITHM = 'luminance-otsu-v1'

export function clampByte(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return 0
  return Math.max(0, Math.min(255, Math.round(number)))
}

export function pixelLuminance(red, green, blue) {
  return (0.2126 * clampByte(red)) + (0.7152 * clampByte(green)) + (0.0722 * clampByte(blue))
}

export function buildLuminanceHistogram(rgba = []) {
  const histogram = new Uint32Array(256)
  let validPixelCount = 0

  for (let index = 0; index + 3 < rgba.length; index += 4) {
    if (rgba[index + 3] === 0) continue
    histogram[clampByte(pixelLuminance(rgba[index], rgba[index + 1], rgba[index + 2]))] += 1
    validPixelCount += 1
  }

  return { histogram, validPixelCount }
}

export function otsuThreshold(histogram, pixelCount) {
  if (!histogram || !Number.isFinite(pixelCount) || pixelCount <= 0) return 127

  let totalLuminance = 0
  let first = -1
  let last = -1
  for (let value = 0; value < 256; value += 1) {
    const count = Number(histogram[value]) || 0
    if (!count) continue
    if (first === -1) first = value
    last = value
    totalLuminance += value * count
  }

  if (first === -1) return 127
  if (first === last) return first < 128 ? first : Math.max(0, first - 1)

  let backgroundWeight = 0
  let backgroundLuminance = 0
  let bestVariance = -1
  let bestThreshold = first

  for (let value = first; value < last; value += 1) {
    const count = Number(histogram[value]) || 0
    backgroundWeight += count
    if (backgroundWeight === 0) continue

    const foregroundWeight = pixelCount - backgroundWeight
    if (foregroundWeight === 0) break

    backgroundLuminance += value * count
    const backgroundMean = backgroundLuminance / backgroundWeight
    const foregroundMean = (totalLuminance - backgroundLuminance) / foregroundWeight
    const betweenClassVariance = backgroundWeight * foregroundWeight * ((backgroundMean - foregroundMean) ** 2)

    if (betweenClassVariance > bestVariance) {
      bestVariance = betweenClassVariance
      bestThreshold = value
    }
  }

  return bestThreshold
}

export function analyzeInkPixels(rgba, options = {}) {
  const { histogram, validPixelCount } = buildLuminanceHistogram(rgba)
  if (!validPixelCount) {
    return {
      thresholdMethod: options.threshold == null ? 'otsu' : 'manual',
      threshold: options.threshold == null ? 127 : clampByte(options.threshold),
      darkPixelCount: 0,
      sampledPixelCount: 0,
      inkDensity: 0,
      algorithmVersion: INK_DENSITY_ALGORITHM,
    }
  }

  const automatic = options.threshold == null
  const threshold = automatic
    ? otsuThreshold(histogram, validPixelCount)
    : clampByte(options.threshold)
  let darkPixelCount = 0

  for (let index = 0; index + 3 < rgba.length; index += 4) {
    if (rgba[index + 3] === 0) continue
    if (pixelLuminance(rgba[index], rgba[index + 1], rgba[index + 2]) <= threshold) {
      darkPixelCount += 1
    }
  }

  return {
    thresholdMethod: automatic ? 'otsu' : 'manual',
    threshold,
    darkPixelCount,
    sampledPixelCount: validPixelCount,
    inkDensity: darkPixelCount / validPixelCount,
    algorithmVersion: INK_DENSITY_ALGORITHM,
  }
}

export function normalizePixelBounds(rect = {}, imageWidth = 0, imageHeight = 0) {
  const maxWidth = Math.max(0, Math.floor(Number(imageWidth) || 0))
  const maxHeight = Math.max(0, Math.floor(Number(imageHeight) || 0))
  const rawLeft = Number(rect.x) || 0
  const rawTop = Number(rect.y) || 0
  const rawRight = rawLeft + (Number(rect.width) || 0)
  const rawBottom = rawTop + (Number(rect.height) || 0)
  const x = Math.max(0, Math.min(maxWidth, Math.floor(Math.min(rawLeft, rawRight))))
  const y = Math.max(0, Math.min(maxHeight, Math.floor(Math.min(rawTop, rawBottom))))
  const right = Math.max(x, Math.min(maxWidth, Math.ceil(Math.max(rawLeft, rawRight))))
  const bottom = Math.max(y, Math.min(maxHeight, Math.ceil(Math.max(rawTop, rawBottom))))

  return { x, y, width: right - x, height: bottom - y }
}

export function calculateBoxAspectRatio(width, height) {
  const numericWidth = Number(width)
  const numericHeight = Number(height)
  if (!Number.isFinite(numericWidth) || !Number.isFinite(numericHeight) || numericWidth < 0 || numericHeight <= 0) {
    return 0
  }
  return numericWidth / numericHeight
}

function summarizeBoxValues(values = []) {
  const sorted = values.map(Number).filter(Number.isFinite).sort((left, right) => left - right)
  if (!sorted.length) return { count: 0, mean: 0, median: 0, stdDev: 0, min: 0, max: 0 }

  const count = sorted.length
  const mean = sorted.reduce((total, value) => total + value, 0) / count
  const median = count % 2 === 0
    ? (sorted[(count / 2) - 1] + sorted[count / 2]) / 2
    : sorted[Math.floor(count / 2)]
  const variance = sorted.reduce((total, value) => total + ((value - mean) ** 2), 0) / count

  // Keep source precision here and round only at the presentation/export boundary.
  // Ink density is stored as a 0–1 fraction, so rounding it to two decimals here
  // would turn (for example) 66.22% into 66.00% in a one-box class.
  return {
    count,
    mean,
    median,
    stdDev: Math.sqrt(variance),
    min: sorted[0],
    max: sorted[sorted.length - 1],
  }
}

export function summarizeBoxMeasurements(measurements = []) {
  const groups = new Map()
  measurements.forEach((measurement) => {
    if (!measurement) return
    const label = normalizeMeasurementLabel(measurement.label)
    if (!groups.has(label)) groups.set(label, [])
    groups.get(label).push(measurement)
  })

  return Array.from(groups.entries())
    .map(([label, values]) => ({
      label,
      count: values.length,
      aspectRatio: summarizeBoxValues(values.map(value => Number(value.aspectRatio))),
      inkDensity: summarizeBoxValues(values.map(value => Number(value.inkDensity))),
      darkPixelCount: values.reduce((total, value) => total + (Number(value.darkPixelCount) || 0), 0),
      sampledPixelCount: values.reduce((total, value) => total + (Number(value.sampledPixelCount) || 0), 0),
    }))
    .sort((left, right) => left.label.localeCompare(right.label, undefined, { sensitivity: 'base' }))
}

export function buildInkMaskRgba(rgba, threshold) {
  const mask = new Uint8ClampedArray(rgba?.length || 0)
  const normalizedThreshold = clampByte(threshold)
  for (let index = 0; index + 3 < mask.length; index += 4) {
    const alpha = rgba[index + 3]
    const isInk = alpha > 0 && pixelLuminance(rgba[index], rgba[index + 1], rgba[index + 2]) <= normalizedThreshold
    const value = isInk ? 0 : 255
    mask[index] = value
    mask[index + 1] = value
    mask[index + 2] = value
    mask[index + 3] = alpha
  }
  return mask
}
