/**
 * Builds a function-declaration string for Runtime.callFunctionOn that
 * clones a DOM element, inlines all computed styles, strips scripts and
 * event handlers, and returns self-contained outerHTML.
 *
 * The function runs in the browser with `this` bound to the target element.
 */

const MAX_NODES = 200;
const MAX_DEPTH = 8;

export function buildHtmlSnapshotExpression(): string {
  // The function must be a plain function declaration (not arrow) so that
  // Runtime.callFunctionOn can bind `this` to the target DOM element.
  return `function() {
  var MAX_NODES = ${MAX_NODES};
  var MAX_DEPTH = ${MAX_DEPTH};
  var nodeCount = 0;

  var clone = this.cloneNode(true);

  function walk(original, cloned, depth) {
    if (depth > MAX_DEPTH) {
      // Truncate children beyond max depth
      while (cloned.firstChild) cloned.removeChild(cloned.firstChild);
      return;
    }

    if (original.nodeType !== 1) return; // Element nodes only

    nodeCount++;
    if (nodeCount > MAX_NODES) {
      while (cloned.firstChild) cloned.removeChild(cloned.firstChild);
      return;
    }

    // Inline all computed styles onto the clone
    var computed = window.getComputedStyle(original);
    var styleStr = '';
    for (var i = 0; i < computed.length; i++) {
      var prop = computed[i];
      var val = computed.getPropertyValue(prop);
      if (val) {
        styleStr += prop + ':' + val + ';';
      }
    }
    cloned.setAttribute('style', styleStr);

    // Strip class/id — styles are fully inlined, these would conflict
    cloned.removeAttribute('class');
    cloned.removeAttribute('id');

    // Remove on* event handler attributes
    var attrs = cloned.attributes;
    var toRemove = [];
    for (var a = 0; a < attrs.length; a++) {
      if (attrs[a].name.indexOf('on') === 0) {
        toRemove.push(attrs[a].name);
      }
    }
    for (var r = 0; r < toRemove.length; r++) {
      cloned.removeAttribute(toRemove[r]);
    }

    // Walk children in parallel
    var origChildren = original.children;
    var clonedChildren = cloned.children;
    var ci = 0;
    for (var c = 0; c < origChildren.length; c++) {
      // Skip script elements in the clone
      if (clonedChildren[ci] && clonedChildren[ci].tagName === 'SCRIPT') {
        cloned.removeChild(clonedChildren[ci]);
        // Don't increment ci — removing shifts the live collection
        continue;
      }
      if (origChildren[c].tagName === 'SCRIPT') {
        // Original has a script we already removed from clone
        continue;
      }
      if (clonedChildren[ci]) {
        walk(origChildren[c], clonedChildren[ci], depth + 1);
        ci++;
      }
    }

    // Remove any remaining script elements
    var scripts = cloned.querySelectorAll('script');
    for (var s = scripts.length - 1; s >= 0; s--) {
      scripts[s].parentNode.removeChild(scripts[s]);
    }
  }

  walk(this, clone, 0);

  // Convert small images (<32KB) to data URIs
  var images = clone.querySelectorAll('img');
  var promises = [];
  for (var i = 0; i < images.length; i++) {
    (function(img) {
      if (!img.src || img.src.indexOf('data:') === 0) return;
      // Check if image is loaded and small enough
      if (img.naturalWidth > 0 && img.naturalHeight > 0) {
        try {
          var canvas = document.createElement('canvas');
          canvas.width = img.naturalWidth;
          canvas.height = img.naturalHeight;
          canvas.getContext('2d').drawImage(img, 0, 0);
          var dataUrl = canvas.toDataURL('image/png');
          // Rough base64 size check: ~1.37x the raw bytes, data URI prefix is ~22 chars
          if (dataUrl.length < 32 * 1024 * 1.37 + 30) {
            img.setAttribute('src', dataUrl);
          } else {
            img.removeAttribute('src');
          }
        } catch(e) {
          // Cross-origin image — can't read canvas, just remove src
          img.removeAttribute('src');
        }
      } else {
        img.removeAttribute('src');
      }
    })(images[i]);
  }

  return clone.outerHTML;
}`;
}
