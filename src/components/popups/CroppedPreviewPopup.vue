<template>
  <Dialog :open="!!croppedImage" @update:open="handleOpenChange">
    <DialogContent class="sm:max-w-4xl">
      <DialogHeader>
        <DialogTitle>Cropped Image</DialogTitle>
        <DialogDescription>
          Preview your cropped image and save in your preferred format.
        </DialogDescription>
      </DialogHeader>

      <div class="py-4">
        <div
          class="cropped-image-container"
          ref="croppedContainer"
          @mousedown="$emit('start-annotation', $event)"
          @mousemove="$emit('move-annotation', $event)"
          @mouseup="$emit('end-annotation')"
          @mouseleave="$emit('end-annotation')"
        >
          <img
            :src="croppedImage"
            alt="Cropped"
            class="cropped-image"
            draggable="false"
          />

          <!-- Default slot for annotation overlays -->
          <slot></slot>
        </div>
      </div>

      <DialogFooter class="flex-wrap gap-2">
        <Button variant="outline" @click="$emit('save-png')">Save as PNG</Button>
        <Button variant="outline" @click="$emit('save-svg')">Save as SVG</Button>
        <Button variant="outline" @click="$emit('save-annotated')">Save with Annotations</Button>
        <Button @click="$emit('close')">Close</Button>
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

export default {
  name: "CroppedPreviewPopup",
  components: {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    Button,
  },
  props: {
    croppedImage: { type: String, default: null },
  },
  emits: ['start-annotation', 'move-annotation', 'end-annotation', 'save-png', 'save-svg', 'save-annotated', 'close'],
  methods: {
    handleOpenChange(open) {
      if (!open) {
        this.$emit('close');
      }
    },
  },
};
</script>

<style scoped>
.cropped-image-container {
  position: relative;
  display: flex;
  justify-content: center;
  width: 100%;
  border-radius: var(--radius-md);
  overflow: hidden;
  background: hsl(var(--muted));
}

.cropped-image {
  display: block;
  max-width: 100%;
  height: auto;
}
</style>
