<script setup>
import { ref, watch } from 'vue'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

const props = defineProps({
  visible: { type: Boolean, default: false },
  annotation: { type: Object, default: null },
  originalPreview: { type: String, default: '' },
  maskPreview: { type: String, default: '' },
  processing: { type: Boolean, default: false },
})

const emit = defineEmits(['close', 'apply-threshold', 'use-automatic'])
const draftThreshold = ref(128)

watch(() => props.annotation?.threshold, value => {
  if (Number.isFinite(Number(value))) draftThreshold.value = Number(value)
}, { immediate: true })

function percent(value) {
  const number = Number(value)
  return Number.isFinite(number) ? `${(number * 100).toFixed(2)}%` : '—'
}
</script>

<template>
  <Dialog :open="visible" @update:open="open => { if (!open) emit('close') }">
    <DialogContent class="sm:max-w-2xl">
      <DialogHeader>
        <DialogTitle>Inspect ink classification</DialogTitle>
        <DialogDescription>
          Compare the original source pixels with the counted mask. Black pixels in the mask are counted as ink.
        </DialogDescription>
      </DialogHeader>

      <div v-if="annotation" class="inspector-body">
        <div class="preview-grid">
          <figure><div class="preview-frame"><img v-if="originalPreview" :src="originalPreview" alt="Original selected box" /></div><figcaption>Original</figcaption></figure>
          <figure><div class="preview-frame mask"><img v-if="maskPreview" :src="maskPreview" alt="Black and white ink mask" /></div><figcaption>Counted mask</figcaption></figure>
        </div>

        <div class="metric-strip">
          <span><small>Class</small><strong>{{ annotation.label }}</strong></span>
          <span><small>W/H</small><strong>{{ Number(annotation.aspectRatio).toFixed(3) }}</strong></span>
          <span><small>Ink density</small><strong>{{ percent(annotation.inkDensity) }}</strong></span>
          <span><small>Pixels</small><strong>{{ annotation.darkPixelCount }}/{{ annotation.sampledPixelCount }}</strong></span>
        </div>

        <label class="threshold-editor">
          <span>Dark/light threshold: <strong>{{ draftThreshold }}</strong></span>
          <input v-model.number="draftThreshold" type="range" min="0" max="255" step="1" :disabled="processing" />
          <small>Lower values count only darker pixels. Changes are applied from the original image.</small>
        </label>
      </div>

      <DialogFooter>
        <Button variant="outline" :disabled="processing" @click="emit('use-automatic')">Use automatic threshold</Button>
        <Button variant="outline" @click="emit('close')">Close</Button>
        <Button :disabled="processing" @click="emit('apply-threshold', draftThreshold)">{{ processing ? 'Recalculating…' : 'Apply threshold' }}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<style scoped>
.inspector-body { display: grid; gap: 1rem; }
.preview-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; }
figure { margin: 0; }
.preview-frame { display: flex; align-items: center; justify-content: center; min-height: 180px; max-height: 280px; overflow: hidden; border: 1px solid hsl(var(--border)); border-radius: 0.625rem; background: hsl(var(--muted) / 0.45); }
.preview-frame.mask { background-image: linear-gradient(45deg, hsl(var(--muted)) 25%, transparent 25%), linear-gradient(-45deg, hsl(var(--muted)) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, hsl(var(--muted)) 75%), linear-gradient(-45deg, transparent 75%, hsl(var(--muted)) 75%); background-position: 0 0, 0 8px, 8px -8px, -8px 0; background-size: 16px 16px; }
.preview-frame img { display: block; max-width: 100%; max-height: 280px; image-rendering: auto; }
figcaption { margin-top: 0.3rem; text-align: center; color: hsl(var(--muted-foreground)); font-size: 0.75rem; }
.metric-strip { display: grid; grid-template-columns: repeat(4, 1fr); gap: 0.5rem; }
.metric-strip span { border-radius: 0.5rem; background: hsl(var(--muted) / 0.55); padding: 0.55rem; }
.metric-strip small, .metric-strip strong { display: block; }
.metric-strip small { color: hsl(var(--muted-foreground)); font-size: 0.7rem; }
.metric-strip strong { margin-top: 0.15rem; font-size: 0.9rem; }
.threshold-editor { display: grid; gap: 0.4rem; }
.threshold-editor span { font-size: 0.8rem; }
.threshold-editor input { width: 100%; accent-color: hsl(var(--primary)); }
.threshold-editor small { color: hsl(var(--muted-foreground)); font-size: 0.75rem; }
@media (max-width: 640px) { .preview-grid { grid-template-columns: 1fr; } .metric-strip { grid-template-columns: 1fr 1fr; } }
</style>
