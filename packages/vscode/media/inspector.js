// @ts-check

/** @typedef {import('@ui-ls/shared').InspectorData} InspectorData */
/** @typedef {import('@ui-ls/shared').InlineStyleInfo} InlineStyleInfo */

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

/** @type {InspectorData | null} */
var currentData = null;

window.addEventListener('message', (event) => {
  const message = event.data;
  if (message.type === 'update') {
    render(message.data);
  }
});

/** @param {InspectorData | null} data */
function render(data) {
  currentData = data;

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

  // Computed styles — inline-authored properties first, with interactive editors
  renderStyles(data);

  // Props
  var propEntries = Object.entries(data.props);
  if (propEntries.length > 0) {
    propsSection.hidden = false;
    propsEl.textContent = JSON.stringify(data.props, null, 2);
  } else {
    propsSection.hidden = true;
  }
}

/**
 * Render the computed styles table with interactive editors.
 * @param {InspectorData} data
 */
function renderStyles(data) {
  var styleEntries = Object.entries(data.computedStyles);

  // Build a lookup from kebab name → InlineStyleInfo
  /** @type {Map<string, InlineStyleInfo>} */
  var inlineMap = new Map();
  if (data.inlineStyles) {
    for (var info of data.inlineStyles) {
      inlineMap.set(info.name, info);
    }
  }

  if (styleEntries.length === 0) {
    stylesSection.hidden = true;
    return;
  }

  stylesSection.hidden = false;
  clearChildren(stylesTable);

  // Sort: inline properties first (in source order), then the rest alphabetically
  var inlineEntries = [];
  var otherEntries = [];
  for (var entry of styleEntries) {
    if (inlineMap.has(entry[0])) {
      inlineEntries.push(entry);
    } else {
      otherEntries.push(entry);
    }
  }

  for (var i = 0; i < inlineEntries.length; i++) {
    stylesTable.appendChild(
      renderStyleRow(inlineEntries[i][0], inlineEntries[i][1], inlineMap.get(inlineEntries[i][0]), data)
    );
  }

  if (inlineEntries.length > 0 && otherEntries.length > 0) {
    var separator = document.createElement('tr');
    separator.className = 'style-separator';
    var td = document.createElement('td');
    td.colSpan = 3;
    separator.appendChild(td);
    stylesTable.appendChild(separator);
  }

  for (var j = 0; j < otherEntries.length; j++) {
    stylesTable.appendChild(
      renderStyleRow(otherEntries[j][0], otherEntries[j][1], null, data)
    );
  }
}

/**
 * Render a single style row with interactive editor.
 * @param {string} prop - kebab-case property name
 * @param {string} val - current value
 * @param {InlineStyleInfo | null | undefined} inlineInfo - source info (null = computed only)
 * @param {InspectorData} data
 * @returns {HTMLTableRowElement}
 */
function renderStyleRow(prop, val, inlineInfo, data) {
  var tr = document.createElement('tr');
  tr.className = inlineInfo ? 'inline-style' : '';

  // Property name cell
  var tdProp = document.createElement('td');
  if (inlineInfo) {
    // Clickable link → jump to source
    var link = document.createElement('a');
    link.className = 'prop-link';
    link.textContent = prop;
    link.href = '#';
    link.addEventListener('click', function(e) {
      e.preventDefault();
      vscode.postMessage({
        type: 'jumpToProperty',
        filePath: data.filePath,
        range: inlineInfo.range,
      });
    });
    tdProp.appendChild(link);
  } else {
    tdProp.textContent = prop;
  }
  tr.appendChild(tdProp);

  // Value cell with type-appropriate editor
  var tdVal = document.createElement('td');
  var camelName = inlineInfo ? inlineInfo.camelName : kebabToCamel(prop);
  tdVal.appendChild(createValueEditor(prop, val, camelName));
  tr.appendChild(tdVal);

  // Token badge cell
  var tdToken = document.createElement('td');
  tdToken.className = 'token-cell';
  if (data.tokenMatches && data.tokenMatches[prop]) {
    var badge = document.createElement('span');
    badge.className = 'token-badge';
    badge.textContent = data.tokenMatches[prop];
    tdToken.appendChild(badge);
  }
  tr.appendChild(tdToken);

  return tr;
}

/**
 * Create a type-appropriate value editor.
 * @param {string} prop - kebab-case CSS property name
 * @param {string} val - current value
 * @param {string} camelName - camelCase name for edit messages
 * @returns {HTMLElement}
 */
function createValueEditor(prop, val, camelName) {
  var container = document.createElement('span');
  container.className = 'value-editor';

  if (isColorValue(val)) {
    // Color picker
    var colorInput = document.createElement('input');
    colorInput.type = 'color';
    colorInput.className = 'color-input';
    colorInput.value = normalizeToHex(val);
    var swatch = document.createElement('span');
    swatch.className = 'color-swatch';
    swatch.style.background = val;
    var colorText = document.createElement('span');
    colorText.className = 'color-text';
    colorText.textContent = val;
    colorInput.addEventListener('change', function() {
      sendEdit(camelName, "'" + colorInput.value + "'");
    });
    container.appendChild(colorInput);
    container.appendChild(swatch);
    container.appendChild(colorText);
  } else if (isDimensionValue(val)) {
    // Number input + unit
    var parsed = parseDimension(val);
    var numInput = document.createElement('input');
    numInput.type = 'number';
    numInput.className = 'dimension-input';
    numInput.value = String(parsed.number);
    var unitLabel = document.createElement('span');
    unitLabel.className = 'unit-label';
    unitLabel.textContent = parsed.unit;
    numInput.addEventListener('change', function() {
      var newVal = numInput.value;
      if (parsed.unit) {
        sendEdit(camelName, "'" + newVal + parsed.unit + "'");
      } else {
        sendEdit(camelName, newVal);
      }
    });
    container.appendChild(numInput);
    container.appendChild(unitLabel);
  } else {
    // Generic text input
    var textInput = document.createElement('input');
    textInput.type = 'text';
    textInput.className = 'text-input';
    textInput.value = val;
    var committed = false;
    function commitText() {
      if (committed) return;
      committed = true;
      if (textInput.value !== val) {
        var newVal = textInput.value;
        // Wrap in quotes if it's not a bare number
        if (isNaN(Number(newVal))) {
          sendEdit(camelName, "'" + newVal + "'");
        } else {
          sendEdit(camelName, newVal);
        }
      }
    }
    textInput.addEventListener('blur', commitText);
    textInput.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') {
        committed = false;
        commitText();
      }
    });
    container.appendChild(textInput);
  }

  return container;
}

/**
 * Send an editStyle message to the extension.
 * @param {string} propName - camelCase property name
 * @param {string} value - formatted value for JSX source
 */
function sendEdit(propName, value) {
  vscode.postMessage({
    type: 'editStyle',
    propName: propName,
    value: value,
  });
}

/** @param {string} val */
function isColorValue(val) {
  if (/^#[0-9a-fA-F]{3,8}$/.test(val)) return true;
  if (/^rgb/.test(val)) return true;
  if (/^hsl/.test(val)) return true;
  return false;
}

/** @param {string} val */
function isDimensionValue(val) {
  return /^-?\d+(\.\d+)?(px|%|em|rem|vh|vw)?$/.test(val.trim());
}

/**
 * Parse a dimension value into number + unit.
 * @param {string} val
 * @returns {{ number: number, unit: string }}
 */
function parseDimension(val) {
  var match = val.trim().match(/^(-?\d+(?:\.\d+)?)(px|%|em|rem|vh|vw)?$/);
  if (match) {
    return { number: parseFloat(match[1]), unit: match[2] || '' };
  }
  return { number: parseFloat(val) || 0, unit: '' };
}

/**
 * Normalize a color to hex for the color input.
 * @param {string} val
 * @returns {string}
 */
function normalizeToHex(val) {
  if (/^#[0-9a-fA-F]{6}$/.test(val)) return val;
  if (/^#[0-9a-fA-F]{3}$/.test(val)) {
    return '#' + val[1] + val[1] + val[2] + val[2] + val[3] + val[3];
  }
  // For rgb/hsl, use a temporary element to convert
  var temp = document.createElement('div');
  temp.style.color = val;
  document.body.appendChild(temp);
  var computed = getComputedStyle(temp).color;
  document.body.removeChild(temp);
  var match = computed.match(/\d+/g);
  if (match && match.length >= 3) {
    return '#' + hex2(match[0]) + hex2(match[1]) + hex2(match[2]);
  }
  return '#000000';
}

/** @param {string} n */
function hex2(n) {
  var h = parseInt(n, 10).toString(16);
  return h.length === 1 ? '0' + h : h;
}

/**
 * Convert kebab-case to camelCase.
 * @param {string} str
 * @returns {string}
 */
function kebabToCamel(str) {
  return str.replace(/-([a-z])/g, function(_, c) { return c.toUpperCase(); });
}

/**
 * Renders the Chrome DevTools-style box model diagram using safe DOM methods.
 * @param {{ content: { x: number, y: number, width: number, height: number }, padding: { top: number, right: number, bottom: number, left: number }, border: { top: number, right: number, bottom: number, left: number }, margin: { top: number, right: number, bottom: number, left: number } }} box
 * @returns {HTMLElement}
 */
function renderBoxModel(box) {
  var diagram = el('div', 'box-model-diagram');

  var marginLayer = boxLayer('box-margin', 'margin', box.margin);
  var borderLayer = boxLayer('box-border', 'border', box.border);
  var paddingLayer = boxLayer('box-padding', 'padding', box.padding);

  var contentLayer = el('div', 'box-content');
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
  var layer = el('div', `box-layer ${className}`);

  var label = el('span', 'box-layer-label');
  label.textContent = labelText;
  layer.appendChild(label);

  for (var side of ['top', 'right', 'bottom', 'left']) {
    var span = el('span', `box-layer-value ${side}`);
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
  var node = document.createElement(tag);
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
