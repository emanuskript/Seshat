<template>
  <Dialog :open="visible" @update:open="handleOpenChange">
    <DialogContent class="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>Select a Pen</DialogTitle>
        <DialogDescription>
          Choose a pen angle and test it in the drawing area below.
        </DialogDescription>
      </DialogHeader>

      <div class="space-y-4 py-4">
        <!-- Pen options -->
        <div class="pen-options">
          <div
            v-for="angle in penAngles"
            :key="angle"
            class="pen-option"
            :class="{ selected: selectedAngle === angle }"
            @click="$emit('select', angle)"
          >
            <div class="pen-preview">
              <svg width="40" height="20">
                <ellipse
                  cx="20"
                  cy="10"
                  rx="12"
                  ry="4"
                  :fill="selectedAngle === angle ? 'hsl(var(--primary))' : 'hsl(var(--muted-foreground))'"
                  :stroke="selectedAngle === angle ? 'hsl(var(--primary))' : 'hsl(var(--foreground))'"
                  stroke-width="2"
                  :transform="`rotate(${-angle}, 20, 10)`"
                />
              </svg>
            </div>
            <span class="pen-angle-text">{{ angle }}°</span>
          </div>
        </div>

        <!-- Test area -->
        <div class="test-box">
          <Label class="text-sm font-semibold mb-2 block">Test Your Pen</Label>
          <div
            class="test-area"
            @mousedown="$emit('test-start', $event)"
            @mousemove="$emit('test-move', $event)"
            @mouseup="$emit('test-end')"
            @mouseleave="$emit('test-end')"
          >
            <svg class="test-svg">
              <polyline
                v-if="testPath.length > 0"
                :points="formatPoints(testPath)"
                stroke="hsl(var(--foreground))"
                :stroke-width="penWidth"
                fill="none"
              />
            </svg>
          </div>
        </div>
      </div>

      <DialogFooter class="gap-2 sm:gap-0">
        <Button variant="outline" @click="$emit('cancel')">Cancel</Button>
        <Button @click="$emit('confirm')">Confirm</Button>
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
  name: "PenSelectionPopup",
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
    penAngles: { type: Array, default: () => [0, 25, 30, 50, 80] },
    selectedAngle: { type: Number, default: null },
    testPath: { type: Array, default: () => [] },
    penWidth: { type: Number, default: 3 },
    penHeight: { type: Number, default: 6 },
  },
  emits: ['select', 'test-start', 'test-move', 'test-end', 'confirm', 'cancel'],
  methods: {
    formatPoints(points) {
      return points.map(({ x, y }) => `${x},${y}`).join(" ");
    },
    handleOpenChange(open) {
      if (!open) {
        this.$emit('cancel');
      }
    },
  },
};
</script>

<style scoped>
.pen-options {
  display: flex;
  justify-content: space-between;
  gap: 0.5rem;
}

.pen-option {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem;
  border: 2px solid hsl(var(--border));
  border-radius: var(--radius-md);
  background: hsl(var(--muted));
  cursor: pointer;
  transition: all 0.2s ease;
}

.pen-option:hover {
  border-color: hsl(var(--primary) / 0.5);
  background: hsl(var(--primary) / 0.05);
}

.pen-option.selected {
  border-color: hsl(var(--primary));
  box-shadow: 0 0 0 2px hsl(var(--primary) / 0.2);
  background: hsl(var(--primary) / 0.1);
}

.pen-preview {
  width: 40px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.pen-angle-text {
  font-size: var(--text-xs);
  color: hsl(var(--foreground));
}

.test-area {
  width: 100%;
  height: 100px;
  border: 1px solid hsl(var(--border));
  border-radius: var(--radius-md);
  background: hsl(var(--background));
  position: relative;
  cursor: crosshair;
}

.test-svg {
  width: 100%;
  height: 100%;
  pointer-events: none;
}
</style>
