// @ts-check

/** @typedef {import('@ui-ls/shared').InspectorData} InspectorData */

const vscode = acquireVsCodeApi();

const placeholder = document.getElementById('placeholder');
const content = document.getElementById('content');
const componentName = document.getElementById('component-name');
const sourceBadge = document.getElementById('source-badge');
const previewSection = document.getElementById('preview-section');
const previewContainer = document.getElementById('preview-container');
const previewContent = document.getElementById('preview-content');
const screenshotSection = document.getElementById('screenshot-section');
const screenshotImg = document.getElementById('screenshot');

/** @type {ShadowRoot | null} */
var shadowRoot = null;
const boxModelSection = document.getElementById('box-model-section');
const boxModelEl = document.getElementById('box-model');
const stylesSection = document.getElementById('styles-section');
const stylesTable = document.getElementById('styles-table');
const propsSection = document.getElementById('props-section');
const propsEl = document.getElementById('props');

window.addEventListener('message', (event) => {
  const message = event.data;
  if (message.type === 'update') {
    render(message.data);
  }
});

/** @param {InspectorData | null} data */
function render(data) {
  if (!data) {
    placeholder.hidden = false;
    content.hidden = true;
    return;
  }

  placeholder.hidden = true;
  content.hidden = false;

  // Header
  componentName.textContent = `<${data.componentName}>`;
  sourceBadge.textContent = data.source === 'live' ? 'live' : 'estimated';
  sourceBadge.className = data.source === 'live' ? 'badge-live' : 'badge-estimated';

  // Live HTML preview or screenshot fallback
  if (data.renderedHtml) {
    previewSection.hidden = false;
    screenshotSection.hidden = true;
    renderPreview(data.renderedHtml);
  } else if (data.screenshot) {
    previewSection.hidden = true;
    screenshotSection.hidden = false;
    screenshotImg.src = `data:image/png;base64,${data.screenshot}`;
  } else {
    previewSection.hidden = true;
    screenshotSection.hidden = true;
  }

  // Box model
  if (data.boxModel) {
    boxModelSection.hidden = false;
    clearChildren(boxModelEl);
    boxModelEl.appendChild(renderBoxModel(data.boxModel));
  } else {
    boxModelSection.hidden = true;
  }

  // Computed styles
  const styleEntries = Object.entries(data.computedStyles);
  if (styleEntries.length > 0) {
    stylesSection.hidden = false;
    clearChildren(stylesTable);
    for (const [prop, val] of styleEntries) {
      const tr = document.createElement('tr');
      const tdProp = document.createElement('td');
      tdProp.textContent = prop;
      const tdVal = document.createElement('td');
      tdVal.textContent = val;
      tr.appendChild(tdProp);
      tr.appendChild(tdVal);
      stylesTable.appendChild(tr);
    }
  } else {
    stylesSection.hidden = true;
  }

  // Props
  const propEntries = Object.entries(data.props);
  if (propEntries.length > 0) {
    propsSection.hidden = false;
    propsEl.textContent = JSON.stringify(data.props, null, 2);
  } else {
    propsSection.hidden = true;
  }
}

/**
 * Renders the Chrome DevTools-style box model diagram using safe DOM methods.
 * @param {{ content: { x: number, y: number, width: number, height: number }, padding: { top: number, right: number, bottom: number, left: number }, border: { top: number, right: number, bottom: number, left: number }, margin: { top: number, right: number, bottom: number, left: number } }} box
 * @returns {HTMLElement}
 */
function renderBoxModel(box) {
  const diagram = el('div', 'box-model-diagram');

  const marginLayer = boxLayer('box-margin', 'margin', box.margin);
  const borderLayer = boxLayer('box-border', 'border', box.border);
  const paddingLayer = boxLayer('box-padding', 'padding', box.padding);

  const contentLayer = el('div', 'box-content');
  contentLayer.textContent = `${Math.round(box.content.width)} \u00D7 ${Math.round(box.content.height)}`;

  paddingLayer.appendChild(contentLayer);
  borderLayer.appendChild(paddingLayer);
  marginLayer.appendChild(borderLayer);
  diagram.appendChild(marginLayer);

  return diagram;
}

/**
 * Creates a box model layer with label and directional values.
 * @param {string} className
 * @param {string} labelText
 * @param {{ top: number, right: number, bottom: number, left: number }} dir
 * @returns {HTMLElement}
 */
function boxLayer(className, labelText, dir) {
  const layer = el('div', `box-layer ${className}`);

  const label = el('span', 'box-layer-label');
  label.textContent = labelText;
  layer.appendChild(label);

  for (const side of ['top', 'right', 'bottom', 'left']) {
    const span = el('span', `box-layer-value ${side}`);
    span.textContent = String(Math.round(dir[side]));
    layer.appendChild(span);
  }

  return layer;
}

/**
 * Helper to create an element with a className.
 * @param {string} tag
 * @param {string} className
 * @returns {HTMLElement}
 */
function el(tag, className) {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}

/** @param {HTMLElement} node */
function clearChildren(node) {
  while (node.firstChild) {
    node.removeChild(node.firstChild);
  }
}

/**
 * Renders self-contained HTML into a shadow DOM container, scaled to fit.
 * Uses DOMParser instead of innerHTML for defense-in-depth (the HTML is
 * already sanitized server-side: scripts stripped, event handlers removed).
 * @param {string} html
 */
function renderPreview(html) {
  // Attach shadow root once, reuse on subsequent updates
  if (!shadowRoot) {
    shadowRoot = previewContent.attachShadow({ mode: 'open' });
  }

  // Clear previous content
  while (shadowRoot.firstChild) {
    shadowRoot.removeChild(shadowRoot.firstChild);
  }

  // Reset styles to isolate from VS Code theme
  var resetStyle = document.createElement('style');
  resetStyle.textContent =
    ':host { all: initial; display: block; } * { pointer-events: none !important; }';
  shadowRoot.appendChild(resetStyle);

  // Parse rendered HTML safely via DOMParser (won't execute scripts)
  var parser = new DOMParser();
  var doc = parser.parseFromString(html, 'text/html');
  var parsed = doc.body.firstElementChild;
  if (!parsed) return;

  // Adopt the node into the current document and append to shadow root
  var adopted = document.adoptNode(parsed);
  shadowRoot.appendChild(adopted);

  // Scale to fit the sidebar width
  requestAnimationFrame(function() {
    var containerWidth = previewContainer.clientWidth;
    var naturalWidth = adopted.scrollWidth;
    if (naturalWidth > 0 && containerWidth > 0) {
      var scale = Math.min(1, containerWidth / naturalWidth);
      previewContent.style.transform = 'scale(' + scale + ')';
      previewContent.style.width = naturalWidth + 'px';
      previewContainer.style.height = Math.ceil(adopted.scrollHeight * scale) + 'px';
    } else {
      previewContent.style.transform = '';
      previewContent.style.width = '';
      previewContainer.style.height = '';
    }
  });
}
