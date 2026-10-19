export const UNLABELED_MEASUREMENT = 'Unlabeled'

export function normalizeMeasurementLabel(value) {
  const normalized = String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ')
  return normalized || UNLABELED_MEASUREMENT
}

export function measurementLabelKey(value) {
  return normalizeMeasurementLabel(value).toLocaleLowerCase()
}

export function measurementLabelsEqual(left, right) {
  return measurementLabelKey(left) === measurementLabelKey(right)
}

export function uniqueMeasurementLabels(values = [], { includeUnlabeled = true } = {}) {
  const labels = []
  const seen = new Set()

  values.forEach((value) => {
    const label = normalizeMeasurementLabel(value)
    if (!includeUnlabeled && label === UNLABELED_MEASUREMENT) return
    const key = measurementLabelKey(label)
    if (seen.has(key)) return
    seen.add(key)
    labels.push(label)
  })

  return labels
}

export function calculateAngleDegrees(pt1, vertex, pt2) {
  if (!pt1 || !vertex || !pt2) return null
  const v1 = { x: Number(pt1.x) - Number(vertex.x), y: Number(pt1.y) - Number(vertex.y) }
  const v2 = { x: Number(pt2.x) - Number(vertex.x), y: Number(pt2.y) - Number(vertex.y) }
  if (![v1.x, v1.y, v2.x, v2.y].every(Number.isFinite)) return null

  const mag1 = Math.hypot(v1.x, v1.y)
  const mag2 = Math.hypot(v2.x, v2.y)
  if (!mag1 || !mag2) return null

  const cosine = Math.max(-1, Math.min(1, (v1.x * v2.x + v1.y * v2.y) / (mag1 * mag2)))
  const degrees = Math.acos(cosine) * 180 / Math.PI
  return Number.isFinite(degrees) ? Number(degrees.toFixed(2)) : null
}

export function axisGuideCandidate(point, reference, tolerance = 8) {
  if (!point || !reference) return null
  const x = Number(point.x)
  const y = Number(point.y)
  const refX = Number(reference.x)
  const refY = Number(reference.y)
  const threshold = Math.max(0, Number(tolerance) || 0)
  if (![x, y, refX, refY].every(Number.isFinite)) return null

  const horizontalDistance = Math.abs(y - refY)
  const verticalDistance = Math.abs(x - refX)
  const horizontalMatch = horizontalDistance < threshold
  const verticalMatch = verticalDistance < threshold

  if (!horizontalMatch && !verticalMatch) return null
  if (horizontalMatch && (!verticalMatch || horizontalDistance <= verticalDistance)) {
    return {
      type: 'horizontal',
      x: null,
      y: refY,
      position: { x, y: refY },
    }
  }

  return {
    type: 'vertical',
    x: refX,
    y: null,
    position: { x: refX, y },
  }
}

export function pointDistance(a, b) {
  if (!a || !b) return null
  const x1 = Number(a.x)
  const y1 = Number(a.y)
  const x2 = Number(b.x)
  const y2 = Number(b.y)
  if (![x1, y1, x2, y2].every(Number.isFinite)) return null
  return Math.hypot(x2 - x1, y2 - y1)
}

export function scaledPointDistance(a, b, pixelsPerUnitX, pixelsPerUnitY = pixelsPerUnitX) {
  if (!a || !b) return null
  const xScale = Number(pixelsPerUnitX)
  const yScale = Number(pixelsPerUnitY)
  const x1 = Number(a.x)
  const y1 = Number(a.y)
  const x2 = Number(b.x)
  const y2 = Number(b.y)
  if (![xScale, yScale, x1, y1, x2, y2].every(Number.isFinite) || xScale <= 0 || yScale <= 0) {
    return null
  }
  return Math.hypot((x2 - x1) / xScale, (y2 - y1) / yScale)
}

export function summarizeMeasurements(values = []) {
  const numbers = values.map(Number).filter(Number.isFinite)
  if (!numbers.length) {
    return { count: 0, mean: 0, median: 0, stdDev: 0, min: 0, max: 0, mode: 'No mode' }
  }

  const sorted = [...numbers].sort((a, b) => a - b)
  const count = sorted.length
  const mean = sorted.reduce((sum, value) => sum + value, 0) / count
  const median = count % 2 === 0
    ? (sorted[count / 2 - 1] + sorted[count / 2]) / 2
    : sorted[Math.floor(count / 2)]
  const variance = sorted.reduce((sum, value) => sum + (value - mean) ** 2, 0) / count
  const frequencies = new Map()
  sorted.forEach(value => frequencies.set(value, (frequencies.get(value) || 0) + 1))
  const maxFrequency = Math.max(...frequencies.values())
  const modes = [...frequencies.entries()]
    .filter(([, frequency]) => frequency === maxFrequency)
    .map(([value]) => value)
  const mode = maxFrequency > 1 ? Math.min(...modes) : 'No mode'
  const round = value => Number(value.toFixed(2))

  return {
    count,
    mean: round(mean),
    median: round(median),
    stdDev: round(Math.sqrt(variance)),
    min: round(sorted[0]),
    max: round(sorted[sorted.length - 1]),
    mode: typeof mode === 'number' ? round(mode) : mode,
  }
}
