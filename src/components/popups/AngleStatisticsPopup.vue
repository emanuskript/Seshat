<template>
  <Dialog :open="visible" @update:open="handleOpenChange">
    <DialogContent class="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>Angle Statistics</DialogTitle>
        <DialogDescription>
          Statistical summary of your angle measurements.
        </DialogDescription>
      </DialogHeader>

      <div class="py-4">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Average</TableHead>
              <TableHead>Std Dev</TableHead>
              <TableHead>Mode</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell class="text-center">{{ fmt(stats.average) }}</TableCell>
              <TableCell class="text-center">{{ fmt(stats.standardDeviation) }}</TableCell>
              <TableCell class="text-center">
                {{ typeof stats.mode === "number" ? fmt(stats.mode) : (stats.mode || "No mode") }}
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>

      <DialogFooter>
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

export default {
  name: "AngleStatisticsPopup",
  components: {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    Button,
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
  },
  props: {
    visible: { type: Boolean, default: false },
    stats: {
      type: Object,
      default: () => ({ average: 0, standardDeviation: 0, mode: "No mode" }),
    },
  },
  emits: ['close'],
  methods: {
    fmt(v) {
      const n = Number(v);
      return Number.isFinite(n) ? n.toFixed(2) : "0.00";
    },
    handleOpenChange(open) {
      if (!open) {
        this.$emit('close');
      }
    },
  },
};
</script>
