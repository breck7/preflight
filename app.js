(function () {
  const DEFAULT_APPLICATION_DATA = {
    brandName: "",
    classType: "",
    alcoholContent: "",
    netContents: "",
    bottlerProducer: "",
    productOrigin: "",
    governmentWarning: "GOVERNMENT WARNING:",
  };
  const ZOOM_CLASSES = ["zoom-fit", "zoom-inspect", "zoom-close"];

  const state = {
    mode: "applicant",
    image: {
      fileName: "",
      objectUrl: "",
      base64: "",
      naturalWidth: 0,
      naturalHeight: 0,
    },
    applicationData: { ...DEFAULT_APPLICATION_DATA },
    fields: [],
    engine: window.DEFAULT_AI_ENGINE,
    selectedFieldId: null,
    status: "idle",
    error: null,
    submission: null,
    rotation: 0,
    zoomLevel: 0,
  };

  let submissionQueue = [];
  let activeSubmissionId = null;
  let latestAnalysisRequest = 0;
  let activeStitchedUrl = "";
  let activeRotatedUrl = "";
  let userSelectedEngine = engineSpecifiedInUrl();

  const elements = {
    dropzone: document.getElementById("dropzone"),
    fileInput: document.getElementById("fileInput"),
    uploadButton: document.getElementById("uploadButton"),
    thumbStrip: document.getElementById("thumbStrip"),
    labelWrap: document.getElementById("labelWrap"),
    labelImage: document.getElementById("labelImage"),
    overlaySvg: document.getElementById("overlaySvg"),
    calloutLayer: document.getElementById("calloutLayer"),
    summaryText: document.getElementById("summaryText"),
    statusText: document.getElementById("statusText"),
    engineSelect: document.getElementById("engineSelect"),
    metadataPanel: document.getElementById("metadataPanel"),
    metadataText: document.getElementById("metadataText"),
    shortcutFab: document.getElementById("shortcutFab"),
    shortcutModal: document.getElementById("shortcutModal"),
    shortcutClose: document.getElementById("shortcutClose"),
  };

  const overlayCallbacks = {
    selectField(fieldId) {
      const field = state.fields.find((item) => item.id === fieldId);
      if (!field) return;
      state.selectedFieldId = state.selectedFieldId === fieldId ? null : fieldId;
      render();
    },
  };

  function init() {
    bindEvents();
    state.rotation = rotationFromUrl();
    applyZoomLevel();
    populateEngineSelect();
    elements.labelImage.addEventListener("load", () => {
      state.image.naturalWidth = elements.labelImage.naturalWidth;
      state.image.naturalHeight = elements.labelImage.naturalHeight;
      render();
    });
    loadSubmissionManifests().then(loadInitialSubmission);
  }

  function bindEvents() {
    elements.uploadButton.addEventListener("click", () => elements.fileInput.click());
    elements.fileInput.addEventListener("change", (event) => {
      const files = Array.from(event.target.files || []);
      if (files.length) useFiles(files);
      elements.fileInput.value = "";
    });

    ["dragenter", "dragover"].forEach((name) => {
      elements.dropzone.addEventListener(name, (event) => {
        event.preventDefault();
        elements.dropzone.classList.add("dragging");
      });
    });

    ["dragleave", "drop"].forEach((name) => {
      elements.dropzone.addEventListener(name, (event) => {
        event.preventDefault();
        elements.dropzone.classList.remove("dragging");
      });
    });

    elements.dropzone.addEventListener("drop", (event) => {
      const files = Array.from(event.dataTransfer.files || []);
      if (files.length) useFiles(files);
    });

    elements.thumbStrip.addEventListener("click", (event) => {
      const button = event.target.closest("[data-submission-id]");
      if (!button) return;
      const submission = submissionQueue.find((entry) => entry.submissionId === button.dataset.submissionId);
      if (submission) useSubmission(submission, { announce: true, updateUrl: submission.type !== "upload" });
    });

    elements.engineSelect.addEventListener("change", () => {
      state.engine = elements.engineSelect.value;
      userSelectedEngine = true;
      state.selectedFieldId = null;
      runAnalysis();
    });

    elements.shortcutFab.addEventListener("click", toggleShortcuts);
    elements.shortcutClose.addEventListener("click", hideShortcuts);
    elements.shortcutModal.addEventListener("click", (event) => {
      const button = event.target.closest("[data-shortcut-action]");
      if (button) {
        runShortcutAction(button.dataset.shortcutAction);
        return;
      }
      if (event.target === elements.shortcutModal) hideShortcuts();
    });

    document.addEventListener("keydown", (event) => {
      if (shouldIgnoreShortcut(event)) return;

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        runShortcutAction("signingKey");
        return;
      }

      if (event.key === "?") {
        event.preventDefault();
        toggleShortcuts();
        return;
      }

      const shortcutsOpen = !elements.shortcutModal.classList.contains("hidden");
      if (event.key === "Escape" && shortcutsOpen) {
        event.preventDefault();
        hideShortcuts();
        return;
      }

      if (shortcutsOpen) return;

      if (event.key === "ArrowLeft") {
        event.preventDefault();
        runShortcutAction("previous");
        return;
      }

      if (event.key === "ArrowRight") {
        event.preventDefault();
        runShortcutAction("next");
        return;
      }

      if (event.key.toLowerCase() === "r") {
        event.preventDefault();
        runShortcutAction("rotate");
        return;
      }

      if (event.key.toLowerCase() === "z") {
        event.preventDefault();
        runShortcutAction("zoom");
        return;
      }

      if (event.key === "1") {
        event.preventDefault();
        runShortcutAction("approve");
        return;
      }

      if (event.key === "2") {
        event.preventDefault();
        runShortcutAction("needsCorrection");
        return;
      }

      if (event.key === "3") {
        event.preventDefault();
        runShortcutAction("reject");
        return;
      }

      if (event.key === "Escape" && state.selectedFieldId) {
        state.selectedFieldId = null;
        render();
      }
    });

    window.addEventListener("resize", render);

    const resizeObserver = new ResizeObserver(render);
    resizeObserver.observe(elements.labelWrap);
  }

  async function loadSubmissionManifests() {
    submissionQueue = await loadPublicSampleSubmissions();
    renderSubmissionQueue();
  }

  async function loadPublicSampleSubmissions() {
    try {
      const response = await fetch("test-images/ttb-public-sample/index.json");
      if (!response.ok) throw new Error("TTB sample manifest unavailable.");
      const manifest = await response.json();
      return manifest.submissions.map((item) => ({
        submissionId: `ttb:${item.ttbId}`,
        type: "ttb",
        id: item.ttbId,
        title: item.brandName || `TTB ${item.ttbId}`,
        subtitle: `${item.imageCount} label${item.imageCount === 1 ? "" : "s"} · ${item.classType || "Public COLA"}`,
        metadata: {
          source: manifest.source,
          ttbId: item.ttbId,
          completedDate: item.completedDate,
          brandName: item.brandName,
          fancifulName: item.fancifulName,
          classType: item.classType,
          imageCount: item.imageCount,
        },
        images: item.images.map((image, index) => ({
          id: `${item.ttbId}:${index + 1}`,
          title: labelTitleFromFilename(image, index),
          fileName: image,
          path: `test-images/ttb-public-sample/${item.folder}/${image}`,
          thumbPath: index === 0 ? `test-images/ttb-public-sample/thumbs/${item.folder}.jpg` : null,
        })),
        applicationData: {
          ...DEFAULT_APPLICATION_DATA,
          brandName: item.brandName || "",
          classType: item.classType || "",
        },
      }));
    } catch (error) {
      console.warn("Public TTB sample unavailable.", error);
      return [];
    }
  }

  async function loadInitialSubmission() {
    const requested = submissionFromUrl();
    if (requested) {
      await useSubmission(requested, { announce: false, updateUrl: false });
      return;
    }
    clearSubmissionUrl();

    if (submissionQueue.length) {
      await useSubmission(submissionQueue[0], { announce: false, updateUrl: false });
      return;
    }

    state.status = "idle";
    render();
  }

  function submissionFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const submissionId = params.get("submission");
    if (submissionId) {
      return submissionQueue.find((submission) => submission.submissionId === submissionId) || null;
    }
    return null;
  }

  function useFiles(files) {
    const imageFiles = files.filter((file) => file.type && file.type.startsWith("image/"));
    if (!imageFiles.length) {
      state.status = "error";
      state.error = "Please choose image files for the label submission.";
      render();
      return;
    }

    const submissionId = `upload:${Date.now()}:${Math.random().toString(36).slice(2)}`;
    const uploadSubmission = {
      submissionId,
      type: "upload",
      id: submissionId,
      title: `${imageFiles.length} uploaded label${imageFiles.length === 1 ? "" : "s"}`,
      subtitle: "User upload",
      metadata: {
        source: "User upload",
        uploadedAt: new Date().toISOString(),
        imageCount: imageFiles.length,
        fileNames: imageFiles.map((file) => file.name),
      },
      images: imageFiles.map((file, index) => ({
        id: `${submissionId}:${index + 1}`,
        title: file.name,
        fileName: file.name,
        file,
        path: URL.createObjectURL(file),
      })),
      applicationData: { ...DEFAULT_APPLICATION_DATA },
    };

    submissionQueue = [uploadSubmission, ...submissionQueue];
    renderSubmissionQueue();
    clearSubmissionUrl();
    useSubmission(uploadSubmission, { announce: true, updateUrl: false });
  }

  async function useSubmission(submission, options = {}) {
    const requestId = ++latestAnalysisRequest;
    activeSubmissionId = submission.submissionId;
    if (!userSelectedEngine) state.engine = "local";
    state.status = "loading";
    state.error = null;
    state.fields = [];
    state.selectedFieldId = null;
    state.submission = submission;
    state.applicationData = { ...DEFAULT_APPLICATION_DATA, ...(submission.applicationData || {}) };
    renderSubmissionQueue();
    scrollActiveSubmissionIntoView();
    renderMetadata();
    render();

    try {
      const cachedAnalysisPromise = getInitialCachedAnalysis(submission);
      const stitched = await stitchSubmissionImages(submission);
      if (requestId !== latestAnalysisRequest) return;
      if (activeStitchedUrl) URL.revokeObjectURL(activeStitchedUrl);
      activeStitchedUrl = stitched.objectUrl;
      state.image.fileName = stitched.fileName;
      state.image.objectUrl = stitched.objectUrl;
      state.image.base64 = stitched.base64;
      state.image.naturalWidth = stitched.width;
      state.image.naturalHeight = stitched.height;
      await updateDisplayedImageForRotation();
      if (requestId !== latestAnalysisRequest) return;
      if (options.updateUrl) updateSubmissionUrl(submission);
      if (options.updateUrl === false && submission.type === "upload") clearSubmissionUrl();
      const cachedAnalysis = await cachedAnalysisPromise;
      if (requestId !== latestAnalysisRequest) return;
      if (cachedAnalysis) {
        state.engine = "openai:gpt-5.5";
        state.fields = cachedAnalysis.fields;
        state.status = "ready";
        state.error = null;
        state.selectedFieldId = null;
        render();
        logScroll("cached GPT analysis loaded");
      } else {
        runAnalysis();
      }
    } catch (error) {
      if (requestId !== latestAnalysisRequest) return;
      state.status = "error";
      state.error = "Could not load that submission.";
      render();
    }
  }

  function getInitialCachedAnalysis(submission) {
    if (userSelectedEngine || state.engine !== "local" || !submission || submission.type === "upload") {
      return Promise.resolve(null);
    }
    return window.getCachedLabelAnalysis(
      null,
      state.mode,
      state.applicationData,
      "openai:gpt-5.5",
      { submissionId: submission.submissionId },
    ).catch(() => null);
  }

  async function stitchSubmissionImages(submission) {
    const loaded = await Promise.all(submission.images.map(loadImageForCanvas));
    const maxSourceWidth = Math.max(...loaded.map((image) => image.width));
    const columnCount = loaded.length === 1 ? 1 : 2;
    const canvasWidth = loaded.length === 1 ? Math.min(1400, Math.max(620, maxSourceWidth)) : 1400;
    const gutter = loaded.length === 1 ? 0 : 18;
    const columnWidth = Math.floor((canvasWidth - gutter * (columnCount + 1)) / columnCount);
    const columnHeights = Array(columnCount).fill(gutter);
    const placements = loaded.map((image) => {
      const column = columnHeights.indexOf(Math.min(...columnHeights));
      const maxWidth = columnCount === 1 ? canvasWidth : columnWidth;
      const scale = Math.min(1, maxWidth / image.width);
      const width = Math.round(image.width * scale);
      const height = Math.round(image.height * scale);
      const x = columnCount === 1 ? Math.round((canvasWidth - width) / 2) : gutter + column * (columnWidth + gutter) + Math.round((columnWidth - width) / 2);
      const y = columnCount === 1 ? 0 : columnHeights[column];
      columnHeights[column] += height + gutter;
      return { image, x, y, width, height };
    });

    const canvasHeight = columnCount === 1
      ? placements[0].height
      : Math.max(...columnHeights) - gutter + gutter;
    const canvas = document.createElement("canvas");
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;
    const context = canvas.getContext("2d", { alpha: false });
    context.fillStyle = "#f7f5ef";
    context.fillRect(0, 0, canvasWidth, canvasHeight);

    placements.forEach((placement) => {
      context.drawImage(placement.image.element, placement.x, placement.y, placement.width, placement.height);
    });

    const blob = await canvasToBlob(canvas, "image/jpeg", 0.82);
    return {
      fileName: `${submission.id || "submission"}-stitched.jpg`,
      objectUrl: URL.createObjectURL(blob),
      base64: await blobToDataUrl(blob),
      width: canvas.width,
      height: canvas.height,
    };
  }

  function loadImageForCanvas(item) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve({
        element: image,
        width: image.naturalWidth || image.width,
        height: image.naturalHeight || image.height,
      });
      image.onerror = () => reject(new Error(`Could not load ${item.fileName || item.path}.`));
      image.src = item.path;
    });
  }

  function canvasToBlob(canvas, type, quality) {
    return new Promise((resolve) => {
      canvas.toBlob((blob) => resolve(blob), type, quality);
    });
  }

  async function runAnalysis() {
    if (!state.image.base64) {
      if (state.status !== "loading") {
        state.status = "error";
        state.error = "Upload or choose a submission to start analysis.";
        render();
      }
      return;
    }

    const requestId = ++latestAnalysisRequest;
    state.status = "analyzing";
    state.error = null;
    renderStatus();

    try {
      if (!userSelectedEngine && state.engine === "local" && state.submission && state.submission.type === "upload") {
        const cached = await window.getCachedLabelAnalysis(
          state.image.base64,
          state.mode,
          state.applicationData,
          "openai:gpt-5.5",
          { submissionId: state.submission && state.submission.submissionId },
        );
        if (requestId !== latestAnalysisRequest) return;
        if (cached) {
          state.engine = "openai:gpt-5.5";
          state.fields = cached.fields;
          state.status = "ready";
          state.error = null;
          state.selectedFieldId = null;
          render();
          logScroll("cached GPT analysis loaded");
          return;
        }
      }

      const result = await window.analyzeLabel(
        state.image.base64,
        state.mode,
        state.applicationData,
        state.engine,
        { submissionId: state.submission && state.submission.submissionId },
      );
      if (requestId !== latestAnalysisRequest) return;
      state.fields = result.fields;
      state.status = "ready";
      state.error = null;
      state.selectedFieldId = null;
      render();
      logScroll("analysis complete");
    } catch (error) {
      if (requestId !== latestAnalysisRequest) return;
      state.status = "error";
      state.error = analysisErrorMessage(error);
      render();
    }
  }

  function render() {
    renderStatus();
    window.renderOverlay(state, elements, overlayCallbacks);
  }

  function renderStatus() {
    const summary = summarizeFields();
    const checkCount = window.FIELD_IDS ? window.FIELD_IDS.length : Math.max(state.fields.length, 0);
    const reviewCount = summary.warning + summary.invalid + summary.unknown;
    const statusLabel = {
      idle: "Ready",
      loading: "Loading submission",
      analyzing: "Analyzing submission",
      ready: "Analysis ready",
      error: "Analysis error",
    }[state.status];

    const engineLabel = window.getAIEngineLabel(state.engine);
    elements.statusText.textContent = state.status === "analyzing" ? "Analyzing with" : `${statusLabel} ·`;
    elements.summaryText.classList.toggle("shimmer-text", state.status === "analyzing");
    elements.engineSelect.value = state.engine;
    elements.engineSelect.disabled = state.status === "analyzing";
    elements.engineSelect.title = engineLabel;
    if (state.status === "error" && state.error) {
      elements.summaryText.textContent = state.error;
    } else if (state.status === "analyzing") {
      elements.summaryText.textContent = `Running ${checkCount} checks`;
    } else if (state.fields.length) {
      elements.summaryText.textContent = `Pass ${summary.valid} · Review ${reviewCount}`;
    } else if (state.submission) {
      const count = state.submission.images.length;
      elements.summaryText.textContent = `${count} label${count === 1 ? "" : "s"} ready for preflight.`;
    } else {
      elements.summaryText.textContent = "Ready for preflight.";
    }
  }

  function renderSubmissionQueue() {
    elements.thumbStrip.innerHTML = submissionQueue.map((submission, index) => {
      const firstImage = submission.images[0] || {};
      const count = submission.images.length;
      const title = `${submission.title} (${count} label${count === 1 ? "" : "s"})`;
      return `
        <button class="queue-thumb ${submission.submissionId === activeSubmissionId ? "active" : ""} ${count > 1 ? "multi" : ""}" type="button" data-submission-id="${escapeHtml(submission.submissionId)}" title="${escapeHtml(title)}" aria-label="${escapeHtml(title)}">
          <img src="${escapeHtml(firstImage.thumbPath || firstImage.path || "")}" alt="" loading="lazy" decoding="async" />
          <span>${index + 1}</span>
        </button>
      `;
    }).join("");
  }

  function selectRelativeSubmission(direction) {
    if (!submissionQueue.length) return;
    const currentIndex = Math.max(0, submissionQueue.findIndex((submission) => submission.submissionId === activeSubmissionId));
    const nextIndex = (currentIndex + direction + submissionQueue.length) % submissionQueue.length;
    const nextSubmission = submissionQueue[nextIndex];
    useSubmission(nextSubmission, { announce: true, updateUrl: nextSubmission.type !== "upload" });
  }

  function scrollActiveSubmissionIntoView() {
    const active = elements.thumbStrip.querySelector(".queue-thumb.active");
    if (!active) return;
    active.scrollIntoView({ block: "nearest", inline: "center" });
  }

  function showShortcuts() {
    elements.shortcutModal.classList.remove("hidden");
    elements.shortcutClose.focus();
  }

  function hideShortcuts() {
    elements.shortcutModal.classList.add("hidden");
  }

  function toggleShortcuts() {
    if (elements.shortcutModal.classList.contains("hidden")) {
      showShortcuts();
    } else {
      hideShortcuts();
      elements.shortcutFab.focus();
    }
  }

  function runShortcutAction(action) {
    if (action === "help") {
      toggleShortcuts();
      return;
    }
    if (action === "previous") {
      hideShortcuts();
      selectRelativeSubmission(-1);
      return;
    }
    if (action === "next") {
      hideShortcuts();
      selectRelativeSubmission(1);
      return;
    }
    if (action === "rotate") {
      rotateRight();
      return;
    }
    if (action === "zoom") {
      toggleZoom();
      return;
    }
    if (action === "approve") {
      promptReviewerAction("Approved", "Optional approval note");
      return;
    }
    if (action === "needsCorrection") {
      promptReviewerAction("Needs Correction", "Correction reason");
      return;
    }
    if (action === "reject") {
      promptReviewerAction("Rejected", "Rejection reason");
      return;
    }
    if (action === "signingKey") {
      promptSigningKey();
      return;
    }
    if (action === "escape") {
      if (!elements.shortcutModal.classList.contains("hidden")) {
        hideShortcuts();
        return;
      }
      if (state.selectedFieldId) {
        state.selectedFieldId = null;
        render();
      }
    }
  }

  function shouldIgnoreShortcut(event) {
    const target = event.target;
    if (!target) return false;
    const tag = target.tagName;
    return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(tag);
  }

  function promptReviewerAction(status, promptLabel) {
    hideShortcuts();
    const note = window.prompt(`${status}\n\n${promptLabel}:`, "");
    if (note === null) return;
    console.log(`Prototype reviewer command: ${status}${note ? `\n${note}` : ""}`);
  }

  function promptSigningKey() {
    hideShortcuts();
    const key = window.prompt("Signing Key\n\nPaste or enter signing key:", "");
    if (key === null) return;
    console.log(`Prototype signing key entered (${key.length} characters).`);
  }

  function renderMetadata() {
    if (!elements.metadataText) return;
    elements.metadataText.value = state.submission ? submissionToScroll(state.submission) : "";
  }

  function submissionToScroll(submission) {
    const lines = [
      "https://prototype.ttb.gov/colaSubmission.scroll",
      "",
      "submission",
      ` id ${safeLine(submission.id)}`,
      ` title ${safeLine(submission.title)}`,
      ` source ${safeLine(submission.metadata && submission.metadata.source)}`,
    ];
    Object.entries(submission.metadata || {}).forEach(([key, value]) => {
      if (["id", "title", "source"].includes(key)) return;
      if (Array.isArray(value)) {
        lines.push(` ${key}`);
        value.forEach((entry) => lines.push(`  item ${safeLine(entry)}`));
      } else if (value !== undefined && value !== null && value !== "") {
        lines.push(` ${key} ${safeLine(value)}`);
      }
    });
    lines.push(" labels");
    submission.images.forEach((image, index) => {
      lines.push(`  label ${index + 1}`);
      lines.push(`   name ${safeLine(image.fileName)}`);
      lines.push(`   title ${safeLine(image.title)}`);
      lines.push(`   path ${safeLine(image.path)}`);
      if (image.thumbPath) lines.push(`   thumbPath ${safeLine(image.thumbPath)}`);
    });
    return lines.join("\n");
  }

  function populateEngineSelect() {
    elements.engineSelect.innerHTML = window.AI_ENGINES.map((engine) => (
      `<option value="${engine.id}">${engine.label}</option>`
    )).join("");
    elements.engineSelect.value = state.engine;
  }

  function summarizeFields() {
    return state.fields.reduce(
      (summary, field) => {
        summary[field.status] = (summary[field.status] || 0) + 1;
        return summary;
      },
      { valid: 0, warning: 0, invalid: 0, corrected: 0, unknown: 0 },
    );
  }

  function updateSubmissionUrl(submission) {
    const url = new URL(window.location.href);
    url.searchParams.set("submission", submission.submissionId);
    url.searchParams.delete("demo");
    writeRotationToUrl(url);
    window.history.replaceState(null, "", url);
  }

  function clearSubmissionUrl() {
    const url = new URL(window.location.href);
    if (!url.searchParams.has("submission") && !url.searchParams.has("demo")) {
      writeRotationToUrl(url);
      window.history.replaceState(null, "", url);
      return;
    }
    url.searchParams.delete("submission");
    url.searchParams.delete("demo");
    writeRotationToUrl(url);
    window.history.replaceState(null, "", url);
  }

  async function rotateRight() {
    state.rotation = (state.rotation + 1) % 4;
    updateRotationUrl();
    await updateDisplayedImageForRotation();
    render();
  }

  function toggleZoom() {
    state.zoomLevel = (state.zoomLevel + 1) % ZOOM_CLASSES.length;
    applyZoomLevel();
    render();
  }

  function applyZoomLevel() {
    ZOOM_CLASSES.forEach((className) => elements.labelWrap.classList.toggle(className, className === ZOOM_CLASSES[state.zoomLevel]));
  }

  async function updateDisplayedImageForRotation() {
    if (!state.image.objectUrl) return;
    if (activeRotatedUrl) {
      URL.revokeObjectURL(activeRotatedUrl);
      activeRotatedUrl = "";
    }
    if (!state.rotation) {
      elements.labelImage.src = state.image.objectUrl;
      return;
    }
    const rotated = await rotateImageUrl(state.image.objectUrl, state.rotation);
    activeRotatedUrl = rotated.objectUrl;
    elements.labelImage.src = rotated.objectUrl;
  }

  function rotateImageUrl(sourceUrl, rotation) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = async () => {
        try {
          const quarterTurns = ((rotation % 4) + 4) % 4;
          const sourceWidth = image.naturalWidth || image.width;
          const sourceHeight = image.naturalHeight || image.height;
          const swap = quarterTurns % 2 === 1;
          const canvas = document.createElement("canvas");
          canvas.width = swap ? sourceHeight : sourceWidth;
          canvas.height = swap ? sourceWidth : sourceHeight;
          const context = canvas.getContext("2d", { alpha: false });
          context.fillStyle = "#f7f5ef";
          context.fillRect(0, 0, canvas.width, canvas.height);
          context.translate(canvas.width / 2, canvas.height / 2);
          context.rotate(quarterTurns * Math.PI / 2);
          context.drawImage(image, -sourceWidth / 2, -sourceHeight / 2, sourceWidth, sourceHeight);
          const blob = await canvasToBlob(canvas, "image/jpeg", 0.9);
          resolve({ objectUrl: URL.createObjectURL(blob), width: canvas.width, height: canvas.height });
        } catch (error) {
          reject(error);
        }
      };
      image.onerror = () => reject(new Error("Could not rotate image."));
      image.src = sourceUrl;
    });
  }

  function rotationFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const raw = Number(params.get("rotation") || params.get("rot") || 0);
    return Number.isFinite(raw) ? ((Math.round(raw) % 4) + 4) % 4 : 0;
  }

  function engineSpecifiedInUrl() {
    const params = new URLSearchParams(window.location.search);
    return params.has("engine") || params.has("model");
  }

  function updateRotationUrl() {
    const url = new URL(window.location.href);
    writeRotationToUrl(url);
    window.history.replaceState(null, "", url);
  }

  function writeRotationToUrl(url) {
    url.searchParams.delete("rot");
    if (state.rotation) {
      url.searchParams.set("rotation", String(state.rotation));
    } else {
      url.searchParams.delete("rotation");
    }
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  function labelTitleFromFilename(fileName, index) {
    const raw = fileName.replace(/\.[^.]+$/, "").replace(/^\d+-/, "").replace(/-/g, " ");
    return raw ? raw.replace(/\b\w/g, (letter) => letter.toUpperCase()) : `Label ${index + 1}`;
  }

  function analysisErrorMessage(error) {
    const message = String(error && error.message ? error.message : "");
    if (message.includes("OPENAI_API_KEY")) {
      return "Live AI needs OPENAI_API_KEY on the Node server. Restart with: OPENAI_API_KEY=... node server.js";
    }
    if (message.includes("Vision analysis failed")) {
      return `Live AI request failed: ${message.slice(0, 220)}`;
    }
    if (message.includes("fetch failed") || message.includes("Connect Timeout")) {
      return "Live AI cannot reach OpenAI from this server right now. Check network/firewall access to api.openai.com.";
    }
    if (message.includes("Model returned no JSON text")) {
      return "Live AI responded, but not with usable JSON. Try another submission or a smaller upload.";
    }
    return "Couldn't analyze this submission. You can still inspect it manually or try another image set.";
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function safeLine(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function logScroll(reason) {
    console.log(`Scroll serialization: ${reason}\n${window.toScroll(state)}`);
  }

  window.colaPreflightState = state;
  init();
})();
