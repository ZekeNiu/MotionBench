"use strict";
const assert = require("node:assert/strict");

// Runs in the browser immediately before html2canvas captures a prepared page.
function capturePDFBounds(page) {
  const content = page.querySelector(".ringside-pdf-content") || page;
  const tolerance = 2;
  const inside = (inner, outer) => inner.left >= outer.left - tolerance &&
    inner.right <= outer.right + tolerance && inner.top >= outer.top - tolerance &&
    inner.bottom <= outer.bottom + tolerance;
  const images = [...page.querySelectorAll("img[data-pdf-chart-index]")].map(image => {
    const bounds = image.getBoundingClientRect(), clippingAncestors = [];
    for (let parent = image.parentElement; parent && parent !== content; parent = parent.parentElement) {
      const style = getComputedStyle(parent), parentBounds = parent.getBoundingClientRect();
      if ((/hidden|clip|auto|scroll/.test(style.overflowX) &&
           (bounds.left < parentBounds.left - tolerance || bounds.right > parentBounds.right + tolerance)) ||
          (/hidden|clip|auto|scroll/.test(style.overflowY) &&
           (bounds.top < parentBounds.top - tolerance || bounds.bottom > parentBounds.bottom + tolerance))) {
        clippingAncestors.push(parent.className || parent.id || parent.tagName);
      }
    }
    return { index: image.dataset.pdfChartIndex, width: bounds.width, height: bounds.height,
      loaded: image.complete && image.naturalWidth > 0, insideContent: inside(bounds, content.getBoundingClientRect()),
      clippingAncestors };
  });
  const facets = [...page.querySelectorAll(".comparison-body-facets")].map(container => {
    const bounds = container.getBoundingClientRect();
    return { width: container.clientWidth, scrollWidth: container.scrollWidth,
      dates: [...container.querySelectorAll("figcaption")].map(caption => caption.textContent.trim()),
      contained: [...container.querySelectorAll("figure,figcaption")].every(figure =>
        inside(figure.getBoundingClientRect(), bounds) && inside(figure.getBoundingClientRect(), content.getBoundingClientRect())) };
  });
  return { images, facets };
}

function assertPDFBounds(pages) {
  assert.ok(pages.some(page => page.bounds?.images.length), "PDF records actual rendered chart image bounds");
  pages.forEach((page, index) => {
    assert.ok(page.bounds, "PDF page " + (index + 1) + " includes physical chart bounds");
    for (const image of page.bounds.images) {
      assert.ok(image.loaded && image.width > 0 && image.height > 0, "PDF chart " + image.index + " loaded at a visible size");
      assert.ok(image.insideContent, "PDF page " + (index + 1) + " chart " + image.index + " fits the page content");
      assert.deepEqual(image.clippingAncestors, [], "PDF page " + (index + 1) + " chart " + image.index + " has no clipping ancestor");
    }
    for (const facet of page.bounds.facets) {
      assert.ok(facet.scrollWidth <= facet.width + 2, "PDF body diagrams do not require horizontal scrolling");
      assert.ok(facet.contained, "Every selected-date body diagram and caption fits the exported page");
    }
  });
}

module.exports = { capturePDFBounds, assertPDFBounds };
