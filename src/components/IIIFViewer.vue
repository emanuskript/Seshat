<!-- /src/components/IIIFViewer.vue -->
<!-- Main IIIF viewer component with CSS Grid layout -->
<template>
  <div
    class="grid h-screen w-screen bg-background overflow-hidden"
    :class="{
      'grid-cols-[0_1fr_280px]': leftPanelCollapsed && !rightPanelCollapsed,
      'grid-cols-[48px_1fr_0]': !leftPanelCollapsed && rightPanelCollapsed,
      'grid-cols-[0_1fr_0]': leftPanelCollapsed && rightPanelCollapsed,
      'grid-cols-[48px_1fr_280px]': !leftPanelCollapsed && !rightPanelCollapsed
    }"
    style="grid-template-rows: 48px 1fr 40px; grid-template-areas: 'topbar topbar topbar' 'left canvas right' 'bottom bottom bottom';"
  >
    <!-- Top Bar -->
    <header style="grid-area: topbar;" class="relative z-50">
      <ViewerTopBar
        :document-name="documentName"
        :left-collapsed="leftPanelCollapsed"
        :right-collapsed="rightPanelCollapsed"
        :session-active="sessionActive"
        :pdf-exporting="isExportingPdf"
        @toggle-left="leftPanelCollapsed = !leftPanelCollapsed"
        @toggle-right="rightPanelCollapsed = !rightPanelCollapsed"
        @save="saveAnnotations"
        @export-pdf-all="saveAnnotations('all')"
        @go-home="goHome"
        @clear-highlights="clearHighlights"
        @clear-underlines="clearUnderlines"
        @clear-comments="clearComments"
        @clear-traces="clearTraces"
        @clear-angles="clearAngles"
        @clear-distances="clearDistances"
        @clear-box-measurements="clearBoxMeasurements"
        @clear-horizontal="clearHorizontalLengths"
        @clear-vertical="clearVerticalLengths"
        @clear-all="showClearConfirmation = true"
        @start-session="showShareDialog = true"
        @open-share="showShareDialog = true"
        @open-history="showVersionHistory = true"
        @export-json="handleExportJson"
        @export-tei="handleExportTei"
        @export-text="handleExportPlainText"
        @export-w3c="handleExportWebAnnotation"
        @export-box-csv="handleExportBoxMeasurementsCsv"
        @import-json="showImportDialog = true"
        @add-images="$refs.addImagesInput.click()"
      />
    </header>

    <!-- Left Toolbar -->
    <aside v-show="!leftPanelCollapsed" style="grid-area: left;" class="min-h-0 overflow-hidden" data-tour="toolbar">
      <ViewerToolbar
        :active-tool="currentActiveTool"
        :has-active-filters="hasActiveFilters"
        :is-operation-in-progress="toolSwitchLocked"
        @select-tool="selectTool"
        @toggle-adjustments="toggleAdjustmentsPanel"
        @open-horizontal="openHorizontalPopup"
        @open-vertical="openVerticalPopup"
        @open-statistics="showStatsPanel = true"
        @start-crop="openCropModeChooser"
      />
    </aside>

    <!-- Main Canvas Area -->
    <main style="grid-area: canvas;" class="relative min-h-0 overflow-hidden bg-muted" data-tour="canvas">
      <!-- Tool message -->
      <div
        v-if="toolMessage"
        class="absolute top-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2 bg-card border border-border rounded-md shadow-lg text-sm"
      >
        {{ toolMessage }}
      </div>

      <label v-if="measureModeActive" class="angle-snap-control">
        <input v-model="angleSnapEnabled" type="checkbox" />
        <span>Snap to axes</span>
        <small>Hold Shift for temporary snap</small>
      </label>

      <div v-if="boxMeasurementModeActive" class="box-measurement-control" role="status">
        <div>
          <strong>Crop & Count: {{ activeBoxMeasurementLabel }}</strong>
          <small>{{ boxMeasurementProcessing ? 'Analyzing original pixels…' : (boxMeasurementThresholdMode === 'manual' ? `Fixed threshold ${boxMeasurementThreshold}` : 'Automatic ink threshold') }}</small>
        </div>
        <button type="button" :disabled="boxMeasurementProcessing" @click="openCropModeChooser">Change</button>
        <button type="button" @click="showBoxStatistics = true">Statistics</button>
        <button type="button" class="primary" :disabled="boxMeasurementProcessing" @click="finishBoxMeasurementMode">Done</button>
      </div>

      <!-- Hidden file input for adding more pages -->
      <input ref="addImagesInput" type="file" accept="image/*,application/pdf"
             multiple style="display:none" @change="handleAddImages" />

      <!-- Image Stage -->
      <div
        class="absolute inset-0"
        ref="viewer"
        :style="{ cursor: stageCursor }"
        @selectstart.prevent.stop
        @dragstart.prevent.stop
        @contextmenu.prevent.stop
        @mousemove="trackCursorForCollaboration($event)"
        ondragstart="return false"
        onselectstart="return false"
        oncontextmenu="return false"
        unselectable="on"
      >
        <!-- OpenSeadragon Container -->
        <div ref="osdContainer" class="absolute inset-0"></div>

        <div
          v-if="iiifLoading || imageLoading"
          class="iiif-status-overlay"
          role="status"
          aria-live="polite"
        >
          <div class="iiif-status-card">
            <span class="iiif-spinner" aria-hidden="true"></span>
            <span>{{ iiifLoading ? 'Loading and validating IIIF manifest…' : 'Loading manuscript page…' }}</span>
          </div>
        </div>

        <div
          v-else-if="iiifError"
          class="iiif-status-overlay"
          role="alert"
          aria-live="assertive"
        >
          <div class="iiif-status-card iiif-error-card">
            <strong>Unable to load IIIF content</strong>
            <p>{{ iiifError }}</p>
            <div class="iiif-error-actions">
              <button type="button" @click="retryCurrentSource">Retry</button>
              <button type="button" class="secondary" @click="goHome">Choose another source</button>
            </div>
          </div>
        </div>

        <!-- Event Intercept Layer - captures events when tools are active -->
        <div
          v-show="isAnyToolActive"
          class="tool-interaction-layer absolute inset-0"
          :class="{ 'cursor-crosshair': isAnyToolActive }"
          @mousedown="startTrace($event)"
          @mousemove="trace($event)"
          @mouseup="endTrace($event)"
          @mouseleave="handleMouseLeave($event)"
          @wheel="preventZoomWhileHighlighting($event)"
          @gesturestart.prevent.stop="preventZoomWhileHighlighting($event)"
          @gesturechange.prevent.stop="preventZoomWhileHighlighting($event)"
          @gestureend.prevent.stop="preventZoomWhileHighlighting($event)"
          @touchstart.prevent="startTrace($event)"
          @touchmove.prevent="trace($event)"
          @touchend.prevent="endTrace($event)"
        ></div>

        <!-- Annotation Overlay - positioned to match OSD viewport -->
        <div
          v-show="osdReady && osdImageWidth > 0"
          class="annotation-overlay"
          :class="{ 'annotation-overlay--passthrough': isAnyToolActive }"
          :style="annotationOverlayStyle"
        >

        <!-- SVG drawing layer -->
        <svg
          v-if="showTraces"
          class="drawing-layer"
          :viewBox="`0 0 ${osdImageWidth || baseFitWidth} ${osdImageHeight || baseFitHeight}`"
          preserveAspectRatio="xMidYMid meet"
        >
          <!-- existing traces (calligraphic paths with variable width) -->
          <g
            v-for="(stroke, index) in currentPageStrokes"
            :key="'stroke-group-' + (stroke.id || index)"
            class="trace-selection-group"
            :class="{
              'is-selected': isSelectedAnnotation('trace', stroke),
              'annotation-flash': isAnnotationFlashing('trace', stroke)
            }"
            :aria-label="getAnnotationBankLabel('trace', stroke, index)"
            @click.stop="selectTraceFromPage(stroke, index)"
            @pointerenter="showAnnotationTooltip('trace', stroke, index, $event)"
            @pointermove="moveAnnotationTooltip($event)"
            @pointerleave="hideAnnotationTooltip"
          >
            <path
              v-if="!isAnyToolActive"
              class="trace-hit-target"
              :d="traceCenterlinePath(stroke.points)"
              fill="none"
              stroke="transparent"
              :stroke-width="Math.max(12, 18 * svgInverseScale)"
            />
            <path
              class="annotation-trace"
              :class="{ 'annotation-interactive': !isAnyToolActive }"
              :d="generateCalligraphicPath(stroke.points, stroke.penWidth, stroke.penHeight, stroke.nibAngle)"
              :fill="stroke.color"
              stroke="none"
            />
          </g>
          <!-- Angle Construction Guides -->
          <g v-if="measureModeActive && angleGuideMousePos">
            <!-- Guide line from first point to cursor -->
            <line
              v-if="measurePoints.length === 1"
              :x1="measurePoints[0].x"
              :y1="measurePoints[0].y"
              :x2="angleGuideMousePos.x"
              :y2="angleGuideMousePos.y"
              stroke="#00D4FF"
              :stroke-width="1 * svgInverseScale"
              :stroke-dasharray="(5*svgInverseScale)+','+(5*svgInverseScale)"
              opacity="0.7"
            />
            
            <!-- Construction lines from vertex after 2nd point placed -->
            <g v-if="measurePoints.length === 2">
              <!-- Solid line to first point -->
              <line
                :x1="measurePoints[1].x"
                :y1="measurePoints[1].y"
                :x2="measurePoints[0].x"
                :y2="measurePoints[0].y"
                stroke="#00D4FF"
                :stroke-width="2 * svgInverseScale"
                opacity="0.8"
              />
              <!-- Dashed line to cursor -->
              <line
                :x1="measurePoints[1].x"
                :y1="measurePoints[1].y"
                :x2="angleGuideMousePos.x"
                :y2="angleGuideMousePos.y"
                stroke="#00D4FF"
                :stroke-width="1 * svgInverseScale"
                :stroke-dasharray="(5*svgInverseScale)+','+(5*svgInverseScale)"
                opacity="0.7"
              />
              <!-- Arc preview -->
              <path
                :d="getAngleArcPath(measurePoints[1], measurePoints[0], angleGuideMousePos)"
                fill="none"
                stroke="#00ff87"
                :stroke-width="2 * svgInverseScale"
                opacity="0.8"
              />
              <!-- Live angle display -->
              <text
                :x="measurePoints[1].x + 15 * svgInverseScale"
                :y="measurePoints[1].y - 15 * svgInverseScale"
                :font-size="16 * svgInverseScale"
                font-weight="bold"
                fill="#00ff87"
                stroke="#000"
                :stroke-width="0.5 * svgInverseScale"
                paint-order="stroke"
                pointer-events="none"
              >
                {{ calculateLiveAngle(measurePoints[0], measurePoints[1], angleGuideMousePos) }}°
              </text>
            </g>
          </g>
          
          <!-- Horizontal/Vertical Snap Guide -->
          <line
            v-if="angleSnapGuide && angleSnapGuide.type === 'horizontal'"
            :x1="0"
            :y1="angleSnapGuide.y"
            :x2="currentImageWidth"
            :y2="angleSnapGuide.y"
            stroke="#FFD700"
            stroke-width="2"
            stroke-dasharray="10,5"
            opacity="0.9"
          />
          <line
            v-if="angleSnapGuide && angleSnapGuide.type === 'vertical'"
            :x1="angleSnapGuide.x"
            :y1="0"
            :x2="angleSnapGuide.x"
            :y2="currentImageHeight"
            stroke="#FFD700"
            stroke-width="2"
            stroke-dasharray="10,5"
            opacity="0.9"
          />
          
          <!-- measure points (temp) with numbered labels -->
          <g v-for="(point, index) in measurePoints" :key="'measure-point-' + index">
            <circle
              :cx="point.x"
              :cy="point.y"
              :r="6 * svgInverseScale"
              fill="#FF4444"
              stroke="#FFF"
              :stroke-width="2 * svgInverseScale"
            />
            <text
              :x="point.x"
              :y="point.y + 5 * svgInverseScale"
              :font-size="10 * svgInverseScale"
              font-weight="bold"
              fill="#FFF"
              text-anchor="middle"
            >
              {{ index + 1 }}
            </text>
          </g>
          <!-- Distance construction guide -->
          <g v-if="distanceModeActive && distancePoints.length === 1 && distanceGuideMousePos">
            <line
              :x1="distancePoints[0].x"
              :y1="distancePoints[0].y"
              :x2="distanceGuideMousePos.x"
              :y2="distanceGuideMousePos.y"
              stroke="#7c3aed"
              :stroke-width="2 * svgInverseScale"
              opacity="0.9"
            />
            <line
              v-if="distanceAxisGuide"
              :x1="distanceAxisGuide.x1"
              :y1="distanceAxisGuide.y1"
              :x2="distanceAxisGuide.x2"
              :y2="distanceAxisGuide.y2"
              stroke="#FFD700"
              :stroke-width="1.5 * svgInverseScale"
              :stroke-dasharray="(8*svgInverseScale)+','+(5*svgInverseScale)"
              opacity="0.9"
            />
            <text
              :x="(distancePoints[0].x + distanceGuideMousePos.x) / 2 + 10 * svgInverseScale"
              :y="(distancePoints[0].y + distanceGuideMousePos.y) / 2 - 10 * svgInverseScale"
              :font-size="14 * svgInverseScale"
              font-weight="bold"
              fill="#a855f7"
              stroke="#000"
              :stroke-width="0.5 * svgInverseScale"
              paint-order="stroke"
              pointer-events="none"
            >
              {{ formatDistanceBetween(distancePoints[0], distanceGuideMousePos, currentPage) }}
            </text>
          </g>

          <!-- distance points (temp) with numbered labels -->
          <g v-for="(point, index) in distancePoints" :key="'distance-point-' + index">
            <circle
              :cx="point.x"
              :cy="point.y"
              :r="6 * svgInverseScale"
              fill="#7c3aed"
              stroke="#FFF"
              :stroke-width="2 * svgInverseScale"
            />
            <text
              :x="point.x"
              :y="point.y + 5 * svgInverseScale"
              :font-size="10 * svgInverseScale"
              font-weight="bold"
              fill="#FFF"
              text-anchor="middle"
            >
              {{ index + 1 }}
            </text>
          </g>
          <!-- saved angles -->
          <g
            v-for="(annotation, index) in currentPageAngles"
            :key="'angle-' + index"
            class="saved-angle-group"
            :class="{
              'is-keyboard-selected': isAngleSelectedForKeyboardMove(annotation),
              'annotation-flash': isAnnotationFlashing('angle', annotation)
            }"
            @click.stop="selectAngleForKeyboardMove(annotation)"
            @contextmenu.prevent.stop="openAngleContextMenu(annotation, $event)"
            :aria-label="getAnnotationBankLabel('angle', annotation, index)"
            @pointerenter="showAnnotationTooltip('angle', annotation, index, $event)"
            @pointermove="moveAnnotationTooltip($event)"
            @pointerleave="hideAnnotationTooltip"
          >
            <line
              v-if="!isAnyToolActive && annotation.type === 'measure' && annotation.points.length >= 2"
              class="angle-hit-target"
              :x1="annotation.points[0].x"
              :y1="annotation.points[0].y"
              :x2="annotation.points[1].x"
              :y2="annotation.points[1].y"
              stroke="transparent"
              :stroke-width="12 * svgInverseScale"
            />
            <line
              v-if="!isAnyToolActive && annotation.type === 'measure' && annotation.points.length === 3"
              class="angle-hit-target"
              :x1="annotation.points[1].x"
              :y1="annotation.points[1].y"
              :x2="annotation.points[2].x"
              :y2="annotation.points[2].y"
              stroke="transparent"
              :stroke-width="12 * svgInverseScale"
            />
            <line
              v-if="annotation.type === 'measure' && annotation.points.length >= 2"
              class="angle-line"
              :x1="annotation.points[0].x"
              :y1="annotation.points[0].y"
              :x2="annotation.points[1].x"
              :y2="annotation.points[1].y"
              stroke="blue"
              :stroke-width="2 * svgInverseScale"
            />
            <line
              v-if="annotation.type === 'measure' && annotation.points.length === 3"
              class="angle-line"
              :x1="annotation.points[1].x"
              :y1="annotation.points[1].y"
              :x2="annotation.points[2].x"
              :y2="annotation.points[2].y"
              stroke="blue"
              :stroke-width="2 * svgInverseScale"
            />
            <!-- angle label moved to HTML overlay for drag support -->
          </g>
          <!-- saved distances -->
          <g
            v-for="(annotation, index) in currentPageDistances"
            :key="'distance-' + (annotation.id || index)"
            class="saved-distance-group"
            :class="{
              'is-selected': isSelectedAnnotation('distance', annotation),
              'annotation-flash': isAnnotationFlashing('distance', annotation)
            }"
            @click.stop="selectDistanceFromPage(annotation, index)"
            :aria-label="getAnnotationBankLabel('distance', annotation, index)"
            @pointerenter="showAnnotationTooltip('distance', annotation, index, $event)"
            @pointermove="moveAnnotationTooltip($event)"
            @pointerleave="hideAnnotationTooltip"
          >
            <line
              v-if="!isAnyToolActive && annotation.points && annotation.points.length >= 2"
              class="distance-hit-target"
              :x1="annotation.points[0].x"
              :y1="annotation.points[0].y"
              :x2="annotation.points[1].x"
              :y2="annotation.points[1].y"
              stroke="transparent"
              :stroke-width="12 * svgInverseScale"
            />
            <line
              v-if="annotation.points && annotation.points.length >= 2"
              class="distance-line"
              :x1="annotation.points[0].x"
              :y1="annotation.points[0].y"
              :x2="annotation.points[1].x"
              :y2="annotation.points[1].y"
              stroke="#7c3aed"
              :stroke-width="2.5 * svgInverseScale"
            />
            <circle
              v-for="(point, pointIndex) in (annotation.points || []).slice(0, 2)"
              :key="'distance-endpoint-' + (annotation.id || index) + '-' + pointIndex"
              :cx="point.x"
              :cy="point.y"
              :r="4 * svgInverseScale"
              fill="#7c3aed"
              stroke="#fff"
              :stroke-width="1.5 * svgInverseScale"
            />
          </g>
          <!-- dynamic freehand trace (calligraphic path) -->
          <path
            v-if="currentStroke && currentStroke.points.length > 1"
            :d="generateCalligraphicPath(currentStroke.points, currentStroke.penWidth, currentStroke.penHeight, currentStroke.nibAngle)"
            :fill="currentStroke.color"
            stroke="none"
          />
        </svg>

        <!-- Dynamic Crop / Length rectangles - use percentage positioning -->
        <div
          v-if="(isMeasuring && currentSquare) || (croppingStarted && currentSquare)"
          class="length-measurement"
          :style="{
            left: `${(currentSquare.x / osdImageWidth) * 100}%`,
            top: `${(currentSquare.y / osdImageHeight) * 100}%`,
            width: `${(currentSquare.width / osdImageWidth) * 100}%`,
            height: `${(currentSquare.height / osdImageHeight) * 100}%`,
            backgroundColor: measurementColorFor(currentSquare),
            border: `2px solid ${measurementBorderFor(currentSquare)}`,
            position: 'absolute',
          }"
        >
          <div
            v-if="isMeasuring"
            class="length-label draggable-label"
            :style="{
              left: (labelPositions['dynamic']?.x ?? 15) + 'px',
              top: (labelPositions['dynamic']?.y ?? 15) + 'px',
              position: 'absolute',
              cursor: draggedLabelIndex === 'dynamic' ? 'grabbing' : 'grab',
              zIndex: 400,
              userSelect: 'none',
              pointerEvents: 'none',
            }"
          >
            {{ camelToTitle(currentSquare.label) }}:
            {{
              formatMeasurement(
                isHorizontalLabel(currentSquare.label) ? currentSquare.height : currentSquare.width,
                isHorizontalLabel(currentSquare.label) ? 'y' : 'x'
              )
            }}
          </div>
        </div>

        <!-- Crop & Count live box -->
        <div
          v-if="boxMeasurementModeActive && currentBoxMeasurement"
          class="box-measurement box-measurement--live"
          :style="boxMeasurementStyle(currentBoxMeasurement)"
        >
          <span>{{ activeBoxMeasurementLabel }}</span>
        </div>

        <!-- Crop & Count saved boxes -->
        <div
          v-for="(box, index) in currentPageBoxMeasurements"
          :key="'box-measurement-' + (box.id || index)"
          class="box-measurement"
          :class="{
            'annotation-interactive': !isAnyToolActive,
            'is-selected': isSelectedAnnotation('boxMeasurement', box),
            'annotation-flash': isAnnotationFlashing('boxMeasurement', box)
          }"
          :style="boxMeasurementStyle(box)"
          :title="getAnnotationBankLabel('boxMeasurement', box, index)"
          @click.stop="selectBoxMeasurementFromPage(box, index)"
          @pointerenter="showAnnotationTooltip('boxMeasurement', box, index, $event)"
          @pointermove="moveAnnotationTooltip($event)"
          @pointerleave="hideAnnotationTooltip"
        >
          <span>{{ boxMeasurementOverlayLabel(box) }}</span>
          <button
            v-for="corner in boxResizeCorners"
            v-show="isSelectedAnnotation('boxMeasurement', box) && !isAnyToolActive"
            :key="corner"
            type="button"
            class="box-resize-handle"
            :class="`box-resize-handle--${corner}`"
            :aria-label="`Resize ${corner} corner`"
            @pointerdown.stop.prevent="startBoxMeasurementResize(box, corner, $event)"
          />
        </div>

        <!-- Finalized Lengths - use percentage positioning -->
        <div
          v-for="(measurement, index) in currentPageLengthMeasurements"
          :key="'length-' + index"
          class="length-measurement"
          :class="{
            'annotation-interactive': !isAnyToolActive,
            'band-selected': isBandSelectedForResize(measurement),
            'annotation-flash': isAnnotationFlashing('length', measurement)
          }"
          :style="{
            left: `${(measurement.x / osdImageWidth) * 100}%`,
            top: `${(measurement.y / osdImageHeight) * 100}%`,
            width: `${(measurement.width / osdImageWidth) * 100}%`,
            height: `${(measurement.height / osdImageHeight) * 100}%`,
            backgroundColor: measurementColorFor(measurement),
            border: `2px solid ${measurementBorderFor(measurement)}`,
            position: 'absolute',
          }"
          :title="getAnnotationBankLabel('length', measurement, index)"
          @pointerenter="showAnnotationTooltip('length', measurement, index, $event)"
          @pointermove="moveAnnotationTooltip($event)"
          @pointerleave="hideAnnotationTooltip"
          @pointerdown.stop="selectBandForResize(measurement)"
          @click.stop="selectBandForResize(measurement)"
        >
          <div
            class="length-label draggable-label"
            :style="{
              left: (labelPositions[measurement.id]?.x ?? 15) + 'px',
              top: (labelPositions[measurement.id]?.y ?? 15) + 'px',
              position: 'absolute',
              cursor: draggedLabelIndex === measurement.id ? 'grabbing' : 'grab',
              zIndex: 400,
              userSelect: 'none',
              pointerEvents: isAnyToolActive ? 'none' : 'auto',
            }"
            @mousedown.stop="startLabelDrag(measurement.id, $event)"
          >
            {{ camelToTitle(measurement.label) }}:
            {{
              formatMeasurement(
                isHorizontalLabel(measurement.label) ? measurement.height : measurement.width,
                isHorizontalLabel(measurement.label) ? 'y' : 'x'
              )
            }}
          </div>

          <template v-if="isBandSelectedForResize(measurement) && !isAnyToolActive">
            <button
              v-for="corner in bandResizeCorners"
              :key="corner"
              type="button"
              class="band-resize-handle"
              :class="`band-resize-handle--${corner}`"
              :aria-label="`Resize ${camelToTitle(measurement.label)} from ${corner} corner`"
              @pointerdown.stop.prevent="startBandResize(measurement, corner, $event)"
            />
          </template>
        </div>

        <!-- Draggable angle labels -->
        <div
          v-for="annotation in currentPageAngles.filter(a => a.type === 'measure' && a.points.length === 3)"
          :key="'angle-label-' + annotation.id"
          :style="{
            left: `${(annotation.points[1].x / osdImageWidth) * 100}%`,
            top: `${(annotation.points[1].y / osdImageHeight) * 100}%`,
            position: 'absolute',
            width: 0,
            height: 0,
            overflow: 'visible',
          }"
        >
          <div
            class="angle-label draggable-label"
            :class="{
              'is-keyboard-selected': isAngleSelectedForKeyboardMove(annotation),
              'annotation-flash': isAnnotationFlashing('angle', annotation)
            }"
            :style="{
              left: (angleLabelPositions[annotation.id]?.x ?? 10) + 'px',
              top: (angleLabelPositions[annotation.id]?.y ?? -30) + 'px',
              position: 'absolute',
              cursor: draggedLabelIndex === annotation.id ? 'grabbing' : 'grab',
              zIndex: 400,
              userSelect: 'none',
              pointerEvents: isAnyToolActive ? 'none' : 'auto',
            }"
            @mousedown.stop="startAngleLabelDrag(annotation.id, $event)"
            @click.stop="selectAngleForKeyboardMove(annotation)"
            @contextmenu.prevent.stop="openAngleContextMenu(annotation, $event)"
            :title="getAnnotationBankLabel('angle', annotation, currentPageAngles.indexOf(annotation))"
            @pointerenter="showAnnotationTooltip('angle', annotation, currentPageAngles.indexOf(annotation), $event)"
            @pointermove="moveAnnotationTooltip($event)"
            @pointerleave="hideAnnotationTooltip"
          >
            {{ annotation.angle }}°{{ annotation.label ? ' • ' + annotation.label : '' }}
          </div>
        </div>

        <!-- Draggable distance labels -->
        <div
          v-for="annotation in currentPageDistances.filter(a => a.points && a.points.length >= 2)"
          :key="'distance-label-' + annotation.id"
          :style="{
            left: `${(distanceMidpoint(annotation).x / osdImageWidth) * 100}%`,
            top: `${(distanceMidpoint(annotation).y / osdImageHeight) * 100}%`,
            position: 'absolute',
            width: 0,
            height: 0,
            overflow: 'visible',
          }"
        >
          <div
            class="distance-label draggable-label"
            :class="{
              'is-selected': isSelectedAnnotation('distance', annotation),
              'annotation-flash': isAnnotationFlashing('distance', annotation)
            }"
            :style="{
              left: (distanceLabelPositions[annotation.id]?.x ?? 10) + 'px',
              top: (distanceLabelPositions[annotation.id]?.y ?? -30) + 'px',
              position: 'absolute',
              cursor: draggedLabelIndex === annotation.id ? 'grabbing' : 'grab',
              zIndex: 400,
              userSelect: 'none',
              pointerEvents: isAnyToolActive ? 'none' : 'auto',
            }"
            @mousedown.stop="startDistanceLabelDrag(annotation.id, $event)"
            @click.stop="selectDistanceFromPage(annotation, currentPageDistances.indexOf(annotation))"
            :title="getAnnotationBankLabel('distance', annotation, currentPageDistances.indexOf(annotation))"
            @pointerenter="showAnnotationTooltip('distance', annotation, currentPageDistances.indexOf(annotation), $event)"
            @pointermove="moveAnnotationTooltip($event)"
            @pointerleave="hideAnnotationTooltip"
          >
            {{ formatDistanceAnnotation(annotation, annotation.pageIndex ?? currentPage) }}{{ annotation.label ? ' • ' + annotation.label : '' }}
          </div>
        </div>

        <!-- Dynamic Underline - use percentage positioning -->
        <div
          v-if="underlineModeActive && currentUnderline"
          class="underline-line"
          :style="{
            position: 'absolute',
            left: `${(currentUnderline.x / osdImageWidth) * 100}%`,
            top: `${(currentUnderline.y / osdImageHeight) * 100}%`,
            width: `${(currentUnderline.width / osdImageWidth) * 100}%`,
            height: '2px',
            backgroundColor: 'blue',
          }"
        ></div>

        <!-- Saved Underlines - use percentage positioning -->
        <div
          v-for="(annotation, index) in currentPageUnderlines"
          :key="'underline-' + index"
          class="underline-line"
          :class="{
            'is-selected': isSelectedAnnotation('underline', annotation),
            'annotation-interactive': !isAnyToolActive,
            'annotation-flash': isAnnotationFlashing('underline', annotation)
          }"
          :style="{
            position: 'absolute',
            left: `${(annotation.x / osdImageWidth) * 100}%`,
            top: `${(annotation.y / osdImageHeight) * 100}%`,
            width: `${(annotation.width / osdImageWidth) * 100}%`,
            height: '2px',
            backgroundColor: 'red',
          }"
          :title="getAnnotationBankLabel('underline', annotation, index)"
          @click.stop="selectRectAnnotationFromPage('underline', annotation, index)"
          @pointerenter="showAnnotationTooltip('underline', annotation, index, $event)"
          @pointermove="moveAnnotationTooltip($event)"
          @pointerleave="hideAnnotationTooltip"
        ></div>

        <!-- Cropping rectangle - use percentage positioning -->
        <div
          v-if="croppingStarted && currentSquare"
          class="cropping-rectangle"
          :style="{
            left: `${(currentSquare.x / osdImageWidth) * 100}%`,
            top: `${(currentSquare.y / osdImageHeight) * 100}%`,
            width: `${(currentSquare.width / osdImageWidth) * 100}%`,
            height: `${(currentSquare.height / osdImageHeight) * 100}%`,
            position: 'absolute',
          }"
        ></div>
        </div>

        <!-- Dynamic highlight is rendered independently from the shared overlay box -->
        <div
          v-if="highlightModeActive && currentSquare"
          class="highlight-rectangle"
          :style="getViewerRectStyle(currentSquare)"
        ></div>

        <!-- Each highlight is mapped directly from image coordinates to screen pixels -->
        <div
          v-for="(annotation, index) in currentPageHighlights"
          :key="'highlight-screen-' + (annotation.id || index)"
          class="highlight-rectangle"
          :class="{
            'is-selected': isSelectedAnnotation('highlight', annotation),
            'annotation-interactive': !isAnyToolActive,
            'annotation-flash': isAnnotationFlashing('highlight', annotation)
          }"
          :style="getViewerRectStyle(annotation)"
          :title="getAnnotationBankLabel('highlight', annotation, index)"
          @click.stop="selectRectAnnotationFromPage('highlight', annotation, index)"
          @pointerenter="showAnnotationTooltip('highlight', annotation, index, $event)"
          @pointermove="moveAnnotationTooltip($event)"
          @pointerleave="hideAnnotationTooltip"
        ></div>

      </div>

      <div
        v-if="annotationHoverTooltip.visible"
        class="annotation-hover-tooltip"
        :style="{
          left: `${annotationHoverTooltip.x}px`,
          top: `${annotationHoverTooltip.y}px`
        }"
        role="tooltip"
      >
        {{ annotationHoverTooltip.label }}
      </div>

      <!-- Floating Scribe Detection Button -->
      <div
        class="absolute bottom-4 right-4 z-40 cursor-pointer hover:scale-110 transition-transform"
        data-tour="scribe-button"
        @click="openScribeDetection"
      >
        <img
          :src="require('@/assets/pharosight_icon_no_text.png')"
          alt="PharoSight"
          class="h-10 w-10 rounded-full shadow-lg"
        />
      </div>
    </main>

    <!-- Right Panel -->
    <aside v-show="!rightPanelCollapsed" style="grid-area: right;" class="min-h-0 overflow-hidden" data-tour="right-panel">
      <ViewerRightPanel
        :annotations="currentPageAnnotationsList"
        :current-page="currentPage"
        :total-pages="totalPages"
        :zoom-level="zoomLevel"
        :show-in-cm="showMeasurementsInCm"
        :selected-annotation="selectedAnnotationItem"
        :angle-labels="angleLabels"
        :distance-labels="distanceLabels"
        :box-measurement-labels="boxMeasurementStatisticsLabels"
        @select-annotation="handleSelectAnnotation"
        @delete-annotation="handleDeleteAnnotation"
        @rename-annotation="renameAnnotation"
        @reclassify-annotation="reclassifyAnnotation"
        @generate-page-summary="calculateWholePageStatistics"
        @generate-bands-page="calculateCurrentPage"
        @generate-bands-doc="calculateEntireDocument"
        @generate-angles="openAnglesFilterFromStats"
        @generate-distances="openDistancesFilterFromStats"
        @generate-box-measurements="showBoxStatistics = true"
        @inspect-box-measurement="openBoxMeasurementInspector"
      />
    </aside>

    <!-- Bottom Bar -->
    <footer style="grid-area: bottom;" data-tour="bottom-bar">
      <ViewerBottomBar
        :current-page="currentPage"
        :total-pages="totalPages"
        :zoom-level="zoomLevel"
        :min-zoom="minZoom"
        :max-zoom="maxZoom"
        :show-in-cm="showMeasurementsInCm"
        :image-ready="imageReady"
        @prev-page="prevPage"
        @next-page="nextPage"
        @go-to-page="goToPage"
        @zoom-in="zoomIn"
        @zoom-out="zoomOut"
        @zoom-to="zoomTo"
        @reset-zoom="resetZoom"
        @toggle-units="toggleMeasurementUnits"
        @start-hold-reset="startHoldReset"
        @cancel-hold-reset="cancelHoldReset"
      />
    </footer>

    <CropModeDialog
      :open="showCropModeDialog"
      :labels="boxMeasurementLabels"
      :initial-label="activeBoxMeasurementLabel"
      @update:open="showCropModeDialog = $event"
      @crop-segment="startCrop"
      @start-count="startBoxMeasurementMode"
    />

    <BoxStatisticsPopup
      :visible="showBoxStatistics"
      :rows="boxStatisticsRows"
      :scope="boxStatisticsScope"
      @close="showBoxStatistics = false"
      @update:scope="boxStatisticsScope = $event"
      @export-csv="handleExportBoxMeasurementsCsv"
    />

    <BoxMeasurementInspector
      :visible="showBoxInspector"
      :annotation="boxInspectorAnnotation"
      :original-preview="boxInspectorOriginalPreview"
      :mask-preview="boxInspectorMaskPreview"
      :processing="boxInspectorProcessing"
      @close="closeBoxMeasurementInspector"
      @apply-threshold="applyBoxInspectorThreshold"
      @use-automatic="applyBoxInspectorAutomaticThreshold"
    />

    <!-- Angle Label Picker Popup -->
    <!-- Angle Label Popup -->
    <AngleLabelPopup
      v-if="showAngleLabelPopup"
      :visible="showAngleLabelPopup"
      :labels="angleLabels"
      :initial-label="activeAngleLabel"
      @confirm="onAngleLabelConfirm"
      @cancel="cancelAngleLabel"
    />

    <AngleLabelPopup
      v-if="showDistanceLabelPopup"
      :visible="showDistanceLabelPopup"
      :labels="distanceLabels"
      :initial-label="activeDistanceLabel"
      title="Choose Distance Label"
      placeholder="e.g., t height, stroke thickness, crossbar width"
      @confirm="onDistanceLabelConfirm"
      @cancel="cancelDistanceLabel"
    />

    <!-- Angle Statistics Filter Popup -->
    <div v-if="showAngleFilterPopup" class="length-popup" @click.self="showAngleFilterPopup = false">
      <div class="length-popup-content">
        <h3>Angle Measurements</h3>
        <div class="row">
          <label>Scope:</label>
          <div class="label-grid">
            <button class="grid-btn" :class="{active: angleScope==='page'}" @click="angleScope='page'">Current Page</button>
            <button class="grid-btn" :class="{active: angleScope==='doc'}" @click="angleScope='doc'">Entire Document</button>
          </div>
        </div>
        <div class="row">
          <label>Class:</label>
          <div class="label-grid">
            <button class="grid-btn" :class="{active: angleFilterLabel==='__ALL__'}" @click="angleFilterLabel='__ALL__'">All classes</button>
            <button
              v-for="label in angleStatisticsLabels"
              :key="'f-'+label"
              class="grid-btn"
              :class="{active: angleFilterLabel===label}"
              @click="angleFilterLabel=label"
            >
              {{ label }}
            </button>
          </div>
        </div>

        <div class="popup-actions">
          <button class="grid-btn" @click="runAngleStatistics">Generate</button>
          <button class="grid-btn" @click="showAngleFilterPopup=false">Cancel</button>
        </div>
      </div>
    </div>

    <!-- Distance Statistics Filter Popup -->
    <div v-if="showDistanceFilterPopup" class="length-popup" @click.self="showDistanceFilterPopup = false">
      <div class="length-popup-content">
        <h3>Distance Measurements</h3>
        <div class="row">
          <label>Scope:</label>
          <div class="label-grid">
            <button class="grid-btn" :class="{active: distanceScope==='page'}" @click="distanceScope='page'">Current Page</button>
            <button class="grid-btn" :class="{active: distanceScope==='doc'}" @click="distanceScope='doc'">Entire Document</button>
          </div>
        </div>
        <div class="row">
          <label>Class:</label>
          <div class="label-grid">
            <button class="grid-btn" :class="{active: distanceFilterLabel==='__ALL__'}" @click="distanceFilterLabel='__ALL__'">All classes</button>
            <button
              v-for="label in distanceStatisticsLabels"
              :key="'df-'+label"
              class="grid-btn"
              :class="{active: distanceFilterLabel===label}"
              @click="distanceFilterLabel=label"
            >
              {{ label }}
            </button>
          </div>
        </div>

        <div class="popup-actions">
          <button class="grid-btn" @click="runDistanceStatistics">Generate</button>
          <button class="grid-btn" @click="showDistanceFilterPopup=false">Cancel</button>
        </div>
      </div>
    </div>

    <!-- Trace Pen Popup -->
    <TracePopup
      :visible="showTracePopup"
      :penAngles="penAngles"
      :penSizes="penSizes"
      :selectedAngle="selectedPenAngle"
      :selectedSize="selectedPenSize"
      @update:selectedAngle="selectedPenAngle = $event"
      @update:selectedSize="selectedPenSize = $event"
      @confirm="confirmPenSelection"
      @cancel="cancelPenSelection"
    />

    <!-- Stats quick panel (Lengths + Angles entry) -->
    <div
      v-if="showStatsPanel"
      class="stats-panel"
      @click.self="showStatsPanel = false"
    >
      <div class="panel-card stats-card">
        <h4>Statistics</h4>

        <div class="panel-actions">
          <button class="grid-btn" @click="calculateWholePageStatistics">Current Page Summary</button>
          <button class="grid-btn" @click="calculateCurrentPage">Bands: Current Page</button>
          <button class="grid-btn" @click="calculateEntireDocument">Bands: Entire Document</button>
          <button class="grid-btn" @click="openAnglesFilterFromStats">Angle Measurements…</button>
          <button class="grid-btn" @click="openDistancesFilterFromStats">Distance Measurements…</button>
          <button class="grid-btn" @click="showStatsPanel=false">Close</button>
        </div>
      </div>
    </div>

    <!-- Horizontal Bands Popup -->
    <LengthPopupHorizontal
      :visible="showHorizontalPopup"
      :measurement-colors="measurementColors"
      @confirm="onHorizontalConfirm"
      @cancel="showHorizontalPopup = false"
    />

    <!-- Vertical Bands Popup -->
    <LengthPopupVertical
      :visible="showVerticalPopup"
      :measurement-colors="measurementColors"
      @confirm="onVerticalConfirm"
      @cancel="showVerticalPopup = false"
    />

    <!-- Angle Statistics Result Popup -->
    <div v-if="showAngleStatistics" class="statistics-popup" @click.self="showAngleStatistics = false">
      <div class="statistics-popup-content">
        <h3>Angle Statistics ({{ angleStatistics.count }} {{ angleStatistics.count === 1 ? 'angle' : 'angles' }})</h3>
        <p v-if="angleStatisticsContext" class="angle-stats-context">{{ angleStatisticsContext }}</p>
        <table>
          <thead>
            <tr>
              <th>Mean</th>
              <th>Median</th>
              <th>Std Dev</th>
              <th>Min</th>
              <th>Max</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>{{ formatStat(angleStatistics.mean) }}°</td>
              <td>{{ formatStat(angleStatistics.median) }}°</td>
              <td>{{ formatStat(angleStatistics.stdDev) }}°</td>
              <td>{{ formatStat(angleStatistics.min) }}°</td>
              <td>{{ formatStat(angleStatistics.max) }}°</td>
            </tr>
          </tbody>
        </table>
        <button class="grid-btn" @click="showAngleStatistics = false">Close</button>
      </div>
    </div>

    <!-- Distance Statistics Result Popup -->
    <div v-if="showDistanceStatistics" class="statistics-popup" @click.self="showDistanceStatistics = false">
      <div class="statistics-popup-content">
        <h3>Distance Statistics ({{ distanceStatistics.count }} {{ distanceStatistics.count === 1 ? 'distance' : 'distances' }})</h3>
        <p v-if="distanceStatisticsContext" class="angle-stats-context">{{ distanceStatisticsContext }}</p>
        <p v-if="distanceStatisticsApproximateCount" class="measurement-statistics-warning">
          {{ distanceStatisticsApproximateCount }}
          {{ distanceStatisticsApproximateCount === 1 ? 'measurement uses' : 'measurements use' }}
          the approximate 96-DPI conversion.
        </p>
        <table>
          <thead>
            <tr>
              <th>Mean</th>
              <th>Median</th>
              <th>Std Dev</th>
              <th>Min</th>
              <th>Max</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>{{ formatStat(distanceStatistics.mean) }} {{ distanceStatisticsUnit }}</td>
              <td>{{ formatStat(distanceStatistics.median) }} {{ distanceStatisticsUnit }}</td>
              <td>{{ formatStat(distanceStatistics.stdDev) }} {{ distanceStatisticsUnit }}</td>
              <td>{{ formatStat(distanceStatistics.min) }} {{ distanceStatisticsUnit }}</td>
              <td>{{ formatStat(distanceStatistics.max) }} {{ distanceStatisticsUnit }}</td>
            </tr>
          </tbody>
        </table>
        <button class="grid-btn" @click="showDistanceStatistics = false">Close</button>
      </div>
    </div>

    <!-- Lengths Statistics Result Popup -->
    <StatisticsPopup
      :visible="showStatistics"
      :horizontal="horizontalStatistics"
      :vertical="verticalStatistics"
      :summary="pageStatisticsSummary"
      @close="closeStatisticsPopup"
    />

    <Dialog :open="showMeasurementScalePopup" @update:open="handleMeasurementScalePopupChange">
      <DialogContent class="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Physical dimensions unavailable</DialogTitle>
          <DialogDescription>
            Physical dimensions are not included in the IIIF metadata for this page.
            Centimetre measurements require a scale.
          </DialogDescription>
        </DialogHeader>

        <div v-if="measurementCalibrationMode !== 'dimensions'" class="measurement-scale-options">
          <button type="button" class="measurement-scale-option" @click="measurementCalibrationMode = 'dimensions'">
            <strong>Enter real dimensions</strong>
            <span>Provide the manuscript page width and height in centimetres.</span>
          </button>
          <button type="button" class="measurement-scale-option" @click="useApproximateMeasurementScale">
            <strong>Continue with assumption</strong>
            <span>Use the approximate 96-DPI conversion (37.8 pixels per centimetre).</span>
          </button>
        </div>

        <form v-else class="measurement-calibration-form" @submit.prevent="applyRealDimensionsCalibration">
          <p>Enter the real dimensions for page {{ currentPage + 1 }}.</p>
          <div class="measurement-calibration-grid">
            <label>
              <span>Width (cm)</span>
              <input v-model="calibrationWidthCm" type="number" min="0.01" step="0.01" required />
            </label>
            <label>
              <span>Height (cm)</span>
              <input v-model="calibrationHeightCm" type="number" min="0.01" step="0.01" required />
            </label>
          </div>
          <p v-if="measurementCalibrationError" class="measurement-calibration-error" role="alert">
            {{ measurementCalibrationError }}
          </p>
          <div class="measurement-calibration-actions">
            <Button type="button" variant="outline" @click="measurementCalibrationMode = 'choice'">Back</Button>
            <Button type="submit">Use these dimensions</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>

    <!-- Image Adjustments Panel -->
    <ImageAdjustmentsPanel
      v-if="showAdjustmentsPanel"
      :total-pages="totalPages"
      @close="showAdjustmentsPanel = false"
      @apply-to-all="handleApplyFiltersToAll"
      @filters-changed="onFiltersChanged"
    />

    <!-- Clear Confirmation Popup -->
    <div v-if="showClearConfirmation" class="length-popup" @click.self="showClearConfirmation = false">
      <div class="length-popup-content">
        <h3>Clear All Annotations</h3>
        <p>Are you sure you want to clear all annotations on this page?</p>
        <div class="popup-actions">
          <button class="grid-btn confirm-btn" @click="confirmClearAll">Yes</button>
          <button class="grid-btn cancel-btn" @click="cancelClearAll">No</button>
        </div>
      </div>
    </div>

    <!-- ========= CROPPED IMAGE MODAL (shadcn Dialog) ========= -->
    <Dialog :open="!!croppedImage" @update:open="handleCropDialogChange">
      <DialogContent class="max-w-[1100px] w-[calc(100vw-48px)] max-h-[calc(100vh-96px)] p-4 flex flex-col gap-0 overflow-hidden">
        <DialogHeader class="sr-only">
          <DialogTitle>Cropped Image</DialogTitle>
          <DialogDescription>Annotate and export your cropped selection.</DialogDescription>
        </DialogHeader>

        <!-- Header with controls -->
        <div class="crop-header">
          <div class="zoom-cluster">
            <button class="zoom-pill" :disabled="cropZoom<=1" @click="cropZoomOut">−</button>
            <button class="zoom-pill zoom-pill-reset" :disabled="cropZoom===1 && cropPanX===0 && cropPanY===0" @click="cropResetZoom">Reset</button>
            <button class="zoom-pill" @click="cropZoomIn">+</button>
            <span class="zoom-readout">{{ Math.round(cropZoom*100) }}%</span>
          </div>

          <div class="crop-actions">
            <Button variant="outline" size="sm" @click="croppedBankVisible = !croppedBankVisible">
              {{ croppedBankVisible ? 'Hide' : 'Show' }} Bank
            </Button>
            <Button variant="outline" size="sm" @click="saveCroppedImageAsPNG">Save PNG</Button>
            <Button variant="outline" size="sm" @click="saveCroppedImage">Save w/ Annotations</Button>
            <Button size="sm" @click="closeCroppedPopup">Close</Button>
          </div>
        </div>

        <!-- Mini Toolbar for cropped popup -->
        <div class="crop-toolbar">
          <div class="crop-tool"
               :class="{ active: highlightModeActive }"
               @click="selectTool('highlight')"
               title="Highlight">
            <Highlighter :size="18" />
            <span>Highlight</span>
          </div>

          <div class="crop-tool"
               :class="{ active: underlineModeActive }"
               @click="selectTool('underline')"
               title="Underline">
            <Minus :size="18" />
            <span>Underline</span>
          </div>

          <div class="crop-tool"
               :class="{ active: traceModeActive }"
               @click="selectTool('trace')"
               title="Draw">
            <Pencil :size="18" />
            <span>Draw</span>
          </div>

          <div class="crop-tool"
               :class="{ active: measureModeActive }"
               @click="selectTool('measure')"
               title="Measure Angle">
            <Compass :size="18" />
            <span>Angle</span>
          </div>

          <div class="crop-tool"
               @click="calculateCroppedAngleStatistics"
               title="Angle Statistics">
            <Calculator :size="18" />
            <span>Stats</span>
          </div>

          <div class="crop-tool-divider"></div>

          <div class="crop-tool"
               @click="selectTool('')"
               title="Pan/Zoom">
            <Hand :size="18" />
            <span>Pan</span>
          </div>
        </div>

        <!-- Stage -->
        <div
          class="crop-stage"
          ref="croppedStage"
          :style="{ cursor: croppedStageCursor }"
          @mousedown="cropStageDown"
          @mousemove="cropStageMove"
          @mouseup="cropStageUp"
          @mouseleave="cropStageUp"
          @wheel.prevent="cropStageWheel"
          @selectstart.prevent.stop
          @dragstart.prevent.stop
          @contextmenu.prevent.stop
          @dblclick.prevent.stop
          ondragstart="return false"
          onselectstart="return false"
          oncontextmenu="return false"
          unselectable="on"
        >
          <div class="crop-anchor" :style="croppedAnchorStyle">
            <!-- Base image (fit-to-anchor coordinates) -->
            <img
              :src="croppedImage"
              ref="croppedImg"
              class="cropped-image"
              alt=""
              draggable="false"
              unselectable="on"
              @load="onCroppedImgLoad"
              style="pointer-events: none !important; user-select: none !important;"
              ondragstart="return false"
              onselectstart="return false"
              oncontextmenu="return false"
              onmousedown="return false"
              onmouseup="return false"
              onmousemove="return false"
              onclick="return false"
            />

            <!-- Transparent overlay to capture mouse events -->
            <div class="image-overlay" 
                 style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; z-index: 1; background: transparent; cursor: inherit;"></div>

            <!-- ABS layer (rects/lines) -->
            <div
              v-for="(a, i) in croppedAnnotationsAbs"
              :key="'ca-'+i"
              v-show="a.type==='highlight' || a.type==='underline'"
              :class="a.type==='highlight' ? 'highlight-rectangle' : 'underline-line'"
              :style="a.style"
            ></div>

            <!-- Live rectangles/lines -->
            <div
              v-if="croppedLive.highlight"
              class="highlight-rectangle"
              :style="croppedLive.highlight.style"
            ></div>
            <div
              v-if="croppedLive.underline"
              class="underline-line"
              :style="croppedLive.underline.style"
            ></div>

            <!-- SVG layer (traces & angles) -->
            <svg class="drawing-layer" :width="croppedBaseW" :height="croppedBaseH"
                 style="position:absolute;inset:0;z-index:2;">
              <!-- traces (calligraphic paths) -->
              <path
                v-for="(a, i) in croppedTraces"
                :key="'ct-'+i"
                :d="generateCalligraphicPath(a.points, a.penWidth, a.penHeight, a.nibAngle)"
                :fill="a.color"
                stroke="none"
              />
              <!-- live stroke (calligraphic path) -->
              <path
                v-if="croppedLive.trace && croppedLive.trace.points.length > 1"
                :d="generateCalligraphicPath(croppedLive.trace.points, croppedLive.trace.penWidth, croppedLive.trace.penHeight, croppedLive.trace.nibAngle)"
                :fill="croppedLive.trace.color"
                stroke="none"
              />

              <!-- angles -->
              <g v-for="(a, i) in croppedMeasures" :key="'cm-'+i">
                <line v-if="a.points.length>=2"
                  :x1="a.points[0].x" :y1="a.points[0].y"
                  :x2="a.points[1].x" :y2="a.points[1].y"
                  stroke="blue" stroke-width="2" />
                <line v-if="a.points.length===3"
                  :x1="a.points[1].x" :y1="a.points[1].y"
                  :x2="a.points[2].x" :y2="a.points[2].y"
                  stroke="blue" stroke-width="2" />
                <path v-if="a.points.length===3"
                  :d="getAngleArcPath(a.points[1], a.points[0], a.points[2], 30)"
                  fill="none" stroke="#00ff87" stroke-width="2" opacity="0.8" />
                <text v-if="a.points.length===3"
                  :x="a.points[1].x + 10" :y="a.points[1].y - 10"
                  font-size="16" font-weight="bold"
                  fill="#00ff87" stroke="#000" stroke-width="0.5"
                  paint-order="stroke" pointer-events="none">
                  {{ a.angle }}°{{ a.label ? ' • '+a.label : '' }}
                </text>
              </g>

              <!-- live angle points/lines -->
              <g v-if="croppedLive.measure && croppedLive.measure.points.length">
                <g v-for="(p, idx) in croppedLive.measure.points" :key="'livep-'+idx">
                  <circle :cx="p.x" :cy="p.y" r="6" fill="#FF4444" stroke="#FFF" stroke-width="2" />
                  <text :x="p.x" :y="p.y + 5" font-size="10" font-weight="bold"
                    fill="#FFF" text-anchor="middle">{{ idx + 1 }}</text>
                </g>
                <line v-if="croppedLive.measure.points.length>=2"
                  :x1="croppedLive.measure.points[0].x" :y1="croppedLive.measure.points[0].y"
                  :x2="croppedLive.measure.points[1].x" :y2="croppedLive.measure.points[1].y"
                  stroke="blue" stroke-width="2" />
                <line v-if="croppedLive.measure.points.length===3"
                  :x1="croppedLive.measure.points[1].x" :y1="croppedLive.measure.points[1].y"
                  :x2="croppedLive.measure.points[2].x" :y2="croppedLive.measure.points[2].y"
                  stroke="blue" stroke-width="2" />
                <path v-if="croppedLive.measure.points.length===3"
                  :d="getAngleArcPath(croppedLive.measure.points[1], croppedLive.measure.points[0], croppedLive.measure.points[2], 30)"
                  fill="none" stroke="#00ff87" stroke-width="2" opacity="0.8" />
              </g>
            </svg>
          </div>
        </div>

        <!-- Mini bank (re-uses same UX: multi-select, move, delete) -->
        <AnnotationsBank
          v-show="croppedBankVisible"
          class="mini-bank"
          :page="0"
          :items="croppedBankItems"
          :selectedKeys="croppedBankSelected"
          :multiSelect="croppedBankMulti"
          :moveActive="croppedMoveActive"
          :showInCm="showMeasurementsInCm"
          :pixelsPerCm="pixelsPerCm"
          @update:selected="(keys)=>croppedBankSelected = keys"
          @toggle-multi="croppedBankMulti = !croppedBankMulti"
          @request-move="enableCroppedMove"
          @cancel-move="disableCroppedMove"
          @request-delete="deleteSelectedCropped"
          @toggle-units="toggleMeasurementUnits"
        />
      </DialogContent>
    </Dialog>

    <!-- Scribe Detection Popup -->
    <ScribeDetectionPopup
      ref="scribeDetectionPopup"
      :currentPage="currentPage"
      :totalPages="totalPages"
      :currentPageImage="currentImage"
    />

    <!-- Share Dialog -->
    <ShareDialog
      v-model:open="showShareDialog"
      :iiif-manifest="iiifManifest"
      :document-name="documentName"
      :current-annotations="getAllAnnotations()"
      @session-created="handleSessionCreated"
    />

    <!-- Join Dialog (for shared links) -->
    <JoinDialog
      v-model:open="showJoinDialog"
      :document-name="documentName"
      @join="handleJoinSession"
    />

    <!-- Version History Panel -->
    <VersionHistory
      v-model:open="showVersionHistory"
      @version-restored="handleVersionRestored"
    />

    <!-- Import Annotations Dialog -->
    <ImportAnnotationsDialog
      v-model:open="showImportDialog"
      :has-existing-annotations="hasAnyAnnotations"
      :current-manifest="iiifManifest"
      :current-page-count="images.length"
      @import="handleImportJson"
    />

    <!-- Remote Participant Cursors -->
    <template v-if="sessionConnected && remoteCursorData.length > 0">
      <ParticipantCursor
        v-for="cursor in currentPageCursors"
        :key="cursor.participantId"
        :x="cursorToScreenX(cursor.x)"
        :y="cursorToScreenY(cursor.y)"
        :display-name="cursor.displayName"
        :color="cursor.color"
      />
    </template>

    <div
      v-if="angleContextMenu.visible"
      class="fixed inset-0"
      style="z-index: 9998;"
      @mousedown.stop="closeAngleContextMenu"
      @contextmenu.prevent.stop="closeAngleContextMenu"
    ></div>
    <div
      v-if="angleContextMenu.visible"
      class="angle-context-menu"
      :style="{ left: `${angleContextMenu.x}px`, top: `${angleContextMenu.y}px` }"
      role="menu"
      aria-label="Angle actions"
      @mousedown.stop
      @contextmenu.prevent.stop
    >
      <button
        type="button"
        class="angle-context-menu__item"
        role="menuitem"
        @click.stop="moveAngleFromContextMenu"
      >
        <Move :size="15" />
        Move with arrow keys
      </button>
      <button
        type="button"
        class="angle-context-menu__item angle-context-menu__delete"
        role="menuitem"
        @click.stop="deleteAngleFromContextMenu"
      >
        <Trash2 :size="15" />
        Delete angle
      </button>
    </div>
  </div>
</template>

<script>
/* eslint-disable */
import { PDFDocument } from "pdf-lib";
import AnnotationsBank from "@/components/viewer/AnnotationsBank.vue";
import ScribeDetectionPopup from "@/components/popups/ScribeDetectionPopup.vue";
import AngleLabelPopup from "@/components/popups/AngleLabelPopup.vue";
import LengthPopupHorizontal from "@/components/popups/LengthPopupHorizontal.vue";
import LengthPopupVertical from "@/components/popups/LengthPopupVertical.vue";
import PenSelectionPopup from "@/components/popups/PenSelectionPopup.vue";
import AngleStatsPickerPopup from "@/components/popups/AngleStatsPickerPopup.vue";
import StatisticsPopup from "@/components/popups/StatisticsPopup.vue";
import TracePopup from "@/components/popups/TracePopup.vue";
import CropModeDialog from "@/components/popups/CropModeDialog.vue";
import BoxStatisticsPopup from "@/components/popups/BoxStatisticsPopup.vue";
import BoxMeasurementInspector from "@/components/popups/BoxMeasurementInspector.vue";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useTheme } from "@/composables/useTheme";
import { useImageAdjustments } from "@/composables/useImageAdjustments";
import ImageAdjustmentsPanel from "@/components/viewer/ImageAdjustmentsPanel.vue";
import ViewerTopBar from "@/components/viewer/ViewerTopBar.vue";
import ShareDialog from "@/components/collaboration/ShareDialog.vue";
import JoinDialog from "@/components/collaboration/JoinDialog.vue";
import VersionHistory from "@/components/collaboration/VersionHistory.vue";
import ParticipantCursor from "@/components/collaboration/ParticipantCursor.vue";
import ImportAnnotationsDialog from "@/components/dialogs/ImportAnnotationsDialog.vue";
import {
  exportAsJson,
  exportAsTei,
  exportAsPlainText,
  exportAsWebAnnotation,
  exportBoxMeasurementsAsCsv
} from "@/services/annotationExportService";
import {
  PDF_EXPORT_SCOPE,
  formatPageCount,
  pageHasExportableAnnotations,
  selectPdfExportPages,
} from "@/services/pdfExportUtils.mjs";
import {
  UNLABELED_MEASUREMENT,
  axisGuideCandidate,
  calculateAngleDegrees,
  measurementLabelsEqual,
  normalizeMeasurementLabel,
  pointDistance,
  scaledPointDistance,
  summarizeMeasurements,
  uniqueMeasurementLabels,
} from "@/utils/measurementStatistics.mjs";
import {
  analyzeInkPixels,
  buildInkMaskRgba,
  calculateBoxAspectRatio,
  normalizePixelBounds,
  summarizeBoxMeasurements,
} from "@/utils/inkDensity.mjs";
import { useSession } from "@/composables/useSession";
import { usePresence } from "@/composables/usePresence";
import { useFollow } from "@/composables/useFollow";
import ViewerToolbar from "@/components/viewer/ViewerToolbar.vue";
import ViewerBottomBar from "@/components/viewer/ViewerBottomBar.vue";
import ViewerRightPanel from "@/components/viewer/ViewerRightPanel.vue";
import OpenSeadragon from "openseadragon";
import "openseadragon-filtering";
import {
  buildImageRequestUrl,
  buildRegionRequestUrl,
  extractServiceId,
  fetchImageInfo,
  formatIIIFError,
  loadIIIFSource,
  resolveOpenSeadragonSource,
} from "@/services/iiifService";
import { generateCalligraphicPath, generateCalligraphicPolygon } from "@/utils/math";
import {
  MessageSquare,
  SlidersHorizontal,
  Highlighter,
  Underline,
  Pencil,
  Scissors,
  ChevronUp,
  Ruler,
  RulerDimensionLine,
  Calculator,
  Save,
  Trash2,
  Palette,
  Sun,
  Moon,
  Contrast,
  Minus,
  Compass,
  Hand,
  Move,
} from "lucide-vue-next";

function safeUUID() {
  // RFC4122 v4 using crypto.getRandomValues when available
  const rnd = new Uint8Array(16);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(rnd);
  } else {
    for (let i = 0; i < 16; i++) rnd[i] = Math.floor(Math.random() * 256);
  }

  rnd[6] = (rnd[6] & 0x0f) | 0x40; // version 4
  rnd[8] = (rnd[8] & 0x3f) | 0x80; // variant 10

  const hex = [...rnd].map(b => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}

export default {
  name: "IIIFViewer",
  components: {
    AnnotationsBank,
    ViewerTopBar,
    ViewerToolbar,
    ViewerBottomBar,
    ViewerRightPanel,
    ScribeDetectionPopup,
    ShareDialog,
    JoinDialog,
    VersionHistory,
    ParticipantCursor,
    ImportAnnotationsDialog,
    AngleLabelPopup,
    LengthPopupHorizontal,
    LengthPopupVertical,
    PenSelectionPopup,
    AngleStatsPickerPopup,
    StatisticsPopup,
    TracePopup,
    CropModeDialog,
    BoxStatisticsPopup,
    BoxMeasurementInspector,
    ImageAdjustmentsPanel,
    MessageSquare,
    SlidersHorizontal,
    Highlighter,
    Underline,
    Pencil,
    Scissors,
    ChevronUp,
    Ruler,
    RulerDimensionLine,
    Calculator,
    Save,
    Trash2,
    Palette,
    Sun,
    Moon,
    Contrast,
    Minus,
    Compass,
    Hand,
    Move,
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    Button,
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
  },
  setup() {
    const { currentTheme, setTheme } = useTheme();
    const {
      currentFilters,
      hasActiveFilters,
      setFilter,
      resetFilters,
      getAllFilters,
      replaceAllFilters,
      applyToAllPages,
      setCurrentPage: setAdjustmentPage
    } = useImageAdjustments();

    // Session collaboration
    const {
      sessionId: activeSessionId,
      isConnected: sessionConnected,
      annotations: sessionAnnotations,
      addAnnotation: syncAddAnnotation,
      updateAnnotation: syncUpdateAnnotation,
      deleteAnnotation: syncDeleteAnnotation,
      updateSettings: syncSessionSettings,
      updateAnnotations: syncAllAnnotations,
      joinSession,
      leaveSession,
      onMessage: onSessionMessage,
      localParticipant
    } = useSession();

    // Presence tracking
    const {
      participants,
      otherParticipants,
      cursors: remoteCursorData,
      init: initPresence,
      throttledCursorUpdate
    } = usePresence();

    // Follow mode
    const {
      isFollowing,
      followingId,
      followersCount,
      startFollowing,
      stopFollowing,
      broadcastViewport,
      broadcastViewportImmediate,
      broadcastFilters,
      init: initFollow,
      cleanup: cleanupFollow,
      onViewportSync,
      onFiltersSync,
      isFollowingParticipant,
      getParticipantPage
    } = useFollow();

    return {
      currentTheme,
      setTheme,
      currentFilters,
      hasActiveFilters,
      setFilter,
      resetFilters,
      getAllFilters,
      replaceAllFilters,
      applyToAllPages,
      setAdjustmentPage,
      // Session
      activeSessionId,
      sessionConnected,
      sessionAnnotations,
      syncAddAnnotation,
      syncUpdateAnnotation,
      syncDeleteAnnotation,
      syncSessionSettings,
      syncAllAnnotations,
      joinSession,
      leaveSession,
      onSessionMessage,
      localParticipant,
      // Presence
      participants,
      otherParticipants,
      remoteCursorData,
      initPresence,
      throttledCursorUpdate,
      // Follow mode
      isFollowing,
      followingId,
      followersCount,
      startFollowing,
      stopFollowing,
      broadcastViewport,
      broadcastViewportImmediate,
      broadcastFilters,
      initFollow,
      cleanupFollow,
      onViewportSync,
      onFiltersSync,
      isFollowingParticipant,
      getParticipantPage
    };
  },
  props: {
    source: { type: String, default: '' },
    sessionId: { type: String, default: '' },
  },
  data() {
    return {
      // Layout state
      leftPanelCollapsed: false,
      rightPanelCollapsed: false,
      selectedAnnotationItem: null,
      flashingAnnotation: null,
      annotationHoverTooltip: {
        visible: false,
        label: '',
        x: 0,
        y: 0,
      },
      documentName: 'IIIF Document',

      // Collaboration state
      showShareDialog: false,
      showVersionHistory: false,
      showImportDialog: false,
      showJoinDialog: false,
      pendingSessionId: null,
      sessionActive: false,
      annotationSyncUnsubscribe: null,
      annotationsSnapshotUnsubscribe: null,
      settingsSyncUnsubscribe: null,
      versionRestoredUnsubscribe: null,
      isApplyingSessionSync: false,
      iiifManifest: '',
      iiifPages: [],
      iiifLoading: false,
      imageLoading: false,
      iiifError: '',
      jobId: null,
      remoteCursors: [],
      // Follow mode state
      followSyncUnsubscribers: [],
      isApplyingFollowSync: false,

      annotationsByPage: [],
      // Pen config
      penWidth: 3,
      penHeight: 6,
      // Trace popup & pen options
      showTracePopup: false,
      penAngles: [0, 15, 30, 45, 60, 75],
      penSizes: [
        { key: 'thin',   label: 'Thin'   , w: 2, h: 6 },
        { key: 'medium', label: 'Medium' , w: 3, h: 12 },
        { key: 'broad',  label: 'Broad'  , w: 5, h: 20 },
      ],
      selectedPenAngle: 45,
      selectedPenSize: 'medium',
      currentNibAngle: 45,
      // Toggles / modes
      showTraces: true,
      measureModeActive: false,
      distanceModeActive: false,
      traceModeActive: false,
      commentModeActive: false,
      highlightModeActive: false,
      underlineModeActive: false,
      isMeasuring: false, // length-bands creation
      croppingStarted: false,
      cropButtonClicked: false,
      showCropModeDialog: false,
      boxMeasurementModeActive: false,
      boxMeasurementStart: null,
      currentBoxMeasurement: null,
      activeBoxMeasurementLabel: '',
      boxMeasurementLabels: [],
      boxMeasurementThresholdMode: 'automatic',
      boxMeasurementThreshold: 128,
      boxMeasurementProcessing: false,
      boxResizeState: null,
      boxResizeCorners: ['nw', 'ne', 'se', 'sw'],

      // Measurement units
      showMeasurementsInCm: false,
      pixelsPerCm: 37.8, // Approximate conversion: 96 DPI = 37.8 pixels per cm
      measurementScalesByPage: [],
      showMeasurementScalePopup: false,
      measurementCalibrationMode: 'choice',
      calibrationWidthCm: '',
      calibrationHeightCm: '',
      measurementCalibrationError: '',

      // Bands sticky-mode
      activeBandGroup: null,   // 'horizontal' | 'vertical' | null
      pendingBandGroup: null,  // which popup opened last ('horizontal'|'vertical')

      // Stage state
      images: [],
      currentPage: 0,
      pageInput: 1,
      imageLoaded: false,
      scalingFactor: 1,

      // Drawing state
      startPoint: null,
      currentSquare: null, // for crop / highlight / bands
      currentUnderline: null,
      currentStroke: null,
      strokes: [],
      dynamicTracePath: "",

      // Angles
      measurePoints: [],      // temp points for new angle OR during drag
      draggingPoint: -1,      // index within measurePoints
      editingAnnotationIndex: -1,
      calculatedAngle: 0,
      distancePoints: [],     // temp points for new straight distance measurement
      distanceGuideMousePos: null,
      
      // Angle guides
      angleGuideMousePos: null,  // current mouse position for construction guides
      angleSnapGuide: null,      // { type: 'horizontal'|'vertical', y: number } for snap lines
      angleSnapEnabled: false,   // opt-in; Shift temporarily enables snapping

      // Angle labels
      showAngleLabelPopup: false,
      activeAngleLabel: null,
      angleLabels: [],           // list of strings (persist within session)
      newAngleLabel: "",
      showDistanceLabelPopup: false,
      activeDistanceLabel: null,
      distanceLabels: [],        // list of strings (persist within session)

      // Angle stats filter
      showAngleFilterPopup: false,
      angleScope: "page",        // 'page' | 'doc'
      angleFilterLabel: "__ALL__", // "__ALL__" or a label
      angleStatistics: { count: 0, mean: 0, median: 0, stdDev: 0, min: 0, max: 0, mode: "No mode", angles: [] },
      angleStatisticsContext: "",
      showAngleStatistics: false,

      // Distance stats filter
      showDistanceFilterPopup: false,
      distanceScope: "page",        // 'page' | 'doc'
      distanceFilterLabel: "__ALL__",
      distanceStatistics: { count: 0, mean: 0, median: 0, stdDev: 0, min: 0, max: 0, mode: "No mode", values: [] },
      distanceStatisticsContext: "",
      distanceStatisticsUnit: "px",
      distanceStatisticsApproximateCount: 0,
      showDistanceStatistics: false,

      // Crop & Count statistics and mask inspector
      showBoxStatistics: false,
      boxStatisticsScope: 'page',
      showBoxInspector: false,
      boxInspectorAnnotation: null,
      boxInspectorOriginalPreview: '',
      boxInspectorMaskPreview: '',
      boxInspectorProcessing: false,

      // Bands
      showHorizontalPopup: false,
      showVerticalPopup: false,
      selectedMeasurement: "ascenders",
      lengthMeasurementActive: false,
      measurementColors: {
        ascenders: "rgba(0, 255, 0, 0.5)",
        descenders: "rgba(0, 0, 255, 0.5)",
        interlinear: "rgba(255, 165, 0, 0.5)",
        upperMargin: "rgba(255, 0, 0, 0.5)",
        lowerMargin: "rgba(128, 0, 128, 0.5)",
        internalMargin: "rgba(0, 255, 255, 0.5)",
        intercolumnSpaces: "rgba(255, 0, 255, 0.5)",
        lineHeight: "rgba(100, 100, 255, 0.5)",
        minimumHeight: "rgba(255, 100, 100, 0.5)",
        other_h: "rgba(150, 150, 150, 0.5)",
        other_v: "rgba(200, 150, 100, 0.5)",
        externalMargin: "rgba(0, 128, 128, 0.5)",
      },
      lengthMeasurements: {
        ascenders: {},
        descenders: {},
        interlinear: {},
        upperMargin: {},
        lowerMargin: {},
        internalMargin: {},
        intercolumnSpaces: {},
        lineHeight: {},
        minimumHeight: {},
        other_h: {},
        other_v: {},
        externalMargin: {},
      },
      labelPositions: {}, // for length labels drag
      selectedBandId: null,
      selectedBandRef: null,
      bandResizeState: null,
      bandResizeCorners: ['nw', 'ne', 'se', 'sw'],
      angleLabelPositions: {}, // for angle labels drag
      distanceLabelPositions: {}, // for distance labels drag
      angleContextMenu: {
        visible: false,
        x: 0,
        y: 0,
        annotation: null,
        pageIndex: 0,
      },
      keyboardMovingAngleId: null,
      keyboardMovingAngleRef: null,
      keyboardMovingAnglePageIndex: null,
      draggedLabelIndex: null,
      labelDragOffset: { x: 0, y: 0 },
      _rectMovePersistTimer: null,
      _boxRecalculateTimer: null,

      // Popups and stats
      showStatistics: false,
      horizontalStatistics: {},
      verticalStatistics: {},
      pageStatisticsSummary: null,
      showStatsPanel: false,

      // Cropped popup state
      croppedImage: null,
      croppedStrokes: [],
      croppedHighlights: [],
      croppedUnderlines: [],
      croppedMeasurePoints: [],
      croppedCalculatedAngle: null,
      croppedDraggingPoint: -1,
      croppedCurrentStroke: null,
      croppedCurrentMeasure: null,
      croppedCurrentHighlight: null,
      croppedCurrentUnderline: null,
      croppedStartPoint: null,
      croppedPendingAngle: null,
      croppedEditingAnnotationIndex: -1,
      popupDimensions: { width: 0, height: 0 },

      // Comments
      comments: [],                   // per page (array of arrays)
      currentCommentText: "",
      expandedCommentId: null,
      suppressNextComment: false,

      // UI
      showClearDropdown: false,
      showThemeDropdown: false,
      showAdjustmentsPanel: false,
      showClearConfirmation: false,
      toolMessage: "",
      isExportingPdf: false,

      // Bank
      bankSelectedKeys: [],
      bankMultiSelect: false,
      moveModeActive: false,
      moveStartPos: null,
      currentMoveDelta: { x: 0, y: 0 },
      annotationSequence: 0,

      // OpenSeadragon state
      osdViewer: null,       // OpenSeadragon instance
      osdReady: false,       // Viewer initialized and image loaded
      osdImageWidth: 0,      // Image natural width from OSD
      osdImageHeight: 0,     // Image natural height from OSD
      imageDimensionsByPage: {},
      imageInfoByPage: {},
      osdViewportBounds: null, // For triggering overlay updates
      _overlayUpdatePending: false, // RAF throttle flag for overlay updates
      isOperationInProgress: false, // Lock to prevent tool switching during drawing
      highlightInteractionLocked: false,
      highlightViewportSnapshot: null,
      isApplyingHighlightViewportSnapshot: false,

      // Legacy Zoom & Pan (kept for compatibility, synced from OSD)
      zoomLevel: 1,
      zoomStep: 0.06,
      minZoom: 0.25,
      maxZoom: 12,
      _holdTimer: null,      // for long-press reset
      panX: 0,
      panY: 0,
      isPanning: false,
      baseFitWidth: 0,       // image fitted width at 100% zoom
      baseFitHeight: 0,      // image fitted height at 100% zoom

      // Cropped zoom/pan
      cropZoom: 1,
      cropZoomStep: 0.10,
      cropPanX: 0,
      cropPanY: 0,
      isCropPanning: false,
      _cPanStart: null,
      croppedBaseW: 0,
      croppedBaseH: 0,
      croppedSourceRegion: null,

      // Unified cropped state
      croppedLive: {
        trace: null,
        highlight: null,
        underline: null,
        measure: null
      },
      croppedAnnotations: [],
      croppedBankSelected: [],
      croppedBankMulti: false,
      croppedMoveActive: false,
      croppedBankVisible: true,
    };
  },
  computed: {
    currentMeasurementScale() {
      return this.measurementScalesByPage[this.currentPage] || null;
    },
    currentPixelsPerCmX() {
      const scale = this.currentMeasurementScale;
      if (scale?.pixelsPerCmX) return scale.pixelsPerCmX;
      if (scale?.physicalWidthCm && this.osdImageWidth > 0) {
        return this.osdImageWidth / scale.physicalWidthCm;
      }
      return this.pixelsPerCm;
    },
    currentPixelsPerCmY() {
      const scale = this.currentMeasurementScale;
      if (scale?.pixelsPerCmY) return scale.pixelsPerCmY;
      if (scale?.physicalHeightCm && this.osdImageHeight > 0) {
        return this.osdImageHeight / scale.physicalHeightCm;
      }
      return this.pixelsPerCm;
    },
    anchorStyle() {
      // A fixed box centered in the stage; zoom/pan transform is applied here
      return {
        position: 'absolute',
        left: '50%',
        top: '50%',
        width: `${this.baseFitWidth || 0}px`,
        height: `${this.baseFitHeight || 0}px`,
        transform: `translate(-50%, -50%) translate(${this.panX}px, ${this.panY}px) scale(${this.zoomLevel})`,
        transformOrigin: 'center center',
        zIndex: 100, // below buttons/bank/panels
      };
    },

    zoomedWidth() { return this.baseFitWidth  * (this.zoomLevel || 1); },
    zoomedHeight(){ return this.baseFitHeight * (this.zoomLevel || 1); },

    // Stage cursor: show crosshair for tool modes, let OSD handle default cursor
    stageCursor() {
      // Show crosshair when a tool is active
      if (this.isAnyToolActive) {
        return 'crosshair';
      }
      // Let OSD handle cursor for pan/zoom (default, grab, grabbing)
      return 'default';
    },

    // Returns true if any annotation tool is active (used for event intercept layer)
    isAnyToolActive() {
      return this.traceModeActive || this.highlightModeActive || this.underlineModeActive ||
             this.measureModeActive || this.distanceModeActive || this.isMeasuring || this.moveModeActive ||
             this.lengthMeasurementActive || this.croppingStarted || this.boxMeasurementModeActive || this.commentModeActive;
    },

    toolSwitchLocked() {
      if (!this.isOperationInProgress) return false;
      return !!this.currentStroke ||
             !!this.moveStartPos ||
             !!this.boxResizeState ||
             this.draggingPoint !== -1 ||
             (!!this.startPoint && (
               !!this.currentSquare ||
               !!this.currentUnderline ||
               this.lengthMeasurementActive ||
               this.croppingStarted
             )) || (!!this.boxMeasurementStart && !!this.currentBoxMeasurement);
    },

    // Active tool for toolbar highlighting
    currentActiveTool() {
      if (this.traceModeActive) return 'trace';
      if (this.highlightModeActive) return 'highlight';
      if (this.underlineModeActive) return 'underline';
      if (this.commentModeActive) return 'comment';
      if (this.measureModeActive) return 'measure';
      if (this.distanceModeActive) return 'distance';
      if (this.lengthMeasurementActive || this.isMeasuring) {
        const label = this.selectedMeasurement || '';
        const isHorizontal = ['ascenders', 'descenders', 'interlinear', 'upperMargin', 'lowerMargin', 'lineHeight', 'minimumHeight', 'other_h'].includes(label);
        return isHorizontal ? 'horizontal' : 'vertical';
      }
      if (this.croppingStarted || this.boxMeasurementModeActive) return 'crop';
      return '';
    },

    // All annotations for right panel
    currentPageAnnotationsList() {
      const list = [];
      let fallbackOrder = 0;
      const typeIndexes = { highlight: 0, underline: 0, trace: 0, angle: 0, distance: 0, boxMeasurement: 0 };
      const addItem = (item, annotation) => {
        list.push({
          ...item,
          _chronology: this.annotationChronology(annotation),
          _fallbackOrder: fallbackOrder++,
        });
      };

      // annotationsByPage already preserves insertion order. Keep that order here
      // instead of rebuilding the bank in type-specific groups.
      (this.annotationsByPage[this.currentPage] || []).forEach(annotation => {
        const bankType = annotation.type === 'measure' ? 'angle' : annotation.type;
        if (!Object.prototype.hasOwnProperty.call(typeIndexes, bankType)) return;
        const index = typeIndexes[bankType]++;
        addItem({
          type: bankType,
          label: this.getAnnotationBankLabel(bankType, annotation, index),
          data: annotation,
          index,
        }, annotation);
      });

      (this.currentPageComments || []).forEach((comment, index) => {
        addItem({
          type: 'comment',
          label: this.getAnnotationBankLabel('comment', comment, index),
          data: comment,
          index,
        }, comment);
      });

      // Length measurements
      if (this.currentPageLengthMeasurements) {
        this.currentPageLengthMeasurements.forEach((m) => {
          const isHorizontal = ['ascenders', 'descenders', 'interlinear', 'upperMargin', 'lowerMargin', 'lineHeight', 'minimumHeight', 'other_h'].includes(m.label);
          addItem({
            type: isHorizontal ? 'length-h' : 'length-v',
            label: this.getAnnotationBankLabel(isHorizontal ? 'length-h' : 'length-v', m),
            data: m,
            id: m.id
          }, m);
        });
      }

      return list
        .sort((a, b) => {
          if (a._chronology === 0 && b._chronology === 0) {
            return a._fallbackOrder - b._fallbackOrder;
          }
          if (a._chronology === 0) return -1;
          if (b._chronology === 0) return 1;
          return a._chronology - b._chronology || a._fallbackOrder - b._fallbackOrder;
        })
        .map(({ _chronology, _fallbackOrder, ...item }) => item);
    },

    imageReady() {
      // Use OSD state when available, fall back to legacy for cropped popup
      return (this.osdReady && this.osdImageWidth > 0 && this.osdImageHeight > 0) ||
             (this.imageLoaded && this.baseFitWidth > 0 && this.baseFitHeight > 0);
    },

    // SVG fill color that adapts to theme (for angle labels in cropped preview)
    svgLabelFill() {
      // Read the primary color from CSS variables
      const style = getComputedStyle(document.documentElement);
      const primary = style.getPropertyValue('--primary').trim();
      if (primary) {
        // Convert HSL values to hsl() format
        return `hsl(${primary})`;
      }
      return '#3d8bfa'; // Fallback blue
    },

    // Inverse scale so SVG cosmetic sizes (text, circles, strokes) stay
    // constant on screen regardless of zoom level.
    svgInverseScale() {
      // eslint-disable-next-line no-unused-vars
      const _trigger = this.osdViewportBounds;
      if (!this.osdViewer || !this.osdReady) return 1;
      const tiledImage = this.osdViewer.world.getItemAt(0);
      if (!tiledImage) return 1;
      const tl = this.osdViewer.viewport.pixelFromPoint(
        tiledImage.imageToViewportCoordinates(new OpenSeadragon.Point(0, 0)),
        true
      );
      const tr = this.osdViewer.viewport.pixelFromPoint(
        tiledImage.imageToViewportCoordinates(new OpenSeadragon.Point(this.osdImageWidth, 0)),
        true
      );
      const w = tr.x - tl.x;
      return w > 0 ? this.osdImageWidth / w : 1;
    },

    // Annotation overlay positioning - syncs with OpenSeadragon viewport
    annotationOverlayStyle() {
      // Force reactivity on viewport changes
      // eslint-disable-next-line no-unused-vars
      const _trigger = this.osdViewportBounds;

      if (!this.osdViewer || !this.osdReady) {
        return { display: 'none' };
      }

      const tiledImage = this.osdViewer.world.getItemAt(0);
      if (!tiledImage) {
        return { display: 'none' };
      }

      // Convert image corners to window (pixel) coordinates
      // Use Point objects for proper API usage
      const topLeft = this.osdViewer.viewport.pixelFromPoint(
        tiledImage.imageToViewportCoordinates(new OpenSeadragon.Point(0, 0)),
        true
      );
      const bottomRight = this.osdViewer.viewport.pixelFromPoint(
        tiledImage.imageToViewportCoordinates(new OpenSeadragon.Point(this.osdImageWidth, this.osdImageHeight)),
        true
      );

      const width = bottomRight.x - topLeft.x;
      const height = bottomRight.y - topLeft.y;

      return {
        position: 'absolute',
        left: `${topLeft.x}px`,
        top: `${topLeft.y}px`,
        width: `${width}px`,
        height: `${height}px`,
        pointerEvents: 'none',
        overflow: 'visible',
        zIndex: 10
      };
    },

    anchorBoxInViewer() {
      // Force reactivity on viewport changes
      // eslint-disable-next-line no-unused-vars
      const _trigger = this.osdViewportBounds;

      // Page rect in viewer-coordinates after zoom/pan
      // Use OSD viewport when available
      if (this.osdViewer && this.osdReady) {
        const tiledImage = this.osdViewer.world.getItemAt(0);
        if (tiledImage) {
          // Use Point objects for proper API usage
          const topLeft = this.osdViewer.viewport.pixelFromPoint(
            tiledImage.imageToViewportCoordinates(new OpenSeadragon.Point(0, 0)),
            true
          );
          const bottomRight = this.osdViewer.viewport.pixelFromPoint(
            tiledImage.imageToViewportCoordinates(new OpenSeadragon.Point(this.osdImageWidth, this.osdImageHeight)),
            true
          );
          const left = topLeft.x;
          const top = topLeft.y;
          const w = bottomRight.x - topLeft.x;
          const h = bottomRight.y - topLeft.y;
          return { left, top, width: w, height: h, right: left + w, bottom: top + h };
        }
      }

      // Fallback for legacy or cropped popup
      const w = this.zoomedWidth;
      const h = this.zoomedHeight;
      const left = (this.viewerWidth / 2) - (w / 2) + this.panX;
      const top  = (this.viewerHeight / 2) - (h / 2) + this.panY;
      return { left, top, width: w, height: h, right: left + w, bottom: top + h };
    },


    viewerWidth() {
      const viewer = this.$refs.viewer;
      return viewer ? viewer.clientWidth : 0;
    },
    viewerHeight() {
      const viewer = this.$refs.viewer;
      return viewer ? viewer.clientHeight : 0;
    },
    
    currentImageWidth() {
      return this.baseFitWidth || 1000;
    },
    currentImageHeight() {
      return this.baseFitHeight || 1000;
    },
    
    isAnyPopupOpen() {
      return this.showAngleLabelPopup || 
             this.showDistanceLabelPopup ||
             this.showAngleFilterPopup || 
             this.showDistanceFilterPopup ||
             this.showTracePopup || 
             this.showHorizontalPopup || 
             this.showVerticalPopup || 
             this.showAngleStatistics || 
             this.showDistanceStatistics ||
             this.showCropModeDialog ||
             this.showBoxStatistics ||
             this.showBoxInspector ||
             this.showStatistics || 
             this.showClearConfirmation || 
             !!this.croppedImage ||
             this.showStatsPanel;
    },
    
    currentImage() {
      return this.images[this.currentPage] || null;
    },
    totalPages() {
      return this.images.length;
    },
    currentPageCursors() {
      // Filter cursors to only show those on the current page
      return (this.remoteCursorData || []).filter(cursor => cursor.pageIndex === this.currentPage);
    },
    currentPageHighlights() {
      return (this.annotationsByPage[this.currentPage] || []).filter(a => a.type === "highlight");
    },
    currentPageUnderlines() {
      return (this.annotationsByPage[this.currentPage] || []).filter(a => a.type === "underline");
    },
    currentPageBoxMeasurements() {
      return (this.annotationsByPage[this.currentPage] || []).filter(a => a.type === 'boxMeasurement');
    },
    currentPageStrokes() {
      const strokes = (this.annotationsByPage[this.currentPage] || []).filter(a => a.type === "trace");
      
      // Apply movement delta if in move mode and annotations are selected
      if (this.moveModeActive && (this.currentMoveDelta.x !== 0 || this.currentMoveDelta.y !== 0)) {
        return strokes.map((stroke, index) => {
          const key = `trace-${index}`;
          if (this.bankSelectedKeys.includes(key)) {
            return {
              ...stroke,
              points: stroke.points.map(point => ({
                x: point.x + this.currentMoveDelta.x,
                y: point.y + this.currentMoveDelta.y
              }))
            };
          }
          return stroke;
        });
      }
      
      return strokes;
    },
    distanceAxisGuide() {
      if (!this.distanceModeActive || this.distancePoints.length !== 1 || !this.distanceGuideMousePos) return null;
      return this.getDistanceAxisGuide(this.distancePoints[0], this.distanceGuideMousePos);
    },
    currentPageAngles() {
      const angles = (this.annotationsByPage[this.currentPage] || []).filter(a => a.type === "measure");
      
      // Apply movement delta if in move mode and annotations are selected
      if (this.moveModeActive && (this.currentMoveDelta.x !== 0 || this.currentMoveDelta.y !== 0)) {
        return angles.map((angle, index) => {
          const key = `measure-${index}`;
          if (this.bankSelectedKeys.includes(key)) {
            return {
              ...angle,
              points: angle.points.map(point => ({
                x: point.x + this.currentMoveDelta.x,
                y: point.y + this.currentMoveDelta.y
              }))
            };
          }
          return angle;
        });
      }
      
      return angles;
    },
    currentPageDistances() {
      const distances = (this.annotationsByPage[this.currentPage] || []).filter(a => a.type === "distance");

      // Apply movement delta if in move mode and annotations are selected
      if (this.moveModeActive && (this.currentMoveDelta.x !== 0 || this.currentMoveDelta.y !== 0)) {
        return distances.map((distance, index) => {
          const key = `distance-${index}`;
          if (this.bankSelectedKeys.includes(key)) {
            return {
              ...distance,
              points: (distance.points || []).map(point => ({
                x: point.x + this.currentMoveDelta.x,
                y: point.y + this.currentMoveDelta.y
              }))
            };
          }
          return distance;
        });
      }

      return distances;
    },
    angleStatisticsLabels() {
      const pages = this.angleScope === 'page'
        ? [this.currentPage]
        : Array.from({ length: Math.max(this.totalPages, this.annotationsByPage.length) }, (_, index) => index);
      const labels = pages.flatMap(pageIndex =>
        (this.annotationsByPage[pageIndex] || [])
          .filter(annotation => annotation?.type === 'measure')
          .map(annotation => annotation.label)
      );
      return uniqueMeasurementLabels(labels);
    },
    distanceStatisticsLabels() {
      const pages = this.distanceScope === 'page'
        ? [this.currentPage]
        : Array.from({ length: Math.max(this.totalPages, this.annotationsByPage.length) }, (_, index) => index);
      const labels = pages.flatMap(pageIndex =>
        (this.annotationsByPage[pageIndex] || [])
          .filter(annotation => annotation?.type === 'distance')
          .map(annotation => annotation.label)
      );
      return uniqueMeasurementLabels(labels);
    },
    boxMeasurementStatisticsLabels() {
      const labels = this.annotationsByPage.flatMap(page =>
        (page || []).filter(annotation => annotation?.type === 'boxMeasurement').map(annotation => annotation.label)
      );
      return uniqueMeasurementLabels([...this.boxMeasurementLabels, ...labels]);
    },
    boxStatisticsMeasurements() {
      const pages = this.boxStatisticsScope === 'page'
        ? [this.currentPage]
        : Array.from({ length: Math.max(this.totalPages, this.annotationsByPage.length) }, (_, index) => index);
      return pages.flatMap(pageIndex =>
        (this.annotationsByPage[pageIndex] || []).filter(annotation => annotation?.type === 'boxMeasurement')
      );
    },
    boxStatisticsRows() {
      return summarizeBoxMeasurements(this.boxStatisticsMeasurements);
    },
    currentPageLengthMeasurements() {
      const measurements = [];
      for (const label in this.lengthMeasurements) {
        if (this.lengthMeasurements[label][this.currentPage]) {
          measurements.push(...this.lengthMeasurements[label][this.currentPage]);
        }
      }
      return measurements;
    },
    currentPageComments() {
      return this.comments[this.currentPage] || [];
    },
    bankItems() {
      const items = [];
      const ann = this.annotationsByPage[this.currentPage] || [];

      // Annotations
      ann.forEach((a, i) => {
        if (!a) return;
        
        // Get creator name if available
        const creatorName = this.getCreatorName(a.createdBy);
        const creatorSuffix = creatorName ? ` • By ${creatorName}` : '';

        if (a.type === "measure") {
          // Angle(Label)(number)
          const label = a.label ? String(a.label) : "Unlabeled";
          const num = typeof a.angle === "number" || typeof a.angle === "string"
            ? String(a.angle)
            : "";
          items.push({
            key: `a:${i}`,
            category: "angle",
            title: `Angle (${label}) (${num})`,
            subtitle: creatorSuffix.trim(),
            color: "#0d6efd", // blue accent for angles
          });
          return;
        }

        if (a.type === "distance") {
          const label = a.label ? String(a.label) : "Unlabeled";
          items.push({
            key: `a:${i}`,
            category: "distance",
            title: `Distance (${label})`,
            subtitle: `${this.formatDistanceAnnotation(a, a.pageIndex ?? this.currentPage)}${creatorSuffix}`,
            color: "#7c3aed",
          });
          return;
        }

        if (a.type === 'boxMeasurement') {
          items.push({
            key: `a:${i}`,
            category: 'boxMeasurement',
            title: `Crop & Count (${normalizeMeasurementLabel(a.label)})`,
            subtitle: `${Number(a.aspectRatio).toFixed(3)} W/H • ${((Number(a.inkDensity) || 0) * 100).toFixed(2)}% ink${creatorSuffix}`,
            color: '#f97316',
          });
          return;
        }

        if (a.type === "trace") {
          // Trace(Color)
          const colorName = this.colorToName(a.color);
          items.push({
            key: `a:${i}`,
            category: "trace",
            title: `Trace (${colorName})`,
            subtitle: `${a.points?.length || 0} pts${creatorSuffix}`,
            color: a.color || "#0d6efd",
          });
          return;
        }

        if (a.type === "highlight") {
          items.push({
            key: `a:${i}`,
            category: "highlight",
            title: "Highlight",
            subtitle: `${this.formatDimensions(a.width, a.height)}${creatorSuffix}`,
            color: "rgba(255, 255, 0, 0.8)",
          });
          return;
        }

        if (a.type === "underline") {
          items.push({
            key: `a:${i}`,
            category: "underline",
            title: "Underline",
            subtitle: `${this.formatMeasurement(a.width, 'x')}${creatorSuffix}`,
            color: "red",
          });
          return;
        }
      });

      // Length bands (name according to actual type)
      const pageLengths = this.currentPageLengthMeasurements || [];
      pageLengths.forEach((m) => {
        const creatorName = this.getCreatorName(m.createdBy);
        const creatorSuffix = creatorName ? ` • By ${creatorName}` : '';
        items.push({
          key: `l:${m.id}`,
          category: "length",
          title: this.camelToTitle(m.label || "Length"),
          subtitle: `${this.formatDimensions(m.width, m.height)}${creatorSuffix}`,
          color: m.color || this.measurementColors[m.label] || "#6ea8fe",
        });
      });

      // Comments
      const cmts = this.comments[this.currentPage] || [];
      cmts.forEach((c, i) => {
        const creatorName = this.getCreatorName(c.createdBy);
        const creatorSuffix = creatorName ? ` • By ${creatorName}` : '';
        const commentText = (c.text || "").slice(0, 60);
        items.push({
          key: `c:${i}`,
          category: "comment",
          title: "Comment",
          subtitle: commentText + creatorSuffix,
          color: "#6ea8fe",
        });
      });

      return items;
    },

    // Cropped popup computed properties
    croppedAnchorStyle() {
      return {
        position: 'absolute',
        left: '50%',
        top: '50%',
        width: this.croppedBaseW + 'px',
        height: this.croppedBaseH + 'px',
        transform: `translate(-50%,-50%) translate(${this.cropPanX}px, ${this.cropPanY}px) scale(${this.cropZoom})`,
        transformOrigin: 'center center',
      };
    },
    croppedStageCursor() {
      const toolActive = this.traceModeActive || this.measureModeActive || this.distanceModeActive || this.highlightModeActive || this.underlineModeActive;
      if (toolActive) return 'crosshair';
      if (this.isCropPanning) return 'grabbing';
      if (this.cropZoom > 1) return 'grab';
      return 'default';
    },
    cropZoomLeftStyle() {
      const el = this.$refs.croppedStage;
      if (!el) return {};
      const y = el.clientHeight/2;
      const x = el.clientWidth/2 - (this.croppedBaseW*this.cropZoom)/2 + this.cropPanX - 44;
      return { left: `${Math.round(x)}px`, top: `${Math.round(y)}px`, transform: 'translateY(-50%)' };
    },
    cropZoomRightStyle() {
      const el = this.$refs.croppedStage;
      if (!el) return {};
      const y = el.clientHeight/2;
      const x = el.clientWidth/2 + (this.croppedBaseW*this.cropZoom)/2 + this.cropPanX + 8;
      return { left: `${Math.round(x)}px`, top: `${Math.round(y)}px`, transform: 'translateY(-50%)' };
    },
    // Unified cropped annotations system
    croppedAnnotationsAbs() {
      return this.croppedAnnotations.filter(a => a.type === 'highlight' || a.type === 'underline').map(a => ({
        ...a,
        style: a.type === 'highlight' ? {
          position: 'absolute',
          left: `${a.rect.left}px`,
          top: `${a.rect.top}px`,
          width: `${a.rect.width}px`,
          height: `${a.rect.height}px`,
          backgroundColor: a.color,
          opacity: 0.3,
          pointerEvents: 'none'
        } : {
          position: 'absolute',
          left: `${a.line.x1}px`,
          top: `${a.line.y1}px`,
          width: `${Math.abs(a.line.x2 - a.line.x1)}px`,
          height: `${Math.abs(a.line.y2 - a.line.y1) || 2}px`,
          backgroundColor: a.color,
          pointerEvents: 'none'
        }
      }));
    },
    croppedAnnotationsSvg() {
      return this.croppedAnnotations.filter(a => a.type === 'trace' || a.type === 'measure');
    },
    croppedTraces() {
      return this.croppedAnnotations.filter(a => a.type === 'trace');
    },
    croppedMeasures() {
      return this.croppedAnnotations.filter(a => a.type === 'measure');
    },
    croppedBankItems() {
      return this.croppedAnnotations.map((a, i) => {
        const creatorName = this.getCreatorName(a.createdBy);
        const creatorSuffix = creatorName ? ` • By ${creatorName}` : '';
        
        let subtitle = '';
        if (a.type === 'trace') {
          subtitle = `${a.points?.length || 0} pts${creatorSuffix}`;
        } else {
          subtitle = creatorSuffix.trim();
        }
        
        return {
          key: `c${i}`,
          category: a.type,
          title: a.type === 'trace' ? 'Trace' :
                 a.type === 'measure' ? `Angle (${a.angle || ''}°)` :
                 a.type === 'highlight' ? 'Highlight' : 'Underline',
          subtitle,
          color: a.color || (a.type === 'measure' ? 'blue' : a.type === 'highlight' ? 'rgba(255,255,0,0.8)' : '#3b82f6')
        };
      });
    },
    // Check if any annotations exist (for import confirmation)
    hasAnyAnnotations() {
      return this.annotationsByPage.some(page => page?.length > 0) ||
             this.comments.some(page => page?.length > 0) ||
             Object.values(this.lengthMeasurements).some(
               label => Object.values(label).some(page => page?.length > 0)
             );
    },
  },
  watch: {
    currentPage(n) {
      this.pageInput = n + 1;
      this.iiifError = '';
      this.imageLoaded = false;
      if (this.showMeasurementsInCm && !this.measurementScalesByPage[n]) {
        this.showMeasurementsInCm = false;
        this.showToolMessage('Centimetre mode was turned off because this page has no physical scale.');
      }
      // Clear bank selections when page changes
      this.bankSelectedKeys = [];
      this.clearKeyboardMovingAngle();
      clearTimeout(this._annotationFlashTimer);
      this._annotationFlashTimer = null;
      this.flashingAnnotation = null;
      this.hideAnnotationTooltip();
      // Update adjustment page for per-page filters
      this.setAdjustmentPage(n);
      // Refresh comment overlays for the new page
      this.expandedCommentId = null;
      this._removeComposerOverlay();
      this.$nextTick(() => {
        this.renderCommentOverlays();
        this.refreshVisibleAngleStatistics();
        this.refreshVisibleDistanceStatistics();
      });

      // Broadcast page change for follow mode (immediate, not throttled)
      if (this.sessionConnected && !this.isApplyingFollowSync && this.osdViewer) {
        const bounds = this.osdViewer.viewport.getBounds();
        const zoom = this.osdViewer.viewport.getZoom();
        this.broadcastViewportImmediate(n, zoom, {
          x: bounds.x,
          y: bounds.y,
          width: bounds.width,
          height: bounds.height
        });
      }
    },
    // Initialize OpenSeadragon when image changes
    currentImage: {
      handler(newImage) {
        if (newImage && !this.croppedImage) {
          this.initOpenSeadragon(newImage);
        }
      },
      immediate: true
    },
    // Watch for filter changes and apply to OSD
    currentFilters: {
      handler() {
        this.applyFiltersToOsd();

        // Broadcast filter changes for follow mode
        if (this.sessionConnected && !this.isApplyingFollowSync) {
          this.broadcastCurrentFilters();
        }
        if (!this.isApplyingFollowSync) {
          this.queueSessionSettingsSync();
        }
      },
      deep: true
    },
    angleLabels: {
      handler() {
        this.queueSessionSettingsSync();
      },
      deep: true
    },
    distanceLabels: {
      handler() {
        this.queueSessionSettingsSync();
      },
      deep: true
    },
    boxMeasurementLabels: {
      handler() {
        this.queueSessionSettingsSync();
      },
      deep: true
    },
    angleLabelPositions: {
      handler() {
        this.queueSessionSettingsSync();
      },
      deep: true
    },
    distanceLabelPositions: {
      handler() {
        this.queueSessionSettingsSync();
      },
      deep: true
    },
    labelPositions: {
      handler() {
        this.queueSessionSettingsSync();
      },
      deep: true
    },
    measurementScalesByPage: {
      handler() {
        this.queueSessionSettingsSync();
      },
      deep: true
    },
    showMeasurementsInCm() {
      this.queueSessionSettingsSync();
      this.refreshVisibleDistanceStatistics();
    },
    // Watch for incoming annotation changes from session
    sessionAnnotations: {
      handler(newAnnotations) {
        if (!newAnnotations || !this.sessionConnected) return;
        // Apply comments from session
        if (newAnnotations.comments) {
          this.applySessionComments(newAnnotations.comments);
        }
      },
      deep: true
    },
    highlightModeActive(isActive) {
      this.setHighlightInteractionLock(isActive);
    }
  },
  async created() {
    // Non-reactive comment overlay refs
    this._commentOverlayEls = [];
    this._composerOverlayEl = null;
    this._composerAnchorOverlayEl = null;
    this._composerImageCoords = { x: 0, y: 0 };
    this._toolMessageTimer = null;

    // Handle session route - load from session API
    if (this.sessionId) {
      await this.loadFromSession(this.sessionId);
      return;
    }

    // Handle regular IIIF source route
    if (!this.source) {
      alert("Invalid source. Returning to input.");
      this.$router.push({ name: "IIIFInput" });
      return;
    }
    this.annotationsByPage = []; // init

    // Handle uploaded files (job:xxx)
    if (this.source.startsWith("job:")) {
      const cached = sessionStorage.getItem(this.source);
      if (!cached) {
        alert("Upload data expired. Returning to input.");
        this.$router.push({ name: "IIIFInput" });
        return;
      }
      const data = JSON.parse(cached);
      this.jobId = data.job_id;
      const base = this._getBackendBase();
      const pages = Array.isArray(data.pages) ? data.pages : [];
      this.images = pages
        .map((page) => {
          const rawPath = typeof page === 'string' ? page : page?.image;
          return this._resolveUploadedImageUrl(rawPath, base);
        })
        .filter(Boolean);

      if (!this.images.length) {
        alert("Upload data is invalid. Returning to input.");
        this.$router.push({ name: "IIIFInput" });
        return;
      }

      // Store image list as JSON so session sharing can reconstruct pages
      this.iiifManifest = JSON.stringify(this.images);
      this.iiifPages = [];
      this.measurementScalesByPage = [];
      this.annotationsByPage = this.images.map(() => []);
      this.comments = this.images.map(() => []);
      return;
    }

    this.iiifManifest = this.source; // Store for sharing
    await this.loadRemoteSource(this.source);
  },
  mounted() {
    // Force close any cropped popup on mount
    this.croppedImage = null;
    
    this._onLabelDragMove = (e) => {
      if (this.draggedLabelIndex !== null) {
        let measurement = null;
        if (this.draggedLabelIndex === "dynamic") {
          measurement = this.currentSquare;
        } else {
          measurement = this.currentPageLengthMeasurements.find((m) => m.id === this.draggedLabelIndex);
        }
        if (measurement) this.dragLabel(this.draggedLabelIndex, e);
      }
    };
    this._onAngleLabelDragMove = (e) => {
      if (this.draggedLabelIndex !== null) {
        this.dragAngleLabel(this.draggedLabelIndex, e);
      }
    };
    this._onDistanceLabelDragMove = (e) => {
      if (this.draggedLabelIndex !== null) {
        this.dragDistanceLabel(this.draggedLabelIndex, e);
      }
    };
    
    // Initialize fit computation
    this.$nextTick(() => {
      this.computeBaseFit();  // in case the image is cached and loads instantly
    });
    window.addEventListener('resize', this.computeBaseFit);
    
    // Global selection prevention for cropped popup
    this._preventSelection = (e) => {
      if (this.croppedImage && (e.target.closest('.cropped-popup') || e.target.closest('.crop-stage'))) {
        e.preventDefault();
        e.stopPropagation();
        return false;
      }
    };
    
    document.addEventListener('selectstart', this._preventSelection, true);
    document.addEventListener('dragstart', this._preventSelection, true);
    document.addEventListener('contextmenu', this._preventSelection, true);

    // Global mouseup handler to complete operations when mouse is released outside viewer
    this._globalMouseUp = (e) => {
      if (this.isAnyToolActive) {
        this.endTrace(e);
      }
    };
    window.addEventListener('mouseup', this._globalMouseUp);

    this._angleMoveKeyDown = (event) => this.handleAngleMoveKeyDown(event);
    this._angleMoveOutsideClick = (event) => {
      if (!this.keyboardMovingAngleId && !this.keyboardMovingAngleRef) return;
      const target = event.target;
      if (target?.closest?.('.saved-angle-group, .angle-label, .angle-context-menu')) return;
      this.clearKeyboardMovingAngle();
    };
    window.addEventListener('keydown', this._angleMoveKeyDown);
    document.addEventListener('mousedown', this._angleMoveOutsideClick, true);
    this._bandResizeOutsidePointerDown = (event) => {
      if (event.target?.closest?.('.length-measurement, .band-resize-handle')) return;
      this.clearBandResizeSelection();
    };
    document.addEventListener('pointerdown', this._bandResizeOutsidePointerDown, true);
  },

  beforeUnmount() {
    window.removeEventListener('resize', this.computeBaseFit);

    // Clean up annotation sync subscription
    if (this.annotationSyncUnsubscribe) {
      this.annotationSyncUnsubscribe();
      this.annotationSyncUnsubscribe = null;
    }
    if (this.annotationsSnapshotUnsubscribe) {
      this.annotationsSnapshotUnsubscribe();
      this.annotationsSnapshotUnsubscribe = null;
    }
    if (this.settingsSyncUnsubscribe) {
      this.settingsSyncUnsubscribe();
      this.settingsSyncUnsubscribe = null;
    }

    // Clean up version restored subscription
    if (this.versionRestoredUnsubscribe) {
      this.versionRestoredUnsubscribe();
      this.versionRestoredUnsubscribe = null;
    }

    // Clean up follow mode
    this.cleanupFollowSyncHandlers();
    this.cleanupFollow();
    this._removeComposerOverlay();

    // Clean up OpenSeadragon
    if (this.osdViewer) {
      // Remove all event handlers before destroying
      this.osdViewer.removeAllHandlers('open');
      this.osdViewer.removeAllHandlers('open-failed');
      this.osdViewer.removeAllHandlers('animation');
      this.osdViewer.removeAllHandlers('animation-finish');
      this.osdViewer.removeAllHandlers('resize');
      this.osdViewer.removeAllHandlers('zoom');
      this.osdViewer.removeAllHandlers('pan');
      this.osdViewer.destroy();
      this.osdViewer = null;
    }

    // Clean up global selection prevention
    if (this._preventSelection) {
      document.removeEventListener('selectstart', this._preventSelection, true);
      document.removeEventListener('dragstart', this._preventSelection, true);
      document.removeEventListener('contextmenu', this._preventSelection, true);
    }

    // Clean up global mouseup handler
    if (this._globalMouseUp) {
      window.removeEventListener('mouseup', this._globalMouseUp);
    }

    if (this._angleMoveKeyDown) {
      window.removeEventListener('keydown', this._angleMoveKeyDown);
    }
    if (this._onDistanceLabelDragMove) {
      window.removeEventListener('mousemove', this._onDistanceLabelDragMove);
      window.removeEventListener('mouseup', this.stopDistanceLabelDrag);
    }
    if (this._angleMoveOutsideClick) {
      document.removeEventListener('mousedown', this._angleMoveOutsideClick, true);
    }
    if (this._bandResizeOutsidePointerDown) {
      document.removeEventListener('pointerdown', this._bandResizeOutsidePointerDown, true);
    }
    window.removeEventListener('pointermove', this.resizeSelectedBand);
    window.removeEventListener('pointerup', this.finishBandResize);
    window.removeEventListener('pointercancel', this.finishBandResize);
    window.removeEventListener('pointermove', this.resizeBoxMeasurement);
    window.removeEventListener('pointerup', this.finishBoxMeasurementResize);
    window.removeEventListener('pointercancel', this.finishBoxMeasurementResize);
    if (this._angleMovePersistTimer) {
      clearTimeout(this._angleMovePersistTimer);
    }
    if (this._rectMovePersistTimer) {
      clearTimeout(this._rectMovePersistTimer);
    }
    if (this._boxRecalculateTimer) {
      clearTimeout(this._boxRecalculateTimer);
    }
    if (this._bandResizePersistTimer) {
      clearTimeout(this._bandResizePersistTimer);
    }
    if (this._annotationFlashTimer) {
      clearTimeout(this._annotationFlashTimer);
    }
    if (this._sessionSettingsSyncTimer) {
      clearTimeout(this._sessionSettingsSyncTimer);
    }
    if (this._sessionSnapshotSyncTimer) {
      clearTimeout(this._sessionSnapshotSyncTimer);
    }
    if (this._toolMessageTimer) {
      clearTimeout(this._toolMessageTimer);
      this._toolMessageTimer = null;
    }

    // Clean up body class if component is destroyed while popup is open
    document.body.classList.remove('cropped-popup-active');
  },

  methods: {
    // Make calligraphic path generator available in template
    generateCalligraphicPath,
    nextAnnotationOrder() {
      this.annotationSequence = Math.max(this.annotationSequence + 1, Date.now() * 1000);
      return this.annotationSequence;
    },
    creationMetadata() {
      return {
        createdAt: new Date().toISOString(),
        createdOrder: this.nextAnnotationOrder(),
      };
    },
    annotationChronology(annotation) {
      const createdOrder = Number(annotation?.createdOrder);
      if (Number.isFinite(createdOrder) && createdOrder > 0) return createdOrder;
      const createdAt = Date.parse(annotation?.createdAt);
      return Number.isFinite(createdAt) ? createdAt * 1000 : 0;
    },
    beginApplyingSessionSync() {
      this.isApplyingSessionSync = true;
      if (this._sessionSettingsSyncTimer) {
        clearTimeout(this._sessionSettingsSyncTimer);
        this._sessionSettingsSyncTimer = null;
      }
      if (this._sessionSnapshotSyncTimer) {
        clearTimeout(this._sessionSnapshotSyncTimer);
        this._sessionSnapshotSyncTimer = null;
      }
    },
    finishApplyingSessionSync() {
      this.$nextTick(() => {
        this.isApplyingSessionSync = false;
      });
    },
    queueSessionSettingsSync() {
      if (this.isApplyingSessionSync || !this.activeSessionId || !this.sessionConnected) return;

      if (this._sessionSettingsSyncTimer) {
        clearTimeout(this._sessionSettingsSyncTimer);
      }

      this._sessionSettingsSyncTimer = setTimeout(() => {
        this._sessionSettingsSyncTimer = null;
        if (this.isApplyingSessionSync || !this.activeSessionId || !this.sessionConnected) return;

        try {
          this.syncSessionSettings(this.getSharedSessionSettings());
        } catch (error) {
          console.error('Failed to sync shared session settings:', error);
          this.showToolMessage('Session settings were kept locally, but sync failed.');
        }
      }, 250);
    },
    queueSessionSnapshotSync() {
      if (this.isApplyingSessionSync || !this.activeSessionId) return;

      if (this._sessionSnapshotSyncTimer) {
        clearTimeout(this._sessionSnapshotSyncTimer);
      }

      this._sessionSnapshotSyncTimer = setTimeout(async () => {
        this._sessionSnapshotSyncTimer = null;
        if (this.isApplyingSessionSync || !this.activeSessionId) return;

        try {
          await this.syncAllAnnotations(this.getAllAnnotations());
        } catch (error) {
          console.error('Failed to sync shared session snapshot:', error);
          this.showToolMessage('Changes were kept locally, but session sync failed.');
        }
      }, 400);
    },
    mergeUniqueLabels(labels = []) {
      return uniqueMeasurementLabels(labels, { includeUnlabeled: false });
    },
    collectAngleLabelsFromAnnotations(annotations = null) {
      const labels = [];
      const add = (annotation) => {
        if (annotation?.label) labels.push(annotation.label);
      };

      if (annotations && typeof annotations === 'object') {
        (annotations.angles || []).forEach(add);
        (annotations.measures || []).forEach(add);
        return this.mergeUniqueLabels(labels);
      }

      (this.annotationsByPage || []).forEach(page => {
        (page || [])
          .filter(annotation => annotation?.type === 'measure')
          .forEach(add);
      });
      return this.mergeUniqueLabels(labels);
    },
    collectDistanceLabelsFromAnnotations(annotations = null) {
      const labels = [];
      const add = (annotation) => {
        if (annotation?.label) labels.push(annotation.label);
      };

      if (annotations && typeof annotations === 'object') {
        (annotations.distances || []).forEach(add);
        return this.mergeUniqueLabels(labels);
      }

      (this.annotationsByPage || []).forEach(page => {
        (page || [])
          .filter(annotation => annotation?.type === 'distance')
          .forEach(add);
      });
      return this.mergeUniqueLabels(labels);
    },
    collectBoxMeasurementLabelsFromAnnotations(annotations = null) {
      const labels = [];
      const add = annotation => {
        if (annotation?.label) labels.push(annotation.label);
      };
      if (annotations && typeof annotations === 'object') {
        (annotations.boxMeasurements || []).forEach(add);
        return this.mergeUniqueLabels(labels);
      }
      (this.annotationsByPage || []).forEach(page => {
        (page || []).filter(annotation => annotation?.type === 'boxMeasurement').forEach(add);
      });
      return this.mergeUniqueLabels(labels);
    },
    addAngleLabelIfNeeded(label) {
      if (!String(label || '').trim()) return;
      const normalized = normalizeMeasurementLabel(label);
      if (normalized === UNLABELED_MEASUREMENT) return;
      if (!this.angleLabels.some(existing => measurementLabelsEqual(existing, normalized))) {
        this.angleLabels.push(normalized);
      }
    },
    addDistanceLabelIfNeeded(label) {
      if (!String(label || '').trim()) return;
      const normalized = normalizeMeasurementLabel(label);
      if (normalized === UNLABELED_MEASUREMENT) return;
      if (!this.distanceLabels.some(existing => measurementLabelsEqual(existing, normalized))) {
        this.distanceLabels.push(normalized);
      }
    },
    normalizePositionMap(map) {
      if (!map || typeof map !== 'object' || Array.isArray(map)) return {};
      return Object.entries(map).reduce((positions, [id, position]) => {
        const x = Number(position?.x);
        const y = Number(position?.y);
        if (Number.isFinite(x) && Number.isFinite(y)) {
          positions[id] = { x, y };
        }
        return positions;
      }, {});
    },
    getSharedSessionSettings() {
      return {
        angleLabels: this.mergeUniqueLabels([
          ...this.angleLabels,
          ...this.collectAngleLabelsFromAnnotations()
        ]),
        distanceLabels: this.mergeUniqueLabels([
          ...this.distanceLabels,
          ...this.collectDistanceLabelsFromAnnotations()
        ]),
        boxMeasurementLabels: this.mergeUniqueLabels([
          ...this.boxMeasurementLabels,
          ...this.collectBoxMeasurementLabelsFromAnnotations()
        ]),
        angleLabelPositions: this.normalizePositionMap(this.angleLabelPositions),
        distanceLabelPositions: this.normalizePositionMap(this.distanceLabelPositions),
        labelPositions: this.normalizePositionMap(this.labelPositions),
        measurementScalesByPage: (this.measurementScalesByPage || []).map(scale =>
          scale && typeof scale === 'object' ? { ...scale } : null
        ),
        showMeasurementsInCm: !!this.showMeasurementsInCm,
        imageFiltersByPage: typeof this.getAllFilters === 'function' ? this.getAllFilters() : {}
      };
    },
    applySharedSessionSettings(settings = {}, annotations = null) {
      const safeSettings = settings && typeof settings === 'object' && !Array.isArray(settings)
        ? settings
        : {};
      const hasSetting = key => Object.prototype.hasOwnProperty.call(safeSettings, key);

      if (hasSetting('angleLabels') || annotations) {
        this.angleLabels = this.mergeUniqueLabels([
          ...(Array.isArray(safeSettings.angleLabels) ? safeSettings.angleLabels : []),
          ...this.collectAngleLabelsFromAnnotations(annotations)
        ]);
      }

      if (hasSetting('angleLabelPositions') || annotations) {
        this.angleLabelPositions = this.normalizePositionMap(safeSettings.angleLabelPositions);
      }

      if (hasSetting('distanceLabels') || annotations) {
        this.distanceLabels = this.mergeUniqueLabels([
          ...(Array.isArray(safeSettings.distanceLabels) ? safeSettings.distanceLabels : []),
          ...this.collectDistanceLabelsFromAnnotations(annotations)
        ]);
      }

      if (hasSetting('distanceLabelPositions') || annotations) {
        this.distanceLabelPositions = this.normalizePositionMap(safeSettings.distanceLabelPositions);
      }

      if (hasSetting('boxMeasurementLabels') || annotations) {
        this.boxMeasurementLabels = this.mergeUniqueLabels([
          ...(Array.isArray(safeSettings.boxMeasurementLabels) ? safeSettings.boxMeasurementLabels : []),
          ...this.collectBoxMeasurementLabelsFromAnnotations(annotations)
        ]);
      }

      if (hasSetting('labelPositions') || annotations) {
        this.labelPositions = this.normalizePositionMap(safeSettings.labelPositions);
      }

      if (Array.isArray(safeSettings.measurementScalesByPage)) {
        this.measurementScalesByPage = safeSettings.measurementScalesByPage.map(scale =>
          scale && typeof scale === 'object' ? { ...scale } : null
        );
      }

      if (typeof safeSettings.showMeasurementsInCm === 'boolean') {
        this.showMeasurementsInCm = safeSettings.showMeasurementsInCm;
      } else if (annotations) {
        this.showMeasurementsInCm = false;
      }

      if (hasSetting('imageFiltersByPage') || annotations) {
        this.replaceAllFilters(safeSettings.imageFiltersByPage || {});
      }
    },
    handleRemoteAnnotationsSnapshot(payload) {
      const { annotations, participantId } = payload || {};
      if (!annotations || participantId === this.localParticipant?.id) return;
      this.loadAnnotationsFromSession(annotations);
    },
    handleRemoteSettingsSync(payload) {
      const { settings, participantId } = payload || {};
      if (!settings || participantId === this.localParticipant?.id) return;

      this.beginApplyingSessionSync();
      try {
        this.applySharedSessionSettings(settings);
      } finally {
        this.finishApplyingSessionSync();
      }
    },
    async _readResponsePayload(response) {
      const text = await response.text();
      if (!text) return {};
      try {
        return JSON.parse(text);
      } catch {
        return { rawText: text };
      }
    },
    _formatUploadError(payload, status) {
      const proxyError = typeof payload?.rawText === 'string' && payload.rawText.startsWith('Proxy error');
      if (proxyError) {
        return 'Backend is unreachable via /ml proxy. Start the Python backend on port 5001 and retry.';
      }
      if (payload?.error) {
        return typeof payload.error === 'string' ? payload.error : (payload.error.message || `Upload failed (${status})`);
      }
      if (payload?.message) return payload.message;
      if (payload?.rawText) return payload.rawText;
      return `Upload failed (${status})`;
    },
    openScribeDetection() {
      this.$refs.scribeDetectionPopup.openPopup();
    },
    _getBackendBase() {
      const fromWindow = typeof window !== 'undefined' ? window.__PHAROSIGHT_API_BASE__ : null;
      if (fromWindow) return String(fromWindow).replace(/\/+$/, '');
      return '/ml';
    },
    _isImageFile(file) {
      return !!file && typeof file.type === 'string' && file.type.startsWith('image/');
    },
    _resolveUploadedImageUrl(rawPath, base) {
      if (!rawPath) return null;
      const value = String(rawPath).trim();
      if (!value) return null;
      if (/^(blob:|data:|https?:|file:|\/)/i.test(value)) {
        return value;
      }
      return `${base}/static/${value.replace(/^\/+/, '')}`;
    },
    _appendImagesWithPageState(newImages) {
      if (!Array.isArray(newImages) || !newImages.length) return;
      this.images.push(...newImages);
      for (let i = 0; i < newImages.length; i++) {
        this.annotationsByPage.push([]);
        this.comments.push([]);
      }
    },
    
    // Get creator display name for an annotation
    getCreatorName(createdBy) {
      if (!createdBy) return null;
      
      // Check if it's the local participant
      if (createdBy === this.localParticipant?.id) {
        return 'You';
      }
      
      // Get participant from the presence list
      const participant = this.getParticipant(createdBy);
      return participant?.displayName || 'Unknown User';
    },
    
    async handleAddImages(e) {
      const files = Array.from(e.target.files || []);
      if (!files.length) return;
      e.target.value = '';
      const fd = new FormData();
      for (const f of files) fd.append("image", f);
      try {
        const base = this._getBackendBase();
        const res = await fetch(`${base}/prepare`, { method: "POST", body: fd });
        const data = await this._readResponsePayload(res);
        if (!res.ok || !data.ok) {
          throw new Error(this._formatUploadError(data, res.status));
        }
        const pages = Array.isArray(data.pages) ? data.pages : [];
        const newImages = pages
          .map((page) => this._resolveUploadedImageUrl(page?.image, base))
          .filter(Boolean);
        if (!newImages.length) {
          throw new Error('No pages returned from upload.');
        }

        this._appendImagesWithPageState(newImages);
        this.showToolMessage(`Added ${newImages.length} page(s).`);
      } catch (err) {
        const canUseLocalFallback = files.every((file) => this._isImageFile(file));
        if (canUseLocalFallback) {
          const localImages = files.map((file) => URL.createObjectURL(file));
          this._appendImagesWithPageState(localImages);
          this.showToolMessage(`Added ${localImages.length} page(s) locally.`);
          return;
        }

        alert("Failed to add pages: " + err.message + " Local fallback supports image files only; PDF conversion requires the backend.");
      }
    },
    goHome() {
      const ok = window.confirm(
        "Return to the home screen? Any unsaved work on this page will be lost."
      );
      if (ok) {
        this.$router.push({ name: "IIIFInput" });
      }
    },

    clampPan() {
      if (!this.imageReady) return;
      
      const scale = this.zoomLevel;
      const actualWidth = this.baseFitWidth * scale;
      const actualHeight = this.baseFitHeight * scale;
      const viewer = this.$refs.viewer;
      if (!viewer) return;
      
      const vw = viewer.clientWidth;
      const vh = viewer.clientHeight;
      
      const maxPanX = Math.max(0, (actualWidth - vw) / 2);
      const maxPanY = Math.max(0, (actualHeight - vh) / 2);
      
      this.panX = Math.min(Math.max(-maxPanX, this.panX), maxPanX);
      this.panY = Math.min(Math.max(-maxPanY, this.panY), maxPanY);
    },

    zoomIn() {
      if (this.highlightModeActive) return;
      if (!this.osdViewer || !this.osdReady) return;
      this.osdViewer.viewport.zoomBy(1 + this.zoomStep);
      this.osdViewer.viewport.applyConstraints();
    },
    zoomOut() {
      if (this.highlightModeActive) return;
      if (!this.osdViewer || !this.osdReady) return;
      this.osdViewer.viewport.zoomBy(1 / (1 + this.zoomStep));
      this.osdViewer.viewport.applyConstraints();
    },
    resetZoom() {
      if (this.highlightModeActive) return;
      if (!this.osdViewer || !this.osdReady) return;
      this.osdViewer.viewport.goHome();
    },
    zoomTo(level) {
      if (this.highlightModeActive) return;
      if (!this.osdViewer || !this.osdReady) return;
      const nextZoom = Math.min(this.maxZoom, Math.max(this.minZoom, Number(level) || 1));
      this.osdViewer.viewport.zoomTo(nextZoom);
      this.osdViewer.viewport.applyConstraints();
    },

    // Right panel handlers
    handleSelectAnnotation(annotation) {
      this.selectedAnnotationItem = annotation;
      this.flashBankAnnotation(annotation);
      const type = this.normalizeAnnotationDisplayType(annotation?.type);
      if (type === 'highlight' || type === 'underline') {
        this.showToolMessage(`${annotation.label} selected. Use arrow keys to move it; hold Shift for larger steps.`);
      } else if (type === 'distance') {
        this.showToolMessage(`${annotation.label} selected. Use arrow keys to move it; hold Shift for larger steps.`);
      } else if (type === 'boxMeasurement') {
        this.showToolMessage(`${annotation.label} selected. Use arrow keys to move it; inspect the counted mask in Properties.`);
      }
    },
    traceCenterlinePath(points = []) {
      if (!Array.isArray(points) || !points.length) return '';
      const validPoints = points
        .map(point => ({ x: Number(point.x), y: Number(point.y) }))
        .filter(point => Number.isFinite(point.x) && Number.isFinite(point.y));
      if (!validPoints.length) return '';
      return validPoints
        .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`)
        .join(' ');
    },
    selectTraceFromPage(trace, index = 0) {
      if (this.isAnyToolActive || !trace) return;
      const item = {
        type: 'trace',
        label: this.getAnnotationBankLabel('trace', trace, index),
        data: trace,
        index,
      };
      this.selectedAnnotationItem = item;
      this.showToolMessage(`${item.label} selected.`);
    },
    selectDistanceFromPage(distance, index = 0) {
      if (this.isAnyToolActive || !distance) return;
      const item = {
        type: 'distance',
        label: this.getAnnotationBankLabel('distance', distance, index),
        data: distance,
        index,
      };
      this.selectedAnnotationItem = item;
      this.showToolMessage(`${item.label} selected. Use arrow keys to move it; hold Shift for larger steps.`);
    },
    selectRectAnnotationFromPage(type, annotation, index = 0) {
      if (this.isAnyToolActive || !annotation) return;
      const item = {
        type,
        label: this.getAnnotationBankLabel(type, annotation, index),
        data: annotation,
        index,
      };
      this.selectedAnnotationItem = item;
      this.showToolMessage(`${item.label} selected. Use arrow keys to move it; hold Shift for larger steps.`);
    },
    isSelectedAnnotation(type, annotation) {
      const selected = this.selectedAnnotationItem;
      if (!selected?.data || !annotation) return false;
      if (this.normalizeAnnotationDisplayType(selected.type) !== this.normalizeAnnotationDisplayType(type)) return false;
      return annotation.id && selected.data.id
        ? annotation.id === selected.data.id
        : selected.data === annotation;
    },
    renameAnnotation(annotationItem, rawName) {
      const target = annotationItem?.data;
      const originalType = annotationItem?.type;
      const type = this.normalizeAnnotationDisplayType(originalType);
      const annotationSyncTypes = {
        trace: 'traces',
        highlight: 'highlights',
        underline: 'underlines',
        angle: 'measures',
        distance: 'distances',
        boxMeasurement: 'boxMeasurements',
      };
      if (!target) return;

      const name = String(rawName || '').trim();
      const updates = { name: name || null };
      const pageIndex = Number.isInteger(target.pageIndex) ? target.pageIndex : this.currentPage;

      let updatedAnnotation = null;
      let syncType = annotationSyncTypes[type] || null;

      if (type === 'comment') {
        const pageComments = this.comments[pageIndex] || [];
        const idx = target.id
          ? pageComments.findIndex(comment => comment.id === target.id)
          : pageComments.indexOf(target);
        if (idx === -1) return;
        pageComments[idx] = { ...pageComments[idx], ...updates };
        updatedAnnotation = pageComments[idx];
        syncType = 'comments';
        if (pageIndex === this.currentPage) this.renderCommentOverlays();
      } else if (type === 'length') {
        const label = target.label;
        const bandArray = label ? this.lengthMeasurements[label]?.[pageIndex] : null;
        const idx = bandArray
          ? (target.id ? bandArray.findIndex(band => band.id === target.id) : bandArray.indexOf(target))
          : -1;
        if (idx === -1) return;
        bandArray[idx] = { ...bandArray[idx], ...updates };
        updatedAnnotation = bandArray[idx];
        syncType = originalType === 'length-v' ? 'verticalBands' : 'horizontalBands';
      } else {
        const pageAnnotations = this.annotationsByPage[pageIndex] || [];
        const rawType = type === 'angle' ? 'measure' : type;
        const idx = target.id
          ? pageAnnotations.findIndex(annotation => annotation.type === rawType && annotation.id === target.id)
          : pageAnnotations.indexOf(target);
        if (idx === -1) return;
        pageAnnotations[idx] = { ...pageAnnotations[idx], ...updates };
        updatedAnnotation = pageAnnotations[idx];
      }

      if (!updatedAnnotation) return;
      this.selectedAnnotationItem = {
        ...annotationItem,
        label: this.getAnnotationBankLabel(originalType, updatedAnnotation, annotationItem.index),
        data: updatedAnnotation,
      };

      if (this.sessionConnected && updatedAnnotation.id && syncType) {
        this.syncUpdateAnnotation(syncType, updatedAnnotation.id, updates, pageIndex);
      }
    },

    reclassifyAnnotation(annotationItem, rawLabel) {
      const target = annotationItem?.data;
      const type = this.normalizeAnnotationDisplayType(annotationItem?.type);
      if (!target || !['angle', 'distance', 'boxMeasurement'].includes(type)) return;

      const label = normalizeMeasurementLabel(rawLabel);
      const pageIndex = Number.isInteger(target.pageIndex) ? target.pageIndex : this.currentPage;
      const rawType = type === 'angle' ? 'measure' : type;
      const pageAnnotations = this.annotationsByPage[pageIndex] || [];
      const index = target.id
        ? pageAnnotations.findIndex(annotation => annotation?.type === rawType && annotation.id === target.id)
        : pageAnnotations.indexOf(target);
      if (index === -1) return;

      const updatedAnnotation = { ...pageAnnotations[index], label };
      pageAnnotations[index] = updatedAnnotation;
      if (type === 'angle') this.addAngleLabelIfNeeded(label);
      if (type === 'distance') this.addDistanceLabelIfNeeded(label);
      if (type === 'boxMeasurement') this.addBoxMeasurementLabelIfNeeded(label);

      this.selectedAnnotationItem = {
        ...annotationItem,
        label: this.getAnnotationBankLabel(annotationItem.type, updatedAnnotation, annotationItem.index),
        data: updatedAnnotation,
      };

      if (this.sessionConnected && updatedAnnotation.id) {
        const syncType = type === 'angle' ? 'measures' : (type === 'distance' ? 'distances' : 'boxMeasurements');
        this.syncUpdateAnnotation(syncType, updatedAnnotation.id, { label }, pageIndex);
      } else if (this.activeSessionId) {
        this.queueSessionSnapshotSync();
      }

      this.refreshVisibleAngleStatistics();
      this.refreshVisibleDistanceStatistics();
      const typeName = type === 'angle' ? 'Angle' : (type === 'distance' ? 'Distance' : 'Crop & Count');
      this.showToolMessage(`${typeName} class updated to “${label}”.`);
    },

    normalizeAnnotationDisplayType(type) {
      if (type === 'measure') return 'angle';
      if (type === 'length-h' || type === 'length-v') return 'length';
      return type;
    },

    getAnnotationBankLabel(type, annotation, index = 0) {
      const normalizedType = this.normalizeAnnotationDisplayType(type);
      if (normalizedType === 'highlight') return annotation?.name || `Highlight ${index + 1}`;
      if (normalizedType === 'underline') return annotation?.name || `Underline ${index + 1}`;
      if (normalizedType === 'trace') return annotation?.name || `Trace ${index + 1}`;
      if (normalizedType === 'comment') {
        if (annotation?.name) return annotation.name;
        const text = annotation?.text || '';
        return text.substring(0, 25) + (text.length > 25 ? '...' : '') || `Comment ${index + 1}`;
      }
      if (normalizedType === 'angle') {
        const classification = normalizeMeasurementLabel(annotation?.label);
        if (annotation?.name) return `${annotation.name} • ${annotation?.angle}° • ${classification}`;
        return `${annotation?.angle}° - ${classification}`;
      }
      if (normalizedType === 'distance') {
        const pageIndex = Number.isInteger(annotation?.pageIndex) ? annotation.pageIndex : this.currentPage;
        const classification = normalizeMeasurementLabel(annotation?.label);
        const measurement = this.formatDistanceAnnotation(annotation, pageIndex);
        if (annotation?.name) return `${annotation.name} • ${measurement} • ${classification}`;
        return `${classification} - ${measurement}`;
      }
      if (normalizedType === 'boxMeasurement') {
        const classification = normalizeMeasurementLabel(annotation?.label);
        const ratio = Number(annotation?.aspectRatio);
        const density = Number(annotation?.inkDensity);
        const metrics = `${Number.isFinite(ratio) ? ratio.toFixed(3) : '—'} W/H • ${Number.isFinite(density) ? `${(density * 100).toFixed(2)}%` : '—'} ink`;
        if (annotation?.name) return `${annotation.name} • ${classification} • ${metrics}`;
        return `${classification} • ${metrics}`;
      }
      if (normalizedType === 'length') {
        if (annotation?.name) return annotation.name;
        return annotation?.label ? this.camelToTitle(annotation.label) : `Length ${index + 1}`;
      }
      return `Annotation ${index + 1}`;
    },

    annotationMarker(type, annotation) {
      return {
        type: this.normalizeAnnotationDisplayType(type),
        id: annotation?.id || null,
        ref: annotation?.id ? null : annotation,
        pageIndex: this.currentPage,
      };
    },

    isAnnotationFlashing(type, annotation) {
      const marker = this.flashingAnnotation;
      if (!marker || marker.pageIndex !== this.currentPage) return false;
      if (marker.type !== this.normalizeAnnotationDisplayType(type)) return false;
      return annotation?.id ? marker.id === annotation.id : marker.ref === annotation;
    },

    flashBankAnnotation(item) {
      if (!item?.data) return;
      clearTimeout(this._annotationFlashTimer);
      this.flashingAnnotation = this.annotationMarker(item.type, item.data);
      if (this.normalizeAnnotationDisplayType(item.type) === 'comment') {
        this.renderCommentOverlays();
      }

      this._annotationFlashTimer = setTimeout(() => {
        this.flashingAnnotation = null;
        this._annotationFlashTimer = null;
        if (this.normalizeAnnotationDisplayType(item.type) === 'comment') {
          this.renderCommentOverlays();
        }
      }, 3000);
    },

    showAnnotationTooltip(type, annotation, index, event) {
      if (this.isAnyToolActive) return;
      this.annotationHoverTooltip = {
        visible: true,
        label: this.getAnnotationBankLabel(type, annotation, index),
        x: Math.min(event.clientX + 12, window.innerWidth - 220),
        y: Math.min(event.clientY + 12, window.innerHeight - 44),
      };
    },

    moveAnnotationTooltip(event) {
      if (!this.annotationHoverTooltip.visible) return;
      this.annotationHoverTooltip = {
        ...this.annotationHoverTooltip,
        x: Math.min(event.clientX + 12, window.innerWidth - 220),
        y: Math.min(event.clientY + 12, window.innerHeight - 44),
      };
    },

    hideAnnotationTooltip() {
      this.annotationHoverTooltip = {
        visible: false,
        label: '',
        x: 0,
        y: 0,
      };
    },

    handleDeleteAnnotation(annotation) {
      const pageAnnotations = this.annotationsByPage[this.currentPage] || [];

      switch (annotation.type) {
        case 'highlight': {
          // Find highlights in annotationsByPage with type 'highlight', delete by index
          const highlights = pageAnnotations.filter(a => a.type === 'highlight');
          if (highlights[annotation.index]) {
            const idx = pageAnnotations.indexOf(highlights[annotation.index]);
            if (idx !== -1) this.annotationsByPage[this.currentPage].splice(idx, 1);
          }
          break;
        }
        case 'underline': {
          const underlines = pageAnnotations.filter(a => a.type === 'underline');
          if (underlines[annotation.index]) {
            const idx = pageAnnotations.indexOf(underlines[annotation.index]);
            if (idx !== -1) this.annotationsByPage[this.currentPage].splice(idx, 1);
          }
          break;
        }
        case 'trace': {
          const traces = pageAnnotations.filter(a => a.type === 'trace');
          if (traces[annotation.index]) {
            const idx = pageAnnotations.indexOf(traces[annotation.index]);
            if (idx !== -1) this.annotationsByPage[this.currentPage].splice(idx, 1);
          }
          break;
        }
        case 'comment':
          if (this.comments[this.currentPage]) {
            this.comments[this.currentPage].splice(annotation.index, 1);
          }
          break;
        case 'angle': {
          const angles = pageAnnotations.filter(a => a.type === 'measure');
          if (angles[annotation.index]) {
            this.deleteAngleAnnotation(angles[annotation.index], this.currentPage);
            return;
          }
          break;
        }
        case 'distance': {
          const distances = pageAnnotations.filter(a => a.type === 'distance');
          if (distances[annotation.index]) {
            this.deleteDistanceAnnotation(distances[annotation.index], this.currentPage);
            return;
          }
          break;
        }
        case 'boxMeasurement': {
          const boxes = pageAnnotations.filter(a => a.type === 'boxMeasurement');
          const target = boxes[annotation.index];
          if (target) {
            const idx = pageAnnotations.indexOf(target);
            if (idx !== -1) this.annotationsByPage[this.currentPage].splice(idx, 1);
            if (target.id && this.sessionConnected) {
              this.syncDeleteAnnotation('boxMeasurements', target.id, this.currentPage);
            } else if (this.activeSessionId) {
              this.queueSessionSnapshotSync();
            }
          }
          break;
        }
        case 'length-h':
        case 'length-v':
          this.deleteLengthMeasurement(annotation.id);
          break;
      }
      this.selectedAnnotationItem = null;
      this.showToolMessage("Annotation deleted.");
    },

    openAngleContextMenu(annotation, event) {
      if (!annotation) return;
      const menuWidth = 210;
      const menuHeight = 82;
      const margin = 8;
      this.angleContextMenu = {
        visible: true,
        x: Math.max(margin, Math.min(event.clientX, window.innerWidth - menuWidth - margin)),
        y: Math.max(margin, Math.min(event.clientY, window.innerHeight - menuHeight - margin)),
        annotation,
        pageIndex: this.currentPage,
      };
    },

    closeAngleContextMenu() {
      this.angleContextMenu = {
        visible: false,
        x: 0,
        y: 0,
        annotation: null,
        pageIndex: this.currentPage,
      };
    },

    deleteAngleFromContextMenu() {
      const { annotation, pageIndex } = this.angleContextMenu;
      this.closeAngleContextMenu();
      this.deleteAngleAnnotation(annotation, pageIndex);
    },

    moveAngleFromContextMenu() {
      const { annotation, pageIndex } = this.angleContextMenu;
      this.closeAngleContextMenu();
      this.selectAngleForKeyboardMove(annotation, pageIndex);
    },

    isAngleSelectedForKeyboardMove(annotation) {
      if (!annotation || this.keyboardMovingAnglePageIndex !== this.currentPage) return false;
      return annotation.id
        ? annotation.id === this.keyboardMovingAngleId
        : annotation === this.keyboardMovingAngleRef;
    },

    selectAngleForKeyboardMove(annotation, pageIndex = this.currentPage) {
      if (!annotation || annotation.type !== 'measure') return;
      this.keyboardMovingAngleId = annotation.id || null;
      this.keyboardMovingAngleRef = annotation.id ? null : annotation;
      this.keyboardMovingAnglePageIndex = pageIndex;
      this.showToolMessage('Angle selected. Use arrow keys to move it; hold Shift for larger steps.');
    },

    clearKeyboardMovingAngle() {
      this.keyboardMovingAngleId = null;
      this.keyboardMovingAngleRef = null;
      this.keyboardMovingAnglePageIndex = null;
    },

    handleAngleMoveKeyDown(event) {
      const target = event.target;
      const tagName = target?.tagName?.toLowerCase();
      if (target?.isContentEditable || ['input', 'textarea', 'select'].includes(tagName)) return;
      if (event.key === 'Escape' && this.boxMeasurementModeActive) {
        event.preventDefault();
        this.finishBoxMeasurementMode();
        return;
      }

      const hasAngleSelection = this.keyboardMovingAngleId || this.keyboardMovingAngleRef;
      const hasRectSelection = this.isSelectedMovableRectAnnotation();
      const hasPointSelection = this.isSelectedMovablePointAnnotation();
      if (!hasAngleSelection && !hasRectSelection && !hasPointSelection) return;

      if (event.key === 'Escape') {
        event.preventDefault();
        this.clearKeyboardMovingAngle();
        if (hasRectSelection || hasPointSelection) this.selectedAnnotationItem = null;
        this.showToolMessage('Move selection cleared.');
        return;
      }

      if (this.angleContextMenu.visible) return;
      const step = event.shiftKey ? 10 : 1;
      const deltas = {
        ArrowLeft: [-step, 0],
        ArrowRight: [step, 0],
        ArrowUp: [0, -step],
        ArrowDown: [0, step],
      };
      const delta = deltas[event.key];
      if (!delta) return;

      event.preventDefault();
      if (hasAngleSelection) {
        this.moveSelectedAngleBy(delta[0], delta[1]);
      } else if (hasPointSelection) {
        this.moveSelectedPointAnnotationBy(delta[0], delta[1]);
      } else {
        this.moveSelectedRectAnnotationBy(delta[0], delta[1]);
      }
    },

    isSelectedMovableRectAnnotation() {
      const type = this.normalizeAnnotationDisplayType(this.selectedAnnotationItem?.type);
      return type === 'highlight' || type === 'underline' || type === 'boxMeasurement';
    },

    isSelectedMovablePointAnnotation() {
      const type = this.normalizeAnnotationDisplayType(this.selectedAnnotationItem?.type);
      return type === 'distance';
    },

    moveSelectedRectAnnotationBy(dx, dy) {
      const item = this.selectedAnnotationItem;
      if (!item?.data || !this.isSelectedMovableRectAnnotation()) return false;

      const type = this.normalizeAnnotationDisplayType(item.type);
      const pageIndex = Number.isInteger(item.data.pageIndex) ? item.data.pageIndex : this.currentPage;
      if (pageIndex !== this.currentPage) return false;

      const pageAnnotations = this.annotationsByPage[pageIndex] || [];
      const index = item.data.id
        ? pageAnnotations.findIndex(annotation => annotation?.type === type && annotation.id === item.data.id)
        : pageAnnotations.indexOf(item.data);
      if (index === -1) {
        this.selectedAnnotationItem = null;
        return false;
      }

      const annotation = pageAnnotations[index];
      const width = Math.max(0, Number(annotation.width) || 0);
      const height = Math.max(0, Number(annotation.height) || (type === 'underline' ? 2 : 0));
      const imageWidth = Number(this.osdImageWidth) || 0;
      const imageHeight = Number(this.osdImageHeight) || 0;
      const currentX = Number(annotation.x) || 0;
      const currentY = Number(annotation.y) || 0;
      const nextX = imageWidth
        ? Math.max(0, Math.min(currentX + dx, Math.max(0, imageWidth - width)))
        : currentX + dx;
      const nextY = imageHeight
        ? Math.max(0, Math.min(currentY + dy, Math.max(0, imageHeight - height)))
        : currentY + dy;
      if (nextX === currentX && nextY === currentY) return false;

      const updates = { x: nextX, y: nextY };
      const movedAnnotation = { ...annotation, ...updates };
      pageAnnotations.splice(index, 1, movedAnnotation);
      this.selectedAnnotationItem = {
        ...item,
        label: this.getAnnotationBankLabel(type, movedAnnotation, item.index),
        data: movedAnnotation,
      };

      const syncTypes = { highlight: 'highlights', underline: 'underlines', boxMeasurement: 'boxMeasurements' };
      if (type === 'boxMeasurement') {
        this.scheduleBoxMeasurementRecalculation(movedAnnotation);
        return true;
      }
      if (movedAnnotation.id && this.sessionConnected) {
        this.syncUpdateAnnotation(syncTypes[type], movedAnnotation.id, updates, pageIndex);
      } else if (this.activeSessionId) {
        clearTimeout(this._rectMovePersistTimer);
        this._rectMovePersistTimer = setTimeout(() => {
          this.syncAllAnnotations(this.getAllAnnotations()).catch(error => {
            console.error('Failed to persist annotation movement:', error);
            this.showToolMessage('Annotation moved locally, but session sync failed.');
          });
        }, 250);
      }
      return true;
    },

    moveSelectedPointAnnotationBy(dx, dy) {
      const item = this.selectedAnnotationItem;
      if (!item?.data || !this.isSelectedMovablePointAnnotation()) return false;

      const type = this.normalizeAnnotationDisplayType(item.type);
      const pageIndex = Number.isInteger(item.data.pageIndex) ? item.data.pageIndex : this.currentPage;
      if (pageIndex !== this.currentPage) return false;

      const pageAnnotations = this.annotationsByPage[pageIndex] || [];
      const rawType = type;
      const index = item.data.id
        ? pageAnnotations.findIndex(annotation => annotation?.type === rawType && annotation.id === item.data.id)
        : pageAnnotations.indexOf(item.data);
      if (index === -1) {
        this.selectedAnnotationItem = null;
        return false;
      }

      const annotation = pageAnnotations[index];
      if (!Array.isArray(annotation.points) || annotation.points.length === 0) return false;

      const xs = annotation.points.map(point => Number(point.x) || 0);
      const ys = annotation.points.map(point => Number(point.y) || 0);
      const imageWidth = Number(this.osdImageWidth) || 0;
      const imageHeight = Number(this.osdImageHeight) || 0;
      const clampedDx = imageWidth
        ? Math.max(-Math.min(...xs), Math.min(dx, imageWidth - Math.max(...xs)))
        : dx;
      const clampedDy = imageHeight
        ? Math.max(-Math.min(...ys), Math.min(dy, imageHeight - Math.max(...ys)))
        : dy;

      if (clampedDx === 0 && clampedDy === 0) return false;
      const points = annotation.points.map(point => ({
        ...point,
        x: (Number(point.x) || 0) + clampedDx,
        y: (Number(point.y) || 0) + clampedDy,
      }));
      const updates = {
        points,
        lengthPx: points.length >= 2 ? this.distanceBetweenPoints(points[0], points[1]) : annotation.lengthPx,
      };
      const movedAnnotation = { ...annotation, ...updates };
      pageAnnotations.splice(index, 1, movedAnnotation);
      this.selectedAnnotationItem = {
        ...item,
        label: this.getAnnotationBankLabel(type, movedAnnotation, item.index),
        data: movedAnnotation,
      };

      if (movedAnnotation.id && this.sessionConnected) {
        this.syncUpdateAnnotation('distances', movedAnnotation.id, updates, pageIndex);
      } else if (this.activeSessionId) {
        clearTimeout(this._rectMovePersistTimer);
        this._rectMovePersistTimer = setTimeout(() => {
          this.syncAllAnnotations(this.getAllAnnotations()).catch(error => {
            console.error('Failed to persist distance movement:', error);
            this.showToolMessage('Distance moved locally, but session sync failed.');
          });
        }, 250);
      }
      return true;
    },

    moveSelectedAngleBy(dx, dy) {
      const pageIndex = this.keyboardMovingAnglePageIndex;
      const pageAnnotations = this.annotationsByPage[pageIndex] || [];
      const index = this.keyboardMovingAngleId
        ? pageAnnotations.findIndex(a => a?.type === 'measure' && a.id === this.keyboardMovingAngleId)
        : pageAnnotations.indexOf(this.keyboardMovingAngleRef);
      if (index === -1) {
        this.clearKeyboardMovingAngle();
        return false;
      }

      const annotation = pageAnnotations[index];
      if (!Array.isArray(annotation.points) || annotation.points.length === 0) return false;

      const xs = annotation.points.map(point => Number(point.x) || 0);
      const ys = annotation.points.map(point => Number(point.y) || 0);
      const imageWidth = Number(this.osdImageWidth) || 0;
      const imageHeight = Number(this.osdImageHeight) || 0;
      const clampedDx = imageWidth
        ? Math.max(-Math.min(...xs), Math.min(dx, imageWidth - Math.max(...xs)))
        : dx;
      const clampedDy = imageHeight
        ? Math.max(-Math.min(...ys), Math.min(dy, imageHeight - Math.max(...ys)))
        : dy;

      if (clampedDx === 0 && clampedDy === 0) return false;
      const points = annotation.points.map(point => ({
        ...point,
        x: (Number(point.x) || 0) + clampedDx,
        y: (Number(point.y) || 0) + clampedDy,
      }));
      const movedAngle = { ...annotation, points };
      pageAnnotations.splice(index, 1, movedAngle);
      this.keyboardMovingAngleRef = movedAngle.id ? null : movedAngle;

      if (movedAngle.id && this.sessionConnected) {
        this.syncUpdateAnnotation('measures', movedAngle.id, { points }, pageIndex);
      } else if (this.activeSessionId) {
        clearTimeout(this._angleMovePersistTimer);
        this._angleMovePersistTimer = setTimeout(() => {
          this.syncAllAnnotations(this.getAllAnnotations()).catch(error => {
            console.error('Failed to persist angle movement:', error);
            this.showToolMessage('Angle moved locally, but session sync failed.');
          });
        }, 250);
      }
      return true;
    },

    async deleteAngleAnnotation(annotation, pageIndex = this.currentPage) {
      if (!annotation) return false;
      const pageAnnotations = this.annotationsByPage[pageIndex] || [];
      const annotationId = annotation.id;
      const index = annotationId
        ? pageAnnotations.findIndex(a => a?.type === 'measure' && a.id === annotationId)
        : pageAnnotations.indexOf(annotation);

      if (index === -1) return false;

      const [deletedAngle] = pageAnnotations.splice(index, 1);
      if ((deletedAngle?.id && deletedAngle.id === this.keyboardMovingAngleId) ||
          (!deletedAngle?.id && deletedAngle === this.keyboardMovingAngleRef)) {
        this.clearKeyboardMovingAngle();
      }
      if (deletedAngle?.id && this.angleLabelPositions[deletedAngle.id]) {
        delete this.angleLabelPositions[deletedAngle.id];
      }

      this.bankSelectedKeys = [];
      if (this.selectedAnnotationItem?.data?.id === deletedAngle?.id) {
        this.selectedAnnotationItem = null;
      }
      if (pageIndex === this.currentPage && this.editingAnnotationIndex === index) {
        this.editingAnnotationIndex = -1;
        this.draggingPoint = -1;
        this.measurePoints = [];
      }

      this.refreshVisibleAngleStatistics();

      if (deletedAngle?.id && this.sessionConnected) {
        this.syncDeleteAnnotation('measures', deletedAngle.id, pageIndex);
      } else if (this.activeSessionId) {
        try {
          await this.syncAllAnnotations(this.getAllAnnotations());
        } catch (error) {
          console.error('Failed to persist angle deletion:', error);
          this.showToolMessage('Angle deleted locally, but session sync failed.');
          return true;
        }
      }

      this.showToolMessage('Angle deleted.');
      return true;
    },

    async deleteDistanceAnnotation(annotation, pageIndex = this.currentPage) {
      if (!annotation) return false;
      const pageAnnotations = this.annotationsByPage[pageIndex] || [];
      const annotationId = annotation.id;
      const index = annotationId
        ? pageAnnotations.findIndex(a => a?.type === 'distance' && a.id === annotationId)
        : pageAnnotations.indexOf(annotation);

      if (index === -1) return false;

      const [deletedDistance] = pageAnnotations.splice(index, 1);
      if (deletedDistance?.id && this.distanceLabelPositions[deletedDistance.id]) {
        delete this.distanceLabelPositions[deletedDistance.id];
      }

      this.bankSelectedKeys = [];
      if (this.selectedAnnotationItem?.data?.id === deletedDistance?.id) {
        this.selectedAnnotationItem = null;
      }

      this.refreshVisibleDistanceStatistics();

      if (deletedDistance?.id && this.sessionConnected) {
        this.syncDeleteAnnotation('distances', deletedDistance.id, pageIndex);
      } else if (this.activeSessionId) {
        try {
          await this.syncAllAnnotations(this.getAllAnnotations());
        } catch (error) {
          console.error('Failed to persist distance deletion:', error);
          this.showToolMessage('Distance deleted locally, but session sync failed.');
          return true;
        }
      }

      this.showToolMessage('Distance deleted.');
      return true;
    },

    refreshVisibleAngleStatistics() {
      if (!this.showAngleStatistics) return;
      const pageCount = this.totalPages || this.annotationsByPage.length || 0;
      const pages = (this.angleScope === 'page' || pageCount === 0)
        ? [this.currentPage]
        : Array.from({ length: pageCount }, (_, i) => i);
      const labelFilter = this.angleFilterLabel === '__ALL__' ? null : this.angleFilterLabel;
      const values = pages.flatMap(page =>
        this.collectAngleValuesFromAnnotations(this.annotationsByPage[page] || [], labelFilter)
      );
      const stats = this.buildAngleStatistics(values);
      if (stats.count === 0) {
        this.showAngleStatistics = false;
        this.angleStatistics = stats;
      } else {
        this.angleStatistics = stats;
      }
    },

    startHoldReset() {
      // Long press (3s) to reset to 100%
      this._holdTimer = setTimeout(() => {
        this.resetZoom();
        this._holdTimer = null;
      }, 3000);
    },
    cancelHoldReset() {
      if (this._holdTimer) {
        clearTimeout(this._holdTimer);
        this._holdTimer = null;
      }
    },

    /* ---------- OpenSeadragon Methods ---------- */
    async initOpenSeadragon(imageUrl) {
      if (!imageUrl) return;
      const loadToken = (this._osdLoadToken || 0) + 1;
      this._osdLoadToken = loadToken;
      this.imageLoading = true;
      this.imageLoaded = false;
      this.iiifError = '';

      // Wait until DOM is ready (watcher with immediate:true can fire before mount)
      if (!this.$refs.viewer) {
        await this.$nextTick();
        if (!this.$refs.viewer) {
          this.imageLoading = false;
          return;
        }
      }

      // Destroy previous viewer if exists
      if (this.osdViewer) {
        // Remove all event handlers before destroying
        this.osdViewer.removeAllHandlers('open');
        this.osdViewer.removeAllHandlers('open-failed');
        this.osdViewer.removeAllHandlers('animation');
        this.osdViewer.removeAllHandlers('animation-finish');
        this.osdViewer.removeAllHandlers('resize');
        this.osdViewer.removeAllHandlers('zoom');
        this.osdViewer.removeAllHandlers('pan');
        this.osdViewer.destroy();
        this.osdViewer = null;
        this.osdReady = false;
      }

      let tileSource;
      try {
        const page = this.iiifPages[this.currentPage];
        if (page?.image) {
          const resolved = await resolveOpenSeadragonSource(page);
          if (loadToken !== this._osdLoadToken) return;
          tileSource = resolved.tileSource;
          this.imageInfoByPage[this.currentPage] = resolved.imageInfo;
          if (resolved.warning) {
            console.warn(resolved.warning);
            this.showToolMessage(resolved.warning, 8000);
          }
        } else {
          tileSource = { type: 'image', url: imageUrl };
        }
      } catch (error) {
        if (loadToken !== this._osdLoadToken) return;
        this.imageLoading = false;
        this.iiifError = `Page ${this.currentPage + 1} could not be prepared. ${formatIIIFError(error)}`;
        console.error('Failed to resolve IIIF image service:', error);
        return;
      }

      try {
        // Create OpenSeadragon viewer
        this.osdViewer = OpenSeadragon({
          element: this.$refs.osdContainer,
          tileSources: tileSource,
          showNavigationControl: false,
          showNavigator: false,
          gestureSettingsMouse: {
            clickToZoom: false,
            dblClickToZoom: false,
            scrollToZoom: true
          },
          gestureSettingsTouch: {
            pinchToZoom: true
          },
          zoomPerScroll: 1 + this.zoomStep,
          minZoomLevel: 0.25,
          maxZoomLevel: this.maxZoom,
          animationTime: 0.15,
          visibilityRatio: 0.8,
          constrainDuringPan: true,
          autoResize: true,
          preserveImageSizeOnResize: true,
          immediateRender: true,
          crossOriginPolicy: 'Anonymous',
          // Canvas drawer required for openseadragon-filtering plugin
          drawer: 'canvas'
        });

        // Event handlers
        this.osdViewer.addHandler('open', this.onOsdOpen);
        this.osdViewer.addHandler('open-failed', this.onOsdOpenFailed);
        this.osdViewer.addHandler('animation', this.updateOverlayPosition);
        this.osdViewer.addHandler('animation-finish', this.updateOverlayPosition);
        this.osdViewer.addHandler('resize', this.onOsdResize);
        this.osdViewer.addHandler('zoom', this.onOsdZoom);
        this.osdViewer.addHandler('pan', this.onOsdPan);
      } catch (error) {
        this.imageLoading = false;
        this.iiifError = `OpenSeadragon could not initialize page ${this.currentPage + 1}. ${error.message || 'Unknown error.'}`;
        console.error('Failed to initialize OpenSeadragon:', error);
      }
    },

    onOsdOpen() {
      this.osdReady = true;
      this.imageLoading = false;
      this.iiifError = '';
      const tiledImage = this.osdViewer.world.getItemAt(0);
      if (tiledImage) {
        const size = tiledImage.getContentSize();
        this.osdImageWidth = size.x;
        this.osdImageHeight = size.y;
        this.imageDimensionsByPage[this.currentPage] = {
          width: size.x,
          height: size.y,
        };

        // Also update legacy dimensions for compatibility
        this.baseFitWidth = size.x;
        this.baseFitHeight = size.y;
      }
      this.imageLoaded = true;

      // Re-apply strict interaction lock if highlight mode stayed active across reloads.
      if (this.highlightModeActive) {
        this.setHighlightInteractionLock(true);
      }

      // Apply current filters
      this.applyFiltersToOsd();

      // Initial overlay position update
      this.$nextTick(() => {
        this.updateOverlayPosition();
      });
    },

    onOsdOpenFailed(event) {
      const detail = event?.message || event?.eventSource?.url || this.currentImage || 'unknown image request';
      this.imageLoading = false;
      this.osdReady = false;
      this.imageLoaded = false;
      this.iiifError = `Page ${this.currentPage + 1} failed to render in OpenSeadragon: ${detail}`;
      console.error('Failed to load image in OpenSeadragon:', detail);
    },

    onOsdZoom(event) {
      if (this.highlightInteractionLocked && this.enforceHighlightViewportSnapshot()) {
        return;
      }

      // Sync legacy zoom level for UI display
      this.zoomLevel = event.zoom;
      this.updateOverlayPosition();

      // Broadcast viewport for follow mode
      if (!this.isApplyingFollowSync) {
        this.broadcastCurrentViewport();
      }
    },

    onOsdPan() {
      if (this.highlightInteractionLocked && this.enforceHighlightViewportSnapshot()) {
        return;
      }

      this.updateOverlayPosition();

      // Broadcast viewport for follow mode
      if (!this.isApplyingFollowSync) {
        this.broadcastCurrentViewport();
      }
    },

    onOsdResize() {
      if (this.highlightInteractionLocked) {
        requestAnimationFrame(() => {
          this.enforceHighlightViewportSnapshot();
          this.updateOverlayPosition();
        });
        return;
      }

      this.updateOverlayPosition();
    },

    updateOverlayPosition() {
      // RAF throttle: prevent multiple updates per frame for smooth performance
      if (this._overlayUpdatePending) return;

      this._overlayUpdatePending = true;
      requestAnimationFrame(() => {
        this._overlayUpdatePending = false;
        // Force Vue to re-compute annotationOverlayStyle by updating reactive property
        this.osdViewportBounds = Date.now();
      });
    },

    applyFiltersToOsd() {
      // Use openseadragon-filtering plugin with correct API structure
      if (!this.osdViewer || !this.osdReady) return;

      const filters = this.currentFilters;
      const processors = [];

      // Brightness: plugin expects -255 to 255, our slider is -100 to 100
      if (filters.brightness !== 0) {
        const adjustment = (filters.brightness / 100) * 255;
        processors.push(OpenSeadragon.Filters.BRIGHTNESS(adjustment));
      }

      // Contrast: plugin expects adjustment value, our slider is 0-3
      if (filters.contrast !== 1) {
        processors.push(OpenSeadragon.Filters.CONTRAST(filters.contrast));
      }

      // Saturation: custom filter (plugin doesn't have one)
      if (filters.saturation !== undefined && filters.saturation !== 1) {
        const saturation = filters.saturation;
        processors.push(function(context, callback) {
          const imgData = context.getImageData(0, 0, context.canvas.width, context.canvas.height);
          const pixels = imgData.data;
          for (let i = 0; i < pixels.length; i += 4) {
            const r = pixels[i];
            const g = pixels[i + 1];
            const b = pixels[i + 2];
            const gray = 0.2989 * r + 0.587 * g + 0.114 * b;
            pixels[i] = gray + (r - gray) * saturation;
            pixels[i + 1] = gray + (g - gray) * saturation;
            pixels[i + 2] = gray + (b - gray) * saturation;
          }
          context.putImageData(imgData, 0, 0);
          callback();
        });
      }

      // Invert
      if (filters.invert) {
        processors.push(OpenSeadragon.Filters.INVERT());
      }

      // Grayscale
      if (filters.grayscale) {
        processors.push(OpenSeadragon.Filters.GREYSCALE());
      }

      // Threshold: Convert to binary black/white (great for faded manuscripts)
      if (filters.threshold !== null && filters.threshold !== undefined) {
        const threshold = filters.threshold;
        processors.push(OpenSeadragon.Filters.THRESHOLDING(threshold));
      }

      // Sharpen: Enhance edges for blurry scans
      if (filters.sharpen) {
        processors.push(OpenSeadragon.Filters.CONVOLUTION([
           0, -1,  0,
          -1,  5, -1,
           0, -1,  0
        ]));
      }

      // Edge Detection: Highlight text strokes (Laplacian kernel)
      if (filters.edgeDetect) {
        processors.push(OpenSeadragon.Filters.CONVOLUTION([
          -1, -1, -1,
          -1,  8, -1,
          -1, -1, -1
        ]));
      }

      // Apply using correct API: filters is an OBJECT with processors property
      // Use sync mode for better performance during zoom/pan
      this.osdViewer.setFilterOptions({
        filters: processors.length > 0 ? { processors: processors } : null,
        loadMode: 'sync'
      });
    },

    setOsdMouseNavEnabled(enabled) {
      if (!this.osdViewer) return;
      this.osdViewer.setMouseNavEnabled(enabled && !this.highlightInteractionLocked);
    },

    setHighlightInteractionLock(enabled) {
      this.highlightInteractionLocked = !!enabled;

      if (!enabled) {
        this.highlightViewportSnapshot = null;
        this.isApplyingHighlightViewportSnapshot = false;
      }

      if (!this.osdViewer) return;

      if (enabled) {
        this.captureHighlightViewportSnapshot();

        if (!this._osdGestureBackup) {
          this._osdGestureBackup = {
            mouse: { ...(this.osdViewer.gestureSettingsMouse || {}) },
            touch: { ...(this.osdViewer.gestureSettingsTouch || {}) },
          };
        }

        this.osdViewer.gestureSettingsMouse = {
          ...(this.osdViewer.gestureSettingsMouse || {}),
          clickToZoom: false,
          dblClickToZoom: false,
          scrollToZoom: false,
          dragToPan: false,
          flickEnabled: false,
        };
        this.osdViewer.gestureSettingsTouch = {
          ...(this.osdViewer.gestureSettingsTouch || {}),
          pinchToZoom: false,
          dragToPan: false,
          flickEnabled: false,
        };
        this.osdViewer.setMouseNavEnabled(false);
        return;
      }

      if (this._osdGestureBackup) {
        this.osdViewer.gestureSettingsMouse = { ...this._osdGestureBackup.mouse };
        this.osdViewer.gestureSettingsTouch = { ...this._osdGestureBackup.touch };
        this._osdGestureBackup = null;
      }

      if (!this.isAnyToolActive || this.commentModeActive) {
        this.osdViewer.setMouseNavEnabled(true);
      }
    },

    captureHighlightViewportSnapshot() {
      if (!this.osdViewer || !this.osdReady) return;
      const viewport = this.osdViewer.viewport;
      const center = viewport.getCenter(true);
      const zoom = viewport.getZoom(true);

      this.highlightViewportSnapshot = {
        centerX: center.x,
        centerY: center.y,
        zoom,
      };
    },

    enforceHighlightViewportSnapshot() {
      if (!this.highlightInteractionLocked || !this.highlightViewportSnapshot) return false;
      if (!this.osdViewer || this.isApplyingHighlightViewportSnapshot) return false;

      const viewport = this.osdViewer.viewport;
      const snapshot = this.highlightViewportSnapshot;
      const currentCenter = viewport.getCenter(true);
      const currentZoom = viewport.getZoom(true);
      const centerDelta = Math.hypot(
        currentCenter.x - snapshot.centerX,
        currentCenter.y - snapshot.centerY
      );
      const zoomDelta = Math.abs(currentZoom - snapshot.zoom);

      if (centerDelta < 1e-8 && zoomDelta < 1e-8) return false;

      this.isApplyingHighlightViewportSnapshot = true;
      viewport.zoomTo(snapshot.zoom, null, true);
      viewport.panTo(new OpenSeadragon.Point(snapshot.centerX, snapshot.centerY), true);
      viewport.applyConstraints();
      this.updateOverlayPosition();

      requestAnimationFrame(() => {
        this.isApplyingHighlightViewportSnapshot = false;
      });

      return true;
    },

    preventZoomWhileHighlighting(event) {
      if (this.highlightInteractionLocked) {
        event.preventDefault();
        event.stopPropagation();
      }
    },
    /* ---------- End OpenSeadragon Methods ---------- */

    _physicalScaleFromNode(node) {
      if (!node || typeof node !== 'object') return null;
      const candidates = [node];
      const visited = new Set();
      while (candidates.length) {
        const candidate = candidates.shift();
        if (!candidate || typeof candidate !== 'object' || visited.has(candidate)) continue;
        visited.add(candidate);
        const physicalScale = Number(candidate?.physicalScale);
        const unit = String(candidate?.physicalUnits || '').toLowerCase();
        const unitToCm = { mm: 0.1, cm: 1, in: 2.54 }[unit];
        if (Number.isFinite(physicalScale) && physicalScale > 0 && unitToCm) {
          return {
            cmPerUnit: physicalScale * unitToCm,
            physicalScale,
            physicalUnits: unit,
          };
        }
        const nested = Array.isArray(candidate.service)
          ? candidate.service
          : (candidate.service ? [candidate.service] : []);
        candidates.push(...nested);
      }
      return null;
    },

    _firstCanvasImageBody(canvas) {
      const v2Body = canvas?.images?.[0]?.resource || canvas?.images?.[0]?.body;
      if (v2Body) return Array.isArray(v2Body) ? v2Body[0] : v2Body;

      const pages = Array.isArray(canvas?.items) ? canvas.items : [];
      for (const page of pages) {
        const annotations = Array.isArray(page?.items) ? page.items : [];
        for (const annotation of annotations) {
          const body = Array.isArray(annotation?.body) ? annotation.body[0] : annotation?.body;
          if (body) return body;
        }
      }
      return null;
    },

    _extractIiifPhysicalScales(manifest) {
      const canvases = Array.isArray(manifest?.sequences?.[0]?.canvases)
        ? manifest.sequences[0].canvases
        : (Array.isArray(manifest?.items) ? manifest.items : []);
      const manifestScale = this._physicalScaleFromNode(manifest);

      return canvases.map((canvas) => {
        const body = this._firstCanvasImageBody(canvas);
        const bodyScale = this._physicalScaleFromNode(body);
        if (bodyScale) {
          const pixelsPerCm = 1 / bodyScale.cmPerUnit;
          return {
            source: 'iiif',
            pixelsPerCmX: pixelsPerCm,
            pixelsPerCmY: pixelsPerCm,
            ...bodyScale,
          };
        }

        const canvasScale = this._physicalScaleFromNode(canvas) || manifestScale;
        const canvasWidth = Number(canvas?.width);
        const canvasHeight = Number(canvas?.height);
        if (!canvasScale || !Number.isFinite(canvasWidth) || !Number.isFinite(canvasHeight) || canvasWidth <= 0 || canvasHeight <= 0) {
          return null;
        }

        return {
          source: 'iiif',
          physicalWidthCm: canvasWidth * canvasScale.cmPerUnit,
          physicalHeightCm: canvasHeight * canvasScale.cmPerUnit,
          pixelsPerCmX: 1 / canvasScale.cmPerUnit,
          pixelsPerCmY: 1 / canvasScale.cmPerUnit,
          ...canvasScale,
        };
      });
    },

    async loadRemoteSource(sourceUrl) {
      this.iiifLoading = true;
      this.iiifError = '';
      try {
        const result = await loadIIIFSource(sourceUrl);
        this.iiifPages = result.pages;
        this.images = result.pages.map((page) => page.image.displayUrl);
        this.measurementScalesByPage = result.manifest
          ? this._extractIiifPhysicalScales(result.manifest)
          : [];
        this.documentName = result.label || this.documentName;
        this.currentPage = 0;
        this.pageInput = 1;
        this.annotationsByPage = new Array(this.images.length).fill(null).map(() => []);
        this.comments = new Array(this.images.length).fill(null).map(() => []);
        return true;
      } catch (error) {
        this.images = [];
        this.iiifPages = [];
        this.measurementScalesByPage = [];
        this.annotationsByPage = [];
        this.comments = [];
        this.iiifError = formatIIIFError(error);
        console.error('Failed to load IIIF source:', error);
        return false;
      } finally {
        this.iiifLoading = false;
      }
    },

    async retryCurrentSource() {
      if (this.images.length && this.currentImage) {
        await this.initOpenSeadragon(this.currentImage);
        return;
      }
      await this.loadRemoteSource(this.iiifManifest || this.source);
    },

    /* ---------- Helpers ---------- */
    getMousePosition(event) {
      // Extract coordinates from mouse or touch event
      let clientX, clientY;

      if (event.touches && event.touches.length > 0) {
        // touchstart, touchmove - use first touch
        clientX = event.touches[0].clientX;
        clientY = event.touches[0].clientY;
      } else if (event.changedTouches && event.changedTouches.length > 0) {
        // touchend - no active touches, use changedTouches
        clientX = event.changedTouches[0].clientX;
        clientY = event.changedTouches[0].clientY;
      } else {
        // Regular mouse event
        clientX = event.clientX;
        clientY = event.clientY;
      }

      // Use OpenSeadragon coordinate translation if available
      if (this.osdViewer && this.osdReady) {
        const tiledImage = this.osdViewer.world.getItemAt(0);
        if (tiledImage) {
          // Get the container element for coordinate calculation
          const container = this.osdViewer.container;
          const rect = container.getBoundingClientRect();

          // Create a point in window coordinates relative to the container
          const containerPoint = new OpenSeadragon.Point(
            clientX - rect.left,
            clientY - rect.top
          );

          // Convert from window to viewport coordinates
          const viewportPoint = this.osdViewer.viewport.pointFromPixel(containerPoint, true);

          // Convert from viewport to image coordinates
          const imagePoint = tiledImage.viewportToImageCoordinates(viewportPoint);

          // Clamp to image bounds
          return {
            x: Math.round(Math.max(0, Math.min(this.osdImageWidth, imagePoint.x))),
            y: Math.round(Math.max(0, Math.min(this.osdImageHeight, imagePoint.y)))
          };
        }
      }

      // Fallback to legacy calculation for cropped popup or when OSD not ready
      const viewer = this.$refs.viewer;
      const rect = viewer.getBoundingClientRect();

      // Stage center in viewport coords
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;

      // Pointer delta from stage center in screen px
      const dxScreen = clientX - centerX;
      const dyScreen = clientY - centerY;

      // Undo pan & zoom to get into anchor local space (0,0 at anchor center)
      const z = this.zoomLevel || 1;
      const dxLocal = (dxScreen - this.panX) / z;
      const dyLocal = (dyScreen - this.panY) / z;

      // Convert from anchor-center coords to anchor-top-left coords
      const x = dxLocal + (this.baseFitWidth  / 2);
      const y = dyLocal + (this.baseFitHeight / 2);

      return { x, y };
    },

    getViewerRectStyle(rect) {
      // Keep this reactive to viewport changes.
      // eslint-disable-next-line no-unused-vars
      const _trigger = this.osdViewportBounds;

      if (!rect || !this.osdViewer || !this.osdReady) {
        return { display: 'none' };
      }

      const tiledImage = this.osdViewer.world.getItemAt(0);
      if (!tiledImage) {
        return { display: 'none' };
      }

      const topLeft = this.osdViewer.viewport.pixelFromPoint(
        tiledImage.imageToViewportCoordinates(new OpenSeadragon.Point(rect.x, rect.y)),
        true
      );
      const bottomRight = this.osdViewer.viewport.pixelFromPoint(
        tiledImage.imageToViewportCoordinates(new OpenSeadragon.Point(rect.x + rect.width, rect.y + rect.height)),
        true
      );

      const left = Math.min(topLeft.x, bottomRight.x);
      const top = Math.min(topLeft.y, bottomRight.y);
      const width = Math.abs(bottomRight.x - topLeft.x);
      const height = Math.abs(bottomRight.y - topLeft.y);

      return {
        position: 'absolute',
        left: `${left}px`,
        top: `${top}px`,
        width: `${width}px`,
        height: `${height}px`,
        pointerEvents: 'none',
      };
    },

    // Convert percentage coordinates to screen coordinates for remote cursor display
    cursorToScreenX(xPercent) {
      if (!this.$refs.viewer) return 0;
      const rect = this.$refs.viewer.getBoundingClientRect();
      return rect.left + (xPercent / 100) * rect.width;
    },

    cursorToScreenY(yPercent) {
      if (!this.$refs.viewer) return 0;
      const rect = this.$refs.viewer.getBoundingClientRect();
      return rect.top + (yPercent / 100) * rect.height;
    },

    formatPoints(points) {
      return points.map(({ x, y }) => `${x},${y}`).join(" ");
    },
    calculateAngle(pt1, pt2, pt3) {
      return calculateAngleDegrees(pt1, pt2, pt3) ?? 0;
    },
    
    calculateLiveAngle(pt1, vertex, mousePt) {
      // Calculate angle in real-time as mouse moves
      return this.calculateAngle(pt1, vertex, mousePt);
    },

    hasUsableAngleArms(points = []) {
      if (!Array.isArray(points) || points.length !== 3) return false;
      const minimumArmLength = 4 * this.svgInverseScale;
      const firstArm = pointDistance(points[0], points[1]);
      const secondArm = pointDistance(points[1], points[2]);
      return Number.isFinite(firstArm) && Number.isFinite(secondArm) &&
        firstArm >= minimumArmLength && secondArm >= minimumArmLength;
    },
    
    getAngleArcPath(vertex, pt1, pt2, customRadius) {
      // Draw an arc from pt1 to pt2 around vertex
      const radius = customRadius ?? 30 * this.svgInverseScale;
      
      // Calculate angles for both points relative to vertex
      const angle1 = Math.atan2(pt1.y - vertex.y, pt1.x - vertex.x);
      const angle2 = Math.atan2(pt2.y - vertex.y, pt2.x - vertex.x);
      
      // Start and end points on the arc
      const startX = vertex.x + radius * Math.cos(angle1);
      const startY = vertex.y + radius * Math.sin(angle1);
      const endX = vertex.x + radius * Math.cos(angle2);
      const endY = vertex.y + radius * Math.sin(angle2);
      
      // Determine if we should use the large arc flag
      let angleDiff = angle2 - angle1;
      if (angleDiff < 0) angleDiff += 2 * Math.PI;
      const largeArcFlag = angleDiff > Math.PI ? 1 : 0;
      
      // SVG path: Move to start, Arc to end
      return `M ${startX} ${startY} A ${radius} ${radius} 0 ${largeArcFlag} 1 ${endX} ${endY}`;
    },
    
    getSnappedPosition(x, y, shouldSnap = false) {
      // Guides use a screen-space threshold; coordinates only change when
      // snapping is explicitly enabled or Shift is held.
      const snapThreshold = 8 * this.svgInverseScale;
      this.angleSnapGuide = null;
      
      if (this.measurePoints.length === 0) {
        return { x, y };
      }
      
      const reference = this.measurePoints.length === 1
        ? this.measurePoints[0]
        : (this.measurePoints.length === 2 ? this.measurePoints[1] : null);
      const candidate = axisGuideCandidate({ x, y }, reference, snapThreshold);
      if (!candidate) return { x, y };

      this.angleSnapGuide = candidate.type === 'horizontal'
        ? { type: 'horizontal', y: candidate.y }
        : { type: 'vertical', x: candidate.x };
      return shouldSnap ? candidate.position : { x, y };
    },
    getDistanceAxisGuide(start, current) {
      if (!start || !current) return null;
      const snapThreshold = 8;
      const verticalDist = Math.abs((Number(current.y) || 0) - (Number(start.y) || 0));
      const horizontalDist = Math.abs((Number(current.x) || 0) - (Number(start.x) || 0));

      if (verticalDist < snapThreshold) {
        return {
          type: 'horizontal',
          x1: start.x,
          y1: start.y,
          x2: current.x,
          y2: start.y,
        };
      }

      if (horizontalDist < snapThreshold) {
        return {
          type: 'vertical',
          x1: start.x,
          y1: start.y,
          x2: start.x,
          y2: current.y,
        };
      }

      return null;
    },
    pixelsPerCmForPage(pageIndex = this.currentPage, axis = 'x') {
      const scale = this.measurementScalesByPage[pageIndex] || null;
      const explicitValue = axis === 'y' ? scale?.pixelsPerCmY : scale?.pixelsPerCmX;
      if (explicitValue) return explicitValue;

      const physicalSize = axis === 'y' ? scale?.physicalHeightCm : scale?.physicalWidthCm;
      const imageSize = pageIndex === this.currentPage
        ? (axis === 'y' ? this.osdImageHeight : this.osdImageWidth)
        : 0;
      if (physicalSize && imageSize > 0) {
        return imageSize / physicalSize;
      }

      return this.pixelsPerCm;
    },
    formatDistanceBetween(a, b, pageIndex = this.currentPage) {
      const px = this.distanceBetweenPoints(a, b);
      if (this.showMeasurementsInCm) {
        const x1 = Number(a?.x);
        const y1 = Number(a?.y);
        const x2 = Number(b?.x);
        const y2 = Number(b?.y);
        if (![x1, y1, x2, y2].every(Number.isFinite)) return '0.0 cm';
        const dxCm = (x2 - x1) / this.pixelsPerCmForPage(pageIndex, 'x');
        const dyCm = (y2 - y1) / this.pixelsPerCmForPage(pageIndex, 'y');
        return `${Math.hypot(dxCm, dyCm).toFixed(1)} cm`;
      }
      return `${Math.round(px)} px`;
    },
    formatDistanceAnnotation(annotation, pageIndex = this.currentPage) {
      const points = annotation?.points || [];
      if (points.length < 2) return '0 px';
      return this.formatDistanceBetween(points[0], points[1], pageIndex);
    },
    distanceMidpoint(annotationOrPoints) {
      const points = Array.isArray(annotationOrPoints)
        ? annotationOrPoints
        : (annotationOrPoints?.points || []);
      if (points.length < 2) return { x: 0, y: 0 };
      return {
        x: ((Number(points[0].x) || 0) + (Number(points[1].x) || 0)) / 2,
        y: ((Number(points[0].y) || 0) + (Number(points[1].y) || 0)) / 2,
      };
    },
    isHorizontalLabel(label) {
      return ["ascenders","descenders","interlinear","upperMargin","lowerMargin","lineHeight","minimumHeight","other_h"].includes(label);
    },
    measurementColorFor(measurementOrLabel) {
      const fallback = "rgba(110, 168, 254, 0.35)";
      if (!measurementOrLabel) return fallback;

      if (typeof measurementOrLabel === "string") {
        return this.measurementColors[measurementOrLabel] || fallback;
      }

      return (
        measurementOrLabel.color ||
        this.measurementColors[measurementOrLabel.label] ||
        fallback
      );
    },
    measurementBorderFor(measurementOrLabel) {
      const color = this.measurementColorFor(measurementOrLabel);
      return color || "rgba(110, 168, 254, 0.9)";
    },
    normalizeBandAnnotation(band, fallbackLabel = null, fallbackPageIndex = 0) {
      if (!band || typeof band !== "object") return null;

      const label = band.label || fallbackLabel;
      if (!label) return null;

      const parsedPageIndex = Number.parseInt(
        band.pageIndex !== undefined ? band.pageIndex : fallbackPageIndex,
        10
      );
      const pageIndex = Number.isFinite(parsedPageIndex) ? parsedPageIndex : 0;

      return {
        ...band,
        label,
        pageIndex,
        type: band.type || "length",
        color: band.color || this.measurementColorFor(label),
      };
    },
    isBandSelectedForResize(measurement) {
      if (!measurement) return false;
      return measurement.id
        ? measurement.id === this.selectedBandId
        : measurement === this.selectedBandRef;
    },
    selectBandForResize(measurement) {
      if (!measurement || this.isAnyToolActive) return;
      this.selectedBandId = measurement.id || null;
      this.selectedBandRef = measurement.id ? null : measurement;
      this.hideAnnotationTooltip();
    },
    clearBandResizeSelection() {
      if (this.bandResizeState) return;
      this.selectedBandId = null;
      this.selectedBandRef = null;
    },
    startBandResize(measurement, corner, event) {
      if (!measurement || this.isAnyToolActive || !this.bandResizeCorners.includes(corner)) return;
      this.selectBandForResize(measurement);

      const x = Number(measurement.x) || 0;
      const y = Number(measurement.y) || 0;
      const width = Math.max(1, Number(measurement.width) || 0);
      const height = Math.max(1, Number(measurement.height) || 0);
      this.bandResizeState = {
        measurement,
        corner,
        pageIndex: this.currentPage,
        fixedX: corner.includes('w') ? x + width : x,
        fixedY: corner.includes('n') ? y + height : y,
      };

      event.currentTarget?.setPointerCapture?.(event.pointerId);
      this.setOsdMouseNavEnabled(false);
      window.addEventListener('pointermove', this.resizeSelectedBand);
      window.addEventListener('pointerup', this.finishBandResize, { once: true });
      window.addEventListener('pointercancel', this.finishBandResize, { once: true });
    },
    resizeSelectedBand(event) {
      const state = this.bandResizeState;
      if (!state) return;
      event.preventDefault();

      const pointer = this.getMousePosition(event);
      const imageWidth = Number(this.osdImageWidth) || Number.MAX_SAFE_INTEGER;
      const imageHeight = Number(this.osdImageHeight) || Number.MAX_SAFE_INTEGER;
      const draggedX = Math.max(0, Math.min(imageWidth, pointer.x));
      const draggedY = Math.max(0, Math.min(imageHeight, pointer.y));
      const minSize = 1;

      let x = Math.min(draggedX, state.fixedX);
      let y = Math.min(draggedY, state.fixedY);
      let width = Math.abs(draggedX - state.fixedX);
      let height = Math.abs(draggedY - state.fixedY);

      if (width < minSize) {
        width = minSize;
        x = Math.max(0, Math.min(state.fixedX, imageWidth - minSize));
      }
      if (height < minSize) {
        height = minSize;
        y = Math.max(0, Math.min(state.fixedY, imageHeight - minSize));
      }

      Object.assign(state.measurement, { x, y, width, height });
    },
    finishBandResize() {
      const state = this.bandResizeState;
      if (!state) return;

      window.removeEventListener('pointermove', this.resizeSelectedBand);
      window.removeEventListener('pointerup', this.finishBandResize);
      window.removeEventListener('pointercancel', this.finishBandResize);
      this.bandResizeState = null;
      this.setOsdMouseNavEnabled(true);

      const { measurement, pageIndex } = state;
      const updates = {
        x: measurement.x,
        y: measurement.y,
        width: measurement.width,
        height: measurement.height,
      };
      if (measurement.id && this.sessionConnected) {
        const syncType = this.isHorizontalLabel(measurement.label) ? 'horizontalBands' : 'verticalBands';
        this.syncUpdateAnnotation(syncType, measurement.id, updates, pageIndex);
      } else if (this.activeSessionId) {
        clearTimeout(this._bandResizePersistTimer);
        this._bandResizePersistTimer = setTimeout(() => {
          this.syncAllAnnotations(this.getAllAnnotations()).catch(error => {
            console.error('Failed to persist band resize:', error);
            this.showToolMessage('Band resized locally, but session sync failed.');
          });
        }, 250);
      }
    },
    generateRandomColor() {
      const palette = ["#E69F00","#56B4E9","#009E73","#F0E442","#0072B2","#D55E00","#CC79A7"];
      this._lastColor = this._lastColor || null;
      const pool = palette.filter(c => c !== this._lastColor);
      const selected = pool[Math.floor(Math.random()*pool.length)];
      this._lastColor = selected;
      return selected;
    },
    parseBankKey(key) {
      if (!key || typeof key !== 'string') {
        console.error('Invalid bank key:', key);
        return { kind: '', ref: '' };
      }
      const parts = String(key).split(":");
      if (parts.length !== 2) {
        console.error('Invalid bank key format:', key);
        return { kind: '', ref: '' };
      }
      const [kind, ref] = parts;
      return { kind, ref };
    },

    /* ----- Bank helpers ----- */
    camelToTitle(key) {
      if (!key) return "";
      // Keep the historical data key while using the domain term in the UI.
      if (key === "minimumHeight") return "Minim";
      return key
        .replace(/([a-z])([A-Z])/g, "$1 $2")
        .replace(/^./, (s) => s.toUpperCase());
    },
    colorToName(color) {
      if (!color) return "Color";
      const c = color.toLowerCase();

      // common trace palette (from generateRandomColor)
      const map = {
        "#e69f00": "Orange",
        "#56b4e9": "Sky",
        "#009e73": "Green",
        "#f0e442": "Yellow",
        "#0072b2": "Blue",
        "#d55e00": "Rust",
        "#cc79a7": "Magenta",
      };

      // try exact hex first
      if (map[c]) return map[c];

      // try rgba swatches used for bands (just rough labels)
      if (c.includes("0, 255, 0")) return "Green";
      if (c.includes("0, 0, 255")) return "Blue";
      if (c.includes("255, 165, 0")) return "Orange";
      if (c.includes("255, 0, 0")) return "Red";
      if (c.includes("128, 0, 128")) return "Purple";
      if (c.includes("0, 255, 255")) return "Cyan";
      if (c.includes("255, 0, 255")) return "Pink";
      if (c.includes("100, 100, 255")) return "Indigo";
      if (c.includes("255, 100, 100")) return "Coral";

      return "Color";
    },

    /* ---------- Toolbar ---------- */
    resetAnnotationToolState() {
      this.traceModeActive = false;
      this.measureModeActive = false;
      this.distanceModeActive = false;
      this.highlightModeActive = false;
      this.underlineModeActive = false;
      this.commentModeActive = false;
      this.lengthMeasurementActive = false;
      this.moveModeActive = false;
      this.isMeasuring = false;
      this.croppingStarted = false;
      this.cropButtonClicked = false;
      this.boxMeasurementModeActive = false;
      this.isOperationInProgress = false;

      this.startPoint = null;
      this.currentSquare = null;
      this.currentUnderline = null;
      this.currentStroke = null;
      this.boxMeasurementStart = null;
      this.currentBoxMeasurement = null;
      this.moveStartPos = null;
      this.currentMoveDelta = { x: 0, y: 0 };
      this.measurePoints = [];
      this.distancePoints = [];
      this.distanceGuideMousePos = null;
      this.angleGuideMousePos = null;
      this.angleSnapGuide = null;
      this.draggingPoint = -1;
      this.editingAnnotationIndex = -1;

      this.showTracePopup = false;
      this.showAngleLabelPopup = false;
      this.showDistanceLabelPopup = false;
      this.showHorizontalPopup = false;
      this.showVerticalPopup = false;
      this.showStatsPanel = false;
      this.activeBandGroup = null;
      this.pendingBandGroup = null;

      this.croppedStartPoint = null;
      this.croppedLive.highlight = null;
      this.croppedLive.underline = null;
      this.croppedLive.trace = null;
      this.croppedLive.measure = null;
      this.croppedDraggingPoint = -1;
      this.croppedEditingAnnotationIndex = -1;

      this._removeComposerOverlay();
      this.currentCommentText = '';
      this.setHighlightInteractionLock(false);
      this.setOsdMouseNavEnabled(true);
      this.hideAnnotationTooltip();
    },

    selectTool(tool) {
      if (!this.currentImage) return;

      // Prevent tool switching during active operation
      if (this.toolSwitchLocked) {
        console.warn('Cannot switch tools during active operation');
        return;
      }

      // Recover from a stale pointer lock before changing modes.
      this.isOperationInProgress = false;

      if (!tool || tool === 'pan') {
        this.resetAnnotationToolState();
        this.showToolMessage('Pan mode active.');
        return;
      }

      if (tool === "trace") {
        if (this.traceModeActive) {
          // Toggle OFF
          this.traceModeActive = false;
          this.showTracePopup = false;
          this.showToolMessage("Trace mode off.");
          return;
        }
        this.resetAnnotationToolState();
        // Open pen picker first
        this.showTracePopup = true;
        return;
      }

      if (tool === "measure") {
        // toggle
        if (this.measureModeActive) {
          this.measureModeActive = false;
          this.showToolMessage("Angle measurement mode deactivated.");
          return;
        }
        this.resetAnnotationToolState();
        // open label chooser first
        this.showAngleLabelPopup = true;
        return;
      }

      if (tool === "distance") {
        // toggle
        if (this.distanceModeActive) {
          this.distanceModeActive = false;
          this.distancePoints = [];
          this.distanceGuideMousePos = null;
          this.showToolMessage("Distance measurement mode deactivated.");
          return;
        }
        this.resetAnnotationToolState();
        // open label chooser first
        this.showDistanceLabelPopup = true;
        return;
      }

      if (tool === "highlight") {
        // toggle
        if (this.highlightModeActive) {
          this.highlightModeActive = false;
          this.setHighlightInteractionLock(false);
          this.startPoint = null;
          this.currentSquare = null;
          this.setOsdMouseNavEnabled(true);
          this.showToolMessage("Highlight mode deactivated.");
          return;
        }
        this.resetAnnotationToolState();
        this.highlightModeActive = true;
        this.setHighlightInteractionLock(true);
        this.setOsdMouseNavEnabled(false);
        this.showToolMessage("Highlight mode ACTIVE. Click and drag to add highlights. Click Highlight again to exit.");
        return;
      }

      if (tool === "underline") {
        // toggle
        if (this.underlineModeActive) {
          this.underlineModeActive = false;
          this.startPoint = null;
          this.currentUnderline = null;
          this.showToolMessage("Underline mode deactivated.");
          return;
        }
        this.resetAnnotationToolState();
        this.underlineModeActive = true;
        this.showToolMessage("Underline mode ACTIVE. Click and drag to add underlines. Click Underline again to exit.");
        return;
      }

      if (tool === "comment") {
        this.resetAnnotationToolState();
        this.commentModeActive = true;
        this.showToolMessage("Click anywhere to add a comment.");
        // comment is placed on next click-down within stage via startTrace
        return;
      }
    },

    showPenSelection() {
      // Keep UI minimal: set trace active immediately (we already have angles/labels UI elsewhere)
      this.resetAnnotationToolState();
      this.traceModeActive = true;
      this.showToolMessage("Trace mode active. Draw freehand on the page.");
    },

    openHorizontalPopup() {
      // toggle off if horizontal band mode already active
      if (this.lengthMeasurementActive && this.activeBandGroup === 'horizontal') {
        this.resetAnnotationToolState();
        this.showToolMessage('Horizontal bands deactivated.');
        return;
      }
      // otherwise open chooser for (re)selecting the type
      this.resetAnnotationToolState();
      this.pendingBandGroup = 'horizontal';
      this.showStatsPanel = false;
      this.showHorizontalPopup = true;
      this.showVerticalPopup = false;
    },
    openVerticalPopup() {
      // toggle off if vertical band mode already active
      if (this.lengthMeasurementActive && this.activeBandGroup === 'vertical') {
        this.resetAnnotationToolState();
        this.showToolMessage('Vertical bands deactivated.');
        return;
      }
      // otherwise open chooser for (re)selecting the type
      this.resetAnnotationToolState();
      this.pendingBandGroup = 'vertical';
      this.showStatsPanel = false;
      this.showVerticalPopup = true;
      this.showHorizontalPopup = false;
    },
    hideLengthPopup() {
      this.showHorizontalPopup = false;
      this.showVerticalPopup = false;
    },
    beginLength(type) {
      // choose a band type and stay in that mode until the same toolbar button is clicked again
      const group = this.pendingBandGroup || this.activeBandGroup || 'horizontal';
      this.startLengthMeasurement(type, group);
      const groupLabel = group === 'vertical' ? 'Vertical' : 'Horizontal';
      this.showToolMessage(`${groupLabel} "${type}" measuring is ACTIVE. Click the ${groupLabel} Bands button again to exit.`);
    },

    // Handler for horizontal measurement popup confirm
    onHorizontalConfirm(type) {
      this.pendingBandGroup = 'horizontal';
      this.beginLength(type);
    },

    // Handler for vertical measurement popup confirm
    onVerticalConfirm(type) {
      this.pendingBandGroup = 'vertical';
      this.beginLength(type);
    },

    // Handler for angle label popup confirm
    onAngleLabelConfirm(label) {
      if (!String(label || '').trim()) {
        this.showToolMessage("Choose or create a label first.");
        return;
      }
      const normalizedLabel = normalizeMeasurementLabel(label);
      this.addAngleLabelIfNeeded(normalizedLabel);
      this.resetAnnotationToolState();
      this.activeAngleLabel = normalizedLabel;
      this.measureModeActive = true;
      this.showToolMessage(`Angle measure: class "${normalizedLabel}". Click 3 points (A, vertex, B); hold Shift to snap.`);
    },
    onDistanceLabelConfirm(label) {
      if (!String(label || '').trim()) {
        this.showToolMessage("Choose or create a label first.");
        return;
      }
      const normalizedLabel = normalizeMeasurementLabel(label);
      this.addDistanceLabelIfNeeded(normalizedLabel);
      this.resetAnnotationToolState();
      this.activeDistanceLabel = normalizedLabel;
      this.distanceModeActive = true;
      this.showToolMessage(`Distance measure: class "${normalizedLabel}". Click 2 points.`);
    },

    /* ---------- Angle label popup ---------- */
    confirmNewAngleLabel() {
      if (!String(this.newAngleLabel || '').trim()) return;
      const label = normalizeMeasurementLabel(this.newAngleLabel);
      this.addAngleLabelIfNeeded(label);
      this.activeAngleLabel = label;
      this.newAngleLabel = "";
    },
    confirmAngleLabel() {
      if (!this.activeAngleLabel) {
        this.showToolMessage("Choose or create a label first.");
        return;
      }

      // Every activation starts from the same exclusive baseline.
      this.resetAnnotationToolState();
      this.measureModeActive = true;
      this.showToolMessage(`Angle measure: class "${this.activeAngleLabel}". Click 3 points (A, vertex, B); hold Shift to snap.`);
    },
    cancelAngleLabel() {
      this.activeAngleLabel = null;
      this.showAngleLabelPopup = false;
      this.measureModeActive = false;
      this.angleGuideMousePos = null;
      this.angleSnapGuide = null;
    },
    cancelDistanceLabel() {
      this.activeDistanceLabel = null;
      this.showDistanceLabelPopup = false;
      this.distanceModeActive = false;
      this.distancePoints = [];
      this.distanceGuideMousePos = null;
    },

confirmPenSelection() {
  const size = this.penSizes.find(s => s.key === this.selectedPenSize) || this.penSizes[1];
  this.penWidth  = size.w;
  this.penHeight = size.h;
  this.currentNibAngle = this.selectedPenAngle;

  this.resetAnnotationToolState();
  this.traceModeActive = true;
  this.showToolMessage(`Trace: ${size.label} nib at ${this.currentNibAngle}°`);
},
cancelPenSelection() {
  this.showTracePopup = false;
  this.traceModeActive = false;
},

    /* ---------- Stats panel ---------- */
    calculateCurrentPage() {
      this.showStatsPanel = false;
      this.showStatisticsPopup(this.getCurrentPageStatistics());
    },
    calculateEntireDocument() {
      this.showStatsPanel = false;
      this.showStatisticsPopup(this.getEntireDocumentStatistics());
    },
    calculateWholePageStatistics() {
      this.showStatsPanel = false;
      this.showWholePageStatisticsPopup(this.buildWholePageStatistics(this.currentPage));
    },

    openAnglesFilterFromStats() {
      this.showStatsPanel = false;          // ensure the stats panel closes
      if (this.angleFilterLabel !== '__ALL__' &&
          !this.angleStatisticsLabels.some(label => measurementLabelsEqual(label, this.angleFilterLabel))) {
        this.angleFilterLabel = '__ALL__';
      }
      this.showAngleFilterPopup = true;     // then open the angles filter
    },

    openDistancesFilterFromStats() {
      this.showStatsPanel = false;
      if (this.distanceFilterLabel !== '__ALL__' &&
          !this.distanceStatisticsLabels.some(label => measurementLabelsEqual(label, this.distanceFilterLabel))) {
        this.distanceFilterLabel = '__ALL__';
      }
      this.showDistanceFilterPopup = true;
    },

    runAngleStatistics() {
      const pageCount = this.totalPages || this.annotationsByPage.length || 0;
      const pages = (this.angleScope === "page" || pageCount === 0)
        ? [this.currentPage]
        : Array.from({ length: pageCount }, (_, i) => i);

      const labelFilter = this.angleFilterLabel === "__ALL__" ? null : this.angleFilterLabel;
      const angleValues = pages.flatMap((p) =>
        this.collectAngleValuesFromAnnotations(this.annotationsByPage[p] || [], labelFilter)
      );

      const stats = this.buildAngleStatistics(angleValues);
      if (stats.count === 0) {
        this.showToolMessage("No angles found for the selected scope/label.");
        this.showAngleFilterPopup = false;
        return;
      }

      const scopeText = this.angleScope === "page" ? "Current page" : "Entire document";
      const labelText = labelFilter ? `Class: ${normalizeMeasurementLabel(labelFilter)}` : "All classes";
      this.angleStatistics = stats;
      this.angleStatisticsContext = `${scopeText} • ${labelText}`;
      this.showAngleFilterPopup = false;
      this.showAngleStatistics = true;
    },

    closeAngleStatisticsPopup() {
      this.showAngleStatistics = false;
    },

    getDistanceMeasurement(annotation, pageIndex, unit = 'px') {
      const points = annotation?.points || [];
      if (points.length < 2) return null;
      if (unit === 'px') {
        const value = pointDistance(points[0], points[1]);
        return Number.isFinite(value) ? { value, approximate: false } : null;
      }

      const scale = this.measurementScalesByPage[pageIndex] || null;
      const pixelsPerCmX = this.pixelsPerCmForPage(pageIndex, 'x');
      const pixelsPerCmY = this.pixelsPerCmForPage(pageIndex, 'y');
      const value = scaledPointDistance(points[0], points[1], pixelsPerCmX, pixelsPerCmY);
      if (!Number.isFinite(value)) return null;
      const hasExplicitAxes = Number(scale?.pixelsPerCmX) > 0 && Number(scale?.pixelsPerCmY) > 0;
      return {
        value,
        approximate: !scale || scale.source === 'assumption' || !hasExplicitAxes,
      };
    },

    collectDistanceMeasurementsFromAnnotations(annotations = [], labelFilter = null, pageIndex = this.currentPage, unit = 'px') {
      if (!Array.isArray(annotations)) return [];
      return annotations
        .filter(annotation => annotation?.type === 'distance')
        .filter(annotation => !labelFilter || measurementLabelsEqual(annotation.label, labelFilter))
        .map(annotation => this.getDistanceMeasurement(annotation, pageIndex, unit))
        .filter(Boolean);
    },

    runDistanceStatistics() {
      const pageCount = Math.max(this.totalPages, this.annotationsByPage.length);
      const pages = (this.distanceScope === 'page' || pageCount === 0)
        ? [this.currentPage]
        : Array.from({ length: pageCount }, (_, index) => index);
      const labelFilter = this.distanceFilterLabel === '__ALL__' ? null : this.distanceFilterLabel;
      const unit = this.showMeasurementsInCm ? 'cm' : 'px';
      const measurements = pages.flatMap(pageIndex =>
        this.collectDistanceMeasurementsFromAnnotations(
          this.annotationsByPage[pageIndex] || [],
          labelFilter,
          pageIndex,
          unit
        )
      );
      const stats = summarizeMeasurements(measurements.map(measurement => measurement.value));
      if (stats.count === 0) {
        this.showToolMessage('No distances found for the selected scope/class.');
        this.showDistanceFilterPopup = false;
        this.showDistanceStatistics = false;
        this.distanceStatistics = { ...stats, values: [] };
        return;
      }

      const scopeText = this.distanceScope === 'page' ? 'Current page' : 'Entire document';
      const labelText = labelFilter ? `Class: ${normalizeMeasurementLabel(labelFilter)}` : 'All classes';
      this.distanceStatistics = { ...stats, values: measurements.map(measurement => measurement.value) };
      this.distanceStatisticsContext = `${scopeText} • ${labelText}`;
      this.distanceStatisticsUnit = unit;
      this.distanceStatisticsApproximateCount = measurements.filter(measurement => measurement.approximate).length;
      this.showDistanceFilterPopup = false;
      this.showDistanceStatistics = true;
    },

    refreshVisibleDistanceStatistics() {
      if (!this.showDistanceStatistics) return;
      this.runDistanceStatistics();
      this.showDistanceFilterPopup = false;
    },

    closeDistanceStatisticsPopup() {
      this.showDistanceStatistics = false;
    },

    /* ---------- Length measurement ---------- */
    startLengthMeasurement(type = this.selectedMeasurement, group = this.activeBandGroup || 'horizontal') {
      // This is the canonical band activation path. Reset first so a band can
      // never coexist with underline, highlight, trace, angle, comment, crop,
      // or move mode even if this method is called outside the toolbar flow.
      this.resetAnnotationToolState();
      this.selectedMeasurement = type;
      this.activeBandGroup = group;
      this.lengthMeasurementActive = true;
      this.isMeasuring = true;
      this.showToolMessage(`Measuring "${this.selectedMeasurement}": drag to select a band.`);
    },

    finalizeLengthBand() {
      const label = this.selectedMeasurement;
      const square = this.currentSquare;
      const minSize = 2;

      this.startPoint = null;
      this.currentSquare = null;
      this.lengthMeasurementActive = false;
      this.isMeasuring = false;
      this.activeBandGroup = null;
      this.pendingBandGroup = null;
      this.setOsdMouseNavEnabled(true);

      if (!square || square.width < minSize || square.height < minSize || !label) {
        this.showToolMessage("Band selection too small.");
        return null;
      }

      if (!this.lengthMeasurements[label]) this.lengthMeasurements[label] = {};
      if (!this.lengthMeasurements[label][this.currentPage]) this.lengthMeasurements[label][this.currentPage] = [];

      const isHorizontal = this.isHorizontalLabel(label);
      const band = {
        ...square,
        type: "length",
        id: safeUUID(),
        ...this.creationMetadata(),
        pageIndex: this.currentPage,
        label,
        createdBy: this.localParticipant?.id || null,
      };

      const normalizedBand = this.normalizeBandAnnotation(band, label, this.currentPage);
      if (!normalizedBand) return null;

      this.lengthMeasurements[label][this.currentPage].push(normalizedBand);
      this.selectedBandId = normalizedBand.id || null;
      this.selectedBandRef = normalizedBand.id ? null : normalizedBand;

      if (this.sessionConnected) {
        this.syncAddAnnotation(isHorizontal ? 'horizontalBands' : 'verticalBands', normalizedBand);
      }

      this.showToolMessage(`${this.camelToTitle(label)} band added. Pan mode active.`);
      return normalizedBand;
    },

    /* ---------- Comments (OSD overlay-based) ---------- */
    _imageToViewportPoint(x, y) {
      const tiledImage = this.osdViewer && this.osdViewer.world.getItemAt(0);
      if (!tiledImage) return null;
      return tiledImage.imageToViewportCoordinates(new OpenSeadragon.Point(x, y));
    },

    startComment(event) {
      if (!this.commentModeActive) return;
      if (this.suppressNextComment) { this.suppressNextComment = false; return; }

      const local = this.getMousePosition(event);
      const imgW = this.osdImageWidth || this.baseFitWidth;
      const imgH = this.osdImageHeight || this.baseFitHeight;
      if (local.x < 0 || local.y < 0 || local.x > imgW || local.y > imgH) return;

      this._composerImageCoords = { x: local.x, y: local.y };
      this.currentCommentText = "";
      // Deactivate comment mode and re-enable OSD navigation so the viewer
      // isn't stuck in a disabled state after the composer appears
      this.commentModeActive = false;
      this.isOperationInProgress = false;
      this.setOsdMouseNavEnabled(true);
      this._showComposerOverlay();
    },

    _showComposerOverlay() {
      this._removeComposerOverlay();

      // Position composer as a fixed-position DOM element using screen coords
      const tiledImage = this.osdViewer && this.osdViewer.world.getItemAt(0);
      if (!tiledImage) return;
      const vp = tiledImage.imageToViewportCoordinates(
        new OpenSeadragon.Point(this._composerImageCoords.x, this._composerImageCoords.y)
      );
      const screenPt = this.osdViewer.viewport.pixelFromPoint(vp, true);
      const containerRect = this.osdViewer.container.getBoundingClientRect();

      const el = document.createElement('div');
      el.className = 'comment-composer';
      el.style.position = 'fixed';
      el.style.left = (containerRect.left + screenPt.x + 22) + 'px';
      el.style.top = (containerRect.top + screenPt.y - 14) + 'px';
      el.style.zIndex = '10000';
      el.innerHTML = `
        <div class="comment-composer-leader" aria-hidden="true"></div>
        <div class="comment-composer-kicker">Comment anchored here</div>
        <textarea class="composer-textarea" placeholder="Add your comment…"></textarea>
        <div class="composer-actions">
          <button class="btn-blue comment-add-btn">Add</button>
          <button class="btn-gray comment-cancel-btn">Cancel</button>
        </div>
      `;

      const textarea = el.querySelector('textarea');
      textarea.addEventListener('input', e => { this.currentCommentText = e.target.value; });
      textarea.addEventListener('keydown', e => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.addComment(); }
      });
      el.querySelector('.comment-add-btn').addEventListener('click', () => this.addComment());
      el.querySelector('.comment-cancel-btn').addEventListener('click', () => this.cancelComment());

      document.body.appendChild(el);
      this._composerOverlayEl = el;
      this._showComposerAnchorOverlay();

      this.$nextTick(() => textarea.focus());
    },

    _removeComposerOverlay() {
      if (this._composerOverlayEl) {
        try { this._composerOverlayEl.remove(); } catch(e) {}
        this._composerOverlayEl = null;
      }
      this._removeComposerAnchorOverlay();
    },

    _showComposerAnchorOverlay() {
      this._removeComposerAnchorOverlay();
      const vp = this._imageToViewportPoint(this._composerImageCoords.x, this._composerImageCoords.y);
      if (!vp || !this.osdViewer) return;

      const el = document.createElement('div');
      el.className = 'comment-anchor-preview';
      el.innerHTML = '<span class="comment-anchor-dot"></span><span class="comment-anchor-ring"></span>';
      this.osdViewer.addOverlay({
        element: el,
        location: vp,
        placement: OpenSeadragon.Placement.CENTER,
      });
      this._composerAnchorOverlayEl = el;
    },

    _removeComposerAnchorOverlay() {
      if (!this._composerAnchorOverlayEl) return;
      try {
        this.osdViewer?.removeOverlay(this._composerAnchorOverlayEl);
      } catch(e) {}
      this._composerAnchorOverlayEl = null;
    },

    addComment() {
      if (!this.currentCommentText.trim()) return;
      if (!this.comments[this.currentPage]) this.comments[this.currentPage] = [];

      const comment = {
        id: safeUUID(),
        ...this.creationMetadata(),
        pageIndex: this.currentPage,
        x: this._composerImageCoords.x,
        y: this._composerImageCoords.y,
        text: this.currentCommentText.trim(),
        createdBy: this.localParticipant?.id || null,
      };

      this.comments[this.currentPage].push(comment);

      if (this.sessionConnected) {
        this.syncAddAnnotation('comments', comment);
      }

      this.currentCommentText = "";
      this._removeComposerOverlay();
      this.commentModeActive = false;
      this.suppressNextComment = true;
      this.renderCommentOverlays();
    },

    cancelComment() {
      this.currentCommentText = "";
      this._removeComposerOverlay();
      this.commentModeActive = false;
      this.suppressNextComment = true;
    },

    toggleCommentExpand(id) {
      this.expandedCommentId = this.expandedCommentId === id ? null : id;
      this.renderCommentOverlays();
    },

    renderCommentOverlays() {
      // Remove existing pin overlays
      if (this._commentOverlayEls) {
        this._commentOverlayEls.forEach(el => {
          try { this.osdViewer.removeOverlay(el); } catch(e) {}
        });
      }
      this._commentOverlayEls = [];

      const comments = this.comments[this.currentPage] || [];
      if (!this.osdViewer) return;

      comments.forEach((c, index) => {
        const vp = this._imageToViewportPoint(c.x, c.y);
        if (!vp) return;

        const el = document.createElement('div');
        el.className = 'comment-pin-wrapper annotation-interactive';
        el.title = this.getAnnotationBankLabel('comment', c, index);
        if (this.isAnnotationFlashing('comment', c)) {
          el.classList.add('annotation-flash');
        }
        el.innerHTML = `
          <div class="comment-pin-icon" aria-hidden="true">
            <span class="comment-pin-dot"></span>
            <span class="comment-pin-glyph">“</span>
          </div>
        `;

        if (this.expandedCommentId === c.id) {
          const bubble = document.createElement('div');
          bubble.className = 'comment-expanded-bubble';
          bubble.innerHTML = `
            <div class="comment-expanded-leader" aria-hidden="true"></div>
            <div class="comment-expanded-kicker">Anchored comment</div>
            <div class="comment-text">${this._escapeHtml(c.text)}</div>
          `;
          el.appendChild(bubble);
        }

        const stopPin = e => e.stopPropagation();
        ['pointerdown', 'pointerup', 'pointermove', 'mousedown', 'mouseup',
         'dblclick', 'touchstart', 'touchend'
        ].forEach(evt => el.addEventListener(evt, stopPin, true));
        el.addEventListener('click', (e) => { e.stopPropagation(); this.toggleCommentExpand(c.id); });
        el.addEventListener('pointerenter', e => this.showAnnotationTooltip('comment', c, index, e));
        el.addEventListener('pointermove', e => this.moveAnnotationTooltip(e));
        el.addEventListener('pointerleave', () => this.hideAnnotationTooltip());

        this.osdViewer.addOverlay({
          element: el,
          location: vp,
          placement: OpenSeadragon.Placement.CENTER,
        });
        this._commentOverlayEls.push(el);
      });
    },

    _escapeHtml(str) {
      const d = document.createElement('div');
      d.textContent = str;
      return d.innerHTML;
    },

    /* ---------- Theme dropdown ---------- */
    toggleThemeDropdown() {
      this.showThemeDropdown = !this.showThemeDropdown;
    },
    setThemeAndClose(theme) {
      this.setTheme(theme);
      this.showThemeDropdown = false;
    },

    /* ---------- Clear dropdown ---------- */
    toggleClearDropdown() {
      this.showClearDropdown = !this.showClearDropdown;
    },
    clearHighlights() {
      this.annotationsByPage[this.currentPage] = (this.annotationsByPage[this.currentPage] || [])
        .filter(a => a.type !== "highlight");
      this.queueSessionSnapshotSync();
      this.showToolMessage("Highlights cleared.");
      this.showClearDropdown = false;
    },
    clearUnderlines() {
      this.annotationsByPage[this.currentPage] = (this.annotationsByPage[this.currentPage] || [])
        .filter(a => a.type !== "underline");
      this.queueSessionSnapshotSync();
      this.showToolMessage("Underlines cleared.");
      this.showClearDropdown = false;
    },
    clearComments() {
      this.comments[this.currentPage] = [];
      this.queueSessionSnapshotSync();
      this.showToolMessage("Comments cleared.");
      this.showClearDropdown = false;
    },
    clearTraces() {
      const tracesToDelete = (this.annotationsByPage[this.currentPage] || [])
        .filter(a => a.type === "trace");
      
      this.annotationsByPage[this.currentPage] = (this.annotationsByPage[this.currentPage] || [])
        .filter(a => a.type !== "trace");
      
      // Sync deletion to session if connected
      if (this.sessionConnected && tracesToDelete.length > 0) {
        tracesToDelete.forEach(trace => {
          this.syncDeleteAnnotation('traces', trace.id, trace.pageIndex);
        });
      }
      this.queueSessionSnapshotSync();
      
      this.showToolMessage("Traces cleared.");
      this.showClearDropdown = false;
    },
    clearAngles() {
      const angleIds = (this.annotationsByPage[this.currentPage] || [])
        .filter(a => a.type === "measure" && a.id)
        .map(a => a.id);
      this.annotationsByPage[this.currentPage] = (this.annotationsByPage[this.currentPage] || [])
        .filter(a => a.type !== "measure");
      angleIds.forEach(id => {
        if (this.angleLabelPositions[id]) delete this.angleLabelPositions[id];
      });
      this.queueSessionSnapshotSync();
      this.showToolMessage("Angles cleared.");
      this.showClearDropdown = false;
    },
    clearDistances() {
      const distanceIds = (this.annotationsByPage[this.currentPage] || [])
        .filter(a => a.type === "distance" && a.id)
        .map(a => a.id);
      this.annotationsByPage[this.currentPage] = (this.annotationsByPage[this.currentPage] || [])
        .filter(a => a.type !== "distance");
      distanceIds.forEach(id => {
        if (this.distanceLabelPositions[id]) delete this.distanceLabelPositions[id];
      });
      this.queueSessionSnapshotSync();
      this.showToolMessage("Distances cleared.");
      this.showClearDropdown = false;
    },
    clearBoxMeasurements() {
      this.annotationsByPage[this.currentPage] = (this.annotationsByPage[this.currentPage] || [])
        .filter(annotation => annotation.type !== 'boxMeasurement');
      if (this.selectedAnnotationItem?.type === 'boxMeasurement') this.selectedAnnotationItem = null;
      this.queueSessionSnapshotSync();
      this.showToolMessage('Crop & Count boxes cleared.');
      this.showClearDropdown = false;
    },
    clearHorizontalLengths() {
      ["ascenders","descenders","interlinear","upperMargin","lowerMargin","lineHeight","minimumHeight","other_h"].forEach((t)=>{
        if (this.lengthMeasurements[t]) delete this.lengthMeasurements[t][this.currentPage];
      });
      this.clearBandResizeSelection();
      this.queueSessionSnapshotSync();
      this.showToolMessage("Horizontal lengths cleared.");
      this.showClearDropdown = false;
    },
    clearVerticalLengths() {
      ["internalMargin","intercolumnSpaces","externalMargin","other_v"].forEach((t)=>{
        if (this.lengthMeasurements[t]) delete this.lengthMeasurements[t][this.currentPage];
      });
      this.clearBandResizeSelection();
      this.queueSessionSnapshotSync();
      this.showToolMessage("Vertical lengths cleared.");
      this.showClearDropdown = false;
    },
    deleteLengthMeasurement(id) {
      // Find and delete measurement by id across all labels
      for (const label in this.lengthMeasurements) {
        const pageArr = this.lengthMeasurements[label]?.[this.currentPage];
        if (pageArr) {
          const idx = pageArr.findIndex(m => String(m.id) === String(id));
          if (idx !== -1) {
            pageArr.splice(idx, 1);
            if (String(this.selectedBandId) === String(id)) this.clearBandResizeSelection();
            this.queueSessionSnapshotSync();
            this.showToolMessage("Measurement deleted.");
            return;
          }
        }
      }
    },
    clearAll() {
      this.showClearDropdown = false;
      this.showClearConfirmation = true;
    },
    
    confirmClearAll() {
      (this.annotationsByPage[this.currentPage] || []).forEach(annotation => {
        if (annotation?.id && this.angleLabelPositions[annotation.id]) delete this.angleLabelPositions[annotation.id];
        if (annotation?.id && this.distanceLabelPositions[annotation.id]) delete this.distanceLabelPositions[annotation.id];
      });
      this.annotationsByPage[this.currentPage] = [];
      this.comments[this.currentPage] = [];
      const all = ["ascenders","descenders","interlinear","upperMargin","lowerMargin","internalMargin","intercolumnSpaces","externalMargin","lineHeight","minimumHeight","other_h","other_v"];
      all.forEach(t => { if (this.lengthMeasurements[t]) delete this.lengthMeasurements[t][this.currentPage]; });
      this.clearBandResizeSelection();
      this.strokes = [];
      this.measurePoints = [];
      this.calculatedAngle = 0;
      this.queueSessionSnapshotSync();
      this.showToolMessage("All annotations cleared.");
      this.showClearConfirmation = false;
    },
    
    cancelClearAll() {
      this.showClearConfirmation = false;
    },

    /* ---------- Collaboration ---------- */
    getAllAnnotations() {
      // Gather all annotations for session sharing
      const annotationsByPage = this.annotationsByPage || [];
      const comments = this.comments || [];
      const strokes = this.strokes || [];

      // Collect bands from lengthMeasurements
      const horizontalLabels = ['ascenders', 'descenders', 'interlinear', 'upperMargin', 'lowerMargin', 'lineHeight', 'minimumHeight', 'other_h'];
      const verticalLabels = ['internalMargin', 'intercolumnSpaces', 'externalMargin', 'other_v'];

      const horizontalBands = [];
      const verticalBands = [];

      horizontalLabels.forEach(label => {
        const measurements = this.lengthMeasurements[label] || {};
        Object.entries(measurements).forEach(([pageIndex, bands]) => {
          (bands || []).forEach(b => {
            const normalizedBand = this.normalizeBandAnnotation(b, label, pageIndex);
            if (normalizedBand) horizontalBands.push(normalizedBand);
          });
        });
      });

      verticalLabels.forEach(label => {
        const measurements = this.lengthMeasurements[label] || {};
        Object.entries(measurements).forEach(([pageIndex, bands]) => {
          (bands || []).forEach(b => {
            const normalizedBand = this.normalizeBandAnnotation(b, label, pageIndex);
            if (normalizedBand) verticalBands.push(normalizedBand);
          });
        });
      });

      return {
        highlights: annotationsByPage.flatMap((page, pageIndex) =>
          (page || []).filter(a => a.type === 'highlight').map(a => ({ ...a, pageIndex }))
        ),
        underlines: annotationsByPage.flatMap((page, pageIndex) =>
          (page || []).filter(a => a.type === 'underline').map(a => ({ ...a, pageIndex }))
        ),
        comments: comments.flatMap((pageComments, pageIndex) =>
          (pageComments || []).map(c => ({ ...c, pageIndex }))
        ),
        traces: annotationsByPage.flatMap((page, pageIndex) =>
          (page || []).filter(a => a.type === 'trace').map(a => ({ ...a, pageIndex }))
        ),
        angles: annotationsByPage.flatMap((page, pageIndex) =>
          (page || []).filter(a => a.type === 'measure').map(a => ({ ...a, pageIndex }))
        ),
        distances: annotationsByPage.flatMap((page, pageIndex) =>
          (page || []).filter(a => a.type === 'distance').map(a => ({ ...a, pageIndex }))
        ),
        boxMeasurements: annotationsByPage.flatMap((page, pageIndex) =>
          (page || []).filter(a => a.type === 'boxMeasurement').map(a => ({ ...a, pageIndex }))
        ),
        horizontalBands,
        verticalBands,
        settings: this.getSharedSessionSettings()
      };
    },

    // Build metadata for exports
    getExportMetadata() {
      return {
        documentName: this.documentName,
        iiifManifest: this.iiifManifest,
        totalPages: this.images.length,
        currentPage: this.currentPage
      };
    },

    // JSON Export
    handleExportJson() {
      try {
        const annotations = this.getAllAnnotations();
        const metadata = this.getExportMetadata();
        const settings = this.getSharedSessionSettings();

        exportAsJson(annotations, metadata, settings, this.documentName);
        this.showToolMessage('Exported as JSON');
      } catch (error) {
        console.error('JSON export failed:', error);
        this.showToolMessage('JSON export failed.');
      }
    },

    // TEI XML Export
    handleExportTei() {
      try {
        const annotations = this.getAllAnnotations();
        const metadata = this.getExportMetadata();

        exportAsTei(annotations, metadata, this.documentName);
        this.showToolMessage('Exported as TEI XML');
      } catch (error) {
        console.error('TEI export failed:', error);
        this.showToolMessage('TEI export failed.');
      }
    },

    // Plain Text Export
    handleExportPlainText() {
      try {
        const annotations = this.getAllAnnotations();
        const metadata = this.getExportMetadata();

        exportAsPlainText(annotations, metadata, this.documentName);
        this.showToolMessage('Exported as Plain Text');
      } catch (error) {
        console.error('Plain text export failed:', error);
        this.showToolMessage('Plain text export failed.');
      }
    },

    // W3C Web Annotation Export
    handleExportWebAnnotation() {
      try {
        const annotations = this.getAllAnnotations();
        const metadata = this.getExportMetadata();

        exportAsWebAnnotation(annotations, metadata, this.documentName);
        this.showToolMessage('Exported as Web Annotation');
      } catch (error) {
        console.error('W3C export failed:', error);
        this.showToolMessage('W3C export failed.');
      }
    },

    handleExportBoxMeasurementsCsv() {
      try {
        const annotations = this.getAllAnnotations();
        if (!annotations.boxMeasurements?.length) {
          this.showToolMessage('No Crop & Count boxes to export.');
          return;
        }
        exportBoxMeasurementsAsCsv(annotations, this.documentName);
        this.showToolMessage(`Exported ${annotations.boxMeasurements.length} Crop & Count box${annotations.boxMeasurements.length === 1 ? '' : 'es'} as CSV.`);
      } catch (error) {
        console.error('Crop & Count CSV export failed:', error);
        this.showToolMessage('Crop & Count CSV export failed.');
      }
    },

    // JSON Import
    handleImportJson(data) {
      // Use existing loadAnnotationsFromSession()
      this.loadAnnotationsFromSession(data.annotations);
      this.applySharedSessionSettings(data.settings, data.annotations);

      this.showImportDialog = false;
      this.showToolMessage('Annotations imported successfully');
    },

    handleSessionCreated(session) {
      this.sessionActive = true;
      this.showToolMessage('Session created! Share the link to collaborate.');

      // Update URL to session route without page reload
      const newUrl = `/session/${session.id}`;
      window.history.pushState({ sessionId: session.id }, '', newUrl);

      // Initialize presence tracking (joinSession was called in ShareDialog)
      this.initPresence();

      // Initialize follow mode
      this.initFollow();
      this.setupFollowSyncHandlers();

      // Subscribe to remote annotation changes (same as handleJoinSession)
      this.annotationSyncUnsubscribe = this.onSessionMessage('annotation:sync', (payload) => {
        this.handleRemoteAnnotationSync(payload);
      });
      this.annotationsSnapshotUnsubscribe = this.onSessionMessage('annotations:sync', (payload) => {
        this.handleRemoteAnnotationsSnapshot(payload);
      });
      this.settingsSyncUnsubscribe = this.onSessionMessage('settings:sync', (payload) => {
        this.handleRemoteSettingsSync(payload);
      });

      // Subscribe to version restored events (from other participants)
      this.versionRestoredUnsubscribe = this.onSessionMessage('version:restored', (payload) => {
        if (payload.annotations) {
          this.loadAnnotationsFromSession(payload.annotations);
        }
      });
    },

    applySessionComments(sessionComments) {
      // Merge incoming comments with local state
      // Group by pageIndex
      sessionComments.forEach(comment => {
        const pageIdx = comment.pageIndex || 0;
        if (!this.comments[pageIdx]) {
          this.comments[pageIdx] = [];
        }
        // Check if comment already exists locally
        const exists = this.comments[pageIdx].some(c => c.id === comment.id);
        if (!exists) {
          this.comments[pageIdx].push(comment);
        }
      });
    },

    async loadFromSession(sessionId) {
      try {
        // Import the sessions API
        const { sessionsApi } = await import('@/services/api');

        // Fetch session data
        const session = await sessionsApi.getSession(sessionId);

        // Store session info
        this.sessionActive = true;
        this.iiifManifest = session.iiifManifest;
        this.documentName = session.documentName || 'IIIF Document';

        // Load images from session
        if (session.iiifManifest.startsWith('[')) {
          // JSON array of image URLs (from uploaded files)
          this.images = JSON.parse(session.iiifManifest);
          this.iiifPages = [];
          this.measurementScalesByPage = [];
          this.annotationsByPage = this.images.map(() => []);
          this.comments = this.images.map(() => []);
        } else {
          await this.loadRemoteSource(session.iiifManifest);
        }

        // Load annotations from session
        if (session.annotations) {
          this.loadAnnotationsFromSession(session.annotations);
        }

        // Store session ID and show join dialog to ask for name
        this.pendingSessionId = sessionId;
        this.showJoinDialog = true;
      } catch (error) {
        console.error('Failed to load session:', error);
        alert('Failed to load session. The session may not exist or has expired.');
        this.$router.push({ name: 'IIIFInput' });
      }
    },

    async handleJoinSession(displayName) {
      if (!this.pendingSessionId) return;

      try {
        // Join session via HTTP API (non-blocking if it fails — the
        // session data was already loaded by loadFromSession)
        try {
          await this.joinSession(this.pendingSessionId, displayName);
        } catch (joinErr) {
          console.warn('HTTP join request failed (non-fatal):', joinErr);
        }

        // Initialize presence tracking for cursors
        try { this.initPresence(); } catch (_) { /* WS not ready */ }

        // Initialize follow mode
        try {
          this.initFollow();
          this.setupFollowSyncHandlers();
        } catch (_) { /* WS not ready */ }

        // Subscribe to remote annotation changes
        if (typeof this.onSessionMessage === 'function') {
          this.annotationSyncUnsubscribe = this.onSessionMessage('annotation:sync', (payload) => {
            this.handleRemoteAnnotationSync(payload);
          });
          this.annotationsSnapshotUnsubscribe = this.onSessionMessage('annotations:sync', (payload) => {
            this.handleRemoteAnnotationsSnapshot(payload);
          });
          this.settingsSyncUnsubscribe = this.onSessionMessage('settings:sync', (payload) => {
            this.handleRemoteSettingsSync(payload);
          });

          // Subscribe to version restored events (from other participants)
          this.versionRestoredUnsubscribe = this.onSessionMessage('version:restored', (payload) => {
            if (payload.annotations) {
              this.loadAnnotationsFromSession(payload.annotations);
            }
          });
        }

        this.sessionActive = true;
        this.pendingSessionId = null;
        this.showToolMessage('Joined session successfully');
      } catch (error) {
        console.error('Failed to join session:', error);
        this.showToolMessage('Failed to join session');
      }
    },

    handleRemoteAnnotationSync(payload) {
      const { action, annotationType, annotation, annotationId, updates, participantId, pageIndex: payloadPageIndex } = payload;

      // Skip if this is our own change (we already applied it locally)
      if (participantId === this.localParticipant?.id) return;

      this.beginApplyingSessionSync();

      try {
        const pageIndex = annotation?.pageIndex ?? payloadPageIndex ?? 0;
        const isAngleAnnotation =
          annotationType === 'angles' ||
          annotationType === 'measures' ||
          annotationType === 'angle' ||
          annotationType === 'measure';
        const isDistanceAnnotation =
          annotationType === 'distances' ||
          annotationType === 'distance';
        const isBoxMeasurementAnnotation =
          annotationType === 'boxMeasurements' ||
          annotationType === 'boxMeasurement';
        const isPageAnnotation =
          annotationType === 'highlights' ||
          annotationType === 'underlines' ||
          annotationType === 'traces' ||
          isBoxMeasurementAnnotation ||
          isDistanceAnnotation ||
          isAngleAnnotation;
        const commentChanged = annotationType === 'comments' && pageIndex === this.currentPage;

        // Ensure page array exists
        if (!this.annotationsByPage[pageIndex]) {
          this.annotationsByPage[pageIndex] = [];
        }
        if (!this.comments[pageIndex]) {
          this.comments[pageIndex] = [];
        }

        const normalizeIncomingPageAnnotation = (incoming) => {
          const next = { ...incoming, createdBy: participantId };
          if (isAngleAnnotation) next.type = 'measure';
          if (isDistanceAnnotation) next.type = 'distance';
          if (isBoxMeasurementAnnotation) next.type = 'boxMeasurement';
          return next;
        };

        // Helper for band operations
        const handleBand = (band) => {
          const normalizedBand = this.normalizeBandAnnotation(band, band?.label, pageIndex);
          const label = normalizedBand?.label;
          if (!label) return;
          if (!this.lengthMeasurements[label]) this.lengthMeasurements[label] = {};
          if (!this.lengthMeasurements[label][pageIndex]) this.lengthMeasurements[label][pageIndex] = [];
          return { arr: this.lengthMeasurements[label][pageIndex], normalizedBand };
        };

        switch (action) {
          case 'add': {
            // Add createdBy field from the participantId
            const annotationWithCreator = normalizeIncomingPageAnnotation(annotation);

            if (isPageAnnotation) {
              if (!annotationWithCreator.id || !this.annotationsByPage[pageIndex].some(a => a.id === annotationWithCreator.id)) {
                this.annotationsByPage[pageIndex].push(annotationWithCreator);
              }
              if (isAngleAnnotation) this.addAngleLabelIfNeeded(annotationWithCreator.label);
              if (isDistanceAnnotation) this.addDistanceLabelIfNeeded(annotationWithCreator.label);
              if (isBoxMeasurementAnnotation) this.addBoxMeasurementLabelIfNeeded(annotationWithCreator.label);
            } else if (annotationType === 'comments') {
              if (!annotationWithCreator.id || !this.comments[pageIndex].some(c => c.id === annotationWithCreator.id)) {
                this.comments[pageIndex].push(annotationWithCreator);
              }
            } else if (annotationType === 'horizontalBands' || annotationType === 'verticalBands') {
              const handledBand = handleBand(annotationWithCreator);
              if (handledBand?.arr && handledBand.normalizedBand) {
                const id = handledBand.normalizedBand.id;
                if (!id || !handledBand.arr.some(b => b.id === id)) {
                  handledBand.arr.push(handledBand.normalizedBand);
                }
              }
            }
            break;
          }

          case 'update':
            if (isPageAnnotation) {
              const idx = this.annotationsByPage[pageIndex].findIndex(a => a.id === annotationId);
              if (idx !== -1) {
                this.annotationsByPage[pageIndex][idx] = {
                  ...this.annotationsByPage[pageIndex][idx],
                  ...updates
                };
                if (isAngleAnnotation) this.addAngleLabelIfNeeded(updates?.label);
                if (isDistanceAnnotation) this.addDistanceLabelIfNeeded(updates?.label);
                if (isBoxMeasurementAnnotation) this.addBoxMeasurementLabelIfNeeded(updates?.label);
              }
            } else if (annotationType === 'comments') {
              const idx = this.comments[pageIndex].findIndex(a => a.id === annotationId);
              if (idx !== -1) {
                this.comments[pageIndex][idx] = {
                  ...this.comments[pageIndex][idx],
                  ...updates
                };
              }
            } else if (annotationType === 'horizontalBands' || annotationType === 'verticalBands') {
              // Find band by id across all labels
              for (const label in this.lengthMeasurements) {
                const arr = this.lengthMeasurements[label]?.[pageIndex];
                if (arr) {
                  const idx = arr.findIndex(b => b.id === annotationId);
                  if (idx !== -1) {
                    arr[idx] = { ...arr[idx], ...updates };
                    break;
                  }
                }
              }
            }
            break;

          case 'delete':
            if (isPageAnnotation) {
              this.annotationsByPage[pageIndex] = this.annotationsByPage[pageIndex].filter(a => a.id !== annotationId);
              if (isAngleAnnotation && annotationId === this.keyboardMovingAngleId) {
                this.clearKeyboardMovingAngle();
              }
              if (isDistanceAnnotation && this.distanceLabelPositions[annotationId]) {
                delete this.distanceLabelPositions[annotationId];
              }
            } else if (annotationType === 'comments') {
              this.comments[pageIndex] = this.comments[pageIndex].filter(a => a.id !== annotationId);
            } else if (annotationType === 'horizontalBands' || annotationType === 'verticalBands') {
              // Find and remove band by id across all labels
              for (const label in this.lengthMeasurements) {
                const arr = this.lengthMeasurements[label]?.[pageIndex];
                if (arr) {
                  const idx = arr.findIndex(b => b.id === annotationId);
                  if (idx !== -1) {
                    arr.splice(idx, 1);
                    break;
                  }
                }
              }
            }
            break;
        }

        // Re-render comment overlays if a comment was changed on the current page
        if (commentChanged) {
          this.$nextTick(() => this.renderCommentOverlays());
        }
        if (isAngleAnnotation) this.refreshVisibleAngleStatistics();
        if (isDistanceAnnotation) this.refreshVisibleDistanceStatistics();
      } finally {
        this.finishApplyingSessionSync();
      }
    },

    // ==================== FOLLOW MODE SYNC ====================

    setupFollowSyncHandlers() {
      this.cleanupFollowSyncHandlers();

      this.followSyncUnsubscribers.push(
        this.onViewportSync((payload) => this.applyViewportSync(payload)),
        this.onFiltersSync((payload) => this.applyFiltersSync(payload))
      );
    },

    cleanupFollowSyncHandlers() {
      this.followSyncUnsubscribers.forEach(unsub => unsub());
      this.followSyncUnsubscribers = [];
    },

    applyViewportSync(payload) {
      const { pageIndex, zoom, bounds } = payload;

      this.isApplyingFollowSync = true;

      // Navigate to page if different
      if (pageIndex !== this.currentPage) {
        this.goToPage(pageIndex + 1);
      }

      // Apply zoom/pan using OpenSeadragon
      if (this.osdViewer && bounds) {
        const rect = new OpenSeadragon.Rect(bounds.x, bounds.y, bounds.width, bounds.height);
        this.osdViewer.viewport.fitBounds(rect, true); // animated
      } else if (this.osdViewer && zoom) {
        this.osdViewer.viewport.zoomTo(zoom, null, true);
      }

      // Reset flag after animation
      setTimeout(() => {
        this.isApplyingFollowSync = false;
      }, 300);
    },

    applyFiltersSync(payload) {
      const { pageIndex, filters } = payload;

      this.isApplyingFollowSync = true;

      // Navigate to page if different
      if (pageIndex !== this.currentPage) {
        this.goToPage(pageIndex + 1);
      }

      // Apply all filters
      if (filters) {
        Object.entries(filters).forEach(([key, value]) => {
          this.setFilter(key, value);
        });
      }

      this.isApplyingFollowSync = false;
    },

    broadcastCurrentViewport() {
      if (!this.sessionConnected || this.isApplyingFollowSync) return;
      if (!this.osdViewer) return;

      const bounds = this.osdViewer.viewport.getBounds();
      const zoom = this.osdViewer.viewport.getZoom();

      this.broadcastViewport(this.currentPage, zoom, {
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height
      });
    },

    broadcastCurrentFilters() {
      if (!this.sessionConnected || this.isApplyingFollowSync) return;

      this.broadcastFilters(this.currentPage, { ...this.currentFilters });
    },

    handleVersionRestored(result) {
      // Restore annotations from version
      if (result.annotations) {
        this.loadAnnotationsFromSession(result.annotations);
      }
      this.showToolMessage(`Restored to version: ${result.restoredFrom.name}`);
    },

    loadAnnotationsFromSession(annotations) {
      annotations = annotations || {};
      this.beginApplyingSessionSync();

      // Clear current annotations
      this.annotationsByPage = [];
      this.comments = [];
      this.strokes = [];
      this.annotations = [];
      // Reset lengthMeasurements
      for (const label in this.lengthMeasurements) {
        this.lengthMeasurements[label] = {};
      }

      // Load highlights and underlines into annotationsByPage
      if (annotations.highlights) {
        annotations.highlights.forEach(h => {
          const pageIndex = h.pageIndex || 0;
          if (!this.annotationsByPage[pageIndex]) this.annotationsByPage[pageIndex] = [];
          this.annotationsByPage[pageIndex].push({ ...h, type: 'highlight' });
        });
      }
      if (annotations.underlines) {
        annotations.underlines.forEach(u => {
          const pageIndex = u.pageIndex || 0;
          if (!this.annotationsByPage[pageIndex]) this.annotationsByPage[pageIndex] = [];
          this.annotationsByPage[pageIndex].push({ ...u, type: 'underline' });
        });
      }

      // Load comments
      if (annotations.comments) {
        annotations.comments.forEach(c => {
          const pageIndex = c.pageIndex || 0;
          if (!this.comments[pageIndex]) this.comments[pageIndex] = [];
          this.comments[pageIndex].push(c);
        });
      }

      // Load traces
      if (annotations.traces) {
        annotations.traces.forEach(t => {
          const pageIndex = t.pageIndex || 0;
          if (!this.annotationsByPage[pageIndex]) this.annotationsByPage[pageIndex] = [];
          this.annotationsByPage[pageIndex].push({ ...t, type: 'trace' });
        });
      }

      // Load angles. "measures" is the legacy websocket name for this same
      // collection; saved sessions use the canonical "angles" key.
      const angleRows = [
        ...(Array.isArray(annotations.angles) ? annotations.angles : []),
        ...(Array.isArray(annotations.measures) ? annotations.measures : [])
      ];
      const seenAngleIds = new Set();
      if (angleRows.length) {
        angleRows.forEach(a => {
          if (a?.id && seenAngleIds.has(a.id)) return;
          if (a?.id) seenAngleIds.add(a.id);
          const pageIndex = a.pageIndex || 0;
          if (!this.annotationsByPage[pageIndex]) this.annotationsByPage[pageIndex] = [];
          this.annotationsByPage[pageIndex].push({ ...a, type: 'measure' });
        });
      }

      // Load straight distance measurements
      if (Array.isArray(annotations.distances)) {
        annotations.distances.forEach(distance => {
          const pageIndex = distance.pageIndex || 0;
          if (!this.annotationsByPage[pageIndex]) this.annotationsByPage[pageIndex] = [];
          this.annotationsByPage[pageIndex].push({ ...distance, type: 'distance' });
        });
      }

      // Load Crop & Count box measurements
      if (Array.isArray(annotations.boxMeasurements)) {
        annotations.boxMeasurements.forEach(box => {
          const pageIndex = box.pageIndex || 0;
          if (!this.annotationsByPage[pageIndex]) this.annotationsByPage[pageIndex] = [];
          const normalized = { ...box, type: 'boxMeasurement', label: normalizeMeasurementLabel(box.label) };
          this.annotationsByPage[pageIndex].push(normalized);
          this.addBoxMeasurementLabelIfNeeded(normalized.label);
        });
      }

      // Load bands into lengthMeasurements
      const loadBands = (bands) => {
        if (!bands) return;
        bands.forEach(b => {
          const normalizedBand = this.normalizeBandAnnotation(b, b?.label, b?.pageIndex || 0);
          const pageIndex = normalizedBand?.pageIndex || 0;
          const label = normalizedBand?.label;
          if (!label) return;
          if (!this.lengthMeasurements[label]) this.lengthMeasurements[label] = {};
          if (!this.lengthMeasurements[label][pageIndex]) this.lengthMeasurements[label][pageIndex] = [];
          this.lengthMeasurements[label][pageIndex].push(normalizedBand);
        });
      };
      loadBands(annotations.horizontalBands);
      loadBands(annotations.verticalBands);

      // Legacy import support: older files may store bands under lengthMeasurements
      const hasBandArrays =
        (Array.isArray(annotations.horizontalBands) && annotations.horizontalBands.length > 0) ||
        (Array.isArray(annotations.verticalBands) && annotations.verticalBands.length > 0);

      if (!hasBandArrays && annotations.lengthMeasurements && typeof annotations.lengthMeasurements === 'object') {
        const legacyBands = [];
        Object.entries(annotations.lengthMeasurements).forEach(([label, pages]) => {
          Object.entries(pages || {}).forEach(([pageIndex, bands]) => {
            (bands || []).forEach((band) => {
              legacyBands.push({ ...band, label, pageIndex: Number.parseInt(pageIndex, 10) });
            });
          });
        });
        loadBands(legacyBands);
      }

      this.applySharedSessionSettings(annotations.settings, annotations);
      this.$nextTick(() => this.renderCommentOverlays());
      this.finishApplyingSessionSync();
    },

    /* ---------- Label drag for length badges ---------- */
    startLabelDrag(id, event) {
      this.draggedLabelIndex = id;
      const pos = this.labelPositions[id] || { x: 15, y: 15 };
      this.labelDragOffset = { x: event.clientX - pos.x, y: event.clientY - pos.y };
      window.addEventListener("mousemove", this._onLabelDragMove);
      window.addEventListener("mouseup", this.stopLabelDrag);
    },
    dragLabel(id, event) {
      if (this.draggedLabelIndex !== id) return;
      const x = event.clientX - this.labelDragOffset.x;
      const y = event.clientY - this.labelDragOffset.y;
      this.labelPositions[id] = { x, y };
    },
    stopLabelDrag() {
      this.draggedLabelIndex = null;
      window.removeEventListener("mousemove", this._onLabelDragMove);
      window.removeEventListener("mouseup", this.stopLabelDrag);
    },

    /* ---------- Angle label drag ---------- */
    startAngleLabelDrag(id, event) {
      this.draggedLabelIndex = id;
      const el = event.currentTarget;
      const rect = el.getBoundingClientRect();
      const parentRect = el.parentElement.getBoundingClientRect();
      const currentX = rect.left - parentRect.left;
      const currentY = rect.top - parentRect.top;
      this.labelDragOffset = { x: event.clientX - currentX, y: event.clientY - currentY };
      window.addEventListener("mousemove", this._onAngleLabelDragMove);
      window.addEventListener("mouseup", this.stopAngleLabelDrag);
    },
    dragAngleLabel(id, event) {
      if (this.draggedLabelIndex !== id) return;
      const x = event.clientX - this.labelDragOffset.x;
      const y = event.clientY - this.labelDragOffset.y;
      this.angleLabelPositions[id] = { x, y };
    },
    stopAngleLabelDrag() {
      this.draggedLabelIndex = null;
      window.removeEventListener("mousemove", this._onAngleLabelDragMove);
      window.removeEventListener("mouseup", this.stopAngleLabelDrag);
    },
    startDistanceLabelDrag(id, event) {
      this.draggedLabelIndex = id;
      const el = event.currentTarget;
      const rect = el.getBoundingClientRect();
      const parentRect = el.parentElement.getBoundingClientRect();
      const currentX = rect.left - parentRect.left;
      const currentY = rect.top - parentRect.top;
      this.labelDragOffset = { x: event.clientX - currentX, y: event.clientY - currentY };
      window.addEventListener("mousemove", this._onDistanceLabelDragMove);
      window.addEventListener("mouseup", this.stopDistanceLabelDrag);
    },
    dragDistanceLabel(id, event) {
      if (this.draggedLabelIndex !== id) return;
      const x = event.clientX - this.labelDragOffset.x;
      const y = event.clientY - this.labelDragOffset.y;
      this.distanceLabelPositions[id] = { x, y };
    },
    stopDistanceLabelDrag() {
      this.draggedLabelIndex = null;
      window.removeEventListener("mousemove", this._onDistanceLabelDragMove);
      window.removeEventListener("mouseup", this.stopDistanceLabelDrag);
    },

    /* ---------- Paging ---------- */
    nextPage() {
      if (this.currentPage < this.totalPages - 1) {
        this.currentPage++;
        if (!this.comments[this.currentPage]) this.comments[this.currentPage] = [];
        this.setAdjustmentPage(this.currentPage); // sync with image adjustments
      }
    },
    prevPage() {
      if (this.currentPage > 0) {
        this.currentPage--;
        if (!this.comments[this.currentPage]) this.comments[this.currentPage] = [];
        this.setAdjustmentPage(this.currentPage); // sync with image adjustments
      }
    },
    goToPage(pageNumber = null) {
      const targetPage = pageNumber !== null ? pageNumber : this.pageInput;
      const newPage = Math.max(1, Math.min(targetPage, this.totalPages)) - 1;
      this.currentPage = newPage;
      this.pageInput = newPage + 1; // keep pageInput in sync
      this.setAdjustmentPage(newPage); // sync with image adjustments
    },

    /* ---------- Image Adjustments ---------- */
    toggleAdjustmentsPanel() {
      this.showAdjustmentsPanel = !this.showAdjustmentsPanel;
    },
    handleApplyFiltersToAll() {
      this.applyToAllPages(this.totalPages);
    },
    onFiltersChanged() {
      // Filters are applied via applyFiltersToOsd() which is triggered by the watcher
      // This handler can be used for additional side effects if needed
    },

    /* ---------- Stage interactions (DROP-IN versions) ---------- */
    startTrace(event) {
      // Check if any tool is active
      const toolActive = (
        this.traceModeActive || this.measureModeActive || this.distanceModeActive || this.highlightModeActive ||
        this.underlineModeActive || this.lengthMeasurementActive || this.croppingStarted ||
        this.boxMeasurementModeActive || this.commentModeActive || this.moveModeActive
      );

      // If no tool is active, let OpenSeadragon handle pan/zoom natively
      if (!toolActive) {
        return;
      }

      if (this.highlightInteractionLocked) {
        this.enforceHighlightViewportSnapshot();
      }

      // Mark operation as in progress to prevent tool switching
      this.isOperationInProgress = true;

      // Tool is active - disable OSD mouse navigation while drawing/annotating
      this.setOsdMouseNavEnabled(false);

      // MOVE MODE
      if (this.moveModeActive && this.bankSelectedKeys.length > 0) {
        this.moveStartPos = this.getMousePosition(event);
        return;
      }

      // COMMENT PLACEMENT
      if (this.commentModeActive) {
        this.startComment(event);
        return;
      }

      // LENGTH BANDS
      if (this.lengthMeasurementActive) {
        const { x, y } = this.getMousePosition(event);
        if (!this.startPoint) {
          this.startPoint = { x, y };
          this.currentSquare = {
            x, y, width: 0, height: 0,
            color: this.measurementColorFor(this.selectedMeasurement),
            label: this.selectedMeasurement,
          };
          return;
        }
        return;
      }

      // CROP START
      if (this.boxMeasurementModeActive && !this.boxMeasurementProcessing) {
        const { x, y } = this.getMousePosition(event);
        this.boxMeasurementStart = { x, y };
        this.currentBoxMeasurement = { x, y, width: 0, height: 0 };
        return;
      }

      // CROP START
      if (this.croppingStarted && this.cropButtonClicked && !this.croppedImage) {
        const { x, y } = this.getMousePosition(event);
        this.startPoint = { x, y };
        this.currentSquare = { x, y, width: 0, height: 0 };
        return;
      }

      // HIGHLIGHT / UNDERLINE
      if (this.highlightModeActive || this.underlineModeActive) {
        const { x, y } = this.getMousePosition(event);
        this.startPoint = { x, y };
        if (this.highlightModeActive) {
          this.currentSquare = { x, y, width: 0, height: 0 };
          this.currentUnderline = null;
        } else {
          this.currentUnderline = { x, y, width: 0, height: 2 };
          this.currentSquare = null;
        }
        return;
      }

      // TRACE
      if (this.traceModeActive) {
        const { x, y } = this.getMousePosition(event);
        this.currentStroke = {
          points: [{ x, y }],
          color: this.generateRandomColor(),
          penWidth: this.penWidth,
          penHeight: this.penHeight,
          nibAngle: this.currentNibAngle,
        };
        return;
      }

      // MEASURE DISTANCE
      if (this.distanceModeActive) {
        const { x, y } = this.getMousePosition(event);
        if (this.distancePoints.length >= 2) return;
        this.distancePoints.push({ x, y });
        if (this.distancePoints.length === 2) {
          if (!this.annotationsByPage[this.currentPage]) {
            this.annotationsByPage[this.currentPage] = [];
          }
          const distance = {
            id: safeUUID(),
            ...this.creationMetadata(),
            type: "distance",
            pageIndex: this.currentPage,
            points: [...this.distancePoints],
            lengthPx: this.distanceBetweenPoints(this.distancePoints[0], this.distancePoints[1]),
            label: this.activeDistanceLabel || "Unlabeled",
            createdBy: this.localParticipant?.id || null,
          };
          this.annotationsByPage[this.currentPage].push(distance);
          if (this.sessionConnected) {
            this.syncAddAnnotation('distances', distance);
          }
          this.addDistanceLabelIfNeeded(this.activeDistanceLabel);
          this.distancePoints = [];
          this.distanceGuideMousePos = null;
          this.isOperationInProgress = false;
          this.setOsdMouseNavEnabled(true);
        }
        return;
      }

      // MEASURE ANGLE
      if (this.measureModeActive) {
        const rawPos = this.getMousePosition(event);
        const snapRequested = this.angleSnapEnabled || !!event.shiftKey;
        const { x, y } = this.getSnappedPosition(rawPos.x, rawPos.y, snapRequested);
        const nearest = this.findNearestPoint(x, y, 10);
        if (nearest.annotationIndex !== -1) {
          this.editingAnnotationIndex = nearest.annotationIndex;
          this.draggingPoint = nearest.pointIndex;
          const ann = this.annotationsByPage[this.currentPage][this.editingAnnotationIndex];
          this.measurePoints = [...ann.points];
          return;
        }
        if (this.measurePoints.length >= 3) return;
        this.measurePoints.push({ x, y });
        if (this.measurePoints.length === 3) {
          if (!this.hasUsableAngleArms(this.measurePoints)) {
            this.measurePoints.pop();
            this.isOperationInProgress = false;
            this.showToolMessage('Angle arms are too short. Place the endpoint farther from the vertex.');
            return;
          }
          this.calculatedAngle = this.calculateAngle(this.measurePoints[0], this.measurePoints[1], this.measurePoints[2]);
          if (!this.annotationsByPage[this.currentPage]) {
            this.annotationsByPage[this.currentPage] = [];
          }
          const measure = {
            id: safeUUID(),
            ...this.creationMetadata(),
            type: "measure",
            pageIndex: this.currentPage,
            points: [...this.measurePoints],
            angle: this.calculatedAngle,
            label: this.activeAngleLabel || "Unlabeled",
            createdBy: this.localParticipant?.id || null,
          };
          this.annotationsByPage[this.currentPage].push(measure);
          // Sync to session if connected
          if (this.sessionConnected) {
            this.syncAddAnnotation('measures', measure);
          }
          this.addAngleLabelIfNeeded(this.activeAngleLabel);
          this.measurePoints = [];
          this.angleGuideMousePos = null;
          this.angleSnapGuide = null;
          // Angle creation completes on the third pointer-down. Release the
          // toolbar lock here instead of relying on a later mouseup target.
          this.isOperationInProgress = false;
          this.setOsdMouseNavEnabled(true);
        }
        return;
      }
    },

    // Track cursor for collaboration (runs on all mouse movement)
    // Uses viewport-relative coordinates (percentage) so cursor shows across entire canvas
    trackCursorForCollaboration(event) {
      if (this.sessionConnected && this.$refs.viewer) {
        const rect = this.$refs.viewer.getBoundingClientRect();
        // Calculate percentage position within the viewer container
        const xPercent = ((event.clientX - rect.left) / rect.width) * 100;
        const yPercent = ((event.clientY - rect.top) / rect.height) * 100;
        this.throttledCursorUpdate(xPercent, yPercent, this.currentPage);
      }
    },

    trace(event) {
      if (this.highlightInteractionLocked) {
        this.enforceHighlightViewportSnapshot();
      }

      // MOVE MODE: show live movement preview
      if (this.moveModeActive && this.bankSelectedKeys.length > 0 && this.moveStartPos) {
        const currentPos = this.getMousePosition(event);
        this.currentMoveDelta = {
          x: currentPos.x - this.moveStartPos.x,
          y: currentPos.y - this.moveStartPos.y,
        };
        return;
      }

      // CROP dynamic
      if (this.boxMeasurementModeActive && this.boxMeasurementStart && this.currentBoxMeasurement) {
        const { x, y } = this.getMousePosition(event);
        this.currentBoxMeasurement = {
          x: Math.min(x, this.boxMeasurementStart.x),
          y: Math.min(y, this.boxMeasurementStart.y),
          width: Math.abs(x - this.boxMeasurementStart.x),
          height: Math.abs(y - this.boxMeasurementStart.y),
        };
      }

      // CROP dynamic
      if (this.startPoint && this.cropButtonClicked && this.croppingStarted && !this.croppedImage) {
        const { x, y } = this.getMousePosition(event);
        this.currentSquare = {
          x: Math.min(x, this.startPoint.x),
          y: Math.min(y, this.startPoint.y),
          width: Math.abs(x - this.startPoint.x),
          height: Math.abs(y - this.startPoint.y),
        };
      }

      // HIGHLIGHT dynamic
      if (this.highlightModeActive && this.currentSquare) {
        const { x, y } = this.getMousePosition(event);
        this.currentSquare = {
          ...this.currentSquare,
          x: Math.min(x, this.startPoint.x),
          y: Math.min(y, this.startPoint.y),
          width: Math.abs(x - this.startPoint.x),
          height: Math.abs(y - this.startPoint.y),
        };
      }

      // UNDERLINE dynamic
      if (this.underlineModeActive && this.currentUnderline) {
        const { x } = this.getMousePosition(event);
        this.currentUnderline = {
          ...this.currentUnderline,
          x: Math.min(x, this.startPoint.x),
          width: Math.abs(x - this.startPoint.x),
        };
      }

      // BANDS dynamic
      if (this.lengthMeasurementActive && this.startPoint) {
        const { x, y } = this.getMousePosition(event);
        this.currentSquare = {
          x: Math.min(x, this.startPoint.x),
          y: Math.min(y, this.startPoint.y),
          width: Math.abs(x - this.startPoint.x),
          height: Math.abs(y - this.startPoint.y),
          color: this.measurementColorFor(this.selectedMeasurement),
          label: this.selectedMeasurement,
        };
      }

      // TRACE dynamic
      if (this.traceModeActive && this.currentStroke) {
        const { x, y } = this.getMousePosition(event);
        this.currentStroke.points.push({ x, y });
      }

      // DISTANCE: Update guide mouse position without snapping the actual endpoint
      if (this.distanceModeActive && this.distancePoints.length === 1) {
        this.distanceGuideMousePos = this.getMousePosition(event);
      }

      // ANGLE: Update guide mouse position and check for snapping
      if (this.measureModeActive) {
        const { x, y } = this.getMousePosition(event);
        const snapRequested = this.angleSnapEnabled || !!event.shiftKey;
        const snappedPos = this.getSnappedPosition(x, y, snapRequested);
        this.angleGuideMousePos = snappedPos;
      }
      
      // ANGLE drag existing vertex
      if (this.measureModeActive && this.draggingPoint !== -1) {
        const { x, y } = this.angleGuideMousePos || this.getMousePosition(event);
        this.measurePoints[this.draggingPoint] = { x, y };
        if (this.editingAnnotationIndex !== -1) {
          const ann = this.annotationsByPage[this.currentPage][this.editingAnnotationIndex];
          if (this.measurePoints.length !== 3) {
            this.measurePoints = [...ann.points];
            this.measurePoints[this.draggingPoint] = { x, y };
          }
          const newAngle =
            this.measurePoints.length === 3
              ? this.calculateAngle(this.measurePoints[0], this.measurePoints[1], this.measurePoints[2])
              : ann.angle;

          this.annotationsByPage[this.currentPage][this.editingAnnotationIndex] = {
            ...ann,
            points: [...this.measurePoints],
            angle: newAngle,
          };
        }
      }
    },

    endTrace(event) {
      // Re-enable OSD mouse navigation after tool operation completes
      this.setOsdMouseNavEnabled(true);

      // Mark operation as complete to allow tool switching
      this.isOperationInProgress = false;

      // MOVE MODE: apply delta
      if (this.moveModeActive && this.bankSelectedKeys.length > 0 && this.moveStartPos) {
        const endPos = this.getMousePosition(event);
        const dx = endPos.x - this.moveStartPos.x;
        const dy = endPos.y - this.moveStartPos.y;
        this.applyMoveDelta(dx, dy);
        this.queueSessionSnapshotSync();
        this.moveStartPos = null;
        this.currentMoveDelta = { x: 0, y: 0 };
        this.disableMoveMode();
        return;
      }

      // LENGTH BAND finalize
      if (this.lengthMeasurementActive && this.startPoint) {
        this.finalizeLengthBand();
        return;
      }

      // TRACE finalize
      if (this.traceModeActive && this.currentStroke) {
        if (!this.annotationsByPage[this.currentPage]) {
          this.annotationsByPage[this.currentPage] = [];
        }
        const trace = {
          type: "trace",
          id: safeUUID(),
          ...this.creationMetadata(),
          pageIndex: this.currentPage,
          points: this.currentStroke.points,
          color: this.currentStroke.color,
          penWidth: this.currentStroke.penWidth,
          penHeight: this.currentStroke.penHeight,
          nibAngle: this.currentStroke.nibAngle,
          createdBy: this.localParticipant?.id || null,
        };
        this.annotationsByPage[this.currentPage].push(trace);
        
        // Sync to session if connected
        if (this.sessionConnected) {
          this.syncAddAnnotation('traces', trace);
        }
        
        this.currentStroke = null;
      }

      // ANGLE drag end
      if (this.measureModeActive && this.draggingPoint !== -1) {
        const editedAnnotation = this.editingAnnotationIndex !== -1
          ? this.annotationsByPage[this.currentPage]?.[this.editingAnnotationIndex]
          : null;
        this.draggingPoint = -1;
        this.editingAnnotationIndex = -1;
        this.measurePoints = [];
        this.angleGuideMousePos = null;
        this.angleSnapGuide = null;
        if (editedAnnotation?.id && this.sessionConnected) {
          this.syncUpdateAnnotation('measures', editedAnnotation.id, {
            points: editedAnnotation.points,
            angle: editedAnnotation.angle,
          }, this.currentPage);
        } else if (editedAnnotation && this.activeSessionId) {
          this.queueSessionSnapshotSync();
        }
        if (editedAnnotation) this.refreshVisibleAngleStatistics();
      }

      // CROP finalize
      if (this.boxMeasurementModeActive && this.boxMeasurementStart && this.currentBoxMeasurement) {
        const rect = { ...this.currentBoxMeasurement };
        this.boxMeasurementStart = null;
        this.currentBoxMeasurement = null;
        this.finalizeBoxMeasurement(rect);
        return;
      }

      // CROP finalize
      if ((this.croppingStarted || this.currentSquare) && this.cropButtonClicked && !this.croppedImage) {
        this.generateCroppedFromCurrentSquare();
        this.croppingStarted = false;
        this.cropButtonClicked = false;
        this.currentSquare = null;
        this.startPoint = null;
      }

      // HIGHLIGHT / UNDERLINE finalize on mouseup to avoid drift between clicks
      if ((this.highlightModeActive || this.underlineModeActive) && this.startPoint) {
        if (!this.annotationsByPage[this.currentPage]) {
          this.annotationsByPage[this.currentPage] = [];
        }

        if (this.highlightModeActive && this.currentSquare) {
          const highlight = {
            id: safeUUID(),
            ...this.creationMetadata(),
            type: "highlight",
            pageIndex: this.currentPage,
            ...this.currentSquare,
            createdBy: this.localParticipant?.id || null,
          };
          this.annotationsByPage[this.currentPage].push(highlight);
          if (this.sessionConnected) {
            this.syncAddAnnotation('highlights', highlight);
          }
          this.currentSquare = null;
        } else if (this.underlineModeActive && this.currentUnderline) {
          const underline = {
            id: safeUUID(),
            ...this.creationMetadata(),
            type: "underline",
            pageIndex: this.currentPage,
            ...this.currentUnderline,
            createdBy: this.localParticipant?.id || null,
          };
          this.annotationsByPage[this.currentPage].push(underline);
          if (this.sessionConnected) {
            this.syncAddAnnotation('underlines', underline);
          }
          this.currentUnderline = null;
        }

        this.startPoint = null;
      }
    },

    // Handle mouse leaving the viewer during an active operation
    handleMouseLeave(event) {
      // If actively drawing/cropping/highlighting, complete the operation
      if (this.currentStroke || this.currentSquare || this.currentUnderline ||
          this.currentHighlight || this.moveStartPos) {
        this.endTrace(event);
      }
    },

    /* ---------- Angle helpers ---------- */
    findNearestPoint(x, y, threshold = 10) {
      const all = (this.annotationsByPage[this.currentPage] || [])
        .map((a, i) => ({ a, i }))
        .filter(({ a }) => a && a.type === "measure");

      let best = { annotationIndex: -1, pointIndex: -1, dist: Infinity };
      all.forEach(({ a, i }) => {
        a.points.forEach((p, pi) => {
          const d = Math.hypot(x - p.x, y - p.y);
          if (d < threshold && d < best.dist) best = { annotationIndex: i, pointIndex: pi, dist: d };
        });
      });
      return { annotationIndex: best.annotationIndex, pointIndex: best.pointIndex };
    },

    /* ---------- Cropped Angle helpers ---------- */
    findNearestCroppedPoint(x, y, threshold = 10) {
      const all = this.croppedAnnotations
        .map((a, i) => ({ a, i }))
        .filter(({ a }) => a && a.type === "measure");

      let best = { annotationIndex: -1, pointIndex: -1, dist: Infinity };
      all.forEach(({ a, i }) => {
        if (a.points && a.points.length > 0) {
          a.points.forEach((p, pi) => {
            const d = Math.hypot(x - p.x, y - p.y);
            if (d < threshold && d < best.dist) best = { annotationIndex: i, pointIndex: pi, dist: d };
          });
        }
      });
      return { annotationIndex: best.annotationIndex, pointIndex: best.pointIndex };
    },

    /* ---------- Move selected ---------- */
    enableMoveMode() {
      if (this.bankSelectedKeys.length === 0) {
        this.showToolMessage("Please select items to move first.");
        return;
      }
      this.resetAnnotationToolState();
      this.moveModeActive = true;
      this.showToolMessage("Move mode: drag on the image to reposition selected items.");
    },
    disableMoveMode() {
      this.moveModeActive = false;
      this.moveStartPos = null;
    },
    applyMoveDelta(dx, dy) {
      const page = this.currentPage;
      this.bankSelectedKeys.forEach((k) => {
        try {
          const { kind, ref } = this.parseBankKey(k);
          if (kind === "a") {
            const i = +ref;
            if (isNaN(i)) return;
            const a = this.annotationsByPage[page]?.[i];
            if (!a) return;
            if (a.type === "highlight" || a.type === "underline") {
              a.x = (a.x || 0) + dx; 
              a.y = (a.y || 0) + dy;
            } else if (a.type === "trace" || a.type === "measure" || a.type === "distance") {
              if (Array.isArray(a.points)) {
                a.points = a.points.map((p) => ({ x: (p.x || 0) + dx, y: (p.y || 0) + dy }));
              }
              if (a.id && this.angleLabelPositions[a.id]) {
                this.angleLabelPositions[a.id] = {
                  x: (this.angleLabelPositions[a.id].x || 0) + dx,
                  y: (this.angleLabelPositions[a.id].y || 0) + dy,
                };
              }
              if (a.id && this.distanceLabelPositions[a.id]) {
                this.distanceLabelPositions[a.id] = {
                  x: (this.distanceLabelPositions[a.id].x || 0) + dx,
                  y: (this.distanceLabelPositions[a.id].y || 0) + dy,
                };
              }
            }
          }
          if (kind === "c") {
            const i = +ref;
            if (isNaN(i)) return;
            const c = this.comments[page]?.[i];
            if (!c) return;
            c.x = (c.x || 0) + dx; 
            c.y = (c.y || 0) + dy;
          }
          if (kind === "l") {
            const id = ref;
            for (const label in this.lengthMeasurements) {
              const arr = this.lengthMeasurements[label]?.[page];
              if (!Array.isArray(arr)) continue;
              const m = arr.find((mm) => String(mm.id) === String(id));
              if (m) {
                m.x = (m.x || 0) + dx; 
                m.y = (m.y || 0) + dy;
                if (this.labelPositions[id]) {
                  this.labelPositions[id] = {
                    x: (this.labelPositions[id].x || 0) + dx,
                    y: (this.labelPositions[id].y || 0) + dy,
                  };
                }
                break;
              }
            }
          }
        } catch (error) {
          console.error('Error applying move delta to item:', k, error);
        }
      });
    },
    deleteSelectedFromBank() {
      if (this.bankSelectedKeys.length === 0) {
        this.showToolMessage("Please select items to delete first.");
        return;
      }
      
      const page = this.currentPage;
      const annIdxs = [];
      const cmtIdxs = [];
      const lengthIds = [];

      // Parse and validate all selected keys first
      this.bankSelectedKeys.forEach((k) => {
        try {
          const { kind, ref } = this.parseBankKey(k);
          if (kind === "a") {
            const idx = parseInt(ref);
            if (!isNaN(idx)) annIdxs.push(idx);
          }
          if (kind === "c") {
            const idx = parseInt(ref);
            if (!isNaN(idx)) cmtIdxs.push(idx);
          }
          if (kind === "l") lengthIds.push(ref);
        } catch (error) {
          console.error('Error parsing bank key:', k, error);
        }
      });

      // Delete annotations (from highest index to lowest to avoid index shifting)
      if (annIdxs.length) {
        if (!this.annotationsByPage[page]) {
          this.annotationsByPage[page] = [];
        }
        const sorted = [...annIdxs].sort((a,b)=>b-a);
        sorted.forEach((i) => {
          const ann = this.annotationsByPage[page][i];
          if (ann != null) {
            if (ann.id && this.angleLabelPositions[ann.id]) {
              delete this.angleLabelPositions[ann.id];
            }
            if (ann.id && this.distanceLabelPositions[ann.id]) {
              delete this.distanceLabelPositions[ann.id];
            }
            this.annotationsByPage[page].splice(i, 1);
          }
        });
      }
      
      // Delete comments (from highest index to lowest)
      if (cmtIdxs.length) {
        if (!this.comments[page]) {
          this.comments[page] = [];
        }
        const sorted = [...cmtIdxs].sort((a,b)=>b-a);
        sorted.forEach((i) => {
          if (this.comments[page][i] != null) {
            this.comments[page].splice(i, 1);
          }
        });
      }
      
      // Delete length measurements
      if (lengthIds.length) {
        for (const label in this.lengthMeasurements) {
          const pageArr = this.lengthMeasurements[label]?.[page];
          if (Array.isArray(pageArr)) {
            this.lengthMeasurements[label][page] = pageArr.filter((m) => !lengthIds.includes(String(m.id)));
          }
        }
        lengthIds.forEach((id) => { 
          if (this.labelPositions[id]) delete this.labelPositions[id]; 
        });
      }

      // Refresh comment overlays if any were deleted
      if (cmtIdxs.length) this.renderCommentOverlays();

      // Clear selection after successful deletion
      this.bankSelectedKeys = [];
      this.queueSessionSnapshotSync();
      this.showToolMessage(`Deleted ${annIdxs.length + cmtIdxs.length + lengthIds.length} items.`);
    },

    /* ---------- Measurement Units Toggle ---------- */
    toggleMeasurementUnits() {
      if (this.showMeasurementsInCm) {
        this.showMeasurementsInCm = false;
        this.showToolMessage('Measurements now shown in pixels.');
        return;
      }

      if (this.currentMeasurementScale) {
        this.showMeasurementsInCm = true;
        const sourceLabel = this.currentMeasurementScale.source === 'iiif'
          ? 'IIIF physical-dimension metadata'
          : (this.currentMeasurementScale.source === 'user' ? 'your page calibration' : 'the 96-DPI approximation');
        this.showToolMessage(`Measurements now shown in centimeters using ${sourceLabel}.`);
        return;
      }

      this.measurementCalibrationMode = 'choice';
      this.calibrationWidthCm = '';
      this.calibrationHeightCm = '';
      this.measurementCalibrationError = '';
      this.showMeasurementScalePopup = true;
    },

    handleMeasurementScalePopupChange(open) {
      this.showMeasurementScalePopup = open;
      if (!open) {
        this.measurementCalibrationMode = 'choice';
        this.measurementCalibrationError = '';
      }
    },

    useApproximateMeasurementScale() {
      this.measurementScalesByPage[this.currentPage] = {
        source: 'assumption',
        pixelsPerCmX: this.pixelsPerCm,
        pixelsPerCmY: this.pixelsPerCm,
      };
      this.showMeasurementScalePopup = false;
      this.showMeasurementsInCm = true;
      this.showToolMessage('Measurements now shown in centimeters using the approximate 96-DPI assumption.');
    },

    applyRealDimensionsCalibration() {
      const widthCm = Number(this.calibrationWidthCm);
      const heightCm = Number(this.calibrationHeightCm);
      const imageWidth = Number(this.osdImageWidth);
      const imageHeight = Number(this.osdImageHeight);
      if (!Number.isFinite(widthCm) || widthCm <= 0 || !Number.isFinite(heightCm) || heightCm <= 0) {
        this.measurementCalibrationError = 'Enter positive width and height values.';
        return;
      }
      if (!Number.isFinite(imageWidth) || imageWidth <= 0 || !Number.isFinite(imageHeight) || imageHeight <= 0) {
        this.measurementCalibrationError = 'The original image dimensions are not available yet.';
        return;
      }

      this.measurementScalesByPage[this.currentPage] = {
        source: 'user',
        physicalWidthCm: widthCm,
        physicalHeightCm: heightCm,
        pixelsPerCmX: imageWidth / widthCm,
        pixelsPerCmY: imageHeight / heightCm,
      };
      this.showMeasurementScalePopup = false;
      this.showMeasurementsInCm = true;
      this.measurementCalibrationError = '';
      this.showToolMessage('Measurements now shown in centimeters using your page dimensions.');
    },

    formatMeasurement(pixels, axis = 'x') {
      if (this.showMeasurementsInCm) {
        const pixelsPerCm = axis === 'y' ? this.currentPixelsPerCmY : this.currentPixelsPerCmX;
        const cm = pixels / pixelsPerCm;
        return `${cm.toFixed(1)} cm`;
      } else {
        return `${Math.round(pixels)} px`;
      }
    },

    formatDimensions(width, height) {
      if (this.showMeasurementsInCm) {
        const widthCm = width / this.currentPixelsPerCmX;
        const heightCm = height / this.currentPixelsPerCmY;
        return `${widthCm.toFixed(1)}×${heightCm.toFixed(1)} cm`;
      } else {
        return `${Math.round(width)}×${Math.round(height)} px`;
      }
    },

    /* ---------- Image & crop ---------- */
    computeBaseFit() {
      const img = this.$refs.image;
      const viewer = this.$refs.viewer;
      if (!img || !viewer) return;

      const natW = img.naturalWidth || 0;
      const natH = img.naturalHeight || 0;
      const vw = viewer.clientWidth || 0;
      const vh = viewer.clientHeight || 0;
      if (!natW || !natH || !vw || !vh) return;

      const s = Math.min(vw / natW, vh / natH);
      this.baseFitWidth  = Math.max(1, natW * s);
      this.baseFitHeight = Math.max(1, natH * s);
    },

    handleImageLoad() {
      this.computeBaseFit();
      const img = this.$refs.image;
      if (img && img.naturalWidth) {
        this.scalingFactor = (this.baseFitWidth || img.width) / img.naturalWidth;
      }
      this.imageLoaded = true;
    },
    openCropModeChooser() {
      if (this.toolSwitchLocked) return;
      this.resetAnnotationToolState();
      this.showCropModeDialog = true;
    },
    addBoxMeasurementLabelIfNeeded(label) {
      const normalized = normalizeMeasurementLabel(label);
      if (!this.boxMeasurementLabels.some(existing => measurementLabelsEqual(existing, normalized))) {
        this.boxMeasurementLabels.push(normalized);
      }
    },
    startBoxMeasurementMode(settings = {}) {
      this.resetAnnotationToolState();
      this.activeBoxMeasurementLabel = normalizeMeasurementLabel(settings.label);
      this.boxMeasurementThresholdMode = settings.thresholdMode === 'manual' ? 'manual' : 'automatic';
      this.boxMeasurementThreshold = Math.max(0, Math.min(255, Number(settings.threshold) || 0));
      this.addBoxMeasurementLabelIfNeeded(this.activeBoxMeasurementLabel);
      this.boxMeasurementModeActive = true;
      this.showToolMessage(`Crop & Count “${this.activeBoxMeasurementLabel}”: draw boxes around examples. The tool stays active until Done.` , 5000);
    },
    finishBoxMeasurementMode() {
      this.resetAnnotationToolState();
      this.showToolMessage('Crop & Count finished.');
    },
    boxMeasurementStyle(box) {
      const imageWidth = Number(this.osdImageWidth) || 1;
      const imageHeight = Number(this.osdImageHeight) || 1;
      return {
        left: `${((Number(box?.x) || 0) / imageWidth) * 100}%`,
        top: `${((Number(box?.y) || 0) / imageHeight) * 100}%`,
        width: `${((Number(box?.width) || 0) / imageWidth) * 100}%`,
        height: `${((Number(box?.height) || 0) / imageHeight) * 100}%`,
        position: 'absolute',
      };
    },
    boxMeasurementOverlayLabel(box) {
      const ratio = Number(box?.aspectRatio);
      const density = Number(box?.inkDensity);
      return `${normalizeMeasurementLabel(box?.label)} · ${Number.isFinite(ratio) ? ratio.toFixed(2) : '—'} W/H · ${Number.isFinite(density) ? `${(density * 100).toFixed(1)}%` : '—'} ink`;
    },
    async loadExactImageForCanvas(url) {
      const candidates = [url, this.buildExportImageProxyUrl(url)].filter((value, index, array) => value && array.indexOf(value) === index);
      let lastError = null;
      for (const candidate of candidates) {
        let objectUrl = null;
        try {
          if (candidate.startsWith('data:') || candidate.startsWith('blob:')) {
            return { image: await this.loadImageElementForCanvas(candidate), revoke: () => {} };
          }
          const response = await fetch(candidate, { mode: 'cors', cache: 'force-cache' });
          if (!response.ok) throw new Error(`Image request failed (${response.status})`);
          const blob = await response.blob();
          if (blob.type && !blob.type.toLowerCase().startsWith('image/')) {
            throw new Error(`Image response was ${blob.type}, not an image`);
          }
          objectUrl = URL.createObjectURL(blob);
          const image = await this.loadImageElementForCanvas(objectUrl);
          return { image, revoke: () => URL.revokeObjectURL(objectUrl) };
        } catch (error) {
          if (objectUrl) URL.revokeObjectURL(objectUrl);
          lastError = error;
        }
      }
      throw lastError || new Error('Could not load the selected source pixels');
    },
    async captureBoxMeasurementPixels(rect, pageIndex = this.currentPage, options = {}) {
      const dimensions = this.imageDimensionsByPage[pageIndex] || {};
      const imageWidth = Number(dimensions.width) || Number(rect?.imageWidth) || (pageIndex === this.currentPage ? Number(this.osdImageWidth) : 0);
      const imageHeight = Number(dimensions.height) || Number(rect?.imageHeight) || (pageIndex === this.currentPage ? Number(this.osdImageHeight) : 0);
      const bounds = normalizePixelBounds(rect, imageWidth, imageHeight);
      if (bounds.width < 4 || bounds.height < 4) throw new Error('Draw a box at least 4 × 4 source pixels.');
      if ((bounds.width * bounds.height) > 4000000) throw new Error('This box is too large to analyze. Draw a smaller region.');

      const imageUrl = this.images[pageIndex];
      if (!imageUrl) throw new Error('The page image is unavailable.');
      const serviceId = extractServiceId(imageUrl);
      const pageService = this.iiifPages[pageIndex]?.image?.service || (serviceId ? { id: serviceId } : null);
      const regionUrl = pageService
        ? buildRegionRequestUrl(pageService, this.imageInfoByPage[pageIndex], bounds)
        : '';
      const loaded = regionUrl
        ? await this.loadExactImageForCanvas(regionUrl)
        : await this.loadImageForCanvas(imageUrl);

      try {
        const canvas = document.createElement('canvas');
        canvas.width = bounds.width;
        canvas.height = bounds.height;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (!context) throw new Error('Canvas pixel analysis is unavailable in this browser.');

        if (regionUrl) {
          context.drawImage(loaded.image, 0, 0, bounds.width, bounds.height);
        } else {
          const naturalWidth = loaded.image.naturalWidth || loaded.image.width;
          const naturalHeight = loaded.image.naturalHeight || loaded.image.height;
          const scaleX = imageWidth > 0 ? naturalWidth / imageWidth : 1;
          const scaleY = imageHeight > 0 ? naturalHeight / imageHeight : 1;
          context.drawImage(
            loaded.image,
            bounds.x * scaleX,
            bounds.y * scaleY,
            bounds.width * scaleX,
            bounds.height * scaleY,
            0,
            0,
            bounds.width,
            bounds.height,
          );
        }

        const imageData = context.getImageData(0, 0, bounds.width, bounds.height);
        return {
          bounds,
          imageWidth,
          imageHeight,
          rgba: imageData.data,
          originalPreview: options.includePreview ? canvas.toDataURL('image/png') : '',
        };
      } finally {
        loaded.revoke?.();
      }
    },
    buildBoxMaskPreview(capture, threshold) {
      const canvas = document.createElement('canvas');
      canvas.width = capture.bounds.width;
      canvas.height = capture.bounds.height;
      const context = canvas.getContext('2d');
      const mask = buildInkMaskRgba(capture.rgba, threshold);
      context.putImageData(new ImageData(mask, capture.bounds.width, capture.bounds.height), 0, 0);
      return canvas.toDataURL('image/png');
    },
    async finalizeBoxMeasurement(rect) {
      if (this.boxMeasurementProcessing) return;
      this.boxMeasurementProcessing = true;
      this.showToolMessage('Analyzing original image pixels…', 0);
      try {
        const capture = await this.captureBoxMeasurementPixels(rect, this.currentPage);
        const threshold = this.boxMeasurementThresholdMode === 'manual' ? this.boxMeasurementThreshold : null;
        const metrics = analyzeInkPixels(capture.rgba, { threshold });
        const annotation = {
          id: safeUUID(),
          ...this.creationMetadata(),
          type: 'boxMeasurement',
          pageIndex: this.currentPage,
          label: normalizeMeasurementLabel(this.activeBoxMeasurementLabel),
          ...capture.bounds,
          aspectRatio: calculateBoxAspectRatio(capture.bounds.width, capture.bounds.height),
          ...metrics,
          imageWidth: capture.imageWidth,
          imageHeight: capture.imageHeight,
          createdBy: this.localParticipant?.id || null,
        };
        if (!this.annotationsByPage[this.currentPage]) this.annotationsByPage[this.currentPage] = [];
        this.annotationsByPage[this.currentPage].push(annotation);
        this.addBoxMeasurementLabelIfNeeded(annotation.label);
        const index = this.currentPageBoxMeasurements.length - 1;
        this.selectedAnnotationItem = {
          type: 'boxMeasurement',
          label: this.getAnnotationBankLabel('boxMeasurement', annotation, index),
          data: annotation,
          index,
        };
        if (this.sessionConnected) this.syncAddAnnotation('boxMeasurements', annotation);
        else if (this.activeSessionId) this.queueSessionSnapshotSync();
        this.showToolMessage(`${annotation.label}: ${annotation.aspectRatio.toFixed(3)} W/H, ${(annotation.inkDensity * 100).toFixed(2)}% ink. Draw the next box or choose Done.`, 6000);
      } catch (error) {
        console.error('Crop & Count analysis failed:', error);
        this.showToolMessage(`Crop & Count failed: ${error.message || 'could not read image pixels'}.`, 7000);
      } finally {
        this.boxMeasurementProcessing = false;
        this.isOperationInProgress = false;
      }
    },
    selectBoxMeasurementFromPage(box, index = 0) {
      if (this.isAnyToolActive || !box) return;
      const item = {
        type: 'boxMeasurement',
        label: this.getAnnotationBankLabel('boxMeasurement', box, index),
        data: box,
        index,
      };
      this.selectedAnnotationItem = item;
      this.showToolMessage(`${item.label} selected. Use arrow keys to move it; inspect the mask in Properties.`);
    },
    startBoxMeasurementResize(box, corner, event) {
      if (!box || !box.id || !this.boxResizeCorners.includes(corner)) return;
      event.currentTarget?.setPointerCapture?.(event.pointerId);
      this.isOperationInProgress = true;
      this.boxResizeState = {
        id: box.id,
        pageIndex: box.pageIndex ?? this.currentPage,
        corner,
        startClientX: event.clientX,
        startClientY: event.clientY,
        original: {
          x: Number(box.x) || 0,
          y: Number(box.y) || 0,
          width: Number(box.width) || 0,
          height: Number(box.height) || 0,
        },
      };
      window.addEventListener('pointermove', this.resizeBoxMeasurement);
      window.addEventListener('pointerup', this.finishBoxMeasurementResize);
      window.addEventListener('pointercancel', this.finishBoxMeasurementResize);
    },
    resizeBoxMeasurement(event) {
      const state = this.boxResizeState;
      if (!state) return;
      const sourcePerScreenPixel = this.svgInverseScale || 1;
      const dx = (event.clientX - state.startClientX) * sourcePerScreenPixel;
      const dy = (event.clientY - state.startClientY) * sourcePerScreenPixel;
      const original = state.original;
      const maxWidth = Number(this.imageDimensionsByPage[state.pageIndex]?.width) || Number(this.osdImageWidth) || Infinity;
      const maxHeight = Number(this.imageDimensionsByPage[state.pageIndex]?.height) || Number(this.osdImageHeight) || Infinity;
      const minSize = 4;
      let left = original.x;
      let top = original.y;
      let right = original.x + original.width;
      let bottom = original.y + original.height;

      if (state.corner.includes('w')) left = Math.max(0, Math.min(right - minSize, original.x + dx));
      if (state.corner.includes('e')) right = Math.min(maxWidth, Math.max(left + minSize, original.x + original.width + dx));
      if (state.corner.includes('n')) top = Math.max(0, Math.min(bottom - minSize, original.y + dy));
      if (state.corner.includes('s')) bottom = Math.min(maxHeight, Math.max(top + minSize, original.y + original.height + dy));

      const pageAnnotations = this.annotationsByPage[state.pageIndex] || [];
      const index = pageAnnotations.findIndex(annotation => annotation?.type === 'boxMeasurement' && annotation.id === state.id);
      if (index === -1) return;
      const updated = {
        ...pageAnnotations[index],
        x: left,
        y: top,
        width: right - left,
        height: bottom - top,
        aspectRatio: calculateBoxAspectRatio(right - left, bottom - top),
      };
      pageAnnotations[index] = updated;
      if (this.selectedAnnotationItem?.data?.id === updated.id) {
        this.selectedAnnotationItem = {
          ...this.selectedAnnotationItem,
          label: this.getAnnotationBankLabel('boxMeasurement', updated, this.selectedAnnotationItem.index),
          data: updated,
        };
      }
    },
    finishBoxMeasurementResize() {
      const state = this.boxResizeState;
      this.boxResizeState = null;
      this.isOperationInProgress = false;
      window.removeEventListener('pointermove', this.resizeBoxMeasurement);
      window.removeEventListener('pointerup', this.finishBoxMeasurementResize);
      window.removeEventListener('pointercancel', this.finishBoxMeasurementResize);
      if (!state) return;
      const annotation = (this.annotationsByPage[state.pageIndex] || [])
        .find(item => item?.type === 'boxMeasurement' && item.id === state.id);
      if (annotation) this.scheduleBoxMeasurementRecalculation(annotation);
    },
    async openBoxMeasurementInspector(item) {
      const annotation = item?.data || item;
      if (!annotation || annotation.type !== 'boxMeasurement') return;
      this.boxInspectorAnnotation = annotation;
      this.showBoxInspector = true;
      await this.refreshBoxMeasurementInspector(annotation);
    },
    closeBoxMeasurementInspector() {
      this.showBoxInspector = false;
      this.boxInspectorAnnotation = null;
      this.boxInspectorOriginalPreview = '';
      this.boxInspectorMaskPreview = '';
    },
    async refreshBoxMeasurementInspector(annotation) {
      this.boxInspectorProcessing = true;
      try {
        const capture = await this.captureBoxMeasurementPixels(annotation, annotation.pageIndex ?? this.currentPage, { includePreview: true });
        this.boxInspectorOriginalPreview = capture.originalPreview;
        this.boxInspectorMaskPreview = this.buildBoxMaskPreview(capture, annotation.threshold);
      } catch (error) {
        console.error('Could not prepare ink mask preview:', error);
        this.showToolMessage(`Could not prepare mask preview: ${error.message}.`, 6000);
      } finally {
        this.boxInspectorProcessing = false;
      }
    },
    scheduleBoxMeasurementRecalculation(annotation) {
      clearTimeout(this._boxRecalculateTimer);
      this._boxRecalculateTimer = setTimeout(() => {
        const threshold = annotation.thresholdMethod === 'manual' ? annotation.threshold : null;
        this.recalculateBoxMeasurement(annotation, threshold);
      }, 300);
    },
    async recalculateBoxMeasurement(annotation, threshold = null) {
      if (!annotation) return;
      this.boxInspectorProcessing = true;
      try {
        const pageIndex = annotation.pageIndex ?? this.currentPage;
        const capture = await this.captureBoxMeasurementPixels(annotation, pageIndex, { includePreview: this.showBoxInspector });
        const metrics = analyzeInkPixels(capture.rgba, { threshold });
        const pageAnnotations = this.annotationsByPage[pageIndex] || [];
        const index = pageAnnotations.findIndex(item => item?.type === 'boxMeasurement' && item.id === annotation.id);
        if (index === -1) return;
        const updated = {
          ...pageAnnotations[index],
          ...capture.bounds,
          aspectRatio: calculateBoxAspectRatio(capture.bounds.width, capture.bounds.height),
          ...metrics,
          imageWidth: capture.imageWidth,
          imageHeight: capture.imageHeight,
        };
        pageAnnotations[index] = updated;
        this.boxInspectorAnnotation = updated;
        if (this.showBoxInspector) {
          this.boxInspectorOriginalPreview = capture.originalPreview;
          this.boxInspectorMaskPreview = this.buildBoxMaskPreview(capture, updated.threshold);
        }
        if (this.selectedAnnotationItem?.data?.id === updated.id) {
          this.selectedAnnotationItem = {
            ...this.selectedAnnotationItem,
            label: this.getAnnotationBankLabel('boxMeasurement', updated, this.selectedAnnotationItem.index),
            data: updated,
          };
        }
        const updates = {
          x: updated.x, y: updated.y, width: updated.width, height: updated.height,
          aspectRatio: updated.aspectRatio, inkDensity: updated.inkDensity,
          darkPixelCount: updated.darkPixelCount, sampledPixelCount: updated.sampledPixelCount,
          thresholdMethod: updated.thresholdMethod, threshold: updated.threshold,
          algorithmVersion: updated.algorithmVersion, imageWidth: updated.imageWidth, imageHeight: updated.imageHeight,
        };
        if (this.sessionConnected) this.syncUpdateAnnotation('boxMeasurements', updated.id, updates, pageIndex);
        else if (this.activeSessionId) this.queueSessionSnapshotSync();
        this.showToolMessage(`${updated.label} recalculated: ${(updated.inkDensity * 100).toFixed(2)}% ink.`);
      } catch (error) {
        console.error('Could not recalculate Crop & Count box:', error);
        this.showToolMessage(`Could not recalculate box: ${error.message}.`, 6000);
      } finally {
        this.boxInspectorProcessing = false;
      }
    },
    applyBoxInspectorThreshold(threshold) {
      return this.recalculateBoxMeasurement(this.boxInspectorAnnotation, Number(threshold));
    },
    applyBoxInspectorAutomaticThreshold() {
      return this.recalculateBoxMeasurement(this.boxInspectorAnnotation, null);
    },
    startCrop() {
      if (this.toolSwitchLocked) return;
      this.resetAnnotationToolState();
      this.croppingStarted = true;
      this.cropButtonClicked = true;
      this.currentSquare = null;
      this.startPoint = null;
      this.croppedSourceRegion = null;
      this.showToolMessage("Click and drag to crop.");
    },
    async generateCroppedFromCurrentSquare() {
      if (!this.currentSquare || !this.osdViewer) return;

      // Validate and clamp coordinates to image bounds
      const rawX = this.currentSquare.x;
      const rawY = this.currentSquare.y;
      const rawW = this.currentSquare.width;
      const rawH = this.currentSquare.height;

      const x = Math.max(0, Math.min(rawX, this.osdImageWidth));
      const y = Math.max(0, Math.min(rawY, this.osdImageHeight));
      const width = Math.min(rawW, this.osdImageWidth - x);
      const height = Math.min(rawH, this.osdImageHeight - y);

      // Validate crop has valid dimensions
      if (width <= 10 || height <= 10) {
        this.toolMessage = 'Crop region too small';
        setTimeout(() => { this.toolMessage = ''; }, 2000);
        return;
      }

      this.croppedSourceRegion = {
        x,
        y,
        width,
        height,
        pageIndex: this.currentPage,
      };

      // Helper: Canvas-based crop (works with any image)
      const cropViaCanvas = async (imageUrl) => {
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(width);
        canvas.height = Math.round(height);
        const ctx = canvas.getContext('2d');

        const img = new Image();
        img.crossOrigin = 'anonymous';

        return new Promise((resolve, reject) => {
          img.onload = () => {
            ctx.drawImage(
              img,
              Math.round(x), Math.round(y), Math.round(width), Math.round(height),
              0, 0, Math.round(width), Math.round(height)
            );
            resolve(canvas.toDataURL('image/png'));
          };
          img.onerror = () => reject(new Error('Failed to load image for cropping'));
          img.src = imageUrl;
        });
      };

      try {
        // Try IIIF region URL first (more efficient for large images)
        const serviceId = extractServiceId(this.currentImage);
        if (serviceId) {
          const pageService = this.iiifPages[this.currentPage]?.image?.service || { id: serviceId };
          const regionUrl = buildRegionRequestUrl(
            pageService,
            this.imageInfoByPage[this.currentPage],
            { x, y, width, height }
          );

          // Verify IIIF server supports region requests
          try {
            const testResponse = await fetch(regionUrl, { method: 'HEAD' });
            if (testResponse.ok) {
              this.croppedImage = regionUrl;
              // Add class to body for proper z-index management
              document.body.classList.add('cropped-popup-active');
              return;
            }
          } catch (e) {
            console.warn('IIIF region request failed, using canvas fallback');
          }
        }

        // Fallback: Canvas-based crop
        this.croppedImage = await cropViaCanvas(this.currentImage);

        // Add class to body for proper z-index management
        document.body.classList.add('cropped-popup-active');

      } catch (error) {
        console.error('Crop failed:', error);
        this.croppedSourceRegion = null;
        this.toolMessage = 'Failed to crop image. Please try again.';
        setTimeout(() => { this.toolMessage = ''; }, 3000);
      }
    },
    _downloadBlob(blob, filename) {
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      link.style.display = "none";
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
    isCanvasSafeImageUrl(url) {
      if (!url) return false;
      if (url.startsWith('data:') || url.startsWith('blob:')) return true;
      try {
        const parsed = new URL(url, window.location.href);
        return parsed.origin === window.location.origin;
      } catch (error) {
        return false;
      }
    },
    buildExportImageProxyUrl(url) {
      if (!url || this.isCanvasSafeImageUrl(url)) return url;
      return `${this._getBackendBase()}/export-image?url=${encodeURIComponent(url)}`;
    },
    getExportImageUrlCandidates(url) {
      if (!url) return [];
      const pageIndex = this.images.indexOf(url);
      const page = pageIndex >= 0 ? this.iiifPages[pageIndex] : null;
      const serviceId = extractServiceId(url);
      const service = page?.image?.service || (serviceId ? { id: serviceId } : null);
      const preferredUrl = service
        ? buildImageRequestUrl(service, this.imageInfoByPage[pageIndex], { maxFallbackWidth: 2400 })
        : null;
      const urls = [preferredUrl, page?.image?.bodyId, url].filter(Boolean);

      const candidates = [];
      urls.forEach((candidateUrl) => {
        if (!candidateUrl || candidates.includes(candidateUrl)) return;
        candidates.push(candidateUrl);
        const proxiedUrl = this.buildExportImageProxyUrl(candidateUrl);
        if (proxiedUrl && proxiedUrl !== candidateUrl && !candidates.includes(proxiedUrl)) {
          candidates.push(proxiedUrl);
        }
      });
      return candidates;
    },
    async loadImageElementForCanvas(loadUrl) {
      return new Promise((resolve, reject) => {
        const img = new Image();
        if (!loadUrl.startsWith('data:') && !loadUrl.startsWith('blob:')) {
          img.crossOrigin = 'anonymous';
        }
        img.decoding = 'async';
        const timer = window.setTimeout(() => reject(new Error('Timed out loading image for export')), 30000);
        img.onload = () => {
          window.clearTimeout(timer);
          resolve(img);
        };
        img.onerror = () => {
          window.clearTimeout(timer);
          reject(new Error('Failed to load image for export'));
        };
        img.src = loadUrl;
      });
    },
    async _drawCroppedToCanvas(withAnnotations) {
      const loaded = await this.loadImageForCanvas(this.croppedImage);
      try {
        const img = loaded.image;
        const w = img.naturalWidth;
        const h = img.naturalHeight;
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, w, h);

        if (withAnnotations) {
          const sx = w / (this.croppedBaseW || w);
          const sy = h / (this.croppedBaseH || h);

          for (const a of this.croppedAnnotations) {
            if (a.type === "highlight") {
              const rect = a.rect || { left: a.x || 0, top: a.y || 0, width: a.width || 0, height: a.height || 0 };
              ctx.fillStyle = "rgba(255, 255, 0, 0.3)";
              ctx.strokeStyle = "rgba(255, 255, 0, 0.7)";
              ctx.lineWidth = 2 * sx;
              ctx.fillRect(rect.left * sx, rect.top * sy, rect.width * sx, rect.height * sy);
              ctx.strokeRect(rect.left * sx, rect.top * sy, rect.width * sx, rect.height * sy);
            } else if (a.type === "underline") {
              const line = a.line || {
                x1: a.x || 0,
                y1: a.y || 0,
                x2: (a.x || 0) + (a.width || 0),
                y2: a.y || 0
              };
              ctx.strokeStyle = a.color || "#3b82f6";
              ctx.lineWidth = Math.max(2, (a.height || 3) * sy);
              ctx.beginPath();
              ctx.moveTo(line.x1 * sx, line.y1 * sy);
              ctx.lineTo(line.x2 * sx, line.y2 * sy);
              ctx.stroke();
            } else if (a.type === "trace" && Array.isArray(a.points) && a.points.length > 1) {
              // Use calligraphic polygon for variable-width strokes
              const polygon = generateCalligraphicPolygon(
                a.points,
                a.penWidth || 2,
                a.penHeight || a.penWidth || 2,
                a.nibAngle || 45,
                sx,
                sy
              );
              if (polygon.length > 0) {
                ctx.fillStyle = a.color || "#000";
                ctx.beginPath();
                ctx.moveTo(polygon[0].x, polygon[0].y);
                for (let i = 1; i < polygon.length; i++) {
                  ctx.lineTo(polygon[i].x, polygon[i].y);
                }
                ctx.closePath();
                ctx.fill();
              }
            } else if (a.type === "measure" && Array.isArray(a.points)) {
              ctx.strokeStyle = "blue";
              ctx.lineWidth = 2 * sx;
              if (a.points.length >= 2) {
                ctx.beginPath();
                ctx.moveTo(a.points[0].x * sx, a.points[0].y * sy);
                ctx.lineTo(a.points[1].x * sx, a.points[1].y * sy);
                ctx.stroke();
              }
              if (a.points.length === 3) {
                ctx.beginPath();
                ctx.moveTo(a.points[1].x * sx, a.points[1].y * sy);
                ctx.lineTo(a.points[2].x * sx, a.points[2].y * sy);
                ctx.stroke();
                const lx = a.points[1].x * sx + 10 * sx;
                const ly = a.points[1].y * sy - 10 * sy;
                ctx.font = `bold ${16 * sx}px sans-serif`;
                ctx.fillStyle = "#00ff87";
                ctx.strokeStyle = "#000";
                ctx.lineWidth = 0.5 * sx;
                const label = `${a.angle}°${a.label ? ' • ' + a.label : ''}`;
                ctx.strokeText(label, lx, ly);
                ctx.fillText(label, lx, ly);
              }
            }
          }
        }

        return await new Promise((resolve, reject) => {
          canvas.toBlob((blob) => {
            if (blob) resolve(blob);
            else reject(new Error("Canvas toBlob failed"));
          }, "image/png");
        });
      } finally {
        loaded.revoke?.();
      }
    },
    async saveCroppedImageAsPNG() {
      try {
        const blob = await this._drawCroppedToCanvas(false);
        this._downloadBlob(blob, "cropped-image.png");
      } catch (e) {
        console.warn("PNG save failed:", e);
        window.open(this.croppedImage, "_blank");
      }
    },
    async saveCroppedImage() {
      try {
        const blob = await this._drawCroppedToCanvas(true);
        this._downloadBlob(blob, "cropped-annotated.png");
      } catch (e) {
        console.warn("Annotated save failed:", e);
        this.showToolMessage("Failed to save annotated image.");
      }
    },
    calculateCroppedAngleStatistics() {
      const angleValues = this.collectAngleValuesFromAnnotations(this.croppedAnnotations);
      const stats = this.buildAngleStatistics(angleValues);
      if (stats.count === 0) {
        this.showToolMessage("No angles found in the cropped image.");
        return;
      }

      this.angleStatistics = stats;
      this.angleStatisticsContext = "Cropped image";
      this.showAngleStatistics = true;
    },
    handleCropDialogChange(open) {
      if (!open && !this.showAngleStatistics) {
        this.closeCroppedPopup();
      }
    },
    transposeCroppedAnnotationsToMain() {
      const region = this.croppedSourceRegion;
      const cropWidth = Number(this.croppedBaseW) || 0;
      const cropHeight = Number(this.croppedBaseH) || 0;
      if (!region || cropWidth <= 0 || cropHeight <= 0 || !this.croppedAnnotations.length) {
        return [];
      }

      const pageIndex = region.pageIndex;
      if (!this.annotationsByPage[pageIndex]) this.annotationsByPage[pageIndex] = [];

      const scaleX = region.width / cropWidth;
      const scaleY = region.height / cropHeight;
      const mapPoint = point => ({
        ...point,
        x: region.x + (Number(point.x) || 0) * scaleX,
        y: region.y + (Number(point.y) || 0) * scaleY,
      });
      const baseFields = () => ({
        id: safeUUID(),
        ...this.creationMetadata(),
        pageIndex,
        createdBy: this.localParticipant?.id || null,
      });

      const transposed = this.croppedAnnotations.map(annotation => {
        if (annotation.type === 'highlight' && annotation.rect) {
          return {
            ...annotation,
            ...baseFields(),
            type: 'highlight',
            x: region.x + annotation.rect.left * scaleX,
            y: region.y + annotation.rect.top * scaleY,
            width: annotation.rect.width * scaleX,
            height: annotation.rect.height * scaleY,
            rect: undefined,
          };
        }

        if (annotation.type === 'underline' && annotation.line) {
          const x1 = region.x + annotation.line.x1 * scaleX;
          const x2 = region.x + annotation.line.x2 * scaleX;
          const y1 = region.y + annotation.line.y1 * scaleY;
          const y2 = region.y + annotation.line.y2 * scaleY;
          return {
            ...annotation,
            ...baseFields(),
            type: 'underline',
            x: Math.min(x1, x2),
            y: Math.min(y1, y2),
            width: Math.abs(x2 - x1),
            height: Math.max(2 * scaleY, Math.abs(y2 - y1)),
            line: undefined,
          };
        }

        if (annotation.type === 'trace' && Array.isArray(annotation.points)) {
          return {
            ...annotation,
            ...baseFields(),
            type: 'trace',
            points: annotation.points.map(mapPoint),
            penWidth: (annotation.penWidth || 2) * scaleX,
            penHeight: (annotation.penHeight || annotation.penWidth || 2) * scaleY,
          };
        }

        if (annotation.type === 'measure' && Array.isArray(annotation.points)) {
          const points = annotation.points.map(mapPoint);
          return {
            ...annotation,
            ...baseFields(),
            type: 'measure',
            points,
            point1: undefined,
            vertex: undefined,
            point2: undefined,
            angle: points.length === 3
              ? this.calculateAngle(points[0], points[1], points[2])
              : annotation.angle,
          };
        }

        return null;
      }).filter(Boolean);

      this.annotationsByPage[pageIndex].push(...transposed);

      if (this.sessionConnected) {
        const syncTypes = {
          highlight: 'highlights',
          underline: 'underlines',
          trace: 'traces',
          measure: 'measures',
        };
        transposed.forEach(annotation => {
          this.syncAddAnnotation(syncTypes[annotation.type], annotation);
        });
      } else if (this.activeSessionId && transposed.length) {
        this.syncAllAnnotations(this.getAllAnnotations()).catch(error => {
          console.error('Failed to persist cropped annotations:', error);
          this.showToolMessage('Crop annotations restored locally, but session sync failed.');
        });
      }

      return transposed;
    },
    closeCroppedPopup() {
      const transposed = this.transposeCroppedAnnotationsToMain();

      // Clear cropped annotations after they have been mapped to the main image
      this.croppedAnnotations = [];
      this.croppedLive = { highlight: null, underline: null, trace: null };
      this.croppedStartPoint = null;
      
      this.croppedImage = null;
      this.croppedSourceRegion = null;
      
      // Remove class from body
      document.body.classList.remove('cropped-popup-active');
      
      // Reset unified cropped state
      this.croppedLive = {
        trace: null,
        highlight: null,
        underline: null,
        measure: null
      };
      this.croppedAnnotations = [];
      this.croppedBankSelected = [];
      this.croppedBankMulti = false;
      this.croppedMoveActive = false;
      
      // Reset zoom/pan
      this.cropZoom = 1;
      this.cropPanX = 0;
      this.cropPanY = 0;
      this.isCropPanning = false;

      if (transposed.length) {
        const suffix = transposed.length === 1 ? '' : 's';
        this.showToolMessage(`${transposed.length} crop annotation${suffix} added to the main image.`);
      }
    },

    // Cropped image loading and sizing
    onCroppedImgLoad() {
      const img = this.$refs.croppedImg;
      if (!img) return;
      
      // Wait for the image to be fully laid out
      this.$nextTick(() => {
        // Use displayed size (which preserves aspect ratio) for coordinates
        this.croppedBaseW = img.offsetWidth || img.clientWidth;
        this.croppedBaseH = img.offsetHeight || img.clientHeight;
        
        // Fallback to natural size if displayed size is 0
        if (this.croppedBaseW === 0 || this.croppedBaseH === 0) {
          // Calculate the displayed size based on natural dimensions and container
          const container = this.$refs.croppedStage;
          if (container) {
            const containerW = container.clientWidth;
            const containerH = container.clientHeight - 40; // account for padding
            const naturalW = img.naturalWidth;
            const naturalH = img.naturalHeight;
            
            if (naturalW && naturalH) {
              const aspectRatio = naturalW / naturalH;
              if (containerW / containerH > aspectRatio) {
                // Container is wider than image aspect ratio
                this.croppedBaseH = containerH;
                this.croppedBaseW = containerH * aspectRatio;
              } else {
                // Container is taller than image aspect ratio  
                this.croppedBaseW = containerW;
                this.croppedBaseH = containerW / aspectRatio;
              }
            }
          }
        }
        
        // reset view
        this.cropZoom = 1;
        this.cropPanX = 0;
        this.cropPanY = 0;
      });
    },

    // Prevent any image interaction
    handleImageMouseDown(e) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      return false;
    },

    // Prevent main image interaction
    handleMainImageMouseDown(e) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      return false;
    },

    // Cropped zoom/pan methods
    cropZoomIn() {
      const stage = this.$refs.croppedStage;
      const rect = stage?.getBoundingClientRect();
      this.zoomCropAt(1 + this.cropZoomStep, rect ? rect.left + rect.width / 2 : null, rect ? rect.top + rect.height / 2 : null);
    },
    cropZoomOut() {
      const stage = this.$refs.croppedStage;
      const rect = stage?.getBoundingClientRect();
      this.zoomCropAt(1 / (1 + this.cropZoomStep), rect ? rect.left + rect.width / 2 : null, rect ? rect.top + rect.height / 2 : null);
    },
    cropResetZoom() {
      this.cropZoom = 1;
      this.cropPanX = 0;
      this.cropPanY = 0;
      this.isCropPanning = false;
      this._cPanStart = null;
    },
    cropStageWheel(event) {
      const toolActive = this.traceModeActive || this.measureModeActive || this.distanceModeActive || this.highlightModeActive || this.underlineModeActive;
      if (toolActive) return;
      const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12;
      this.zoomCropAt(factor, event.clientX, event.clientY);
    },
    zoomCropAt(factor, clientX = null, clientY = null) {
      const oldZoom = this.cropZoom || 1;
      const nextZoom = Math.max(1, Math.min(4, +(oldZoom * factor).toFixed(3)));
      if (nextZoom === oldZoom) {
        this._clampCropPan();
        return;
      }

      const stage = this.$refs.croppedStage;
      const rect = stage?.getBoundingClientRect();
      if (!rect || clientX == null || clientY == null) {
        this.cropZoom = nextZoom;
        this._clampCropPan();
        return;
      }

      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const imageX = (clientX - centerX - this.cropPanX) / oldZoom + this.croppedBaseW / 2;
      const imageY = (clientY - centerY - this.cropPanY) / oldZoom + this.croppedBaseH / 2;

      this.cropZoom = nextZoom;
      this.cropPanX = clientX - centerX - (imageX - this.croppedBaseW / 2) * nextZoom;
      this.cropPanY = clientY - centerY - (imageY - this.croppedBaseH / 2) * nextZoom;
      this._clampCropPan();
    },
    _clampCropPan() {
      // allow small margin
      const margin = 120;
      const maxX = (this.croppedBaseW * (this.cropZoom - 1)) / 2 + margin;
      const maxY = (this.croppedBaseH * (this.cropZoom - 1)) / 2 + margin;
      this.cropPanX = Math.max(-maxX, Math.min(maxX, this.cropPanX));
      this.cropPanY = Math.max(-maxY, Math.min(maxY, this.cropPanY));
    },

    // Coordinate transform for cropped popup
    getCroppedMouse(event) {
      const img = this.$refs.croppedImg;
      const anchor = img?.parentElement; // crop-anchor div
      
      if (!img || !anchor || this.croppedBaseW === 0 || this.croppedBaseH === 0) {
        return { x: 0, y: 0 };
      }

      // Get the anchor bounds (this has the transform applied)
      const anchorRect = anchor.getBoundingClientRect();
      
      // Calculate mouse position relative to the transformed anchor
      const relativeX = event.clientX - anchorRect.left;
      const relativeY = event.clientY - anchorRect.top;
      
      // Convert back to original image coordinates (undo zoom)
      const imageX = relativeX / this.cropZoom;
      const imageY = relativeY / this.cropZoom;
      
      return {
        x: Math.max(0, Math.min(this.croppedBaseW, imageX)),
        y: Math.max(0, Math.min(this.croppedBaseH, imageY))
      };
    },

    // ===== UNIFIED CROPPED MOUSE HANDLERS =====
    cropStageDown(e) {
      // Clear any existing selection immediately
      if (window.getSelection) {
        window.getSelection().removeAllRanges();
      } else if (document.selection) {
        document.selection.empty();
      }
      
      // Prevent default behavior
      e.preventDefault();
      e.stopPropagation();
      
      const toolActive = this.traceModeActive || this.measureModeActive || this.distanceModeActive || this.highlightModeActive || this.underlineModeActive;
      
      // Pan when zoomed and no tool active
      if (this.cropZoom > 1 && !toolActive) {
        this.isCropPanning = true;
        this._cPanStart = { x: e.clientX, y: e.clientY, panX: this.cropPanX, panY: this.cropPanY };
        return;
      }

      // Get unified mouse coordinates
      const { x, y } = this.getCroppedMouse(e);

      // HIGHLIGHT / UNDERLINE - Two-click system like main page
      if (this.highlightModeActive || this.underlineModeActive) {
        if (!this.croppedStartPoint) {
          // First click - set start point
          this.croppedStartPoint = { x, y };
          if (this.highlightModeActive) {
            this.croppedLive.highlight = {
              startX: x, startY: y,
              style: { 
                position: 'absolute', 
                left: `${x}px`, 
                top: `${y}px`, 
                width: '0px', 
                height: '0px', 
                backgroundColor: 'rgba(255,255,0,0.3)' 
              }
            };
          } else if (this.underlineModeActive) {
            this.croppedLive.underline = {
              startX: x, startY: y,
              style: { 
                position: 'absolute', 
                left: `${x}px`, 
                top: `${y}px`, 
                width: '0px', 
                height: '2px', 
                backgroundColor: 'blue' 
              }
            };
          }
          return;
        } else {
          // Second click - complete the annotation
          if (this.highlightModeActive && this.croppedLive.highlight) {
            const rect = {
              left: parseInt(this.croppedLive.highlight.style.left),
              top: parseInt(this.croppedLive.highlight.style.top),
              width: parseInt(this.croppedLive.highlight.style.width),
              height: parseInt(this.croppedLive.highlight.style.height)
            };
            
            if (rect.width > 5 && rect.height > 5) { // Minimum size
              this.croppedAnnotations.push({
                type: 'highlight',
                rect: rect,
                color: 'rgba(255,255,0,0.3)'
              });
            }
            this.croppedLive.highlight = null;
          } else if (this.underlineModeActive && this.croppedLive.underline) {
            const line = {
              x1: parseInt(this.croppedLive.underline.style.left),
              y1: parseInt(this.croppedLive.underline.style.top),
              x2: parseInt(this.croppedLive.underline.style.left) + parseInt(this.croppedLive.underline.style.width),
              y2: parseInt(this.croppedLive.underline.style.top)
            };
            
            if (Math.abs(line.x2 - line.x1) > 5) { // Minimum length
              this.croppedAnnotations.push({
                type: 'underline',
                line: line,
                color: 'blue'
              });
            }
            this.croppedLive.underline = null;
          }
          this.croppedStartPoint = null;
          return;
        }
      }

      // Trace mode
      if (this.traceModeActive) {
        this.croppedLive.trace = {
          color: this.generateRandomColor(),
          penWidth: this.penWidth,
          penHeight: this.penHeight,
          nibAngle: this.currentNibAngle,
          points: [{ x, y }]
        };
        return;
      }

      // Measure mode (3-click angle) - Follow main page logic exactly
      if (this.measureModeActive) {
        // First check if clicking near an existing angle point for editing
        const nearest = this.findNearestCroppedPoint(x, y, 10);
        if (nearest.annotationIndex !== -1) {
          // Start editing existing angle
          this.croppedEditingAnnotationIndex = nearest.annotationIndex;
          this.croppedDraggingPoint = nearest.pointIndex;
          const ann = this.croppedAnnotations[this.croppedEditingAnnotationIndex];
          // Copy the points for editing
          this.croppedLive.measure = { points: [...ann.points] };
          return;
        }
        
        // Otherwise, create new angle
        if (!this.croppedLive.measure) {
          this.croppedLive.measure = { points: [] };
        }
        
        // Check if we've already collected 3 points
        if (this.croppedLive.measure.points.length >= 3) return;
        
        this.croppedLive.measure.points.push({ x, y });
        
        if (this.croppedLive.measure.points.length === 3) {
          // Calculate angle and immediately save it (like main page)
          const angle = this.calculateAngle(
            this.croppedLive.measure.points[0],
            this.croppedLive.measure.points[1],
            this.croppedLive.measure.points[2]
          );
          
          // Save to cropped annotations immediately using active label
          this.croppedAnnotations.push({
            type: 'measure',
            point1: this.croppedLive.measure.points[0],
            vertex: this.croppedLive.measure.points[1],
            point2: this.croppedLive.measure.points[2],
            points: [...this.croppedLive.measure.points],
            angle,
            label: this.activeAngleLabel || "Unlabeled",
            color: 'blue'
          });
          
          this.addAngleLabelIfNeeded(this.activeAngleLabel);
          
          // Clear the live measure
          this.croppedLive.measure = null;
        }
        return;
      }
    },

    cropStageMove(e) {
      // Clear any selection that might appear during dragging
      if (window.getSelection && window.getSelection().rangeCount > 0) {
        window.getSelection().removeAllRanges();
      }
      
      // Handle panning
      if (this.isCropPanning && this._cPanStart) {
        const dx = e.clientX - this._cPanStart.x;
        const dy = e.clientY - this._cPanStart.y;
        this.cropPanX = this._cPanStart.panX + dx;
        this.cropPanY = this._cPanStart.panY + dy;
        this._clampCropPan();
        return;
      }

      const { x, y } = this.getCroppedMouse(e);

      // Handle angle point dragging
      if (this.measureModeActive && this.croppedDraggingPoint !== -1 && this.croppedLive.measure) {
        // Update the dragged point position
        this.croppedLive.measure.points[this.croppedDraggingPoint] = { x, y };
        
        // If editing an existing annotation, update it
        if (this.croppedEditingAnnotationIndex !== -1) {
          const ann = this.croppedAnnotations[this.croppedEditingAnnotationIndex];
          ann.points[this.croppedDraggingPoint] = { x, y };
          
          // Recalculate angle
          if (ann.points.length === 3) {
            const angle = this.calculateAngle(ann.points[0], ann.points[1], ann.points[2]);
            ann.angle = angle;
          }
        }
        return;
      }

      // Update live highlight
      if (this.croppedLive.highlight) {
        const startX = this.croppedLive.highlight.startX;
        const startY = this.croppedLive.highlight.startY;
        this.croppedLive.highlight.style = {
          position: 'absolute',
          left: `${Math.min(x, startX)}px`,
          top: `${Math.min(y, startY)}px`,
          width: `${Math.abs(x - startX)}px`,
          height: `${Math.abs(y - startY)}px`,
          backgroundColor: 'rgba(255,255,0,0.3)'
        };
        return;
      }

      // Update live underline
      if (this.croppedLive.underline) {
        const startX = this.croppedLive.underline.startX;
        const startY = this.croppedLive.underline.startY;
        this.croppedLive.underline.style = {
          position: 'absolute',
          left: `${Math.min(x, startX)}px`,
          top: `${startY}px`,
          width: `${Math.abs(x - startX)}px`,
          height: '2px',
          backgroundColor: 'blue'
        };
        return;
      }

      // Extend live trace
      if (this.croppedLive.trace) {
        this.croppedLive.trace.points.push({ x, y });
        return;
      }
    },

    cropStageUp(e) {
      // End panning
      if (this.isCropPanning) {
        this.isCropPanning = false;
        this._cPanStart = null;
        return;
      }

      // End angle point dragging
      if (this.measureModeActive && this.croppedDraggingPoint !== -1) {
        this.croppedDraggingPoint = -1;
        this.croppedEditingAnnotationIndex = -1;
        this.croppedLive.measure = null;
        return;
      }

      // For highlights and underlines, don't commit on mouseup anymore
      // They now use two-click system (commit on second mousedown)
      
      // Commit live trace
      if (this.croppedLive.trace && this.croppedLive.trace.points.length > 1) {
        this.croppedAnnotations.push({
          type: 'trace',
          points: [...this.croppedLive.trace.points],
          color: this.croppedLive.trace.color,
          penWidth: this.croppedLive.trace.penWidth,
          penHeight: this.croppedLive.trace.penHeight,
          nibAngle: this.croppedLive.trace.nibAngle
        });

        this.croppedLive.trace = null;
        return;
      }
    },

    // ===== CROPPED BANK HANDLERS =====
    enableCroppedMove() {
      this.croppedMoveActive = true;
    },

    disableCroppedMove() {
      this.croppedMoveActive = false;
    },

    deleteSelectedCropped() {
      if (!this.croppedBankSelected.length) return;
      
      // Convert selected keys back to indices and remove from croppedAnnotations
      const indices = this.croppedBankSelected
        .map(key => {
          if (typeof key === 'string' && key.startsWith('c')) {
            const index = parseInt(key.substring(1));
            return isNaN(index) ? -1 : index;
          } else {
            console.warn('Invalid cropped bank key:', key);
            return -1;
          }
        })
        .filter(index => index >= 0)
        .sort((a, b) => b - a);
      
      indices.forEach(index => {
        if (index >= 0 && index < this.croppedAnnotations.length) {
          this.croppedAnnotations.splice(index, 1);
        }
      });
      
      this.croppedBankSelected = [];
    },

    /* ---------- Save to PDF ---------- */
    exportPageHasContent(pageIndex) {
      return pageHasExportableAnnotations(pageIndex, {
        annotationsByPage: this.annotationsByPage,
        commentsByPage: this.comments,
        lengthMeasurements: this.lengthMeasurements,
      });
    },
    getPageLengthMeasurementsForExport(pageIndex) {
      const measurements = [];
      Object.values(this.lengthMeasurements).forEach(pages => {
        const pageMeasurements = pages?.[pageIndex];
        if (Array.isArray(pageMeasurements)) measurements.push(...pageMeasurements);
      });
      return measurements;
    },
    safeExportFilename(extension, suffix = '') {
      const safeName = (this.documentName || 'annotated-document')
        .replace(/[^a-zA-Z0-9_-]/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_+|_+$/g, '')
        .substring(0, 50) || 'annotated-document';
      const safeSuffix = String(suffix || '')
        .replace(/[^a-zA-Z0-9_-]/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_+|_+$/g, '');
      const date = new Date().toISOString().slice(0, 10);
      return `${safeName}${safeSuffix ? `_${safeSuffix}` : ''}_${date}.${extension}`;
    },
    async loadImageForCanvas(url) {
      if (!url) throw new Error('Missing image URL');

      let lastError = null;
      const candidates = this.getExportImageUrlCandidates(url);

      for (const candidateUrl of candidates) {
        let objectUrl = null;
        try {
          if (candidateUrl.startsWith('data:') || candidateUrl.startsWith('blob:')) {
            return {
              image: await this.loadImageElementForCanvas(candidateUrl),
              revoke: () => {},
            };
          }

          const response = await fetch(candidateUrl, { mode: 'cors', cache: 'force-cache' });
          if (!response.ok) {
            throw new Error(`Image request failed (${response.status})`);
          }

          const blob = await response.blob();
          if (blob.type && !blob.type.toLowerCase().startsWith('image/')) {
            throw new Error(`Export image response was ${blob.type}, not an image`);
          }

          objectUrl = URL.createObjectURL(blob);
          const image = await this.loadImageElementForCanvas(objectUrl);
          return {
            image,
            revoke: () => {
              if (objectUrl) URL.revokeObjectURL(objectUrl);
            },
          };
        } catch (error) {
          if (objectUrl) URL.revokeObjectURL(objectUrl);
          lastError = error;
          if (this.isCanvasSafeImageUrl(candidateUrl)) {
            try {
              return {
                image: await this.loadImageElementForCanvas(candidateUrl),
                revoke: () => {},
              };
            } catch (directError) {
              lastError = directError;
            }
          }
        }
      }

      throw lastError || new Error('No exportable image source was available');
    },
    async getExportSourceDimensions(imageUrl, image, pageIndex) {
      const cachedDimensions = this.imageDimensionsByPage?.[pageIndex];
      const cachedWidth = Number(cachedDimensions?.width);
      const cachedHeight = Number(cachedDimensions?.height);
      if (
        Number.isFinite(cachedWidth) && cachedWidth > 0 &&
        Number.isFinite(cachedHeight) && cachedHeight > 0
      ) {
        return { width: cachedWidth, height: cachedHeight };
      }

      const serviceId = extractServiceId(imageUrl);
      if (serviceId) {
        try {
          const info = await fetchImageInfo(serviceId);
          const width = Number(info?.width);
          const height = Number(info?.height);
          if (Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0) {
            this.imageDimensionsByPage[pageIndex] = { width, height };
            return { width, height };
          }
        } catch (error) {
          console.warn('Could not read IIIF dimensions for export; using loaded image size.', error);
        }
      }

      const naturalWidth = Number(image?.naturalWidth);
      const naturalHeight = Number(image?.naturalHeight);
      if (Number.isFinite(naturalWidth) && naturalWidth > 0 && Number.isFinite(naturalHeight) && naturalHeight > 0) {
        this.imageDimensionsByPage[pageIndex] = {
          width: naturalWidth,
          height: naturalHeight,
        };
        return { width: naturalWidth, height: naturalHeight };
      }

      throw new Error('Could not determine the source image dimensions');
    },
    buildExportCanvas(width, height) {
      const maxDimension = 2400;
      const scale = Math.min(1, maxDimension / Math.max(width || 1, height || 1));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));
      return { canvas, scale };
    },
    getExportVisualMetrics(sourceWidth, scale) {
      const safeScale = Number.isFinite(scale) && scale > 0 ? scale : 1;
      const outputWidth = Math.max(1, Number(sourceWidth) * safeScale);
      // The PDF is normally viewed fitted to a window. Target roughly the
      // same 14px apparent label size as the website at common PDF zooms.
      const labelFontOutputPx = Math.min(52, Math.max(28, outputWidth * 0.022));
      const toSourceUnits = outputPixels => outputPixels / safeScale;

      return {
        labelFontSize: toSourceUnits(labelFontOutputPx),
        secondaryFontSize: toSourceUnits(Math.max(24, labelFontOutputPx * 0.82)),
        lineWidth: toSourceUnits(Math.max(5, labelFontOutputPx * 0.12)),
        thinLineWidth: toSourceUnits(Math.max(3, labelFontOutputPx * 0.075)),
        pointRadius: toSourceUnits(Math.max(7, labelFontOutputPx * 0.18)),
        commentRadius: toSourceUnits(Math.max(12, labelFontOutputPx * 0.3)),
        // Stored draggable-label offsets are website CSS pixels. Scale them
        // with the exported font so their relative placement stays familiar.
        websitePixel: toSourceUnits(labelFontOutputPx / 14),
      };
    },
    async canvasToPngBytes(canvas) {
      if (!canvas || typeof canvas.toBlob !== 'function') {
        throw new Error('This browser cannot encode the PDF page image');
      }

      const blob = await new Promise((resolve, reject) => {
        canvas.toBlob((result) => {
          if (result) {
            resolve(result);
          } else {
            reject(new Error('Could not encode the PDF page image'));
          }
        }, 'image/png');
      });

      return new Uint8Array(await blob.arrayBuffer());
    },
    drawExportLabel(ctx, text, x, y, options = {}) {
      const fontSize = options.fontSize || 24;
      ctx.save();
      ctx.font = `700 ${fontSize}px sans-serif`;
      ctx.textBaseline = 'top';
      const paddingX = options.paddingX || Math.max(8, fontSize * 0.32);
      const paddingY = options.paddingY || Math.max(5, fontSize * 0.18);
      const labelText = String(text ?? '');
      const metrics = ctx.measureText(labelText);
      const boxWidth = metrics.width + paddingX * 2;
      const boxHeight = fontSize + paddingY * 2;
      ctx.fillStyle = options.background || 'rgba(255,255,255,0.88)';
      ctx.fillRect(x, y, boxWidth, boxHeight);
      ctx.strokeStyle = options.border || 'rgba(0,0,0,0.18)';
      ctx.lineWidth = Math.max(1, fontSize * 0.035);
      ctx.strokeRect(x, y, boxWidth, boxHeight);
      ctx.fillStyle = options.color || '#111827';
      ctx.fillText(labelText, x + paddingX, y + paddingY);
      ctx.restore();
    },
    drawExportAnnotations(ctx, pageIndex, sourceWidth, sourceHeight, scale = 1) {
      const annotations = this.annotationsByPage[pageIndex] || [];
      const comments = this.comments[pageIndex] || [];
      const measurements = this.getPageLengthMeasurementsForExport(pageIndex);
      const visual = this.getExportVisualMetrics(sourceWidth, scale);

      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      annotations.forEach((annotation, index) => {
        if (annotation.type === 'highlight') {
          ctx.fillStyle = annotation.color || 'rgba(255, 235, 59, 0.32)';
          ctx.strokeStyle = 'rgba(202, 138, 4, 0.85)';
          ctx.lineWidth = visual.thinLineWidth;
          ctx.fillRect(annotation.x || 0, annotation.y || 0, annotation.width || 0, annotation.height || 0);
          ctx.strokeRect(annotation.x || 0, annotation.y || 0, annotation.width || 0, annotation.height || 0);
          if (annotation.name) {
            this.drawExportLabel(
              ctx,
              this.getAnnotationBankLabel('highlight', annotation, index),
              Math.max(0, (annotation.x || 0) + 8),
              Math.max(0, (annotation.y || 0) - 30),
              { fontSize: visual.secondaryFontSize, color: '#854d0e' }
            );
          }
          return;
        }

        if (annotation.type === 'underline') {
          const y = (annotation.y || 0) + Math.max(1, (annotation.height || 2) / 2);
          ctx.strokeStyle = annotation.color || '#dc2626';
          ctx.lineWidth = Math.max(visual.thinLineWidth, annotation.height || 3);
          ctx.beginPath();
          ctx.moveTo(annotation.x || 0, y);
          ctx.lineTo((annotation.x || 0) + (annotation.width || 0), y);
          ctx.stroke();
          if (annotation.name) {
            this.drawExportLabel(
              ctx,
              this.getAnnotationBankLabel('underline', annotation, index),
              Math.max(0, annotation.x || 0),
              Math.max(0, (annotation.y || 0) - 30),
              { fontSize: visual.secondaryFontSize, color: '#991b1b' }
            );
          }
          return;
        }

        if (annotation.type === 'trace' && Array.isArray(annotation.points) && annotation.points.length > 1) {
          const polygon = generateCalligraphicPolygon(
            annotation.points,
            annotation.penWidth || 2,
            annotation.penHeight || annotation.penWidth || 2,
            annotation.nibAngle || 45
          );
          if (!polygon.length) return;
          ctx.fillStyle = annotation.color || '#111827';
          ctx.beginPath();
          ctx.moveTo(polygon[0].x, polygon[0].y);
          polygon.slice(1).forEach(point => ctx.lineTo(point.x, point.y));
          ctx.closePath();
          ctx.fill();
          if (annotation.name) {
            const firstPoint = annotation.points[0];
            this.drawExportLabel(
              ctx,
              this.getAnnotationBankLabel('trace', annotation, index),
              Math.max(0, (Number(firstPoint.x) || 0) + 10),
              Math.max(0, (Number(firstPoint.y) || 0) - 30),
              { fontSize: visual.secondaryFontSize }
            );
          }
          return;
        }

        if (annotation.type === 'boxMeasurement') {
          const x = Number(annotation.x) || 0;
          const y = Number(annotation.y) || 0;
          const width = Number(annotation.width) || 0;
          const height = Number(annotation.height) || 0;
          ctx.strokeStyle = '#f97316';
          ctx.fillStyle = 'rgba(249, 115, 22, 0.08)';
          ctx.lineWidth = visual.lineWidth;
          ctx.fillRect(x, y, width, height);
          ctx.strokeRect(x, y, width, height);
          this.drawExportLabel(
            ctx,
            this.boxMeasurementOverlayLabel(annotation),
            Math.max(0, x),
            Math.max(0, y - 30 * visual.websitePixel),
            {
              color: '#ffedd5',
              background: 'rgba(0,0,0,0.76)',
              border: '#f97316',
              fontSize: visual.secondaryFontSize,
            }
          );
          return;
        }

        if (annotation.type === 'distance' && Array.isArray(annotation.points) && annotation.points.length >= 2) {
          const [start, end] = annotation.points;
          ctx.strokeStyle = '#7c3aed';
          ctx.fillStyle = '#7c3aed';
          ctx.lineWidth = visual.lineWidth;
          ctx.beginPath();
          ctx.moveTo(start.x, start.y);
          ctx.lineTo(end.x, end.y);
          ctx.stroke();
          [start, end].forEach(point => {
            ctx.beginPath();
            ctx.arc(point.x, point.y, visual.pointRadius, 0, Math.PI * 2);
            ctx.fill();
          });
          const midpoint = this.distanceMidpoint(annotation);
          this.drawExportLabel(
            ctx,
            `${this.formatDistanceAnnotation(annotation, pageIndex)}${annotation.label ? ' • ' + annotation.label : ''}`,
            midpoint.x + 12 * visual.websitePixel,
            Math.max(0, midpoint.y - 34 * visual.websitePixel),
            {
              color: '#f5d0fe',
              background: 'rgba(0,0,0,0.72)',
              border: 'rgba(255,255,255,0.35)',
              fontSize: visual.labelFontSize,
            }
          );
          return;
        }

        if (annotation.type === 'measure' && Array.isArray(annotation.points) && annotation.points.length >= 2) {
          ctx.strokeStyle = '#1d4ed8';
          ctx.lineWidth = visual.lineWidth;
          ctx.beginPath();
          ctx.moveTo(annotation.points[0].x, annotation.points[0].y);
          ctx.lineTo(annotation.points[1].x, annotation.points[1].y);
          if (annotation.points.length === 3) {
            ctx.moveTo(annotation.points[1].x, annotation.points[1].y);
            ctx.lineTo(annotation.points[2].x, annotation.points[2].y);
          }
          ctx.stroke();
          if (annotation.points.length === 3) {
            const storedPosition = this.angleLabelPositions?.[annotation.id];
            const labelOffsetX = Number.isFinite(Number(storedPosition?.x))
              ? Number(storedPosition.x)
              : 10;
            const labelOffsetY = Number.isFinite(Number(storedPosition?.y))
              ? Number(storedPosition.y)
              : -30;
            this.drawExportLabel(
              ctx,
              `${annotation.angle || this.calculateAngle(annotation.points[0], annotation.points[1], annotation.points[2])}°${annotation.label ? ' • ' + annotation.label : ''}`,
              Math.max(0, annotation.points[1].x + labelOffsetX * visual.websitePixel),
              Math.max(0, annotation.points[1].y + labelOffsetY * visual.websitePixel),
              {
                color: '#00ff87',
                background: 'rgba(0,0,0,0.72)',
                border: 'rgba(255,255,255,0.35)',
                fontSize: visual.labelFontSize,
              }
            );
          }
        }
      });

      measurements.forEach(measurement => {
        ctx.fillStyle = measurement.color || this.measurementColorFor(measurement.label);
        ctx.strokeStyle = this.measurementBorderFor(measurement);
        ctx.lineWidth = visual.lineWidth;
        ctx.fillRect(measurement.x || 0, measurement.y || 0, measurement.width || 0, measurement.height || 0);
        ctx.strokeRect(measurement.x || 0, measurement.y || 0, measurement.width || 0, measurement.height || 0);
        const size = this.isHorizontalLabel(measurement.label) ? measurement.height : measurement.width;
        this.drawExportLabel(
          ctx,
          `${this.camelToTitle(measurement.label)}: ${Math.round(size || 0)} px`,
          Math.min(sourceWidth - 20, (measurement.x || 0) + 12),
          Math.min(sourceHeight - 20, (measurement.y || 0) + 12),
          { fontSize: visual.labelFontSize }
        );
      });

      comments.forEach((comment, index) => {
        const x = Number(comment.x) || 0;
        const y = Number(comment.y) || 0;
        ctx.fillStyle = '#2563eb';
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = visual.lineWidth;
        ctx.beginPath();
        ctx.arc(x, y, visual.commentRadius, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        this.drawExportLabel(
          ctx,
          comment.text || `Comment ${index + 1}`,
          x + 18 * visual.websitePixel,
          y + 8 * visual.websitePixel,
          { fontSize: visual.labelFontSize }
        );
      });

      ctx.restore();
    },
    async renderAnnotatedPageCanvas(pageIndex) {
      const imageUrl = this.images[pageIndex];
      const loaded = await this.loadImageForCanvas(imageUrl);

      try {
        const sourceDimensions = await this.getExportSourceDimensions(imageUrl, loaded.image, pageIndex);
        const { width: sourceWidth, height: sourceHeight } = sourceDimensions;
        const { canvas, scale } = this.buildExportCanvas(sourceWidth, sourceHeight);
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Could not create a canvas for the PDF page');

        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(loaded.image, 0, 0, canvas.width, canvas.height);

        ctx.save();
        ctx.scale(scale, scale);
        this.drawExportAnnotations(ctx, pageIndex, sourceWidth, sourceHeight, scale);
        ctx.restore();

        return canvas;
      } finally {
        loaded.revoke?.();
      }
    },
    async saveAnnotations(scope = PDF_EXPORT_SCOPE.ANNOTATED) {
      if (this.isExportingPdf) {
        this.showToolMessage('A PDF export is already in progress.');
        return;
      }

      const pagesToExport = selectPdfExportPages(
        this.images.length,
        {
          annotationsByPage: this.annotationsByPage,
          commentsByPage: this.comments,
          lengthMeasurements: this.lengthMeasurements,
        },
        scope
      );

      if (!this.images.length) {
        this.showToolMessage('No document pages to export.');
        return;
      }
      if (!pagesToExport.length) {
        this.showToolMessage('No annotated pages to export. Choose “Full document PDF” to include unannotated pages.', 5000);
        return;
      }

      const annotatedOnly = scope === PDF_EXPORT_SCOPE.ANNOTATED;
      const exportDescription = annotatedOnly ? 'annotated pages PDF' : 'full document PDF';
      this.isExportingPdf = true;
      this.showToolMessage(`Preparing ${exportDescription} (${formatPageCount(pagesToExport.length)})...`, 0);

      try {
        const pdfDoc = await PDFDocument.create();

        for (let exportIndex = 0; exportIndex < pagesToExport.length; exportIndex += 1) {
          const pageIndex = pagesToExport[exportIndex];
          this.showToolMessage(
            `Preparing ${exportDescription} (${exportIndex + 1}/${pagesToExport.length}, document page ${pageIndex + 1})...`,
            0
          );

          let canvas = null;
          try {
            canvas = await this.renderAnnotatedPageCanvas(pageIndex);
            const pngBytes = await this.canvasToPngBytes(canvas);
            const image = await pdfDoc.embedPng(pngBytes);
            const page = pdfDoc.addPage([image.width, image.height]);
            page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });
          } catch (error) {
            throw new Error(`Document page ${pageIndex + 1} could not be exported: ${error.message || 'unknown error'}`);
          } finally {
            if (canvas) {
              canvas.width = 1;
              canvas.height = 1;
            }
          }
        }

        this.showToolMessage(`Finalizing ${exportDescription}...`, 0);
        const pdfBytes = await pdfDoc.save();
        if (!pdfBytes?.length) throw new Error('The generated PDF was empty');
        const blob = new Blob([pdfBytes], { type: 'application/pdf' });
        const filenameSuffix = annotatedOnly ? 'annotated-pages' : 'full-document';
        this._downloadBlob(blob, this.safeExportFilename('pdf', filenameSuffix));
        this.showToolMessage(`${annotatedOnly ? 'Annotated pages' : 'Full document'} PDF exported (${formatPageCount(pagesToExport.length)}).`, 5000);
      } catch (error) {
        console.error('Error saving annotated PDF:', error);
        this.showToolMessage(`PDF export failed: ${error.message || 'could not load page image'}.`, 7000);
      } finally {
        this.isExportingPdf = false;
      }
    },

    /* ---------- Stats helpers ---------- */
    extractValues(measurements, type) {
      const vertical = ["internalMargin", "intercolumnSpaces", "externalMargin"];
      const isVertical = vertical.includes(type);
      // In our rectangles: for horizontal labels we report height; for vertical we report width
      return measurements.map((m) => (isVertical ? m.width : m.height));
    },
    summarizeNumbers(values = []) {
      return summarizeMeasurements(values);
    },
    formatStat(value) {
      const n = Number(value);
      return Number.isFinite(n) ? n.toFixed(2) : "0.00";
    },
    getAngleValueFromAnnotation(annotation) {
      if (!annotation || annotation.type !== "measure") return null;
      if (annotation.points && annotation.points.length === 3) {
        const val = this.calculateAngle(annotation.points[0], annotation.points[1], annotation.points[2]);
        return Number.isFinite(val) ? val : null;
      }
      const val = typeof annotation.angle === "number" ? annotation.angle : parseFloat(annotation.angle);
      return Number.isFinite(val) ? val : null;
    },
    collectAngleValuesFromAnnotations(annotations = [], labelFilter = null) {
      if (!Array.isArray(annotations)) return [];
      const values = [];
      annotations.forEach((a) => {
        if (!a || a.type !== "measure") return;
        if (labelFilter && !measurementLabelsEqual(a.label, labelFilter)) return;
        const val = this.getAngleValueFromAnnotation(a);
        if (Number.isFinite(val)) values.push(val);
      });
      return values;
    },
    buildAngleStatistics(values = []) {
      const summary = this.summarizeNumbers(values);
      return {
        ...summary,
        angles: (values || []).map((v) => (Number.isFinite(v) ? Number(v.toFixed(2)) : v)),
      };
    },
    distanceBetweenPoints(a, b) {
      return pointDistance(a, b) ?? 0;
    },
    polylineLength(points = []) {
      if (!Array.isArray(points) || points.length < 2) return 0;
      return points.reduce((total, point, index) => {
        if (index === 0) return total;
        return total + this.distanceBetweenPoints(points[index - 1], point);
      }, 0);
    },
    annotationWidth(annotation) {
      if (!annotation) return 0;
      if (Number.isFinite(Number(annotation.width))) return Math.abs(Number(annotation.width));
      if (annotation.line) {
        return Math.abs((Number(annotation.line.x2) || 0) - (Number(annotation.line.x1) || 0));
      }
      return 0;
    },
    annotationHeight(annotation) {
      if (!annotation) return 0;
      if (Number.isFinite(Number(annotation.height))) return Math.abs(Number(annotation.height));
      if (annotation.line) {
        return Math.abs((Number(annotation.line.y2) || 0) - (Number(annotation.line.y1) || 0));
      }
      return 0;
    },
    measurementRow(label, values = [], unit = 'px') {
      const numericValues = (values || []).map(Number).filter((value) => Number.isFinite(value) && value > 0);
      const summary = this.summarizeNumbers(numericValues);
      if (!summary.count) return null;
      const total = numericValues.reduce((sum, value) => sum + value, 0);
      return {
        label,
        unit,
        count: summary.count,
        mean: summary.mean,
        total: Number(total.toFixed(2)),
        min: summary.min,
        max: summary.max,
      };
    },
    buildWholePageStatistics(pageIndex = this.currentPage) {
      const annotations = this.annotationsByPage[pageIndex] || [];
      const comments = this.comments[pageIndex] || [];
      const bands = this.getPageLengthMeasurementsForExport(pageIndex);
      const highlights = annotations.filter((annotation) => annotation?.type === 'highlight');
      const underlines = annotations.filter((annotation) => annotation?.type === 'underline');
      const traces = annotations.filter((annotation) => annotation?.type === 'trace');
      const angles = annotations.filter((annotation) => annotation?.type === 'measure');
      const distances = annotations.filter((annotation) => annotation?.type === 'distance');
      const boxMeasurements = annotations.filter((annotation) => annotation?.type === 'boxMeasurement');
      const horizontalBands = bands.filter((band) => this.isHorizontalLabel(band?.label));
      const verticalBands = bands.filter((band) => !this.isHorizontalLabel(band?.label));
      const totalAnnotations = annotations.length + comments.length + bands.length;

      const rows = [
        this.measurementRow(
          'Highlight area',
          highlights.map((annotation) => this.annotationWidth(annotation) * this.annotationHeight(annotation)),
          'px²'
        ),
        this.measurementRow(
          'Underline length',
          underlines.map((annotation) => {
            if (annotation.line) {
              return this.distanceBetweenPoints(
                { x: annotation.line.x1, y: annotation.line.y1 },
                { x: annotation.line.x2, y: annotation.line.y2 }
              );
            }
            return Math.max(this.annotationWidth(annotation), this.annotationHeight(annotation));
          }),
          'px'
        ),
        this.measurementRow(
          'Trace path length',
          traces.map((annotation) => this.polylineLength(annotation.points)),
          'px'
        ),
        this.measurementRow(
          'Trace points',
          traces.map((annotation) => Array.isArray(annotation.points) ? annotation.points.length : 0),
          'pts'
        ),
        this.measurementRow(
          'Angles',
          angles.map((annotation) => this.getAngleValueFromAnnotation(annotation)).filter(Number.isFinite),
          '°'
        ),
        this.measurementRow(
          'Distance measurements',
          distances.map((annotation) => this.distanceBetweenPoints(annotation.points?.[0], annotation.points?.[1])),
          'px'
        ),
        this.measurementRow(
          'Crop & Count aspect ratio',
          boxMeasurements.map(annotation => annotation.aspectRatio),
          'W/H'
        ),
        this.measurementRow(
          'Crop & Count ink density',
          boxMeasurements.map(annotation => (Number(annotation.inkDensity) || 0) * 100),
          '%'
        ),
        this.measurementRow(
          'Horizontal band height',
          horizontalBands.map((band) => this.annotationHeight(band)),
          'px'
        ),
        this.measurementRow(
          'Vertical band width',
          verticalBands.map((band) => this.annotationWidth(band)),
          'px'
        ),
      ].filter(Boolean);

      return {
        title: `Current Page Summary: Page ${pageIndex + 1}`,
        counts: [
          { label: 'Total', value: totalAnnotations },
          { label: 'Highlights', value: highlights.length },
          { label: 'Underlines', value: underlines.length },
          { label: 'Traces', value: traces.length },
          { label: 'Angles', value: angles.length },
          { label: 'Distances', value: distances.length },
          { label: 'Crop & Count', value: boxMeasurements.length },
          { label: 'Comments', value: comments.length },
          { label: 'Bands', value: bands.length },
        ],
        measurements: rows,
      };
    },
    buildLengthStatisticsForPages(pages = []) {
      const horizontal = ["ascenders","descenders","interlinear","upperMargin","lowerMargin","lineHeight","minimumHeight","other_h"];
      const vertical = ["internalMargin","intercolumnSpaces","externalMargin","other_v"];
      const stats = {};
      const allTypes = [...horizontal, ...vertical];

      allTypes.forEach((type) => {
        const vals = [];
        pages.forEach((p) => {
          const arr = this.lengthMeasurements[type]?.[p];
          if (arr?.length) vals.push(...this.extractValues(arr, type));
        });
        const summary = this.summarizeNumbers(vals);
        if (summary.count > 0) {
          stats[type] = {
            average: summary.mean,
            standardDeviation: summary.stdDev,
            mode: summary.mode,
            count: summary.count,
          };
        }
      });

      return stats;
    },
    calculateAverage(values) { return this.summarizeNumbers(values).mean; },
    calculateStandardDeviation(values) { return this.summarizeNumbers(values).stdDev; },
    calculateMode(values) { return this.summarizeNumbers(values).mode; },
    showStatisticsPopup(statistics) {
      this.horizontalStatistics = {};
      this.verticalStatistics = {};
      this.pageStatisticsSummary = null;
      const horizontal = ["ascenders","descenders","interlinear","upperMargin","lowerMargin","lineHeight","minimumHeight","other_h"];
      const vertical = ["internalMargin","intercolumnSpaces","externalMargin","other_v"];
      for (const [type, stats] of Object.entries(statistics)) {
        if (horizontal.includes(type)) {
          this.horizontalStatistics[type] = stats;
        } else if (vertical.includes(type)) {
          this.verticalStatistics[type] = stats;
        }
      }
      this.showStatistics = true;
    },
    showWholePageStatisticsPopup(summary) {
      this.horizontalStatistics = {};
      this.verticalStatistics = {};
      this.pageStatisticsSummary = summary;
      this.showStatistics = true;
    },
    closeStatisticsPopup() {
      this.showStatistics = false;
      this.pageStatisticsSummary = null;
    },
    getCurrentPageStatistics() {
      return this.buildLengthStatisticsForPages([this.currentPage]);
    },
    getEntireDocumentStatistics() {
      const pageCount = Math.max(this.totalPages || 0, this.annotationsByPage.length || 0);
      const pages = pageCount > 0 ? Array.from({ length: pageCount }, (_, i) => i) : [this.currentPage];
      return this.buildLengthStatisticsForPages(pages);
    },

    /* ---------- Tool message ---------- */
    showToolMessage(message, duration = 3000) {
      if (this._toolMessageTimer) {
        clearTimeout(this._toolMessageTimer);
        this._toolMessageTimer = null;
      }
      this.toolMessage = message;
      if (Number.isFinite(duration) && duration > 0) {
        this._toolMessageTimer = window.setTimeout(() => {
          this.toolMessage = "";
          this._toolMessageTimer = null;
        }, duration);
      }
    },
  },
};
</script>

<style scoped>
* { font-family: var(--font-sans, "Arial", "Helvetica", sans-serif) !important; }
.viewer-container {
  display: flex;
  flex-direction: column;
  height: 100vh;
  width: 100vw;
  background: hsl(var(--canvas)); /* dark canvas behind the manuscript */
}
/* Full-bleed bars with clean layout */
.top-bar {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 16px;
  background: hsl(var(--card));
  border-bottom: 1px solid hsl(var(--border));
  padding: 12px 24px;
  box-shadow: 0 1px 3px rgb(0 0 0 / 0.05);
  position: relative;
  z-index: 100;
}
.dark .top-bar {
  box-shadow: 0 1px 4px rgb(0 0 0 / 0.2);
}
.logo {
  height: 60px;
  cursor: pointer;
  border-radius: 12px;
  overflow: hidden;
}

.toolbar {
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: minmax(68px, auto);
  justify-content: center;
  align-items: center;
  gap: 28px;
}
.toolbar-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  color: hsl(var(--foreground));
  cursor: pointer;
  padding: 6px 4px;
  user-select: none;
  position: relative;
  border-radius: var(--radius-md, 8px);
  transition: all 0.2s ease;
}
.toolbar-item:hover {
  color: hsl(var(--primary));
  background: hsl(var(--primary) / 0.1);
  transform: translateY(-1px);
}
.toolbar-item:active {
  transform: translateY(0);
}
.toolbar-item.active {
  color: hsl(var(--primary));
  background: hsl(var(--primary) / 0.12);
  border: 1px solid hsl(var(--primary) / 0.25);
}
.toolbar-item svg { width: 22px; height: 22px; }
.toolbar-item span { font-size: 11px; text-align: center; line-height: 1.2; }

.toolbar-divider {
  width: 1px;
  height: 32px;
  background: hsl(var(--border));
  margin: 0 8px;
}

.tool-message {
  position: fixed; top: 60px; left: 50%; transform: translateX(-50%);
  background-color: hsl(var(--primary)); color: hsl(var(--primary-foreground)); padding: 8px 14px; border-radius: 6px; z-index: 1200; font-size: 12px;
}

.workspace {
  display: flex;
  height: calc(100vh - 110px);
  width: 100%;
  background: hsl(var(--canvas));
}
.stage {
  position: relative;
  background: hsl(var(--canvas));
  box-shadow: inset 0 2px 8px rgb(0 0 0 / 0.15);
  user-select: none !important;
  -webkit-user-select: none !important;
  -moz-user-select: none !important;
  -ms-user-select: none !important;
  -webkit-touch-callout: none !important;
  -webkit-tap-highlight-color: transparent !important;
}
.dark .stage {
  box-shadow: inset 0 2px 12px rgb(0 0 0 / 0.35);
}

.stage *,
.stage *::before,
.stage *::after {
  user-select: none !important;
  -webkit-user-select: none !important;
  -moz-user-select: none !important;
  -ms-user-select: none !important;
  -webkit-touch-callout: none !important;
  -webkit-tap-highlight-color: transparent !important;
}

.stage *::selection,
.stage::selection {
  background: transparent !important;
  color: inherit !important;
}

.stage *::-moz-selection,
.stage::-moz-selection {
  background: transparent !important;
  color: inherit !important;
}

/* OpenSeadragon Container */
.osd-container {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  z-index: 1;
}

/* Event Intercept Layer - captures events when tools are active */
.event-intercept-layer {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 5;
  background: transparent;
  touch-action: none;
  cursor: crosshair;
}

/* Annotation Overlay - positioned over OSD */
.annotation-overlay {
  position: absolute;
  pointer-events: none;
  z-index: 10;
  overflow: visible;
}

.tool-interaction-layer {
  z-index: 900;
  pointer-events: auto;
  touch-action: none;
}

.annotation-overlay > * {
  pointer-events: auto;
}

.annotation-overlay .drawing-layer {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  overflow: visible;
}

.annotation-overlay .drawing-layer * {
  pointer-events: none;
}

.annotation-overlay .drawing-layer .angle-hit-target {
  pointer-events: stroke !important;
  cursor: pointer;
}

.annotation-overlay .drawing-layer .distance-hit-target {
  pointer-events: stroke !important;
  cursor: pointer;
}

.annotation-overlay .drawing-layer .trace-selection-group {
  pointer-events: auto !important;
  cursor: pointer;
}

.annotation-overlay .drawing-layer .trace-hit-target {
  pointer-events: stroke !important;
  cursor: pointer;
}

.annotation-interactive {
  pointer-events: auto !important;
  cursor: help;
}

.annotation-overlay .drawing-layer .annotation-interactive {
  pointer-events: painted !important;
  cursor: pointer;
}

.underline-line.annotation-interactive::before {
  content: '';
  position: absolute;
  inset: -5px 0;
}

.highlight-rectangle.annotation-interactive,
.underline-line.annotation-interactive,
.box-measurement.annotation-interactive {
  pointer-events: auto !important;
  cursor: pointer;
}

.annotation-overlay.annotation-overlay--passthrough,
.annotation-overlay.annotation-overlay--passthrough * {
  pointer-events: none !important;
}

.highlight-rectangle.is-selected,
.underline-line.is-selected,
.box-measurement.is-selected {
  outline: 2px solid hsl(var(--primary));
  outline-offset: 3px;
  box-shadow: 0 0 0 4px hsl(var(--primary) / 0.18), 0 0 16px hsl(var(--primary) / 0.38);
}

.underline-line.is-selected {
  height: 4px !important;
}

.annotation-flash {
  animation: annotation-light-pulse 0.55s ease-in-out infinite alternate !important;
}

.highlight-rectangle.annotation-flash,
.underline-line.annotation-flash,
.box-measurement.annotation-flash,
.length-measurement.annotation-flash,
.angle-label.annotation-flash,
.distance-label.annotation-flash {
  outline: 3px solid #facc15 !important;
  outline-offset: 3px;
  box-shadow: 0 0 0 5px rgb(250 204 21 / 0.35), 0 0 20px 8px rgb(250 204 21 / 0.65) !important;
}

.box-measurement {
  box-sizing: border-box;
  border: 2px solid #f97316;
  background: rgb(249 115 22 / 0.08);
  pointer-events: none;
  z-index: 180;
}
.box-measurement > span {
  position: absolute;
  left: -2px;
  bottom: calc(100% + 3px);
  max-width: 280px;
  overflow: hidden;
  border: 1px solid rgb(249 115 22 / 0.8);
  border-radius: 0.3rem;
  background: rgb(17 24 39 / 0.86);
  color: #ffedd5;
  padding: 0.18rem 0.35rem;
  font-size: 0.68rem;
  font-weight: 650;
  line-height: 1.2;
  text-overflow: ellipsis;
  white-space: nowrap;
  pointer-events: none;
}
.box-measurement--live { border-style: dashed; background: rgb(249 115 22 / 0.15); }
.box-resize-handle {
  position: absolute;
  width: 10px;
  height: 10px;
  border: 2px solid hsl(var(--background));
  border-radius: 2px;
  background: #f97316;
  box-shadow: 0 0 0 1px rgb(17 24 39 / 0.5);
  padding: 0;
  pointer-events: auto;
}
.box-resize-handle--nw { left: -6px; top: -6px; cursor: nwse-resize; }
.box-resize-handle--ne { right: -6px; top: -6px; cursor: nesw-resize; }
.box-resize-handle--se { right: -6px; bottom: -6px; cursor: nwse-resize; }
.box-resize-handle--sw { left: -6px; bottom: -6px; cursor: nesw-resize; }

.annotation-overlay .drawing-layer .saved-angle-group.annotation-flash .angle-line {
  stroke: #facc15 !important;
  filter: drop-shadow(0 0 7px #facc15);
}

.annotation-overlay .drawing-layer .saved-distance-group.annotation-flash .distance-line {
  stroke: #facc15 !important;
  filter: drop-shadow(0 0 7px #facc15);
}

.annotation-overlay .drawing-layer .annotation-trace.annotation-flash {
  filter: drop-shadow(0 0 4px #fff) drop-shadow(0 0 9px #facc15);
}

.annotation-overlay .drawing-layer .trace-selection-group.is-selected .annotation-trace {
  filter: drop-shadow(0 0 3px hsl(var(--background))) drop-shadow(0 0 8px hsl(var(--primary)));
  stroke: hsl(var(--primary));
  stroke-width: 2px;
  paint-order: stroke fill;
}

@keyframes annotation-light-pulse {
  from { filter: brightness(1) drop-shadow(0 0 2px rgb(250 204 21 / 0.7)); }
  to { filter: brightness(1.5) drop-shadow(0 0 10px #facc15); }
}

.annotation-hover-tooltip {
  position: fixed;
  z-index: 10020;
  max-width: 210px;
  padding: 6px 9px;
  border: 1px solid hsl(var(--border));
  border-radius: 6px;
  background: hsl(var(--popover));
  color: hsl(var(--popover-foreground));
  box-shadow: 0 5px 16px rgb(0 0 0 / 0.2);
  font-size: 12px;
  font-weight: 600;
  line-height: 1.25;
  pointer-events: none;
  white-space: normal;
}

.annotation-overlay .drawing-layer .saved-angle-group.is-keyboard-selected .angle-line {
  stroke: #f59e0b;
  filter: drop-shadow(0 0 3px rgb(245 158 11 / 0.8));
}

.annotation-overlay .drawing-layer .saved-distance-group.is-selected .distance-line {
  stroke: #f59e0b;
  filter: drop-shadow(0 0 3px rgb(245 158 11 / 0.8));
}

.bank { width: 300px; min-width: 300px; border-left: 1px solid hsl(var(--border)); }

.navigation-bar {
  display: flex;
  justify-content: center;
  align-items: center;
  margin: 0;
  padding: 0 24px 10px 24px;
  gap: 10px;
  background: hsl(var(--background));
  border-bottom: 1px solid hsl(var(--border));
}
.page-input-container { display: flex; align-items: center; gap: 4px; }
.page-input-container input { width: 45px; text-align: center; }

.navigation-bar .btn {
  background: hsl(var(--primary));
  color: hsl(var(--primary-foreground));
  border: 1px solid hsl(var(--primary));
  border-radius: 8px;
  padding: 6px 10px;
  font-size: 12px;
  transition: all 0.15s ease;
}
.navigation-bar .btn:hover:not(:disabled) {
  filter: brightness(1.05);
  transform: scale(1.02);
}
.navigation-bar .btn:active:not(:disabled) {
  transform: scale(0.98);
}
.navigation-bar .btn:disabled {
  opacity: .45;
  cursor: not-allowed;
}
.navigation-bar input {
  height: 28px;
  padding: 0 8px;
  border: 1px solid hsl(var(--border));
  border-radius: 6px;
  background: hsl(var(--background));
  color: hsl(var(--foreground));
}

/* === Base stacking for stage and annotations === */
.stage,
.pdf-viewer {
  position: relative;
  z-index: 0;
}

.drawing-layer,            /* SVG traces/angles */
.highlight-rectangle,
.underline-line,
.length-measurement,       /* the colored band rectangles */
.comment-container,
.cropping-rectangle {
  z-index: 200;            /* safely below overlays/panels */
}

/* Bank panel still floats above the stage but below popups */
.bank-panel {
  z-index: 1500;
}

/* === Popups / overlays must always be on top === */
.length-popup,             /* Horizontal/Vertical selectors */
.statistics-popup,         /* results tables */
.stats-panel {             /* the 'Statistics' quick panel */
  z-index: calc(var(--z-modal-top) + 500);  /* Always above cropped popup */
  isolation: isolate;      /* Create stacking context to prevent blur bleeding */
}

.cropped-popup,            /* cropped image dialog */
.blurred-background {
  z-index: var(--z-modal);           /* modal level */
}

/* When cropped popup is active, other popups should be above it */
.length-popup,
.statistics-popup {
  z-index: 999999 !important;  /* NUCLEAR OPTION - MUST BE ON TOP */
  isolation: isolate;
  position: relative;
}

/* Just to be safe, their internal cards sit above their own backdrop */
.length-popup-content,
.statistics-popup-content,
.panel-card.stats-card,
.cropped-popup-content {
  position: relative;
  z-index: 1;
  background: hsl(var(--card));          /* Ensure solid background */
  isolation: isolate;        /* Prevent blur inheritance */
}

.pdf-viewer {
  position: relative;
  width: 100%;
  height: 100%;
  display: flex;
  justify-content: center;
  align-items: center;
  overflow: hidden;
  background: hsl(var(--canvas)); /* dark canvas behind manuscript */
  box-shadow: inset 0 2px 8px rgb(0 0 0 / 0.15);
}
.pdf-viewer img { max-width: 100%; max-height: 100%; object-fit: contain; display: block; }

.drawing-layer { position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; }

.underline-line { position: absolute; background-color: blue; height: 2px; pointer-events: none; z-index: 1100; }

.length-measurement {
  position: absolute;
  pointer-events: none;
  box-sizing: border-box;
}
.length-measurement.band-selected {
  outline: 2px solid hsl(var(--primary));
  outline-offset: 2px;
  cursor: default;
}
.band-resize-handle {
  position: absolute;
  width: 12px;
  height: 12px;
  padding: 0;
  border: 2px solid hsl(var(--background));
  border-radius: 50%;
  background: hsl(var(--primary));
  box-shadow: 0 0 0 1px hsl(var(--primary)), 0 2px 5px rgb(0 0 0 / 0.3);
  z-index: 500;
  pointer-events: auto;
  touch-action: none;
}
.band-resize-handle--nw { left: 0; top: 0; transform: translate(-50%, -50%); cursor: nwse-resize; }
.band-resize-handle--ne { right: 0; top: 0; transform: translate(50%, -50%); cursor: nesw-resize; }
.band-resize-handle--se { right: 0; bottom: 0; transform: translate(50%, 50%); cursor: nwse-resize; }
.band-resize-handle--sw { left: 0; bottom: 0; transform: translate(-50%, 50%); cursor: nesw-resize; }
.measurement-scale-options {
  display: grid;
  gap: 12px;
  padding-top: 8px;
}
.measurement-scale-option {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 14px;
  text-align: left;
  border: 1px solid hsl(var(--border));
  border-radius: var(--radius-lg);
  background: hsl(var(--card));
  color: hsl(var(--card-foreground));
}
.measurement-scale-option:hover {
  border-color: hsl(var(--primary));
  background: hsl(var(--accent));
}
.measurement-scale-option span,
.measurement-calibration-form p {
  color: hsl(var(--muted-foreground));
  font-size: 13px;
}
.measurement-calibration-form {
  display: grid;
  gap: 16px;
  padding-top: 8px;
}
.measurement-calibration-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
.measurement-calibration-grid label {
  display: grid;
  gap: 6px;
  font-size: 13px;
  font-weight: 600;
}
.measurement-calibration-grid input {
  width: 100%;
  padding: 8px 10px;
  border: 1px solid hsl(var(--border));
  border-radius: var(--radius-md);
  background: hsl(var(--background));
  color: hsl(var(--foreground));
}
.measurement-calibration-error {
  color: hsl(var(--destructive)) !important;
}
.measurement-calibration-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
.length-label {
  position: absolute; left: 15px; top: 15px; transform: translateY(0);
  color: hsl(var(--foreground)); font-size: 12px; background-color: hsl(var(--card)); padding: 2px 5px; border-radius: 3px;
}
.draggable-label { cursor: grab; user-select: none; }
.draggable-label:active { cursor: grabbing; }
.angle-label {
  position: absolute; left: 15px; top: 15px;
  color: #00ff87; font-size: 14px; font-weight: bold;
  background-color: rgba(0, 0, 0, 0.6); padding: 2px 6px; border-radius: 3px;
  text-shadow: 0 0 2px #000;
  white-space: nowrap;
}

.angle-label.is-keyboard-selected {
  outline: 2px solid #f59e0b;
  outline-offset: 2px;
}

.distance-label {
  position: absolute; left: 15px; top: 15px;
  color: #f5d0fe; font-size: 14px; font-weight: bold;
  background-color: rgba(0, 0, 0, 0.66); padding: 2px 6px; border-radius: 3px;
  text-shadow: 0 0 2px #000;
  white-space: nowrap;
}

.distance-label.is-selected {
  outline: 2px solid #f59e0b;
  outline-offset: 2px;
}

.angle-context-menu {
  position: fixed;
  z-index: 9999;
  min-width: 210px;
  padding: 5px;
  border: 1px solid hsl(var(--border));
  border-radius: 8px;
  background: hsl(var(--popover));
  color: hsl(var(--popover-foreground));
  box-shadow: 0 10px 28px rgb(0 0 0 / 0.22);
}

.angle-context-menu__item {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 8px;
  border: 0;
  border-radius: 5px;
  padding: 8px 10px;
  background: transparent;
  color: hsl(var(--popover-foreground));
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}

.angle-context-menu__delete {
  color: hsl(var(--destructive));
}

.angle-context-menu__item:hover,
.angle-context-menu__item:focus-visible {
  background: hsl(var(--accent));
  outline: none;
}

.angle-context-menu__delete:hover,
.angle-context-menu__delete:focus-visible {
  background: hsl(var(--destructive) / 0.1);
  outline: none;
}

.highlight-rectangle { position: absolute; border: 2px solid rgba(255, 255, 0, 0.7); background-color: rgba(255, 255, 0, 0.3); pointer-events: none; }

.cropping-rectangle { position: absolute; border: 2px dashed #007bff; background-color: rgba(0, 123, 255, 0.2); pointer-events: none; z-index: 100; }

.blurred-background {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background-color: rgba(0, 0, 0, 0.82); /* opaque mask so bank text does not show through */
  backdrop-filter: none;
  z-index: var(--z-modal);
}
.cropped-popup {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  background: hsl(var(--card));
  border: 2px solid hsl(var(--border));
  border-radius: 8px;
  box-shadow: 0 8px 32px rgba(0,0,0,0.5);
  z-index: var(--z-modal-top);
  padding: 20px;
  text-align: center;
  user-select: none !important;
  -webkit-user-select: none !important;
  -moz-user-select: none !important;
  -ms-user-select: none !important;
  -webkit-touch-callout: none !important;
}

.cropped-popup * {
  user-select: none !important;
  -webkit-user-select: none !important;
  -moz-user-select: none !important;
  -ms-user-select: none !important;
  -webkit-touch-callout: none !important;
}

/* Global selection prevention when cropped popup is active */
body.cropped-popup-active * {
  user-select: none !important;
  -webkit-user-select: none !important;
  -moz-user-select: none !important;
  -ms-user-select: none !important;
  -webkit-touch-callout: none !important;
}

body.cropped-popup-active *::selection {
  background: transparent !important;
}

body.cropped-popup-active *::-moz-selection {
  background: transparent !important;
}
.cropped-popup-content img { max-width: 100%; max-height: 300px; margin-bottom: 20px; }
.cropped-popup-content button { margin-top: 10px; padding: 8px 16px; background-color: hsl(var(--primary)); color: hsl(var(--primary-foreground)); border: none; border-radius: 4px; cursor: pointer; }
.cropped-popup-content button:hover { filter: brightness(0.9); }


.clear-dropdown {
  position: absolute; top: 100%; left: 0; background: hsl(var(--popover)); color: hsl(var(--popover-foreground)); border: 1px solid hsl(var(--border)); border-radius: 6px; box-shadow: 0 4px 12px rgba(0,0,0,0.15); z-index: 300; min-width: 160px; padding: 4px 0; margin-top: 4px;
}
.clear-dropdown div { padding: 8px 12px; cursor: pointer; transition: background-color 0.15s; }
.clear-dropdown div:hover { background: hsl(var(--accent) / 0.1); }

/* Theme dropdown */
.theme-container { position: relative; z-index: 200; }
.theme-dropdown {
  position: absolute;
  top: 100%;
  left: 50%;
  transform: translateX(-50%);
  margin-top: 4px;
  background: hsl(var(--popover, 0 0% 100%));
  color: hsl(var(--popover-foreground, 0 0% 20%));
  border: 1px solid hsl(var(--border, 220 13% 91%)); border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.2); z-index: 300; min-width: 160px;
  padding: 4px 0;
}
.theme-dropdown div {
  padding: 8px 16px; cursor: pointer;
  display: flex; align-items: center; gap: 8px;
  transition: background-color 0.15s;
  white-space: nowrap;
}
.theme-dropdown div:hover { background: hsl(var(--accent, 215 100% 50%) / 0.1); }
.theme-dropdown div.active {
  background: hsl(var(--primary, 217 91% 60%));
  color: hsl(var(--primary-foreground, 0 0% 100%));
}

.length-popup {
  position: fixed; top: 0; left: 0; width: 100%; height: 100%;
  display: flex; justify-content: center; align-items: center;
  background-color: rgba(0,0,0,0.5); z-index: 999999 !important;
  isolation: isolate;
}
.length-popup-content {
  background: hsl(var(--card));
  color: hsl(var(--card-foreground));
  padding: 20px;
  border-radius: var(--radius-lg, 12px);
  border: 1px solid hsl(var(--border));
  box-shadow: var(--shadow-modal, 0 25px 50px -12px rgba(0, 0, 0, 0.25));
  text-align: center;
  width: 520px;
  max-width: calc(100% - 24px);
  position: relative;
  z-index: 1;
  isolation: isolate;
}

.length-popup-content h3 {
  color: hsl(var(--foreground));
  margin-bottom: 16px;
}
.btn-grid, .label-grid { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; margin: 14px 0; }
.grid-btn {
  border: 2px solid hsl(var(--primary));
  background: hsl(var(--primary));
  color: hsl(var(--primary-foreground));
  padding: 8px 12px;
  border-radius: var(--radius-md, 8px);
  font-size: 13px;
  cursor: pointer;
  transition: all 0.15s ease;
}
.grid-btn:hover {
  filter: brightness(0.9);
}
.grid-btn:active { transform: translateY(1px); }
.grid-btn.active {
  background: hsl(var(--primary));
  border-color: hsl(var(--primary));
  box-shadow: 0 0 0 3px hsl(var(--primary) / 0.3);
}
.grid-btn.confirm-btn {
  background: hsl(var(--primary));
  border-color: hsl(var(--primary));
  color: hsl(var(--primary-foreground));
}
.grid-btn.confirm-btn:hover {
  filter: brightness(0.9);
}
.grid-btn.cancel-btn {
  background: hsl(var(--muted));
  border-color: hsl(var(--border));
  color: hsl(var(--foreground));
}
.grid-btn.cancel-btn:hover {
  filter: brightness(0.95);
}
.swatch {
  display:inline-block;
  width:16px;
  height:16px;
  border-radius:4px;
  margin-right:8px;
  border:1px solid rgba(0,0,0,.1);
  vertical-align: -2px;
}
.popup-actions { display: flex; justify-content: center; gap: 10px; }

.row { margin: 12px 0; text-align: left; }
.row label { display: inline-block; width: 80px; font-size: 13px; color: hsl(var(--foreground)); }
.new-label-row { display: flex; gap: 8px; justify-content: center; margin: 8px 0 0; }
.new-label-row input {
  flex: 1;
  min-width: 240px;
  border: 1px solid hsl(var(--border));
  border-radius: var(--radius-md, 6px);
  padding: 6px 8px;
  background: hsl(var(--background));
  color: hsl(var(--foreground));
}
.new-label-row input::placeholder {
  color: hsl(var(--muted-foreground));
}

/* Overlay for stats panel */
.stats-panel {
  position: fixed;
  inset: 0;                           /* top/left/right/bottom: 0 */
  background: rgba(0, 0, 0, 0.30);
  display: flex;
  align-items: center;
  justify-content: center;
}

/* Card look & feel */
.panel-card.stats-card {
  background: hsl(var(--card));
  color: hsl(var(--card-foreground));
  border: 1px solid hsl(var(--border));
  border-radius: var(--radius-lg, 14px);
  box-shadow: var(--shadow-modal, 0 25px 50px -12px rgba(0, 0, 0, 0.25));
  width: min(680px, calc(100% - 32px));
  padding: 22px 24px 24px;
  text-align: center;
}

/* Title */
.panel-card.stats-card h4 {
  margin: 0 0 14px;
  font-size: 26px;
  font-weight: 700;
  color: hsl(var(--foreground));
}

/* Button layout inside the stats card */
.panel-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  justify-content: center;
  margin-top: 6px;
}

/* Reuse the themed 'grid-btn' look but add a little breathing room */
.panel-actions .grid-btn {
  min-width: 230px;
  padding: 10px 14px;
  border-radius: var(--radius-lg, 12px);
  border: 1px solid hsl(var(--primary));
  background: hsl(var(--primary));
  color: hsl(var(--primary-foreground));
  font-weight: 600;
}
.panel-actions .grid-btn:hover {
  filter: brightness(0.9);
}
.panel-actions .grid-btn:active {
  transform: translateY(1px);
}

.statistics-popup {
  position: fixed; top: 0; left: 0; width: 100%; height: 100%;
  display: flex; justify-content: center; align-items: center; background: rgba(0,0,0,0.5); z-index: 999999 !important;
  isolation: isolate;
}
.statistics-popup-content {
  background: hsl(var(--card));
  color: hsl(var(--card-foreground));
  padding: 20px;
  border-radius: var(--radius-lg, 8px);
  border: 1px solid hsl(var(--border));
  box-shadow: var(--shadow-modal, 0 25px 50px -12px rgba(0, 0, 0, 0.25));
  max-width: 600px;
  width: 100%;
  position: relative;
  z-index: 1;
  isolation: isolate;
}
.statistics-popup-content h3,
.statistics-popup-content h4 {
  color: hsl(var(--foreground));
}
.statistics-popup-content table {
  width: 100%;
  border-collapse: collapse;
  margin-bottom: 20px;
}
.statistics-popup-content th,
.statistics-popup-content td {
  border: 1px solid hsl(var(--border));
  padding: 10px 12px;
  text-align: center;
}
.statistics-popup-content th {
  background: hsl(var(--muted));
  color: hsl(var(--foreground));
  font-weight: 600;
}
.statistics-popup-content td {
  color: hsl(var(--foreground));
}
.statistics-popup-content h4 { margin-top: 12px; margin-bottom: 8px; }
.angle-stats-context { margin: 4px 0 12px; color: #4b5563; font-size: 13px; }

.measurement-statistics-warning {
  margin: 0 0 12px;
  padding: 8px 10px;
  border: 1px solid hsl(var(--border));
  border-radius: 6px;
  background: hsl(var(--muted));
  color: hsl(var(--muted-foreground));
  font-size: 12px;
}

.angle-snap-control {
  position: absolute;
  top: 4rem;
  left: 50%;
  z-index: 950;
  display: flex;
  align-items: center;
  gap: 0.45rem;
  transform: translateX(-50%);
  padding: 0.45rem 0.7rem;
  border: 1px solid hsl(var(--border));
  border-radius: 0.5rem;
  background: hsl(var(--card) / 0.96);
  box-shadow: 0 4px 12px rgb(0 0 0 / 0.14);
  color: hsl(var(--foreground));
  font-size: 0.8rem;
  user-select: none;
}

.angle-snap-control small {
  color: hsl(var(--muted-foreground));
  font-size: 0.7rem;
}

.box-measurement-control {
  position: absolute;
  top: 4rem;
  left: 50%;
  z-index: 950;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  transform: translateX(-50%);
  padding: 0.45rem 0.55rem 0.45rem 0.75rem;
  border: 1px solid hsl(var(--border));
  border-radius: 0.625rem;
  background: hsl(var(--card) / 0.97);
  box-shadow: 0 4px 14px rgb(0 0 0 / 0.16);
  color: hsl(var(--foreground));
}
.box-measurement-control div { display: grid; min-width: 11rem; }
.box-measurement-control strong { font-size: 0.8rem; }
.box-measurement-control small { color: hsl(var(--muted-foreground)); font-size: 0.68rem; }
.box-measurement-control button {
  border: 1px solid hsl(var(--border)); border-radius: 0.4rem; background: hsl(var(--background));
  color: hsl(var(--foreground)); padding: 0.32rem 0.5rem; font-size: 0.72rem;
}
.box-measurement-control button:hover { background: hsl(var(--muted)); }
.box-measurement-control button.primary { border-color: hsl(var(--primary)); background: hsl(var(--primary)); color: hsl(var(--primary-foreground)); }
.box-measurement-control button:disabled { cursor: wait; opacity: 0.55; }

/* Stage is a fixed viewport for the page; UI overlays sit on top via z-index */
.pdf-viewer.stage {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  /* no flex centering — the anchor will center itself abs pos */
}

/* New absolute centered container that gets transformed */
.zoom-anchor {
  position: absolute; /* set in JS too */
  z-index: 100;       /* keep content behind bank/buttons/popups */
  will-change: transform;
  user-select: none !important;
  -webkit-user-select: none !important;
  -moz-user-select: none !important;
  -ms-user-select: none !important;
  -webkit-touch-callout: none !important;
}

.zoom-anchor *,
.zoom-anchor *::before,
.zoom-anchor *::after {
  user-select: none !important;
  -webkit-user-select: none !important;
  -moz-user-select: none !important;
  -ms-user-select: none !important;
  -webkit-touch-callout: none !important;
  -webkit-tap-highlight-color: transparent !important;
  -webkit-highlight: none !important;
}

.zoom-anchor *::selection,
.zoom-anchor::selection {
  background: transparent !important;
  color: inherit !important;
}

.zoom-anchor *::-moz-selection,
.zoom-anchor::-moz-selection {
  background: transparent !important;
  color: inherit !important;
}

/* NUCLEAR OPTION: Background div instead of img element */
.image-viewer-background {
  width: 100% !important;
  height: 100% !important;
  display: block !important;
  position: absolute !important;
  top: 0 !important;
  left: 0 !important;
  z-index: -100 !important;
  
  /* Complete interaction prevention */
  pointer-events: none !important;
  user-select: none !important;
  -webkit-user-select: none !important;
  -moz-user-select: none !important;
  -ms-user-select: none !important;
  -webkit-touch-callout: none !important;
  -webkit-user-drag: none !important;
  -khtml-user-drag: none !important;
  -moz-user-drag: none !important;
  -o-user-drag: none !important;
  outline: none !important;
  border: none !important;
  -webkit-appearance: none !important;
  -moz-appearance: none !important;
  appearance: none !important;
  -webkit-tap-highlight-color: transparent !important;
  -webkit-highlight: none !important;
  -moz-user-focus: ignore !important;
  background-color: transparent !important;
  
  /* Prevent any text/content selection */
  -webkit-user-modify: read-only !important;
  -moz-user-modify: read-only !important;
}

.image-viewer-background::selection,
.image-viewer-background *::selection {
  background: transparent !important;
  color: inherit !important;
}

.image-viewer-background::-moz-selection,
.image-viewer-background *::-moz-selection {
  background: transparent !important;
  color: inherit !important;
}

.calculation-image {
  width: 100% !important;
  height: 100% !important;
  object-fit: contain !important;
  opacity: 0 !important;
  pointer-events: none !important;
  user-select: none !important;
  position: absolute !important;
  top: 0 !important;
  left: 0 !important;
  z-index: -1 !important;
}

.hidden-image-loader {
  display: none !important;
  visibility: hidden !important;
  position: absolute !important;
  top: -9999px !important;
  left: -9999px !important;
  pointer-events: none !important;
  user-select: none !important;
}

/* Ensure drawing layer sits above the image but below buttons/panels */
.drawing-layer {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 120; /* slightly above anchor content if needed */
}

/* Keep bank and buttons well above page content */
.bank-panel { z-index: 1500; }

.image-viewer {
  width: 100% !important;
  height: 100% !important;
  object-fit: contain !important;
  display: block !important;
  
  /* NUCLEAR OPTION: Complete interaction prevention */
  pointer-events: none !important;
  user-select: none !important;
  -webkit-user-select: none !important;
  -moz-user-select: none !important;
  -ms-user-select: none !important;
  -webkit-touch-callout: none !important;
  -webkit-user-drag: none !important;
  -khtml-user-drag: none !important;
  -moz-user-drag: none !important;
  -o-user-drag: none !important;
  outline: none !important;
  border: none !important;
  -webkit-appearance: none !important;
  -moz-appearance: none !important;
  appearance: none !important;
  -webkit-tap-highlight-color: transparent !important;
  -webkit-highlight: none !important;
  -moz-user-focus: ignore !important;
  position: relative !important;
  z-index: -10 !important;
  background: transparent !important;
  
  /* Completely invisible to mouse interactions */
  visibility: hidden !important;
}

/* Make the image visible but completely unselectable */
.zoom-anchor .image-viewer {
  visibility: visible !important;
  position: absolute !important;
  top: 0 !important;
  left: 0 !important;
  width: 100% !important;
  height: 100% !important;
  z-index: -100 !important;
  pointer-events: none !important;
  user-select: none !important;
  -webkit-user-select: none !important;
  -moz-user-select: none !important;
  -ms-user-select: none !important;
}

.image-viewer::selection {
  background: transparent !important;
  color: inherit !important;
}

.image-viewer::-moz-selection {
  background: transparent !important;
  color: inherit !important;
}
.page-loading {
  position: absolute; inset: 0;
  display: grid; place-items: center;
  color: #4b5563;
  font-size: 13px;
}

.iiif-status-overlay {
  position: absolute;
  inset: 0;
  z-index: 1200;
  display: grid;
  place-items: center;
  padding: 24px;
  background: hsl(var(--background) / 0.82);
  backdrop-filter: blur(2px);
}

.iiif-status-card {
  display: flex;
  align-items: center;
  gap: 12px;
  max-width: 680px;
  padding: 16px 20px;
  border: 1px solid hsl(var(--border));
  border-radius: 10px;
  background: hsl(var(--card));
  color: hsl(var(--card-foreground));
  box-shadow: var(--shadow-lg, 0 10px 25px rgb(0 0 0 / 0.18));
}

.iiif-spinner {
  width: 20px;
  height: 20px;
  flex: 0 0 auto;
  border: 2px solid hsl(var(--muted));
  border-top-color: hsl(var(--primary));
  border-radius: 9999px;
  animation: iiif-spin 0.8s linear infinite;
}

.iiif-error-card {
  display: grid;
  gap: 10px;
}

.iiif-error-card p {
  margin: 0;
  line-height: 1.45;
  overflow-wrap: anywhere;
}

.iiif-error-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.iiif-error-actions button {
  padding: 8px 12px;
  border: 1px solid hsl(var(--primary));
  border-radius: 6px;
  background: hsl(var(--primary));
  color: hsl(var(--primary-foreground));
  cursor: pointer;
}

.iiif-error-actions button.secondary {
  border-color: hsl(var(--border));
  background: hsl(var(--secondary));
  color: hsl(var(--secondary-foreground));
}

@keyframes iiif-spin {
  to { transform: rotate(360deg); }
}

/* Popups must be the absolute top-most layer */
.length-popup,
.stats-panel,
.statistics-popup,
.cropped-popup {
  z-index: 2000;
}

/* Cropped Image Dialog Styles */
.crop-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 12px;
  flex-shrink: 0;
}

.crop-actions {
  display: flex;
  gap: 8px;
}

.crop-stage {
  position: relative;
  height: 480px;
  min-height: 300px;
  background: hsl(var(--muted));
  border: 1px solid hsl(var(--border));
  border-radius: var(--radius-lg, 12px);
  overflow: hidden;
  margin: 0;
  flex-shrink: 0;
}

.crop-anchor {
  position: absolute;
  will-change: transform;
  z-index: 100;
}

.cropped-image {
  display: block;
  max-width: 100%;
  max-height: 100%;
  width: auto;
  height: auto;
  object-fit: contain;
}

.zoom-btn {
  position: absolute;
  z-index: 1200;
  width: 36px; height: 36px;
  border-radius: 50%;
  border: none;
  background: hsl(var(--primary));
  color: hsl(var(--primary-foreground));
  font-size: 20px;
  line-height: 36px;
  text-align: center;
  cursor: pointer;
  box-shadow: 0 2px 8px rgba(0,0,0,0.2);
}
.zoom-btn:disabled { opacity:.45; cursor:not-allowed; }
.zoom-btn:hover { filter: brightness(.9); }

.mini-bank {
  margin-top: 12px;
  border-top: 1px dashed hsl(var(--border));
  padding-top: 10px;
  flex-shrink: 0;
}
.mini-bank-title {
  font-weight: 700;
  font-size: 14px;
  color: hsl(var(--foreground));
  margin-bottom: 6px;
}
.mini-bank-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px,1fr));
  gap: 6px;
}
.mini-bank-item {
  display:flex; align-items:center; gap:8px;
  background: hsl(var(--muted));
  border: 1px solid hsl(var(--border));
  padding:6px 8px;
  border-radius: var(--radius-md, 8px);
  font-size:12px;
  color: hsl(var(--foreground));
}
.mini-bank-item .dot {
  width:10px; height:10px; border-radius:50%;
}

/* ===== Global modal stacking policy ===== */
:root {
  --z-stage: 0;
  --z-bank: 1500;
  --z-bank-blurred: 1000;   /* bank when popups are open */
  --z-popover: 3000;        /* tooltips, small menus */
  --z-modal: 50000;         /* standard dialogs (crop popup) */
  --z-modal-top: 100000;    /* any popup that must be above all */
}

/* NUCLEAR OPTION: Force angle/trace popups above everything */
.length-popup[v-if],
.statistics-popup[v-if],
div.length-popup,
div.statistics-popup,
.length-popup,
.statistics-popup {
  z-index: 999999 !important;
  position: fixed !important;
}

/* make sure all generic popups use one of these */
.stats-panel,
.cropped-popup {
  z-index: var(--z-modal);
}

/* Angle and trace popups MUST be above cropped popup */
.length-popup,
.statistics-popup {
  z-index: 999999 !important;
}

/* things that should ALWAYS sit above everything */
.length-popup.topmost,
.statistics-popup.topmost,
.stats-panel.topmost {
  z-index: var(--z-modal-top);
}

/* bank should never cover popups */
.bank-panel { z-index: var(--z-bank); }

/* Updated popup styles with new design */
.cropped-popup {
  /* Golden-ratio spacing system */
  --space-1: 8px;
  --space-phi: 13px;   /* 8px * 1.618 */
  --space-2phi: 21px;  /* 13px * 1.618 */

  position: fixed; top: 50%; left: 50%;
  transform: translate(-50%,-50%);
  width: min(1100px, calc(100vw - 48px));
  max-height: calc(100vh - 96px);
  background: hsl(var(--card));
  border: 1px solid hsl(var(--border));
  border-radius: var(--radius-lg, 14px);
  box-shadow: var(--shadow-modal, 0 25px 50px -12px rgba(0, 0, 0, 0.25));
  overflow: hidden;
  z-index: var(--z-modal);
}
.cropped-popup-content { padding: var(--space-2phi) var(--space-phi) var(--space-phi); }

.crop-header {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  gap: var(--space-phi);
  padding: 0 0 var(--space-phi);
}
.left-spacer { min-height: 1px; }

.zoom-cluster {
  display: flex;
  align-items: center;
  justify-content: space-evenly;
  gap: var(--space-phi);
  background: hsl(var(--muted));
  border: 1px solid hsl(var(--border));
  border-radius: 28px;
  padding: var(--space-phi) calc(var(--space-2phi) + 2px);
  box-shadow: 0 2px 8px hsl(var(--primary) / 0.1);
  justify-self: center;
  min-height: 52px;
  min-width: 180px;
  margin-bottom: var(--space-phi);
}

.crop-actions { 
  display: inline-flex; 
  gap: var(--space-1); 
  justify-self: end;
}

.zoom-pill {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 36px;
  width: 36px;
  height: 36px;
  border-radius: 10px;
  border: 2px solid hsl(var(--primary));
  background: hsl(var(--primary));
  color: hsl(var(--primary-foreground));
  font-weight: 700;
  font-size: 18px;
  cursor: pointer;
  transition: all 0.2s ease;
  box-shadow: 0 2px 4px hsl(var(--primary) / 0.2);
  flex-shrink: 10;
}
.zoom-pill:hover:not(:disabled) {
  filter: brightness(0.9);
  transform: translateY(-1px);
  box-shadow: 0 4px 8px hsl(var(--primary) / 0.3);
}
.zoom-pill:active:not(:disabled) {
  transform: translateY(0);
  box-shadow: 0 1px 2px hsl(var(--primary) / 0.3);
}
.zoom-pill:disabled {
  opacity: .45;
  cursor: not-allowed;
  transform: none;
  box-shadow: none;
}
.zoom-pill-reset {
  width: auto;
  min-width: 58px;
  padding: 0 10px;
  font-size: 12px;
}
.zoom-readout {
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  color: hsl(var(--primary));
  font-weight: 600;
  min-width: 60px;
  height: 36px;
  padding: 0 12px;
  background: hsl(var(--card));
  border-radius: 18px;
  margin: 0;
  flex-shrink: 0;
  border: 1px solid hsl(var(--border));
}

/* Mini Toolbar for cropped popup */
.crop-toolbar {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: var(--space-phi, 13px);
  padding: 10px 16px;
  background: hsl(var(--muted));
  border: 1px solid hsl(var(--border));
  border-radius: var(--radius-md, 8px);
  margin-bottom: 12px;
  flex-shrink: 0;
}

.crop-tool {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 10px 14px;
  cursor: pointer;
  border-radius: var(--radius-md, 8px);
  transition: all 0.2s ease;
  color: hsl(var(--muted-foreground));
  min-width: 64px;
}

.crop-tool:hover {
  background: hsl(var(--primary) / 0.1);
  color: hsl(var(--primary));
}

.crop-tool.active {
  background: hsl(var(--primary));
  color: hsl(var(--primary-foreground));
}

.crop-tool i {
  font-size: 18px;
}

.crop-tool span {
  font-size: 11px;
  font-weight: 500;
}

.crop-tool-divider {
  width: 1px;
  height: 32px;
  background: hsl(var(--border));
}

.crop-stage {
  position: relative;
  height: 520px;
  margin-top: var(--space-phi);
  background: hsl(var(--muted));
  border: 1px solid hsl(var(--border));
  border-radius: var(--radius-lg, 12px);
  overflow: hidden;
  user-select: none !important;
  -webkit-user-select: none !important;
  -moz-user-select: none !important;
  -ms-user-select: none !important;
  -webkit-touch-callout: none !important;
  -webkit-tap-highlight-color: transparent !important;
  -webkit-highlight: none !important;
}

.crop-stage *,
.crop-stage *::before,
.crop-stage *::after {
  user-select: none !important;
  -webkit-user-select: none !important;
  -moz-user-select: none !important;
  -ms-user-select: none !important;
  -webkit-touch-callout: none !important;
  -webkit-tap-highlight-color: transparent !important;
  -webkit-highlight: none !important;
}

.crop-stage *::selection,
.crop-stage::selection {
  background: transparent !important;
  color: inherit !important;
}

.crop-stage *::-moz-selection,
.crop-stage::-moz-selection {
  background: transparent !important;
  color: inherit !important;
}

.crop-anchor { 
  position: absolute; 
  will-change: transform; 
  z-index: 100; 
  user-select: none !important;
  -webkit-user-select: none !important;
  -moz-user-select: none !important;
  -ms-user-select: none !important;
  -webkit-touch-callout: none !important;
}
.cropped-image { 
  display: block !important; 
  width: 100% !important; 
  height: 100% !important; 
  object-fit: contain !important; 
  pointer-events: none !important; 
  user-select: none !important;
  -webkit-user-select: none !important;
  -moz-user-select: none !important;
  -ms-user-select: none !important;
  -webkit-touch-callout: none !important;
  -webkit-user-drag: none !important;
  -khtml-user-drag: none !important;
  -moz-user-drag: none !important;
  -o-user-drag: none !important;
  outline: none !important;
  border: none !important;
  -webkit-appearance: none !important;
  -moz-appearance: none !important;
  appearance: none !important;
  -webkit-tap-highlight-color: transparent !important;
  -webkit-highlight: none !important;
  -moz-user-focus: ignore !important;
  position: absolute !important;
  z-index: -10 !important;
  background: transparent !important;
}

.cropped-image::selection {
  background: transparent !important;
  color: inherit !important;
}

.cropped-image::-moz-selection {
  background: transparent !important;
  color: inherit !important;
}

/* Ensure overlay captures all events */
.image-overlay {
  user-select: none !important;
  -webkit-user-select: none !important;
  -moz-user-select: none !important;
  -ms-user-select: none !important;
  -webkit-touch-callout: none !important;
}

.mini-bank {
  margin-top: 10px;
  border-top: 1px dashed #e5e7eb;
  padding-top: 8px;
}

/* keep banks below modals */
.bank-panel, .mini-bank { z-index: var(--z-bank); }

/* Floating Scribe Detection Button */
.floating-scribe-button {
  position: fixed;
  left: 15px;
  top: 50%;
  transform: translateY(-50%);
  width: 60px;
  height: 60px;
  background: linear-gradient(135deg, #1a1a1a 0%, #2c2c2c 50%, #fbbf24 100%);
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  box-shadow: 0 8px 25px rgba(251, 191, 36, 0.3);
  transition: all 0.3s ease;
  z-index: 1000;
  border: 3px solid #fbbf24;
}

.floating-scribe-button:hover {
  transform: translateY(-50%) scale(1.1);
  box-shadow: 0 12px 35px rgba(251, 191, 36, 0.5);
  background: linear-gradient(135deg, #000000 0%, #fbbf24 50%, #1a1a1a 100%);
}

.floating-scribe-button:active {
  transform: translateY(-50%) scale(0.95);
}

.floating-scribe-button .scribe-button-icon {
  width: 36px;
  height: 36px;
  object-fit: contain;
  filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.3));
  transition: all 0.3s ease;
}

.floating-scribe-button:hover .scribe-button-icon {
  filter: drop-shadow(0 2px 6px rgba(251, 191, 36, 0.6)) brightness(1.2);
}

.floating-scribe-button::before {
  content: '';
  position: absolute;
  width: 100%;
  height: 100%;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(251, 191, 36, 0.4) 0%, rgba(0, 0, 0, 0.6) 100%);
  z-index: -1;
  opacity: 0;
  transform: scale(1);
  transition: all 0.3s ease;
}

.floating-scribe-button:hover::before {
  opacity: 1;
  transform: scale(1.3);
}

.annotations-bank--hidden {
  visibility: hidden !important;
  pointer-events: none !important;
}
</style>

<!-- Unscoped: styles for dynamically created OSD overlay elements -->
<style>
.comment-pin-wrapper {
  cursor: pointer;
  pointer-events: auto;
  position: relative;
  width: 32px;
  height: 32px;
}
.comment-pin-icon {
  position: relative;
  width: 32px;
  height: 32px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background:
    radial-gradient(circle at 50% 50%, hsl(var(--background)) 0 31%, transparent 32%),
    hsl(var(--primary));
  border: 2px solid hsl(var(--background));
  color: hsl(var(--primary-foreground));
  box-shadow: 0 8px 18px rgba(0,0,0,0.28), 0 0 0 1px hsl(var(--primary) / 0.35);
  transition: transform 0.15s ease, box-shadow 0.15s ease;
}
.comment-pin-icon:hover {
  transform: scale(1.1);
  box-shadow: 0 10px 22px rgba(0,0,0,0.32), 0 0 0 4px hsl(var(--primary) / 0.18);
}
.comment-pin-icon::after {
  content: "";
  position: absolute;
  left: 50%;
  bottom: -7px;
  width: 2px;
  height: 8px;
  transform: translateX(-50%);
  border-radius: 999px;
  background: hsl(var(--primary));
  box-shadow: 0 0 0 1px hsl(var(--background));
}
.comment-pin-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: hsl(var(--primary));
  box-shadow: 0 0 0 3px hsl(var(--background));
}
.comment-pin-glyph {
  position: absolute;
  top: 0;
  right: 6px;
  color: hsl(var(--primary-foreground));
  font-size: 18px;
  font-weight: 800;
  line-height: 1;
}
.comment-pin-wrapper.annotation-flash .comment-pin-icon {
  outline: 3px solid #facc15;
  outline-offset: 3px;
  animation: comment-annotation-light-pulse 0.55s ease-in-out infinite alternate;
}
@keyframes comment-annotation-light-pulse {
  from { box-shadow: 0 0 4px 2px rgb(250 204 21 / 0.45); }
  to { box-shadow: 0 0 18px 8px rgb(250 204 21 / 0.85); transform: scale(1.12); }
}
.comment-expanded-bubble {
  position: absolute;
  top: 10px;
  left: 42px;
  width: 250px;
  background: hsl(var(--card));
  border: 1px solid hsl(var(--border));
  border-radius: 8px;
  box-shadow: 0 14px 32px rgba(0,0,0,0.22);
  padding: 10px 12px;
  pointer-events: auto;
}
.comment-expanded-leader {
  position: absolute;
  left: -34px;
  top: 15px;
  width: 34px;
  height: 2px;
  background: linear-gradient(90deg, hsl(var(--primary)), hsl(var(--border)));
  pointer-events: none;
}
.comment-expanded-leader::before {
  content: "";
  position: absolute;
  left: -4px;
  top: -3px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: hsl(var(--primary));
}
.comment-expanded-kicker,
.comment-composer-kicker {
  margin-bottom: 6px;
  color: hsl(var(--muted-foreground));
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.02em;
  text-transform: uppercase;
}
.comment-text {
  font-size: 13px;
  color: hsl(var(--foreground));
  line-height: 1.35;
  white-space: pre-wrap;
}
.comment-composer {
  width: 260px;
  position: relative;
  background: hsl(var(--card));
  border: 1px solid hsl(var(--border));
  border-radius: 8px;
  box-shadow: 0 10px 24px rgba(0, 0, 0, 0.18);
  padding: 12px;
  pointer-events: auto;
}
.comment-composer-leader {
  position: absolute;
  left: -24px;
  top: 27px;
  width: 24px;
  height: 2px;
  background: linear-gradient(90deg, hsl(var(--primary)), hsl(var(--border)));
  pointer-events: none;
}
.comment-composer-leader::before {
  content: "";
  position: absolute;
  left: -5px;
  top: -4px;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: hsl(var(--primary));
  box-shadow: 0 0 0 3px hsl(var(--background));
}
.comment-anchor-preview {
  position: relative;
  width: 32px;
  height: 32px;
  pointer-events: none;
}
.comment-anchor-dot {
  position: absolute;
  inset: 10px;
  border-radius: 50%;
  background: hsl(var(--primary));
  box-shadow: 0 0 0 4px hsl(var(--background)), 0 6px 14px rgba(0,0,0,0.28);
}
.comment-anchor-ring {
  position: absolute;
  inset: 1px;
  border-radius: 50%;
  border: 2px solid hsl(var(--primary));
  animation: comment-anchor-pulse 1.15s ease-out infinite;
}
@keyframes comment-anchor-pulse {
  from { opacity: 0.9; transform: scale(0.72); }
  to { opacity: 0; transform: scale(1.35); }
}
.composer-textarea {
  width: 100%;
  min-height: 86px;
  border: 1px solid hsl(var(--border));
  border-radius: 8px;
  padding: 8px 10px;
  font-size: 13px;
  resize: vertical;
  outline: none;
  background: hsl(var(--background));
  color: hsl(var(--foreground));
}
.composer-textarea:focus {
  border-color: hsl(var(--primary));
  box-shadow: 0 0 0 3px hsl(var(--primary) / 0.15);
}
.composer-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 8px;
}
.btn-blue {
  border: 1px solid hsl(var(--primary));
  background: hsl(var(--primary));
  color: hsl(var(--primary-foreground));
  padding: 6px 10px;
  font-size: 13px;
  border-radius: 8px;
  cursor: pointer;
  transition: filter .15s, transform .02s;
}
.btn-blue:hover { filter: brightness(0.95); }
.btn-blue:active { transform: translateY(1px); }
.btn-gray {
  border: 1px solid hsl(var(--border));
  background: hsl(var(--muted));
  color: hsl(var(--foreground));
  padding: 6px 10px;
  font-size: 13px;
  border-radius: 8px;
  cursor: pointer;
  transition: filter .15s, transform .02s;
}
.btn-gray:hover { filter: brightness(0.97); }
.btn-gray:active { transform: translateY(1px); }
</style>
