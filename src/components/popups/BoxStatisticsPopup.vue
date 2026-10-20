<script setup>
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

defineProps({
  visible: { type: Boolean, default: false },
  rows: { type: Array, default: () => [] },
  scope: { type: String, default: 'page' },
})

const emit = defineEmits(['close', 'update:scope', 'export-csv'])

function decimal(value, digits = 3) {
  const number = Number(value)
  return Number.isFinite(number) ? number.toFixed(digits) : '—'
}

function percent(value) {
  const number = Number(value)
  return Number.isFinite(number) ? `${(number * 100).toFixed(2)}%` : '—'
}
</script>

<template>
  <Dialog :open="visible" @update:open="open => { if (!open) emit('close') }">
    <DialogContent class="w-[calc(100vw-48px)] max-w-5xl max-h-[calc(100vh-80px)] overflow-hidden flex flex-col">
      <DialogHeader>
        <DialogTitle>Crop & Count statistics</DialogTitle>
        <DialogDescription>
          Each box has equal weight. Aspect ratio is width divided by height; ink density is the percentage of sampled pixels classified as ink.
        </DialogDescription>
      </DialogHeader>

      <div class="stats-controls">
        <div class="scope-switch" role="group" aria-label="Statistics scope">
          <button :class="{ active: scope === 'page' }" @click="emit('update:scope', 'page')">Current page</button>
          <button :class="{ active: scope === 'doc' }" @click="emit('update:scope', 'doc')">Entire document</button>
        </div>
        <Button variant="outline" size="sm" :disabled="!rows.length" @click="emit('export-csv')">
          <Icon name="download" :size="14" class="mr-2" /> Export box data CSV
        </Button>
      </div>

      <div class="stats-table-wrap">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Class</TableHead>
              <TableHead class="text-right">Count</TableHead>
              <TableHead class="text-right">Mean W/H</TableHead>
              <TableHead class="text-right">Median W/H</TableHead>
              <TableHead class="text-right">W/H σ</TableHead>
              <TableHead class="text-right">Mean ink</TableHead>
              <TableHead class="text-right">Median ink</TableHead>
              <TableHead class="text-right">Ink σ</TableHead>
              <TableHead class="text-right">Ink range</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow v-for="row in rows" :key="row.label">
              <TableCell class="font-medium">{{ row.label }}</TableCell>
              <TableCell class="text-right">{{ row.count }}</TableCell>
              <TableCell class="text-right">{{ decimal(row.aspectRatio.mean) }}</TableCell>
              <TableCell class="text-right">{{ decimal(row.aspectRatio.median) }}</TableCell>
              <TableCell class="text-right">{{ decimal(row.aspectRatio.stdDev) }}</TableCell>
              <TableCell class="text-right">{{ percent(row.inkDensity.mean) }}</TableCell>
              <TableCell class="text-right">{{ percent(row.inkDensity.median) }}</TableCell>
              <TableCell class="text-right">{{ percent(row.inkDensity.stdDev) }}</TableCell>
              <TableCell class="text-right">{{ percent(row.inkDensity.min) }}–{{ percent(row.inkDensity.max) }}</TableCell>
            </TableRow>
            <TableRow v-if="!rows.length">
              <TableCell colspan="9" class="py-8 text-center text-muted-foreground">No Crop & Count boxes in this scope.</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>

      <DialogFooter><Button @click="emit('close')">Close</Button></DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<style scoped>
.stats-controls { display: flex; justify-content: space-between; align-items: center; gap: 1rem; }
.scope-switch { display: inline-flex; padding: 0.2rem; border-radius: 0.5rem; background: hsl(var(--muted)); }
.scope-switch button { border: 0; border-radius: 0.375rem; background: transparent; color: hsl(var(--muted-foreground)); padding: 0.4rem 0.7rem; font-size: 0.8rem; }
.scope-switch button.active { background: hsl(var(--background)); color: hsl(var(--foreground)); box-shadow: var(--shadow-sm); }
.stats-table-wrap { overflow: auto; border: 1px solid hsl(var(--border)); border-radius: 0.625rem; }
</style>
