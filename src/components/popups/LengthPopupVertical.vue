<template>
  <Dialog :open="visible" @update:open="handleOpenChange">
    <DialogContent class="sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>Select Vertical Measurement Type</DialogTitle>
        <DialogDescription>
          Choose the vertical manuscript feature represented by the band.
        </DialogDescription>
      </DialogHeader>

      <div class="py-4">
        <RadioGroup v-model="selected" orientation="horizontal" class="options-grid">
          <div
            v-for="opt in options"
            :key="opt"
            class="type-option"
            :class="{ selected: selected === opt }"
            @click="selected = opt"
          >
            <RadioGroupItem :value="opt" :id="`vert-${opt}`" class="sr-only" />
            <span class="swatch" :style="{ backgroundColor: colorFor(opt) }" />
            <span class="option-label">{{ label(opt) }}</span>
          </div>
        </RadioGroup>
      </div>

      <DialogFooter class="gap-2 sm:gap-0">
        <Button variant="outline" @click="$emit('cancel')">Cancel</Button>
        <Button @click="$emit('confirm', selected)">Confirm</Button>
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
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'

export default {
  name: "LengthPopupVertical",
  components: {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    Button,
    RadioGroup,
    RadioGroupItem,
  },
  props: {
    visible: { type: Boolean, default: false },
    measurementColors: {
      type: Object,
      required: true,
      default: () => ({}),
    },
    initialSelection: {
      type: String,
      default: "internalMargin",
    },
  },
  emits: ['confirm', 'cancel'],
  data() {
    return {
      options: ["internalMargin", "intercolumnSpaces", "externalMargin"],
      selected: this.initialSelection || "internalMargin",
    };
  },
  watch: {
    initialSelection(v) {
      if (v && this.options.includes(v)) this.selected = v;
    },
  },
  methods: {
    colorFor(k) {
      return this.measurementColors?.[k] || "hsl(var(--muted-foreground) / 0.3)";
    },
    label(k) {
      const map = {
        internalMargin: "Internal Margin",
        intercolumnSpaces: "Intercolumn Spaces",
        externalMargin: "External Margin",
      };
      return map[k] || k;
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
.options-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 1rem;
}

.type-option {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  padding: 1rem;
  border: 2px solid hsl(var(--border));
  border-radius: var(--radius-lg);
  background: hsl(var(--muted));
  cursor: pointer;
  transition: all 0.2s ease;
}

.type-option:hover {
  border-color: hsl(var(--primary) / 0.5);
  background: hsl(var(--primary) / 0.05);
}

.type-option.selected {
  border-color: hsl(var(--primary));
  box-shadow: 0 0 0 2px hsl(var(--primary) / 0.2);
  background: hsl(var(--primary) / 0.1);
}

.swatch {
  width: 3.5rem;
  height: 3.5rem;
  border-radius: var(--radius-md);
  border: 2px solid hsl(var(--foreground) / 0.12);
}

.option-label {
  font-size: var(--text-sm);
  color: hsl(var(--foreground));
  text-align: center;
}
</style>
