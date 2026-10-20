<script setup>
import { ref, inject } from 'vue'
import seshatLogo from '@/assets/logo.png'
import { Button } from '@/components/ui/button'
import Icon from '@/components/ui/icon/Icon.vue'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel
} from '@/components/ui/dropdown-menu'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from '@/components/ui/tooltip'
import { useTheme } from '@/composables/useTheme'
import { useSession } from '@/composables/useSession'
import ParticipantsList from '@/components/collaboration/ParticipantsList.vue'
import FollowIndicator from '@/components/collaboration/FollowIndicator.vue'

// Get restartTour function from TourProvider
const restartTour = inject('restartTour', () => {})

// Session composable for collaboration state
const { sessionId, isConnected } = useSession()

defineProps({
  documentName: { type: String, default: 'IIIF Document' },
  leftCollapsed: { type: Boolean, default: false },
  rightCollapsed: { type: Boolean, default: false },
  sessionActive: { type: Boolean, default: false },
  pdfExporting: { type: Boolean, default: false }
})

const emit = defineEmits([
  'toggle-left',
  'toggle-right',
  'save',
  'export-pdf-all',
  'go-home',
  'clear-highlights',
  'clear-underlines',
  'clear-comments',
  'clear-traces',
  'clear-angles',
  'clear-distances',
  'clear-box-measurements',
  'clear-horizontal',
  'clear-vertical',
  'clear-all',
  'start-session',
  'open-share',
  'open-history',
  'export-json',
  'export-tei',
  'export-text',
  'export-w3c',
  'export-box-csv',
  'import-json',
  'add-images'
])

const { currentTheme, setTheme, themes } = useTheme()

// Explicit dropdown state for debugging
const themeDropdownOpen = ref(false)
const clearDropdownOpen = ref(false)
const saveDropdownOpen = ref(false)

const themeConfig = {
  light: { icon: 'sun', label: 'Light' },
  dark: { icon: 'moon', label: 'Dark' },
  'high-contrast': { icon: 'contrast', label: 'High Contrast' }
}

function handleThemeSelect(theme) {
  setTheme(theme)
  themeDropdownOpen.value = false
}

function handleAnnotatedPdfExport() {
  emit('save')
  saveDropdownOpen.value = false
}

function handleFullPdfExport() {
  emit('export-pdf-all')
  saveDropdownOpen.value = false
}
</script>

<template>
  <TooltipProvider :delay-duration="300">
    <div class="flex items-center justify-between h-full px-3 bg-card border-b border-border">
      <!-- Left: Toggle + Logo + Doc Name -->
      <div class="flex items-center gap-3">
        <Tooltip>
          <TooltipTrigger as-child>
            <Button variant="ghost" size="icon" class="h-8 w-8" aria-label="Toggle toolbar" @click="emit('toggle-left')">
              <Icon name="panel-left" :size="18" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Toggle toolbar</TooltipContent>
        </Tooltip>

        <div class="brand-lockup" @click="emit('go-home')">
          <span class="topbar-logo-frame" aria-hidden="true">
            <img :src="seshatLogo" alt="" class="topbar-logo" />
          </span>
          <span class="text-base font-semibold text-foreground truncate max-w-[240px]">
            {{ documentName }}
          </span>
        </div>
      </div>

      <!-- Center: Participants + Follow Indicator (when in session) -->
      <div class="flex items-center gap-4">
        <ParticipantsList v-if="sessionActive || isConnected" />
        <FollowIndicator v-if="sessionActive || isConnected" />
      </div>

      <!-- Right: Actions -->
      <div class="flex items-center gap-1">
        <!-- Session Controls: Start Session OR Share + History -->
        <template v-if="sessionActive || sessionId">
          <!-- Share -->
          <Tooltip>
            <TooltipTrigger as-child>
              <Button variant="ghost" size="icon" class="h-8 w-8" aria-label="Share session" @click="emit('open-share')">
                <Icon name="share-2" :size="18" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Share Session</TooltipContent>
          </Tooltip>

          <!-- Version History -->
          <Tooltip>
            <TooltipTrigger as-child>
              <Button
                variant="ghost"
                size="icon"
                class="h-8 w-8"
                aria-label="Version history"
                @click="emit('open-history')"
              >
                <Icon name="history" :size="18" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Version History</TooltipContent>
          </Tooltip>
        </template>

        <!-- Start Session (when no active session) -->
        <Tooltip v-else>
          <TooltipTrigger as-child>
            <Button variant="ghost" size="sm" class="h-8 gap-1.5" @click="emit('start-session')">
              <Icon name="users" :size="16" />
              <span class="text-xs">Start Session</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Start a collaboration session</TooltipContent>
        </Tooltip>

        <!-- Divider -->
        <div class="w-px h-6 bg-border mx-1" />

        <!-- Save/Export Dropdown -->
        <DropdownMenu v-model:open="saveDropdownOpen">
          <DropdownMenuTrigger as-child>
            <Button variant="ghost" size="icon" class="h-8 w-8" aria-label="Save & Export" title="Save & Export" data-tour="save-button">
              <Icon name="save" :size="18" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" class="w-64">
            <DropdownMenuLabel>Export</DropdownMenuLabel>
            <DropdownMenuItem
              :disabled="pdfExporting"
              @select="handleAnnotatedPdfExport"
            >
              <Icon name="file-down" :size="16" class="mr-2" />
              Annotated pages PDF
              <span class="ml-auto text-xs text-muted-foreground">Annotated only</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              :disabled="pdfExporting"
              @select="handleFullPdfExport"
            >
              <Icon name="files" :size="16" class="mr-2" />
              Full document PDF
              <span class="ml-auto text-xs text-muted-foreground">All pages</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem @click="emit('export-json'); saveDropdownOpen = false">
              <Icon name="braces" :size="16" class="mr-2" />
              Export as JSON
              <span class="ml-auto text-xs text-muted-foreground">Seshat</span>
            </DropdownMenuItem>
            <DropdownMenuItem @click="emit('export-tei'); saveDropdownOpen = false">
              <Icon name="code" :size="16" class="mr-2" />
              Export as TEI XML
              <span class="ml-auto text-xs text-muted-foreground">Scholarly</span>
            </DropdownMenuItem>
            <DropdownMenuItem @click="emit('export-text'); saveDropdownOpen = false">
              <Icon name="file-text" :size="16" class="mr-2" />
              Export as Plain Text
            </DropdownMenuItem>
            <DropdownMenuItem @click="emit('export-w3c'); saveDropdownOpen = false">
              <Icon name="globe" :size="16" class="mr-2" />
              Export as Web Annotation
              <span class="ml-auto text-xs text-muted-foreground">W3C/IIIF</span>
            </DropdownMenuItem>
            <DropdownMenuItem @click="emit('export-box-csv'); saveDropdownOpen = false">
              <Icon name="table-properties" :size="16" class="mr-2" />
              Crop & Count data
              <span class="ml-auto text-xs text-muted-foreground">CSV</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Import</DropdownMenuLabel>
            <DropdownMenuItem @click="emit('import-json'); saveDropdownOpen = false">
              <Icon name="upload" :size="16" class="mr-2" />
              Import Annotations
              <span class="ml-auto text-xs text-muted-foreground">JSON</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem @click="emit('add-images'); saveDropdownOpen = false">
              <Icon name="plus" :size="16" class="mr-2" />
              Add More Pages
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <!-- Clear Dropdown -->
        <DropdownMenu v-model:open="clearDropdownOpen">
          <DropdownMenuTrigger as-child>
            <Button variant="ghost" size="icon" class="h-8 w-8" aria-label="Clear annotations" title="Clear annotations">
              <Icon name="trash-2" :size="18" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem @click="emit('clear-highlights'); clearDropdownOpen = false">Clear Highlights</DropdownMenuItem>
            <DropdownMenuItem @click="emit('clear-underlines'); clearDropdownOpen = false">Clear Underlines</DropdownMenuItem>
            <DropdownMenuItem @click="emit('clear-comments'); clearDropdownOpen = false">Clear Comments</DropdownMenuItem>
            <DropdownMenuItem @click="emit('clear-traces'); clearDropdownOpen = false">Clear Traces</DropdownMenuItem>
            <DropdownMenuItem @click="emit('clear-angles'); clearDropdownOpen = false">Clear Angles</DropdownMenuItem>
            <DropdownMenuItem @click="emit('clear-distances'); clearDropdownOpen = false">Clear Distances</DropdownMenuItem>
            <DropdownMenuItem @click="emit('clear-box-measurements'); clearDropdownOpen = false">Clear Crop & Count Boxes</DropdownMenuItem>
            <DropdownMenuItem @click="emit('clear-horizontal'); clearDropdownOpen = false">Clear Horizontal Bands</DropdownMenuItem>
            <DropdownMenuItem @click="emit('clear-vertical'); clearDropdownOpen = false">Clear Vertical Bands</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem class="text-destructive" @click="emit('clear-all'); clearDropdownOpen = false">
              Clear All
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <!-- Theme Dropdown -->
        <DropdownMenu v-model:open="themeDropdownOpen">
          <DropdownMenuTrigger as-child>
            <Button variant="ghost" size="icon" class="h-8 w-8" aria-label="Change theme" title="Theme">
              <Icon :name="themeConfig[currentTheme]?.icon || 'sun'" :size="18" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              v-for="theme in themes"
              :key="theme"
              @click="handleThemeSelect(theme)"
              :class="{ 'bg-primary/10 text-primary font-medium': currentTheme === theme }"
            >
              <Icon :name="themeConfig[theme]?.icon || 'sun'" :size="16" class="mr-2" />
              {{ themeConfig[theme]?.label || theme }}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <!-- Help / Tour -->
        <Tooltip>
          <TooltipTrigger as-child>
            <Button variant="ghost" size="icon" class="h-8 w-8" aria-label="Help & Tour" @click="restartTour">
              <Icon name="help-circle" :size="18" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Help & Tour</TooltipContent>
        </Tooltip>

        <!-- Toggle Right Panel -->
        <Tooltip>
          <TooltipTrigger as-child>
            <Button variant="ghost" size="icon" class="h-8 w-8" aria-label="Toggle panel" @click="emit('toggle-right')">
              <Icon name="panel-right" :size="18" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Toggle panel</TooltipContent>
        </Tooltip>
      </div>
    </div>
  </TooltipProvider>
</template>

<style scoped>
.brand-lockup {
  display: inline-flex;
  align-items: center;
  gap: 0.75rem;
  min-width: 0;
  height: 2.5rem;
  cursor: pointer;
  border-radius: 0.5rem;
  padding: 0 0.375rem 0 0.25rem;
  transition: background-color 0.16s ease, box-shadow 0.16s ease;
}

.brand-lockup:hover {
  background: hsl(var(--accent) / 0.55);
}

.topbar-logo-frame {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.25rem;
  height: 2.25rem;
  flex: 0 0 2.25rem;
  border: 1px solid hsl(var(--border) / 0.55);
  border-radius: 0.5rem;
  background:
    radial-gradient(circle at 50% 42%, rgba(249, 115, 22, 0.16), transparent 68%),
    hsl(var(--background) / 0.42);
}

.topbar-logo {
  display: block;
  width: auto;
  height: 1.9rem;
  max-width: 1.7rem;
  object-fit: contain;
  transition: filter 0.2s ease, transform 0.16s ease;
}

.brand-lockup:hover .topbar-logo {
  transform: scale(1.04);
}

.dark .topbar-logo {
  filter: brightness(1.16) saturate(1.08) drop-shadow(0 0 5px rgba(249, 115, 22, 0.2));
}

.high-contrast .topbar-logo {
  filter: contrast(1.25) brightness(1.12);
}
</style>
