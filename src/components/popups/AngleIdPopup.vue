<template>
  <Dialog :open="visible" @update:open="handleOpenChange">
    <DialogContent class="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>Assign Classification / ID</DialogTitle>
        <DialogDescription>
          This ID helps group and reference specific angles in statistics.
        </DialogDescription>
      </DialogHeader>

      <div class="py-4">
        <Input
          ref="inputRef"
          v-model="value"
          type="text"
          placeholder="e.g., A1, C-Angle-07, unique code"
          @keyup.enter="handleConfirm"
        />
      </div>

      <DialogFooter class="gap-2 sm:gap-0">
        <Button variant="outline" @click="$emit('cancel')">Skip</Button>
        <Button @click="handleConfirm">Save</Button>
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

export default {
  name: "AngleIdPopup",
  components: {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    Button,
    Input,
  },
  props: {
    visible: { type: Boolean, default: false },
    initialValue: { type: String, default: "" },
  },
  emits: ['confirm', 'cancel'],
  data() {
    return { value: this.initialValue || "" };
  },
  watch: {
    initialValue(v) {
      this.value = v || "";
    },
    visible(v) {
      if (v) {
        this.$nextTick(() => {
          this.$refs.inputRef?.$el?.focus();
        });
      }
    },
  },
  methods: {
    handleConfirm() {
      this.$emit('confirm', this.value || '');
    },
    handleOpenChange(open) {
      if (!open) {
        this.$emit('cancel');
      }
    },
  },
};
</script>
