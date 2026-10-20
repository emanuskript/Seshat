<script setup>
import { computed, ref, watch } from 'vue'
import { Button } from '@/components/ui/button'
import Icon from '@/components/ui/icon/Icon.vue'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

const props = defineProps({
  open: { type: Boolean, default: false },
  labels: { type: Array, default: () => [] },
  initialLabel: { type: String, default: '' },
})

const emit = defineEmits(['update:open', 'crop-segment', 'start-count'])

const step = ref('choice')
const label = ref('')
const thresholdMode = ref('automatic')
const threshold = ref(128)
const error = ref('')

const normalizedLabels = computed(() => Array.from(new Set(
  props.labels.map(value => String(value || '').trim().replace(/\s+/g, ' ')).filter(Boolean),
)))

watch(() => props.open, (open) => {
  if (!open) return
  step.value = 'choice'
  label.value = props.initialLabel || normalizedLabels.value[0] || ''
  thresholdMode.value = 'automatic'
  threshold.value = 128
  error.value = ''
})

function close() {
  emit('update:open', false)
}

function chooseSegment() {
  emit('crop-segment')
  close()
}

function chooseCount() {
  step.value = 'setup'
  error.value = ''
}

function startCounting() {
  const normalizedLabel = String(label.value || '').trim().replace(/\s+/g, ' ')
  if (!normalizedLabel) {
    error.value = 'Enter a class name so these boxes can be grouped in statistics.'
    return
  }

  emit('start-count', {
    label: normalizedLabel,
    thresholdMode: thresholdMode.value,
    threshold: Math.max(0, Math.min(255, Number(threshold.value) || 0)),
  })
  close()
}
</script>

<template>
  <Dialog :open="open" @update:open="value => emit('update:open', value)">
    <DialogContent class="sm:max-w-xl">
      <DialogHeader>
        <DialogTitle>{{ step === 'choice' ? 'Choose a crop action' : 'Set up Crop & Count' }}</DialogTitle>
        <DialogDescription>
          {{ step === 'choice'
            ? 'Open a page segment for closer annotation, or measure boxed letterforms directly on the page.'
            : 'Choose a reusable class and how Seshat should distinguish ink from parchment.' }}
        </DialogDescription>
      </DialogHeader>

      <div v-if="step === 'choice'" class="crop-mode-grid">
        <button type="button" class="crop-mode-card" @click="chooseSegment">
          <span class="crop-mode-icon"><Icon name="scan" :size="22" /></span>
          <span>
            <strong>Crop page segment</strong>
            <small>Open the existing crop workspace to annotate and export a selected area.</small>
          </span>
          <Icon name="chevron-right" :size="18" class="crop-mode-arrow" />
        </button>

        <button type="button" class="crop-mode-card" @click="chooseCount">
          <span class="crop-mode-icon"><Icon name="box-select" :size="22" /></span>
          <span>
            <strong>Crop & Count ink</strong>
            <small>Draw repeated letter boxes and measure W/H aspect ratio and dark-pixel density.</small>
          </span>
          <Icon name="chevron-right" :size="18" class="crop-mode-arrow" />
        </button>
      </div>

      <form v-else class="count-setup" @submit.prevent="startCounting">
        <label>
          <span>Annotation class</span>
          <input
            v-model="label"
            list="box-measurement-classes"
            placeholder="e.g., T, minuscule a, decorated initial"
            autofocus
          />
          <datalist id="box-measurement-classes">
            <option v-for="item in normalizedLabels" :key="item" :value="item" />
          </datalist>
          <small>The class stays active so you can draw several examples in sequence.</small>
        </label>

        <fieldset>
          <legend>Ink threshold</legend>
          <label class="threshold-option">
            <input v-model="thresholdMode" type="radio" value="automatic" />
            <span><strong>Automatic</strong><small>Recommended. Finds the dark/light boundary independently for each box.</small></span>
          </label>
          <label class="threshold-option">
            <input v-model="thresholdMode" type="radio" value="manual" />
            <span><strong>Fixed threshold</strong><small>Use one luminance cutoff for every new box in this run.</small></span>
          </label>
          <div v-if="thresholdMode === 'manual'" class="threshold-control">
            <input v-model.number="threshold" type="range" min="0" max="255" step="1" />
            <input v-model.number="threshold" type="number" min="0" max="255" step="1" aria-label="Ink threshold" />
          </div>
        </fieldset>

        <p class="count-note">
          Measurements use original source pixels, so display brightness and contrast changes do not alter the data.
        </p>
        <p v-if="error" class="count-error" role="alert">{{ error }}</p>
      </form>

      <DialogFooter>
        <Button v-if="step === 'setup'" type="button" variant="outline" @click="step = 'choice'">Back</Button>
        <Button type="button" variant="outline" @click="close">Cancel</Button>
        <Button v-if="step === 'setup'" type="button" @click="startCounting">Start drawing boxes</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<style scoped>
.crop-mode-grid { display: grid; gap: 0.75rem; padding: 0.5rem 0; }
.crop-mode-card {
  display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: 0.875rem;
  width: 100%; border: 1px solid hsl(var(--border)); border-radius: 0.75rem;
  background: hsl(var(--card)); color: hsl(var(--card-foreground)); padding: 1rem;
  text-align: left; transition: border-color 0.16s ease, background-color 0.16s ease, transform 0.16s ease;
}
.crop-mode-card:hover { border-color: hsl(var(--primary) / 0.65); background: hsl(var(--primary) / 0.06); transform: translateY(-1px); }
.crop-mode-icon { display: inline-flex; align-items: center; justify-content: center; width: 2.5rem; height: 2.5rem; border-radius: 0.625rem; background: hsl(var(--primary) / 0.12); color: hsl(var(--primary)); }
.crop-mode-card strong, .crop-mode-card small { display: block; }
.crop-mode-card small { margin-top: 0.2rem; color: hsl(var(--muted-foreground)); line-height: 1.35; }
.crop-mode-arrow { color: hsl(var(--muted-foreground)); }
.count-setup { display: grid; gap: 1rem; padding: 0.5rem 0; }
.count-setup > label, .count-setup fieldset { display: grid; gap: 0.4rem; }
.count-setup label > span, .count-setup legend { font-size: 0.8rem; font-weight: 700; color: hsl(var(--foreground)); }
.count-setup input[type='text'], .count-setup input[list], .count-setup input[type='number'] {
  min-height: 2.4rem; border: 1px solid hsl(var(--border)); border-radius: 0.5rem;
  background: hsl(var(--background)); color: hsl(var(--foreground)); padding: 0 0.7rem; outline: none;
}
.count-setup input:focus { border-color: hsl(var(--primary)); box-shadow: 0 0 0 2px hsl(var(--primary) / 0.15); }
.count-setup small, .count-note { color: hsl(var(--muted-foreground)); font-size: 0.75rem; line-height: 1.4; }
.count-setup fieldset { border: 1px solid hsl(var(--border)); border-radius: 0.625rem; padding: 0.75rem; }
.threshold-option { display: grid; grid-template-columns: auto 1fr; align-items: start; gap: 0.6rem; padding: 0.35rem 0; cursor: pointer; }
.threshold-option input { margin-top: 0.2rem; accent-color: hsl(var(--primary)); }
.threshold-option strong, .threshold-option small { display: block; }
.threshold-control { display: grid; grid-template-columns: 1fr 4.5rem; align-items: center; gap: 0.75rem; margin-top: 0.35rem; }
.threshold-control input[type='range'] { accent-color: hsl(var(--primary)); }
.count-note { border-radius: 0.5rem; background: hsl(var(--muted) / 0.55); padding: 0.65rem 0.75rem; }
.count-error { color: hsl(var(--destructive)); font-size: 0.8rem; }
</style>
