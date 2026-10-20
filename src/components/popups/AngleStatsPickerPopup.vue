<template>
  <Dialog :open="visible" @update:open="handleOpenChange">
    <DialogContent class="sm:max-w-3xl">
      <DialogHeader>
        <DialogTitle>Angle Statistics</DialogTitle>
        <DialogDescription>
          Choose a scope to view statistics for your angle measurements.
        </DialogDescription>
      </DialogHeader>

      <div class="space-y-4 py-4">
        <!-- Scope Section -->
        <div>
          <Label class="text-sm font-semibold mb-2 block">Scope</Label>
          <div class="options-grid wide">
            <button
              type="button"
              class="scope-button"
              @click="$emit('confirm', { scope: 'current', label: null })"
            >
              <span class="swatch big" />
              <span class="button-label">Current Page (All Labels)</span>
            </button>
            <button
              type="button"
              class="scope-button"
              @click="$emit('confirm', { scope: 'entire', label: null })"
            >
              <span class="swatch big" />
              <span class="button-label">Entire Document (All Labels)</span>
            </button>
          </div>
        </div>

        <!-- By Label Section -->
        <div>
          <Label class="text-sm font-semibold mb-2 block">By Label</Label>
          <div v-if="labels && labels.length" class="options-grid">
            <button
              v-for="l in labels"
              :key="l"
              type="button"
              class="scope-button"
              @click="$emit('confirm', { scope: 'byLabel', label: l })"
            >
              <span class="swatch" />
              <span class="button-label">{{ l }}</span>
            </button>
          </div>
          <p v-else class="empty-message">
            No labels yet — create one by measuring with a new label.
          </p>
        </div>
      </div>

      <DialogFooter>
        <Button variant="outline" @click="$emit('cancel')">Close</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<script>
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'

export default {
  name: "AngleStatsPickerPopup",
  components: {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    Button,
    Label,
  },
  props: {
    visible: { type: Boolean, default: false },
    labels: { type: Array, default: () => [] },
  },
  emits: ['confirm', 'cancel'],
  methods: {
    handleOpenChange(open) {
      if (!open) {
        this.$emit('cancel');
      }
    },
  },
};
</script>

<style scoped>
.options-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 1rem;
}

.options-grid.wide {
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
}

.scope-button {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem;
  border: 2px solid hsl(var(--border));
  border-radius: var(--radius-lg);
  background: hsl(var(--muted));
  cursor: pointer;
  transition: all 0.2s ease;
}

.scope-button:hover {
  border-color: hsl(var(--primary) / 0.5);
  background: hsl(var(--primary) / 0.05);
}

.scope-button:focus-visible {
  outline: none;
  border-color: hsl(var(--primary));
  box-shadow: 0 0 0 2px hsl(var(--primary) / 0.2);
}

.swatch {
  width: 2.75rem;
  height: 2.75rem;
  border-radius: var(--radius-md);
  background: hsl(var(--muted-foreground) / 0.15);
  border: 2px solid hsl(var(--border));
}

.swatch.big {
  width: 3.5rem;
  height: 3.5rem;
}

.button-label {
  font-size: var(--text-sm);
  color: hsl(var(--foreground));
  text-align: center;
}

.empty-message {
  font-size: var(--text-sm);
  color: hsl(var(--muted-foreground));
  margin: 0.25rem 0;
}
</style>
