<template>
  <Dialog :open="visible" @update:open="handleOpenChange">
    <DialogContent class="sm:max-w-2xl z-[60]" overlay-class="z-[60]">
      <DialogHeader>
        <DialogTitle>{{ title }}</DialogTitle>
        <DialogDescription>
          Choose an existing statistics class or create a new class for this measurement.
        </DialogDescription>
      </DialogHeader>

      <div class="space-y-4 py-4">
        <!-- Existing Labels -->
        <div v-if="labels && labels.length">
          <Label class="text-sm font-semibold mb-2 block">{{ existingLabel }}</Label>
          <RadioGroup v-model="selected" orientation="horizontal" class="flex flex-wrap gap-3">
            <div
              v-for="l in labels"
              :key="l"
              class="label-option"
              :class="{ selected: selected === l }"
              @click="selected = l"
            >
              <RadioGroupItem :value="l" :id="`label-${l}`" class="sr-only" />
              <div class="swatch" />
              <span class="text-sm">{{ l }}</span>
            </div>
          </RadioGroup>
        </div>

        <!-- Create New Label -->
        <div>
          <Label class="text-sm font-semibold mb-2 block">{{ createLabel }}</Label>
          <div class="flex gap-2">
            <Input
              v-model="newLabel"
              type="text"
              :placeholder="placeholder"
              class="flex-1"
              @keyup.enter="confirmNew"
            />
            <Button @click="confirmNew">Create & Use</Button>
          </div>
        </div>
      </div>

      <DialogFooter class="gap-2 sm:gap-0">
        <Button variant="outline" @click="$emit('cancel')">Cancel</Button>
        <Button :disabled="!selected" @click="$emit('confirm', selected)">Use Selected</Button>
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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'

export default {
  name: "AngleLabelPopup",
  components: {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    Button,
    Input,
    Label,
    RadioGroup,
    RadioGroupItem,
  },
  props: {
    visible: { type: Boolean, default: false },
    labels: { type: Array, default: () => [] },
    initialLabel: { type: String, default: "" },
    title: { type: String, default: "Choose Angle Label" },
    existingLabel: { type: String, default: "Existing Labels" },
    createLabel: { type: String, default: "Create New Label" },
    placeholder: { type: String, default: "e.g., Main Hand, Corrector A, Line-end flourish" },
  },
  emits: ['confirm', 'cancel'],
  data() {
    return {
      selected: this.initialLabel || "",
      newLabel: "",
    };
  },
  watch: {
    visible(v) {
      if (v) this.$nextTick(() => this.focusFirst());
    },
    initialLabel(v) {
      this.selected = v || "";
    },
  },
  methods: {
    confirmNew() {
      if (!this.newLabel) return;
      this.$emit("confirm", this.newLabel);
      this.newLabel = "";
    },
    focusFirst() {
      // Use document.querySelector since Dialog uses a portal and $el may not be a real element
      this.$nextTick(() => {
        const el = document.querySelector('[role="dialog"] input');
        if (el) el.focus();
      });
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
.label-option {
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
  min-width: 100px;
}

.label-option:hover {
  border-color: hsl(var(--primary) / 0.5);
  background: hsl(var(--primary) / 0.05);
}

.label-option.selected {
  border-color: hsl(var(--primary));
  border-width: 2px;
  box-shadow: 0 0 0 2px hsl(var(--primary) / 0.2);
  background: hsl(var(--primary) / 0.1);
}

.swatch {
  width: 2.5rem;
  height: 2.5rem;
  border-radius: var(--radius-md);
  background: hsl(var(--muted-foreground) / 0.2);
  border: 1px solid hsl(var(--border));
}
</style>
