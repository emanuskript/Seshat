/**
 * Tour step definitions for the interactive onboarding guide.
 * Each step targets a specific UI element and provides explanation.
 */

export const tourSteps = [
  {
    id: 'welcome',
    title: 'Welcome to Seshat',
    content: 'Seshat helps you analyze and annotate historical manuscripts with powerful tools. Let me show you around the main features.',
    target: null, // Centered, no specific target
    placement: 'center',
    icon: 'book-open',
  },
  {
    id: 'canvas',
    title: 'Manuscript Canvas',
    content: 'Your manuscript image appears here. Use the scroll wheel to zoom in and out, and click-drag to pan around the image.',
    target: '[data-tour="canvas"]',
    placement: 'left',
    icon: 'image',
    tip: 'Double-click anywhere to quickly zoom into that area.',
    spotlightPadding: 0,
  },
  {
    id: 'toolbar',
    title: 'Tools Panel',
    content: 'This toolbar contains all your annotation and measurement tools, organized into groups: Navigate, Annotate, Measure, and Utility.',
    target: '[data-tour="toolbar"]',
    placement: 'right',
    icon: 'wrench',
    spotlightPadding: 4,
    tip: 'Only one drawing or measurement tool is active at a time.',
  },
  {
    id: 'pan-tool',
    title: 'Pan Tool',
    content: 'The Pan tool lets you navigate around the manuscript image. Click and drag to move your view.',
    target: '[data-tour-tool="pan"]',
    placement: 'right',
    icon: 'hand',
    tip: 'Hold Space to temporarily activate pan mode while using other tools.',
  },
  {
    id: 'highlight-tool',
    title: 'Highlight Tool',
    content: 'Use the Highlight tool to mark important text passages. Click and drag to create a colored highlight rectangle.',
    target: '[data-tour-tool="highlight"]',
    placement: 'right',
    icon: 'highlighter',
    tip: 'Press H to quickly activate the highlight tool.',
  },
  {
    id: 'underline-tool',
    title: 'Underline Tool',
    content: 'The Underline tool creates lines beneath text. Click and drag to draw an underline annotation.',
    target: '[data-tour-tool="underline"]',
    placement: 'right',
    icon: 'underline',
    tip: 'Press U to quickly activate the underline tool.',
  },
  {
    id: 'trace-tool',
    title: 'Trace Tool',
    content: 'The Trace tool lets you draw freehand lines to trace letterforms. You can customize the pen nib width, height, and angle.',
    target: '[data-tour-tool="trace"]',
    placement: 'right',
    icon: 'pencil',
    tip: 'Press T to activate. A pen settings popup will appear.',
  },
  {
    id: 'comment-tool',
    title: 'Comment Tool',
    content: 'Add text comments and transcription notes to specific locations on the manuscript.',
    target: '[data-tour-tool="comment"]',
    placement: 'right',
    icon: 'message-square',
    tip: 'Press C to quickly add a comment at your cursor position.',
  },
  {
    id: 'crop-tool',
    title: 'Crop and Annotate',
    content: 'Choose Crop page segment for closer annotation, or Crop & Count to box repeated letterforms and measure their aspect ratio and ink density.',
    target: '[data-tour-tool="crop"]',
    placement: 'right',
    icon: 'scissors',
  },
  {
    id: 'measure-tool',
    title: 'Measure Angle',
    content: 'Measure angles between strokes by clicking three points: the start of the first line, the vertex, and the end of the second line.',
    target: '[data-tour-tool="measure"]',
    placement: 'right',
    icon: 'triangle',
    tip: 'Select an angle to move it with arrow keys, or right-click it to delete it.',
  },
  {
    id: 'distance-tool',
    title: 'Measure Distance',
    content: 'Measure letter height, stroke thickness, or any straight span. Choose or create a label, then click two points to draw a straight line in any direction.',
    target: '[data-tour-tool="distance"]',
    placement: 'right',
    icon: 'ruler-dimension-line',
    tip: 'Use the bottom bar to switch the displayed value between pixels and centimetres.',
  },
  {
    id: 'bands-tools',
    title: 'Measurement Bands',
    content: 'Create horizontal and vertical measurement bands for repeated zones such as ascenders, descenders, margins, and line heights. Click a completed band and drag its corner handles to resize it.',
    target: '[data-tour-tool="horizontal"]',
    placement: 'right',
    icon: 'ruler',
  },
  {
    id: 'right-panel',
    title: 'Annotations Panel',
    content: 'Annotations appear here in the order you add them. Click an item to briefly highlight it on the image, or delete it from the list.',
    target: '[data-tour="right-panel"]',
    placement: 'left',
    icon: 'list',
    spotlightPadding: 4,
  },
  {
    id: 'bottom-bar',
    title: 'Navigation Bar',
    content: 'Adjust zoom, navigate pages, and switch between pixels and centimetres. If IIIF scale data is missing, you can calibrate the page or use an approximation.',
    target: '[data-tour="bottom-bar"]',
    placement: 'top',
    icon: 'navigation',
    spotlightPadding: 0,
  },
  {
    id: 'scribe-detection',
    title: 'PharoSight Scribe Detection',
    content: 'Click this button to access AI-powered scribe detection and handwriting analysis features.',
    target: '[data-tour="scribe-button"]',
    placement: 'left',
    icon: 'sparkles',
    spotlightPadding: 8,
    spotlightRadius: 24,
  },
  {
    id: 'save-export',
    title: 'Save Your Work',
    content: 'Export your annotated manuscript as a PDF with all annotations preserved for sharing or printing.',
    target: '[data-tour="save-button"]',
    placement: 'bottom',
    icon: 'save',
  },
  {
    id: 'complete',
    title: "You're All Set!",
    content: "That covers the basics! Start exploring the tools and annotating your manuscript. You can restart this tour anytime from the help button in the top bar.",
    target: null,
    placement: 'center',
    icon: 'check-circle',
  },
]

/**
 * Get a tour step by its ID
 * @param {string} id - The step ID
 * @returns {Object|undefined} The step object or undefined
 */
export function getStepById(id) {
  return tourSteps.find(step => step.id === id)
}

/**
 * Get the index of a step by its ID
 * @param {string} id - The step ID
 * @returns {number} The step index or -1 if not found
 */
export function getStepIndexById(id) {
  return tourSteps.findIndex(step => step.id === id)
}
