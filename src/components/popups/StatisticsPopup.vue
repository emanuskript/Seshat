<template>
  <Dialog :open="visible" @update:open="handleOpenChange">
    <DialogContent class="sm:max-w-3xl">
      <DialogHeader>
        <DialogTitle>{{ summary?.title || 'Statistics' }}</DialogTitle>
        <DialogDescription>
          {{ summary ? 'Current page statistics across annotations, comments, bands, and measurements.' : 'Measurement statistics for horizontal and vertical lengths.' }}
        </DialogDescription>
      </DialogHeader>

      <div class="space-y-6 py-4">
        <div v-if="summary" class="space-y-4">
          <div class="summary-grid">
            <div v-for="item in summary.counts" :key="item.label" class="summary-card">
              <div class="summary-label">{{ item.label }}</div>
              <div class="summary-value">{{ item.value }}</div>
            </div>
          </div>

          <div>
            <h4 class="section-title">Measurements</h4>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead class="text-right">Count</TableHead>
                  <TableHead class="text-right">Mean</TableHead>
                  <TableHead class="text-right">Total</TableHead>
                  <TableHead class="text-right">Min</TableHead>
                  <TableHead class="text-right">Max</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow v-for="row in summary.measurements" :key="row.label">
                  <TableCell class="font-medium">{{ row.label }}</TableCell>
                  <TableCell class="text-right">{{ row.count }}</TableCell>
                  <TableCell class="text-right">{{ formatMeasurement(row.mean, row.unit) }}</TableCell>
                  <TableCell class="text-right">{{ formatMeasurement(row.total, row.unit) }}</TableCell>
                  <TableCell class="text-right">{{ formatMeasurement(row.min, row.unit) }}</TableCell>
                  <TableCell class="text-right">{{ formatMeasurement(row.max, row.unit) }}</TableCell>
                </TableRow>
                <TableRow v-if="!summary.measurements.length">
                  <TableCell colspan="6" class="text-center text-muted-foreground">
                    No measurable annotations on this page
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </div>

        <!-- Horizontal Lengths -->
        <div v-if="hasHorizontalData || !summary">
          <h4 class="section-title">Horizontal Lengths</h4>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Measurement</TableHead>
                <TableHead class="text-right">Average</TableHead>
                <TableHead class="text-right">Std Dev</TableHead>
                <TableHead class="text-right">Mode</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow v-for="(stats, type) in horizontal" :key="type">
                <TableCell class="font-medium">{{ formatType(type) }}</TableCell>
                <TableCell class="text-right">{{ stats.average.toFixed(2) }}</TableCell>
                <TableCell class="text-right">{{ stats.standardDeviation.toFixed(2) }}</TableCell>
                <TableCell class="text-right">
                  {{ typeof stats.mode === "number" ? stats.mode.toFixed(2) : stats.mode }}
                </TableCell>
              </TableRow>
              <TableRow v-if="!hasHorizontalData">
                <TableCell colspan="4" class="text-center text-muted-foreground">
                  No horizontal measurements yet
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>

        <!-- Vertical Lengths -->
        <div v-if="hasVerticalData || !summary">
          <h4 class="section-title">Vertical Lengths</h4>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Measurement</TableHead>
                <TableHead class="text-right">Average</TableHead>
                <TableHead class="text-right">Std Dev</TableHead>
                <TableHead class="text-right">Mode</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow v-for="(stats, type) in vertical" :key="type">
                <TableCell class="font-medium">{{ formatType(type) }}</TableCell>
                <TableCell class="text-right">{{ stats.average.toFixed(2) }}</TableCell>
                <TableCell class="text-right">{{ stats.standardDeviation.toFixed(2) }}</TableCell>
                <TableCell class="text-right">
                  {{ typeof stats.mode === "number" ? stats.mode.toFixed(2) : stats.mode }}
                </TableCell>
              </TableRow>
              <TableRow v-if="!hasVerticalData">
                <TableCell colspan="4" class="text-center text-muted-foreground">
                  No vertical measurements yet
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
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
  name: "StatisticsPopup",
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
    horizontal: { type: Object, default: () => ({}) },
    vertical: { type: Object, default: () => ({}) },
    summary: { type: Object, default: null },
  },
  emits: ['close'],
  computed: {
    hasHorizontalData() {
      return Object.keys(this.horizontal || {}).length > 0;
    },
    hasVerticalData() {
      return Object.keys(this.vertical || {}).length > 0;
    },
  },
  methods: {
    formatType(type) {
      const map = {
        ascenders: "Ascenders",
        descenders: "Descenders",
        interlinear: "Interlinear",
        upperMargin: "Upper Margin",
        lowerMargin: "Lower Margin",
        lineHeight: "Line Height",
        minimumHeight: "Minim",
        internalMargin: "Internal Margin",
        intercolumnSpaces: "Intercolumn Spaces",
      };
      return map[type] || type;
    },
    formatMeasurement(value, unit = '') {
      if (value == null || value === '') return '—';
      const number = Number(value);
      if (!Number.isFinite(number)) return String(value);
      return `${number.toFixed(2)}${unit ? ` ${unit}` : ''}`;
    },
    handleOpenChange(open) {
      if (!open) {
        this.$emit('close');
      }
    },
  },
};
</script>

<style scoped>
.section-title {
  font-size: var(--text-sm);
  font-weight: 600;
  color: hsl(var(--foreground));
  margin-bottom: 0.5rem;
}

.summary-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: 0.75rem;
}

.summary-card {
  border: 1px solid hsl(var(--border));
  border-radius: 0.5rem;
  background: hsl(var(--muted) / 0.45);
  padding: 0.75rem;
}

.summary-label {
  color: hsl(var(--muted-foreground));
  font-size: 0.75rem;
}

.summary-value {
  color: hsl(var(--foreground));
  font-size: 1.25rem;
  font-weight: 700;
  line-height: 1.4;
}
</style>
