<script setup>
import { ref, computed, nextTick, watch } from 'vue'
import Icon from '@/components/ui/icon/Icon.vue'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import {
  normalizeMeasurementLabel,
  uniqueMeasurementLabels,
} from '@/utils/measurementStatistics.mjs'

const props = defineProps({
  annotations: { type: Array, default: () => [] },
  currentPage: { type: Number, default: 0 },
  totalPages: { type: Number, default: 1 },
  zoomLevel: { type: Number, default: 1 },
  showInCm: { type: Boolean, default: false },
  selectedAnnotation: { type: Object, default: null },
  angleLabels: { type: Array, default: () => [] },
  distanceLabels: { type: Array, default: () => [] },
  boxMeasurementLabels: { type: Array, default: () => [] }
})

const emit = defineEmits([
  'select-annotation',
  'delete-annotation',
  'rename-annotation',
  'generate-page-summary',
  'generate-bands-page',
  'generate-bands-doc',
  'generate-angles',
  'generate-distances',
  'generate-box-measurements',
  'inspect-box-measurement',
  'reclassify-annotation'
])

const activeTab = ref('annotations')
const statsExpanded = ref(true)
const annotationsScrollEl = ref(null)

const annotationIcons = {
  highlight: 'highlighter',
  underline: 'underline',
  trace: 'pencil',
  comment: 'message-square',
  angle: 'triangle',
  distance: 'ruler-dimension-line',
  boxMeasurement: 'box-select',
  'length-h': 'ruler',
  'length-v': 'move-vertical'
}

const annotationCount = computed(() => props.annotations.length)
const selectedTypeLabel = computed(() => typeLabel(props.selectedAnnotation?.type))
const selectedData = computed(() => props.selectedAnnotation?.data || {})
const selectedDisplayName = computed(() => {
  const annotation = props.selectedAnnotation
  if (!annotation) return ''
  return annotation.data?.name || annotation.label || typeLabel(annotation.type)
})
const selectedPropertyRows = computed(() => buildPropertyRows(props.selectedAnnotation))
const selectedClassification = computed(() => normalizeMeasurementLabel(selectedData.value?.label))
const classificationOptions = computed(() => {
  const type = props.selectedAnnotation?.type
  const configured = type === 'angle'
    ? props.angleLabels
    : (type === 'distance'
      ? props.distanceLabels
      : (type === 'boxMeasurement' ? props.boxMeasurementLabels : []))
  return uniqueMeasurementLabels([selectedClassification.value, ...configured])
})

function latestAnnotationKey(annotations = []) {
  const latest = annotations[annotations.length - 1]
  if (!latest) return ''
  const data = latest.data || {}
  return [
    latest.type,
    data.id || latest.id || latest.index,
    data.name || latest.label || '',
    data.createdOrder || data.createdAt || '',
  ].join(':')
}

function scrollAnnotationsToLatest(behavior = 'smooth') {
  const el = annotationsScrollEl.value
  if (!el) return
  el.scrollTo({ top: el.scrollHeight, behavior })
}

watch(
  () => ({
    page: props.currentPage,
    count: props.annotations.length,
    latestKey: latestAnnotationKey(props.annotations),
  }),
  (next, previous) => {
    if (!previous || activeTab.value !== 'annotations') return
    const samePage = next.page === previous.page
    const addedRow = next.count > previous.count
    const latestRowChanged = next.count > 0 && next.count === previous.count && next.latestKey !== previous.latestKey
    if (samePage && (addedRow || latestRowChanged)) {
      nextTick(() => scrollAnnotationsToLatest())
    }
  },
  { flush: 'post' }
)

watch(activeTab, (tab) => {
  if (tab === 'annotations') {
    nextTick(() => scrollAnnotationsToLatest('auto'))
  }
})

function isSelected(annotation) {
  const selected = props.selectedAnnotation
  if (!selected || !annotation) return false
  if (selected.type !== annotation.type) return false
  if (selected.data?.id && annotation.data?.id) {
    return selected.data.id === annotation.data.id
  }
  return selected.data === annotation.data
}

function canRename(annotation) {
  return !!annotation?.data
}

function handleAnnotationNameChange(annotation, event) {
  emit('rename-annotation', annotation, event.target.value)
}

function handleClassificationChange(annotation, event) {
  emit('reclassify-annotation', annotation, event.target.value)
}

function typeLabel(type) {
  const labels = {
    highlight: 'Highlight',
    underline: 'Underline',
    trace: 'Trace',
    comment: 'Comment',
    angle: 'Angle',
    distance: 'Distance',
    boxMeasurement: 'Crop & Count box',
    'length-h': 'Horizontal band',
    'length-v': 'Vertical band'
  }
  return labels[type] || 'Annotation'
}

function formatNumber(value, suffix = '') {
  const number = Number(value)
  if (!Number.isFinite(number)) return '—'
  return `${Number(number.toFixed(2))}${suffix}`
}

function formatDate(value) {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleString()
}

function pointCount(annotation) {
  return Array.isArray(annotation?.points) ? annotation.points.length : 0
}

function pathLength(points = []) {
  if (!Array.isArray(points) || points.length < 2) return 0
  return points.reduce((total, point, index) => {
    if (index === 0) return total
    const prev = points[index - 1]
    const x1 = Number(prev.x)
    const y1 = Number(prev.y)
    const x2 = Number(point.x)
    const y2 = Number(point.y)
    if (![x1, y1, x2, y2].every(Number.isFinite)) return total
    return total + Math.hypot(x2 - x1, y2 - y1)
  }, 0)
}

function buildPropertyRows(annotationItem) {
  if (!annotationItem?.data) return []
  const type = annotationItem.type
  const data = annotationItem.data
  const rows = [
    ['Page', String((data.pageIndex ?? props.currentPage) + 1)],
  ]

  if (['highlight', 'underline', 'boxMeasurement', 'length-h', 'length-v'].includes(type)) {
    rows.push(['X', formatNumber(data.x, ' px')])
    rows.push(['Y', formatNumber(data.y, ' px')])
    rows.push(['Width', formatNumber(data.width, ' px')])
    rows.push(['Height', formatNumber(data.height, ' px')])
  }

  if (type === 'highlight') {
    rows.push(['Area', formatNumber((Number(data.width) || 0) * (Number(data.height) || 0), ' px²')])
  }

  if (type === 'underline') {
    rows.push(['Underline length', formatNumber(data.width, ' px')])
  }

  if (type === 'trace') {
    rows.push(['Points', String(pointCount(data))])
    rows.push(['Path length', formatNumber(pathLength(data.points), ' px')])
    rows.push(['Nib angle', formatNumber(data.nibAngle, '°')])
    rows.push(['Nib width', formatNumber(data.penWidth, ' px')])
    rows.push(['Nib height', formatNumber(data.penHeight, ' px')])
  }

  if (type === 'angle') {
    rows.push(['Angle', formatNumber(data.angle, '°')])
    if (data.label) rows.push(['Label', data.label])
    rows.push(['Points', String(pointCount(data))])
  }

  if (type === 'distance') {
    const length = Array.isArray(data.points) && data.points.length >= 2
      ? pathLength(data.points.slice(0, 2))
      : Number(data.lengthPx) || 0
    rows.push(['Distance', formatNumber(length, ' px')])
    if (data.label) rows.push(['Label', data.label])
    rows.push(['Points', String(pointCount(data))])
  }

  if (type === 'boxMeasurement') {
    rows.push(['Class', normalizeMeasurementLabel(data.label)])
    rows.push(['Aspect ratio (W/H)', formatNumber(data.aspectRatio)])
    rows.push(['Ink density', formatNumber((Number(data.inkDensity) || 0) * 100, '%')])
    rows.push(['Ink pixels', `${Number(data.darkPixelCount) || 0} / ${Number(data.sampledPixelCount) || 0}`])
    rows.push(['Threshold', `${Number(data.threshold) || 0} (${data.thresholdMethod === 'manual' ? 'manual' : 'automatic'})`])
  }

  if (type === 'comment') {
    rows.push(['Anchor X', formatNumber(data.x, ' px')])
    rows.push(['Anchor Y', formatNumber(data.y, ' px')])
  }

  if (type === 'length-h' || type === 'length-v') {
    rows.push(['Band type', annotationItem.label])
    rows.push(['Measured value', formatNumber(type === 'length-h' ? data.height : data.width, ' px')])
  }

  const created = formatDate(data.createdAt)
  if (created) rows.push(['Created', created])
  return rows
}
</script>

<template>
  <div class="flex flex-col h-full bg-card border-l border-border">
    <Tabs v-model="activeTab" class="flex-1 flex flex-col min-h-0">
      <TabsList class="w-full justify-start rounded-none border-b bg-transparent px-2 shrink-0">
        <TabsTrigger
          value="annotations"
          class="data-[state=active]:bg-transparent data-[state=active]:shadow-none
                 data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none"
        >
          Annotations
          <span v-if="annotationCount > 0" class="ml-1 text-xs text-muted-foreground">
            ({{ annotationCount }})
          </span>
        </TabsTrigger>
        <TabsTrigger
          value="properties"
          class="data-[state=active]:bg-transparent data-[state=active]:shadow-none
                 data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none"
        >
          Properties
        </TabsTrigger>
      </TabsList>

      <!-- Annotations Tab -->
      <TabsContent value="annotations" class="flex-1 min-h-0 p-0 mt-0">
        <div ref="annotationsScrollEl" class="h-full overflow-y-auto p-3">
          <div v-if="annotations.length === 0" class="text-center text-muted-foreground text-sm py-8">
            <Icon name="file-text" :size="32" class="mx-auto mb-2 opacity-50" />
            <p>No annotations yet</p>
            <p class="text-xs mt-1">Use the tools to add annotations</p>
          </div>
          <div v-else class="space-y-2">
            <div
              v-for="(annotation, index) in annotations"
              :key="`${annotation.type}-${index}`"
              class="p-2 rounded-md border bg-card hover:bg-muted cursor-pointer group transition-colors"
              :class="{ 'ring-2 ring-primary bg-muted': isSelected(annotation) }"
              @click="emit('select-annotation', annotation)"
            >
              <div class="flex items-center justify-between">
                <div class="flex items-center gap-2 min-w-0">
                  <Icon :name="annotationIcons[annotation.type] || 'file'" :size="16" class="shrink-0" />
                  <input
                    v-if="canRename(annotation)"
                    class="trace-name-input"
                    :value="annotation.data?.name || annotation.label"
                    :aria-label="`${annotation.type} name`"
                    @click.stop
                    @focus="emit('select-annotation', annotation)"
                    @change="handleAnnotationNameChange(annotation, $event)"
                    @keydown.enter="$event.target.blur()"
                  />
                  <span v-else class="text-sm truncate">{{ annotation.label }}</span>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  class="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                  @click.stop="emit('delete-annotation', annotation)"
                >
                  <Icon name="trash-2" :size="14" />
                </Button>
              </div>
            </div>
          </div>
        </div>
      </TabsContent>

      <!-- Properties Tab -->
      <TabsContent value="properties" class="flex-1 overflow-y-auto p-3 mt-0">
        <div v-if="!selectedAnnotation" class="text-center text-muted-foreground text-sm py-8">
          <Icon name="settings-2" :size="32" class="mx-auto mb-2 opacity-50" />
          <p>No selection</p>
          <p class="text-xs mt-1">Select an annotation to view properties</p>
        </div>
        <div v-else class="properties-panel">
          <div class="properties-header">
            <Icon :name="annotationIcons[selectedAnnotation.type] || 'file'" :size="18" />
            <div class="min-w-0">
              <div class="properties-title">{{ selectedTypeLabel }}</div>
              <div class="properties-subtitle">{{ selectedDisplayName }}</div>
            </div>
          </div>

          <div v-if="canRename(selectedAnnotation)" class="property-section">
            <label class="property-label" for="selected-annotation-name">Display name</label>
            <input
              id="selected-annotation-name"
              class="trace-name-input property-name-input"
              :value="selectedData?.name || selectedAnnotation.label"
              @change="handleAnnotationNameChange(selectedAnnotation, $event)"
              @keydown.enter="$event.target.blur()"
            />
          </div>

          <div v-if="selectedAnnotation.type === 'angle' || selectedAnnotation.type === 'distance' || selectedAnnotation.type === 'boxMeasurement'" class="property-section">
            <label class="property-label" for="selected-measurement-class">Statistics class</label>
            <input
              id="selected-measurement-class"
              class="trace-name-input property-name-input"
              list="measurement-class-options"
              :value="selectedClassification"
              @blur="handleClassificationChange(selectedAnnotation, $event)"
              @keydown.enter="$event.target.blur()"
            />
            <datalist id="measurement-class-options">
              <option v-for="label in classificationOptions" :key="label" :value="label" />
            </datalist>
            <p class="property-help">Statistics group by this class; the display name is only a personal caption.</p>
          </div>

          <Button
            v-if="selectedAnnotation.type === 'boxMeasurement'"
            variant="outline"
            size="sm"
            class="w-full justify-start"
            @click="emit('inspect-box-measurement', selectedAnnotation)"
          >
            <Icon name="scan-search" :size="14" class="mr-2" />
            Inspect ink mask and threshold
          </Button>

          <div v-if="selectedAnnotation.type === 'comment'" class="property-section">
            <div class="property-label">Comment text</div>
            <div class="comment-property-text">{{ selectedData.text || '—' }}</div>
          </div>

          <div class="property-section">
            <div class="property-label">Details</div>
            <div class="property-grid">
              <div v-for="[label, value] in selectedPropertyRows" :key="label" class="property-row">
                <span>{{ label }}</span>
                <strong>{{ value }}</strong>
              </div>
            </div>
          </div>
        </div>
      </TabsContent>
    </Tabs>

    <!-- Statistics Section -->
    <div class="border-t shrink-0">
      <button
        class="flex items-center justify-between w-full px-3 py-2 hover:bg-muted text-left"
        @click="statsExpanded = !statsExpanded"
      >
        <span class="text-sm font-medium">Statistics</span>
        <Icon :name="statsExpanded ? 'chevron-down' : 'chevron-right'" :size="16" />
      </button>
      <div v-show="statsExpanded" class="px-3 pb-3">
        <div class="grid grid-cols-2 gap-2 text-sm mb-3">
          <div class="p-2 rounded-md bg-muted">
            <div class="text-muted-foreground text-xs">Pages</div>
            <div class="font-medium">{{ totalPages }}</div>
          </div>
          <div class="p-2 rounded-md bg-muted">
            <div class="text-muted-foreground text-xs">Current</div>
            <div class="font-medium">{{ currentPage + 1 }}</div>
          </div>
          <div class="p-2 rounded-md bg-muted">
            <div class="text-muted-foreground text-xs">Annotations</div>
            <div class="font-medium">{{ annotationCount }}</div>
          </div>
          <div class="p-2 rounded-md bg-muted">
            <div class="text-muted-foreground text-xs">Zoom</div>
            <div class="font-medium">{{ Math.round(zoomLevel * 100) }}%</div>
          </div>
        </div>
        <div class="space-y-1">
          <Button
            variant="outline"
            size="sm"
            class="w-full justify-start"
            @click="emit('generate-page-summary')"
          >
            <Icon name="bar-chart-3" :size="14" class="mr-2" />
            Current Page Summary
          </Button>
          <Button
            variant="outline"
            size="sm"
            class="w-full justify-start"
            @click="emit('generate-bands-page')"
          >
            <Icon name="ruler" :size="14" class="mr-2" />
            Bands: Current Page
          </Button>
          <Button
            variant="outline"
            size="sm"
            class="w-full justify-start"
            @click="emit('generate-bands-doc')"
          >
            <Icon name="ruler" :size="14" class="mr-2" />
            Bands: Entire Document
          </Button>
          <Button
            variant="outline"
            size="sm"
            class="w-full justify-start"
            @click="emit('generate-angles')"
          >
            <Icon name="triangle" :size="14" class="mr-2" />
            Angle Measurements
          </Button>
          <Button
            variant="outline"
            size="sm"
            class="w-full justify-start"
            @click="emit('generate-distances')"
          >
            <Icon name="ruler-dimension-line" :size="14" class="mr-2" />
            Distance Measurements
          </Button>
          <Button
            variant="outline"
            size="sm"
            class="w-full justify-start"
            @click="emit('generate-box-measurements')"
          >
            <Icon name="box-select" :size="14" class="mr-2" />
            Crop & Count Measurements
          </Button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.trace-name-input {
  min-width: 0;
  width: 100%;
  height: 1.75rem;
  border: 1px solid transparent;
  border-radius: 0.375rem;
  background: transparent;
  color: hsl(var(--foreground));
  font-size: 0.875rem;
  line-height: 1.25rem;
  padding: 0 0.375rem;
  outline: none;
}

.trace-name-input:hover {
  border-color: hsl(var(--border));
  background: hsl(var(--background));
}

.trace-name-input:focus {
  border-color: hsl(var(--primary));
  background: hsl(var(--background));
  box-shadow: 0 0 0 2px hsl(var(--primary) / 0.14);
}

.property-help {
  margin-top: 0.35rem;
  color: hsl(var(--muted-foreground));
  font-size: 0.75rem;
  line-height: 1.25;
}

.properties-panel {
  display: grid;
  gap: 1rem;
}

.properties-header {
  display: flex;
  align-items: center;
  gap: 0.625rem;
  padding: 0.625rem;
  border: 1px solid hsl(var(--border));
  border-radius: 0.5rem;
  background: hsl(var(--muted) / 0.45);
}

.properties-title {
  font-size: 0.875rem;
  font-weight: 700;
  color: hsl(var(--foreground));
}

.properties-subtitle {
  overflow: hidden;
  color: hsl(var(--muted-foreground));
  font-size: 0.75rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.property-section {
  display: grid;
  gap: 0.375rem;
}

.property-label {
  color: hsl(var(--muted-foreground));
  font-size: 0.75rem;
  font-weight: 700;
  text-transform: uppercase;
}

.property-name-input {
  border-color: hsl(var(--border));
  background: hsl(var(--background));
}

.comment-property-text {
  max-height: 8rem;
  overflow: auto;
  border: 1px solid hsl(var(--border));
  border-radius: 0.5rem;
  background: hsl(var(--background));
  color: hsl(var(--foreground));
  font-size: 0.8125rem;
  line-height: 1.4;
  padding: 0.625rem;
  white-space: pre-wrap;
}

.property-grid {
  overflow: hidden;
  border: 1px solid hsl(var(--border));
  border-radius: 0.5rem;
}

.property-row {
  display: flex;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.5rem 0.625rem;
  border-bottom: 1px solid hsl(var(--border));
  font-size: 0.8125rem;
}

.property-row:last-child {
  border-bottom: 0;
}

.property-row span {
  color: hsl(var(--muted-foreground));
}

.property-row strong {
  color: hsl(var(--foreground));
  font-weight: 600;
  text-align: right;
}
</style>
