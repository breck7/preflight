(function () {
  const STATUS_META = {
    valid: { icon: "✓", label: "Pass" },
    warning: { icon: "?", label: "Review" },
    invalid: { icon: "!", label: "Fix" },
    corrected: { icon: "✓", label: "Corrected" },
    unknown: { icon: "?", label: "Unknown" },
  };

  function boxToPixels(box, imageRect, rotation = 0) {
    const normalized = rotateNormalizedBox(normalizeOverlayBox(box), rotation);
    return {
      x: normalized.x * imageRect.width,
      y: normalized.y * imageRect.height,
      w: normalized.w * imageRect.width,
      h: normalized.h * imageRect.height,
    };
  }

  function rotateNormalizedBox(box, rotation) {
    const quarterTurns = ((Math.round(Number(rotation) || 0) % 4) + 4) % 4;
    if (quarterTurns === 1) {
      return {
        x: 1 - box.y - box.h,
        y: box.x,
        w: box.h,
        h: box.w,
      };
    }
    if (quarterTurns === 2) {
      return {
        x: 1 - box.x - box.w,
        y: 1 - box.y - box.h,
        w: box.w,
        h: box.h,
      };
    }
    if (quarterTurns === 3) {
      return {
        x: box.y,
        y: 1 - box.x - box.w,
        w: box.h,
        h: box.w,
      };
    }
    return box;
  }

  function normalizeOverlayBox(box) {
    const raw = {
      x: Number(box && box.x),
      y: Number(box && box.y),
      w: Number(box && box.w),
      h: Number(box && box.h),
    };
    if (!Object.values(raw).every(Number.isFinite)) {
      return { x: 0, y: 0, w: 0.02, h: 0.02 };
    }
    const max = Math.max(Math.abs(raw.x), Math.abs(raw.y), Math.abs(raw.w), Math.abs(raw.h));
    const scale = max > 1.5 && max <= 100 ? 100 : 1;
    const x = clamp(raw.x / scale, 0, 0.98);
    const y = clamp(raw.y / scale, 0, 0.98);
    return {
      x,
      y,
      w: clamp(raw.w / scale, 0.015, 1 - x),
      h: clamp(raw.h / scale, 0.015, 1 - y),
    };
  }

  function clearElement(element) {
    while (element.firstChild) element.removeChild(element.firstChild);
  }

  function svgEl(name, attrs) {
    const element = document.createElementNS("http://www.w3.org/2000/svg", name);
    Object.entries(attrs).forEach(([key, value]) => element.setAttribute(key, value));
    return element;
  }

  function getStickyNotePoint(field, box, imageRect, placedNotes) {
    const noteWidth = Math.min(field.id === "governmentWarning" ? 290 : 260, Math.max(180, imageRect.width * 0.34));
    const rowCount = field._hasExpected ? 2 : 1;
    const noteHeight = field._selected ? 124 : rowCount === 2 ? 94 : 72;
    const marker = markerRectForBox(box, imageRect);
    const candidates = getAnchoredNoteCandidates(box, marker, noteWidth, noteHeight, imageRect);

    return candidates
      .map((note) => ({
        ...note,
        score: anchoredNoteScore(note, placedNotes, marker, box, imageRect),
      }))
      .sort((a, b) => a.score - b.score)[0];
  }

  function getAnchoredNoteCandidates(box, marker, noteWidth, noteHeight, imageRect) {
    const gap = 8;
    const markerRight = marker.x + marker.width + gap;
    const markerLeft = marker.x - noteWidth - gap;
    const markerTop = marker.y - noteHeight - gap;
    const markerBottom = marker.y + marker.height + gap;
    const markerHigh = marker.y - noteHeight * 0.18;
    const markerMiddle = marker.y + marker.height / 2 - noteHeight / 2;
    const markerLow = marker.y + marker.height - noteHeight * 0.82;
    const centeredOnMarker = marker.x + marker.width / 2 - noteWidth / 2;
    const anchors = [
      [markerRight, markerHigh],
      [markerLeft, markerHigh],
      [markerRight, markerMiddle],
      [markerLeft, markerMiddle],
      [markerRight, markerLow],
      [markerLeft, markerLow],
      [markerRight, markerBottom],
      [markerLeft, markerBottom],
      [markerRight, markerTop],
      [markerLeft, markerTop],
      [centeredOnMarker, markerBottom],
      [centeredOnMarker, markerTop],
      [box.x + box.w + gap, box.y],
      [box.x - noteWidth - gap, box.y],
      [box.x, box.y + box.h + gap],
      [box.x, box.y - noteHeight - gap],
    ];
    const radii = [0, 18, 36, 60, 88, 124, 168];
    const offsets = [
      [0, 0],
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
      [1, 1],
      [-1, 1],
      [1, -1],
      [-1, -1],
    ];
    const notes = [];
    const seen = new Set();
    anchors.forEach(([baseX, baseY]) => {
      radii.forEach((radius) => {
        offsets.forEach(([dx, dy]) => {
          const note = normalizeNote(baseX + dx * radius, baseY + dy * radius, noteWidth, noteHeight, imageRect);
          const key = `${Math.round(note.x)}:${Math.round(note.y)}`;
          if (seen.has(key)) return;
          seen.add(key);
          notes.push(note);
        });
      });
    });
    return notes;
  }

  function renderOverlay(state, elements, callbacks) {
    const { labelImage, overlaySvg, calloutLayer } = elements;
    const imageRect = labelImage.getBoundingClientRect();
    const wrapRect = elements.labelWrap.getBoundingClientRect();
    const width = Math.round(imageRect.width);
    const height = Math.round(imageRect.height);

    overlaySvg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    overlaySvg.setAttribute("width", `${width}`);
    overlaySvg.setAttribute("height", `${height}`);
    overlaySvg.style.left = `${imageRect.left - wrapRect.left}px`;
    overlaySvg.style.top = `${imageRect.top - wrapRect.top}px`;
    clearElement(overlaySvg);
    clearElement(calloutLayer);

    if (!width || !height) return;

    const placedNotes = [];

    state.fields.forEach((field, index) => {
      const selected = state.selectedFieldId === field.id;
      const expected = expectedTextForField(field, state.applicationData);
      const renderField = { ...field, _selected: selected, _hasExpected: Boolean(expected.value) };
      const px = field.box
        ? boxToPixels(field.box, imageRect, state.rotation)
        : fallbackBoxForIndex(index, imageRect);
      const status = field.status || "unknown";
      const note = getStickyNotePoint(renderField, px, imageRect, placedNotes);
      const colorClass = `status-${status}`;
      const number = index + 1;

      if (field.box) {
        const markerRect = markerRectForBox(px, imageRect);
        const marker = svgEl("text", {
          x: markerRect.x,
          y: markerRect.y,
          class: `match-marker ${colorClass}`,
          "text-anchor": "start",
          "dominant-baseline": "hanging",
        });
        marker.textContent = String(number);
        overlaySvg.appendChild(marker);
      }

      const card = document.createElement("button");
      card.type = "button";
      const detectedValue = detectedTextForField(field);
      const showExpectedRow = Boolean(expected.value && expected.kind !== "law");
      const comparison = compareValues(showExpectedRow ? expected.value : "", detectedValue);
      const comparisonClass = showExpectedRow
        ? comparison.matches ? "comparison-match" : "comparison-diff"
        : "comparison-detected-only";
      card.className = `callout ${colorClass} ${comparisonClass} ${selected ? "selected" : ""}`;
      card.style.left = `${imageRect.left - wrapRect.left + note.x}px`;
      card.style.top = `${imageRect.top - wrapRect.top + note.y}px`;
      card.style.width = `${note.width}px`;
      card.dataset.fieldId = field.id;
      card.tabIndex = 0;
      const meta = STATUS_META[status] || STATUS_META.unknown;
      const numberedLabel = `${number}. ${displayFieldLabel(field)}`;
      const expectedHtml = showExpectedRow && comparison.matches
        ? escapeHtml(formatComparisonText(expected.value, field.id, selected))
        : showExpectedRow ? diffHtml(expected.value, detectedValue, "expected", field.id, selected) : "";
      const detectedHtml = comparison.matches || !showExpectedRow
        ? escapeHtml(formatComparisonText(detectedValue, field.id, selected))
        : diffHtml(detectedValue, expected.value, "detected", field.id, selected);
      const expectedRow = showExpectedRow ? `
          <span class="comparison-row submitted-row">
            ${comparisonIcon("user", expected.label)}
            <span class="comparison-text">${expectedHtml}</span>
          </span>
      ` : "";
      card.innerHTML = `
        <span class="callout-body">
          <strong>${escapeHtml(numberedLabel)}${comparison.matches ? '<span class="match-chip" aria-hidden="true">✓</span>' : ""}</strong>
          ${expectedRow}
          <span class="comparison-row detected-row">
            ${comparisonIcon("bot", "Detected by AI")}
            <span class="comparison-text">${detectedHtml}</span>
          </span>
        </span>
      `;
      const expectedLabel = showExpectedRow ? `${expected.label}: ${expected.value}. ` : "";
      card.setAttribute("aria-label", `${numberedLabel}: ${meta.label}. ${expectedLabel}Detected by AI: ${detectedValue || "Not found"}.`);
      makeDraggable(card, () => callbacks.selectField(field.id));
      card.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") callbacks.selectField(field.id);
      });
      calloutLayer.appendChild(card);
      placedNotes.push(note);
    });
  }

  function fallbackBoxForIndex(index, imageRect) {
    return {
      x: imageRect.width * 0.08,
      y: imageRect.height * Math.min(0.9, 0.1 + index * 0.1),
      w: imageRect.width * 0.18,
      h: imageRect.height * 0.05,
    };
  }

  function markerRectForBox(box, imageRect) {
    const markerInset = Math.max(6, Math.min(18, Math.min(box.w, box.h) * 0.12));
    return {
      x: clamp(box.x + markerInset, 4, Math.max(4, imageRect.width - 28)),
      y: clamp(box.y + markerInset, 4, Math.max(4, imageRect.height - 28)),
      width: 30,
      height: 38,
    };
  }

  function makeDraggable(card, onSelect) {
    let drag = null;

    card.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      const rect = card.getBoundingClientRect();
      drag = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        left: parseFloat(card.style.left || "0"),
        top: parseFloat(card.style.top || "0"),
        moved: false,
      };
      card.setPointerCapture(event.pointerId);
    });

    card.addEventListener("pointermove", (event) => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      const dx = event.clientX - drag.startX;
      const dy = event.clientY - drag.startY;
      if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
      if (!drag.moved) return;
      card.classList.add("dragging");
      card.style.left = `${drag.left + dx}px`;
      card.style.top = `${drag.top + dy}px`;
      event.preventDefault();
    });

    card.addEventListener("pointerup", (event) => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      card.releasePointerCapture(event.pointerId);
      card.classList.remove("dragging");
      if (!drag.moved) onSelect();
      drag = null;
    });

    card.addEventListener("pointercancel", () => {
      card.classList.remove("dragging");
      drag = null;
    });
  }

  function normalizeNote(x, y, width, height, imageRect) {
    return {
      x: clamp(x, 8, Math.max(8, imageRect.width - width - 8)),
      y: clamp(y, 8, Math.max(8, imageRect.height - height - 8)),
      width,
      height,
    };
  }

  function anchoredNoteScore(note, placedNotes, marker, box, imageRect) {
    const noteCenterX = note.x + note.width / 2;
    const noteCenterY = note.y + note.height / 2;
    const markerCenterX = marker.x + marker.width / 2;
    const markerCenterY = marker.y + marker.height / 2;
    const centerDistance = Math.hypot(noteCenterX - markerCenterX, noteCenterY - markerCenterY);
    const markerDistance = rectDistance(note, marker);
    const markerAligned =
      rangesOverlap(note.y, note.y + note.height, marker.y, marker.y + marker.height) ||
      rangesOverlap(note.x, note.x + note.width, marker.x, marker.x + marker.width);
    const alignmentPenalty = markerAligned ? 0 : Math.min(90, centerDistance * 0.45);
    const noteOverlap = placedNotes.reduce((sum, placed) => sum + overlapArea(expandRect(note, 7), expandRect(placed, 7)), 0);
    const markerOverlap = overlapArea(note, marker);
    const edgePenalty = edgeDistancePenalty(note, imageRect);
    return noteOverlap * 50 + markerOverlap * 200 + markerDistance * 8 + centerDistance * 0.18 + alignmentPenalty + edgePenalty;
  }

  function rectDistance(a, b) {
    const dx = Math.max(b.x - (a.x + a.width), a.x - (b.x + b.width), 0);
    const dy = Math.max(b.y - (a.y + a.height), a.y - (b.y + b.height), 0);
    return Math.hypot(dx, dy);
  }

  function rangesOverlap(aStart, aEnd, bStart, bEnd) {
    return Math.min(aEnd, bEnd) >= Math.max(aStart, bStart);
  }

  function edgeDistancePenalty(note, imageRect) {
    const margin = 8;
    const left = note.x - margin;
    const top = note.y - margin;
    const right = imageRect.width - margin - note.x - note.width;
    const bottom = imageRect.height - margin - note.y - note.height;
    return [left, top, right, bottom].reduce((sum, value) => sum + (value < 0 ? Math.abs(value) * 100 : 0), 0);
  }

  function expandRect(rect, amount) {
    return {
      x: rect.x - amount,
      y: rect.y - amount,
      width: rect.width + amount * 2,
      height: rect.height + amount * 2,
    };
  }

  function overlapArea(a, b) {
    const x = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
    const y = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
    return x * y;
  }

  function shortValue(value, fieldId) {
    const normalized = String(value || "").replace(/\s+/g, " ").trim();
    if (!normalized) return "Not found";
    if (fieldId === "governmentWarning") {
      return normalized.toLowerCase().includes("government warning") ? "Government Warning" : "Warning text";
    }
    if (normalized.length <= 28) return normalized;
    return `${normalized.slice(0, 25).trim()}...`;
  }

  function expectedTextForField(field, applicationData) {
    if (field.id === "governmentWarning") {
      return {
        value: "GOVERNMENT WARNING:",
        kind: "law",
        label: "Required by law",
      };
    }
    return {
      value: field.applicationValue || field.userValue || (applicationData && applicationData[field.id]) || "",
      kind: "human",
      label: "Submitted by human",
    };
  }

  function detectedTextForField(field) {
    return field.aiValue || "";
  }

  function compareValues(submitted, detected) {
    const left = normalizeComparable(submitted);
    const right = normalizeComparable(detected);
    return {
      matches: Boolean(left && right && left === right),
    };
  }

  function normalizeComparable(value) {
    return String(value || "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase()
      .replace(/[^\w%]+/g, "");
  }

  function formatComparisonText(value, fieldId, expanded) {
    const normalized = String(value || "").replace(/\s+/g, " ").trim();
    if (!normalized) return "Not found";
    if (expanded) return normalized;
    const limit = fieldId === "governmentWarning" ? 42 : 34;
    return normalized.length > limit ? `${normalized.slice(0, limit - 3).trim()}...` : normalized;
  }

  function diffHtml(value, otherValue, side, fieldId, expanded) {
    const normalized = formatComparisonText(value, fieldId, expanded);
    if (normalized === "Not found") return escapeHtml(normalized);
    const otherTokens = new Set(tokenizeComparable(otherValue));
    const pieces = normalized.split(/(\s+)/);
    return pieces.map((piece) => {
      if (!piece.trim()) return escapeHtml(piece);
      const key = comparableToken(piece);
      const different = key && !otherTokens.has(key);
      return different ? `<mark class="diff-${side}">${escapeHtml(piece)}</mark>` : escapeHtml(piece);
    }).join("");
  }

  function tokenizeComparable(value) {
    return String(value || "")
      .split(/\s+/)
      .map(comparableToken)
      .filter(Boolean);
  }

  function comparableToken(value) {
    return String(value || "").toLowerCase().replace(/[^\w%]+/g, "");
  }

  function comparisonIcon(name, label) {
    const paths = {
      user: `
        <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"></path>
        <circle cx="12" cy="7" r="4"></circle>
      `,
      bot: `
        <path d="M12 8V4H8"></path>
        <rect width="16" height="12" x="4" y="8" rx="2"></rect>
        <path d="M2 14h2"></path>
        <path d="M20 14h2"></path>
        <path d="M15 13v2"></path>
        <path d="M9 13v2"></path>
      `,
      gavel: `
        <path d="m14 13-7.5 7.5a2.12 2.12 0 0 1-3-3L11 10"></path>
        <path d="m16 16 6-6"></path>
        <path d="m8 8 6-6"></path>
        <path d="m9 7 8 8"></path>
        <path d="m21 11-8-8"></path>
      `,
    };
    const icon = paths[name] || paths.bot;
    return `
      <span class="comparison-icon" title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}">
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          ${icon}
        </svg>
      </span>
    `;
  }

  function displayFieldLabel(field) {
    const labels = window.DISPLAY_LABELS || {};
    if (labels[field.id]) return labels[field.id];
    return String(field.label || field.id || "Field")
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/[_-]+/g, " ")
      .replace(/\b\w/g, (letter) => letter.toUpperCase());
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  window.boxToPixels = boxToPixels;
  window.renderOverlay = renderOverlay;
})();
