// @ts-nocheck -- Legacy DOM controller; strict typed seams live in core/ and adapters/.
import {
  type Color,
  colorHex,
  colorKey,
  colorLabel,
} from "./core/palette.ts";
import { type PaintPath, orderPaintItems } from "./core/paint-path.ts";
import {
  ALLIANCE_EDITOR_RECYCLE_EVENTS,
  shouldRecycleAllianceEditor,
} from "./core/paint-session.ts";
import {
  editorInputKind,
  isFullscreenEditorClassName,
  isSyntheticPointerCaptureError,
  isWplacePaintButtonLabel,
  settlePaintSessionActivation,
} from "./core/editor-session.ts";
import { shouldRefreshMismatchOverlay } from "./core/paint-feedback.ts";
import { templatePixelMatchesSelectedColor } from "./core/overlay-filter.ts";
import { shouldQueuePaintPixel } from "./core/paint-target.ts";
import { resolveHqChargeCheckpoint } from "./core/hq-charge.ts";
import { hqClientPoint, hqPixelFromClient } from "./core/hq-coordinates.ts";
import { waitForStableTileSnapshot } from "./core/tile-readiness.ts";
import {
  resolveEditorColor,
  resolveTemplatePosition,
  validateTemplatePixels,
} from "./core/template.ts";
import {
  alliancePalette,
  paletteButtonForColor,
  selectedPaletteColor as readSelectedPaletteColor,
} from "./adapters/wplace-palette.ts";

  /*
   * Safety boundary:
   * - HQ auto-paint is build-time opt-in; edit ENABLE_HQ_AUTO_PAINT before installation
   * - alliance auto-paint is exposed for the 64x64 / 384x128 asset canvas
   * - instant fill is only exposed for the local 16x16 user profile-picture draft
   * - paint events and submissions go through Wplace's visible editor controls
   * - the HQ metadata endpoint is read once at start to respect its hidden charge limit
   */

  const SCRIPT_VERSION = __WAA_VERSION__;
  const SCRIPT_ID = "waa-reference-overlay";
  const PANEL_ID = `${SCRIPT_ID}-panel`;
  const OVERLAY_CLASS = `${SCRIPT_ID}-canvas`;
  const MOVE_TOOLBAR_CLASS = `${SCRIPT_ID}-move-toolbar`;
  const STORAGE_PREFIX = `${SCRIPT_ID}:v1:`;
  const SETTINGS_KEY = `${SCRIPT_ID}:settings:v1`;
  const TEMPLATE_DB_NAME = `${SCRIPT_ID}:templates:v1`;
  // Change this to true in the built userscript before installation to expose
  // experimental HQ auto-paint controls. HQ overlays remain enabled either way.
  const ENABLE_HQ_AUTO_PAINT = false;
  const ALLIANCE_SIZES = new Set(["64x64", "384x128"]);
  const HQ_SIZES = new Set([250, 500, 750, 1000, 1500, 2000]);
  const PROFILE_SIZE = "16x16";
  const SYNTHETIC_POINTER_ID = 9471;
  const POINTER_CAPTURE_BRIDGE_KEY = "__waaSyntheticPointerCaptureBridge";
  const ALLIANCE_COLOR_TOLERANCE_SQUARED = 36;
  const ALLIANCE_REFRESH_GRACE_MS = 15000;
  const EDITOR_SESSION_WAIT_MS = 15000;
  const HQ_METADATA_URL = "https://backend.wplace.live/alliance/headquarters";
  const HQ_CHARGE_SETTLE_TIMEOUT_MS = 3000;
  const HQ_CHARGE_POLL_MS = 100;
  const UNPACED_BATCH_SIZE = 50;

  const pageWindow = typeof unsafeWindow === "undefined" ? window : unsafeWindow;

  function installSyntheticPointerCaptureBridge() {
    const prototype = pageWindow.Element?.prototype;
    if (!prototype || prototype[POINTER_CAPTURE_BRIDGE_KEY]) return;
    const nativeSetPointerCapture = prototype.setPointerCapture;
    if (typeof nativeSetPointerCapture !== "function") return;
    Object.defineProperty(prototype, POINTER_CAPTURE_BRIDGE_KEY, {
      configurable: true,
      value: true,
    });
    Object.defineProperty(prototype, "setPointerCapture", {
      configurable: true,
      writable: true,
      value(pointerId) {
        try {
          return nativeSetPointerCapture.call(this, pointerId);
        } catch (error) {
          if (isSyntheticPointerCaptureError(
            error?.name,
            pointerId,
            SYNTHETIC_POINTER_ID,
          )) return;
          throw error;
        }
      },
    });
  }

  /*
   * Wplace ships the whole DaisyUI 5 component layer, so component classes
   * (btn, select, toggle, range, input) always resolve. Tailwind utilities are
   * JIT-compiled from Wplace's own source, so only classes observed on these
   * editor routes are used here; anything else lives in the scoped CSS below.
   * Icons are Material Symbols paths on Wplace's 0 -960 960 960 grid.
   */
  const ICON = {
    layers: "M480-118 120-398l66-50 294 228 294-228 66 50-360 280Zm0-202L120-600l360-280 360 280-360 280Zm0-280Zm0 178 230-178-230-178-230 178 230 178Z",
    upload: "M280-160v-80h400v80H280Zm160-160v-327L336-544l-56-56 200-200 200 200-56 56-104-103v327h-80Z",
    delete: "M280-120q-33 0-56.5-23.5T200-200v-520h-40v-80h200v-40h240v40h200v80h-40v520q0 33-23.5 56.5T680-120H280Zm400-600H280v520h400v-520ZM360-280h80v-360h-80v360Zm160 0h80v-360h-80v360ZM280-720v520-520Z",
    expandLess: "M480-528 296-344l-56-56 240-240 240 240-56 56-184-184Z",
    expandMore: "M480-344 240-584l56-56 184 184 184-184 56 56-240 240Z",
    visibility: "M480-320q75 0 127.5-52.5T660-500q0-75-52.5-127.5T480-680q-75 0-127.5 52.5T300-500q0 75 52.5 127.5T480-320Zm0-72q-45 0-76.5-31.5T372-500q0-45 31.5-76.5T480-608q45 0 76.5 31.5T588-500q0 45-31.5 76.5T480-392Zm0 192q-146 0-266-81.5T40-500q54-137 174-218.5T480-800q146 0 266 81.5T920-500q-54 137-174 218.5T480-200Zm0-80q113 0 207.5-59.5T832-500q-50-101-144.5-160.5T480-720q-113 0-207.5 59.5T128-500q50 101 144.5 160.5T480-280Z",
    visibilityOff: "M480-320q75 0 127.5-52.5T660-500q0-75-52.5-127.5T480-680q-75 0-127.5 52.5T300-500q0 75 52.5 127.5T480-320Zm0-72q-45 0-76.5-31.5T372-500q0-45 31.5-76.5T480-608q45 0 76.5 31.5T588-500q0 45-31.5 76.5T480-392Zm0 192q-146 0-266-81.5T40-500q54-137 174-218.5T480-800q146 0 266 81.5T920-500q-54 137-174 218.5T480-200Zm0-80q113 0 207.5-59.5T832-500q-50-101-144.5-160.5T480-720q-113 0-207.5 59.5T128-500q50 101 144.5 160.5T480-280Zm312 200L168-704l56-56 624 624-56 56Z",
    refresh: "M480-160q-134 0-227-93t-93-227q0-134 93-227t227-93q69 0 132 28.5T720-690v-110h80v280H520v-80h168q-32-56-87.5-88T480-720q-100 0-170 70t-70 170q0 100 70 170t170 70q77 0 139-44t87-116h84q-28 106-114 173t-196 67Z",
    play: "M320-200v-560l440 280-440 280Z",
    pause: "M520-200v-560h240v560H520Zm-320 0v-560h240v560H200Z",
    stop: "M320-320h320v-320H320v320Z",
    info: "M440-280h80v-240h-80v240Zm40-320q17 0 28.5-11.5T520-640q0-17-11.5-28.5T480-680q-17 0-28.5 11.5T440-640q0 17 11.5 28.5T480-600Zm0 520q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Zm0-80q134 0 227-93t93-227q0-134-93-227t-227-93q-134 0-227 93t-93 227q0 134 93 227t227 93Zm0-320Z",
    warning: "m40-120 440-760 440 760H40Zm138-80h604L480-720 178-200Zm302-40q17 0 28.5-11.5T520-280q0-17-11.5-28.5T480-320q-17 0-28.5 11.5T440-280q0 17 11.5 28.5T480-240Zm-40-120h80v-200h-80v200Zm40-100Z",
    // HQ template placement
    openWith: "M480-80 310-250l57-57 73 73v-166h80v165l72-73 58 58L480-80ZM250-310 80-480l169-169 57 57-72 72h166v80H235l73 73-58 57Zm460 0-57-57 73-73H560v-80h165l-73-72 58-58 170 170-170 170ZM440-560v-166l-73 73-57-57 170-170 170 170-58 58-72-73v165h-80Z",
    center: "M200-120q-33 0-56.5-23.5T120-200v-160h80v160h160v80H200Zm400 0v-80h160v-160h80v160q0 33-23.5 56.5T760-120H600ZM120-600v-160q0-33 23.5-56.5T200-840h160v80H200v160h-80Zm640 0v-160H600v-80h160q33 0 56.5 23.5T840-760v160h-80ZM338.5-338.5Q280-397 280-480t58.5-141.5Q397-680 480-680t141.5 58.5Q680-563 680-480t-58.5 141.5Q563-280 480-280t-141.5-58.5ZM565-395q35-35 35-85t-35-85q-35-35-85-35t-85 35q-35 35-35 85t35 85q35 35 85 35t85-35Zm-85-85Z",
    check: "M382-240 154-468l57-57 171 171 367-367 57 57-424 424Z",
    close: "m256-200-56-56 224-224-224-224 56-56 224 224 224-224 56 56-224 224 224 224-56 56-224-224-224 224Z",
  };

  function icon(name, size = "size-4") {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960" fill="currentColor" class="${size}" aria-hidden="true"><path d="${ICON[name]}"></path></svg>`;
  }

  function setButtonFace(button, iconName, label) {
    if (!button) return;
    button.innerHTML = `${icon(iconName)}<span>${label}</span>`;
  }

  const state = {
    editorKind: "alliance",
    root: null,
    frame: null,
    baseCanvas: null,
    tileLayer: null,
    overlayCanvas: null,
    target: null,
    templateSource: null,
    sourceName: "reference",
    templateWidth: 0,
    templateHeight: 0,
    templateOffsetX: 0,
    templateOffsetY: 0,
    templateMoveActive: false,
    templateMoveDragging: false,
    templateMoveOriginX: 0,
    templateMoveOriginY: 0,
    templateMoveDraftX: 0,
    templateMoveDraftY: 0,
    templateMoveStartClientX: 0,
    templateMoveStartClientY: 0,
    templateMoveStartX: 0,
    templateMoveStartY: 0,
    templateMovePending: null,
    templateMoveFrame: 0,
    templateMoveToolbar: null,
    templateMoveHandlersInstalled: false,
    width: 0,
    height: 0,
    opacity: 0.55,
    displayMode: "full",
    mismatchesOnly: false,
    overlaySelectedColorOnly: false,
    fixWrongColors: true,
    preserveView: false,
    hidden: false,
    collapsed: false,
    paintRunId: 0,
    paintActive: false,
    paintPaused: false,
    paintIntervalEnabled: true,
    paintSelectedColorOnly: false,
    paintPath: "start-end" as PaintPath,
    paintDelay: 150,
    paintQueue: [],
    paintIndex: 0,
    paintColor: null,
    paintFailureMessage: null,
    hqChargesRemaining: null,
    hqReportedCharges: null,
    paletteColors: [],
    overlayPaletteObserver: null,
    overlayPaletteRenderFrame: 0,
    pickerRoot: null,
    pickerPointerHandler: null,
    pickerAuxHandler: null,
    viewport: null,
    viewportObserver: null,
    viewportRoot: null,
    viewportCaptureHandler: null,
    viewportRestoring: false,
    statusMessage: "Load a PNG to begin. Middle-click the overlay to pick that pixel\u2019s color.",
    statusKind: "normal",
  };

  function activeAlliancePalette() {
    if (!state.paletteColors.length) {
      state.paletteColors = [...alliancePalette(state.root)];
    }
    return state.paletteColors;
  }

  function editorColor(r, g, b) {
    return resolveEditorColor(state.editorKind, activeAlliancePalette(), r, g, b);
  }

  function paletteColorAt(imageData, x, y) {
    if (!imageData || x < 0 || y < 0 || x >= imageData.width || y >= imageData.height) return null;
    const index = (y * imageData.width + x) * 4;
    if (imageData.data[index + 3] !== 255) return null;
    return editorColor(imageData.data[index], imageData.data[index + 1], imageData.data[index + 2]);
  }

  function validateTemplate(imageData) {
    return validateTemplatePixels(imageData, state.editorKind, activeAlliancePalette());
  }

  function editorKey() {
    return `${state.width}x${state.height}`;
  }

  function storageKey() {
    if (state.editorKind === "hq") return `${STORAGE_PREFIX}hq:${editorKey()}`;
    return `${STORAGE_PREFIX}${editorKey()}`;
  }

  // Templates saved before the key stopped including the revision counter.
  function legacyHqStorageKeys() {
    const suffix = `:${editorKey()}`;
    const prefix = `${STORAGE_PREFIX}hq:`;
    return Object.keys(localStorage).filter((key) => (
      key !== storageKey() && key.startsWith(prefix) && key.endsWith(suffix)
    )).sort();
  }

  function persistSettings() {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({
        preserveView: state.preserveView,
        paintIntervalEnabled: state.paintIntervalEnabled,
        paintSelectedColorOnly: state.paintSelectedColorOnly,
        paintPath: state.paintPath,
        paintDelay: state.paintDelay,
        collapsed: state.collapsed,
      }));
    } catch (error) {
      console.warn(`${SCRIPT_ID}: unable to save settings`, error);
    }
  }

  function restoreSettings() {
    try {
      const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "null");
      state.preserveView = Boolean(saved?.preserveView);
      state.paintIntervalEnabled = saved?.paintIntervalEnabled !== false;
      state.paintSelectedColorOnly = Boolean(saved?.paintSelectedColorOnly);
      state.paintPath = ["start-end", "end-start", "middle-out", "edge-in", "zigzag", "hilbert"]
        .includes(saved?.paintPath) ? saved.paintPath : "start-end";
      state.paintDelay = Number.isFinite(saved?.paintDelay)
        ? Math.max(1, Math.min(5000, saved.paintDelay))
        : 150;
      state.collapsed = Boolean(saved?.collapsed);
    } catch (error) {
      console.warn(`${SCRIPT_ID}: unable to restore settings`, error);
    }
  }

  function setStatus(message, kind = "normal") {
    state.statusMessage = message;
    state.statusKind = kind;
    const status = document.getElementById(`${PANEL_ID}-status`);
    const statusIcon = document.getElementById(`${PANEL_ID}-status-icon`);
    if (status) {
      status.textContent = message;
      status.title = message;
    }
    if (statusIcon) {
      // Warnings get a shape change as well as a hue, so the cue is not colour alone.
      statusIcon.className = kind === "warn" ? "text-warning shrink-0" : "text-base-content/70 shrink-0";
      statusIcon.innerHTML = icon(kind === "warn" ? "warning" : "info");
    }
  }

  function readAllianceEditor() {
    const applications = [
      ...document.querySelectorAll('[role="application"][aria-label="Alliance asset canvas"]'),
    ];
    for (const root of applications) {
      const canvases = [...root.querySelectorAll("canvas")];
      const baseCanvas = canvases.find((canvas) => {
        const size = `${canvas.width}x${canvas.height}`;
        return ALLIANCE_SIZES.has(size) && !canvas.classList.contains("pointer-events-none");
      });
      if (!baseCanvas) continue;
      const frame = baseCanvas.parentElement;
      if (!frame) continue;
      return { kind: "alliance", root, frame, baseCanvas, width: baseCanvas.width, height: baseCanvas.height };
    }
    return null;
  }

  function readProfileEditor() {
    if (location.pathname.replace(/\/+$/, "") !== "/profile-picture") return null;
    const baseCanvas = [...document.querySelectorAll("canvas")].find((canvas) => (
      canvas.width === 16
      && canvas.height === 16
      && canvas.classList.contains("pixelated")
      && !canvas.classList.contains("pointer-events-none")
      && canvas.offsetParent !== null
    ));
    if (!baseCanvas) return null;
    const frame = baseCanvas.parentElement;
    const root = frame?.parentElement;
    if (!frame || !root) return null;
    return { kind: "profile", root, frame, baseCanvas, width: 16, height: 16 };
  }

  function readHqEditor() {
    const root = document.querySelector('[role="application"][aria-label="Headquarters canvas"]');
    if (!root) return null;
    const sizeMatch = root.textContent.match(/\b(250|500|750|1000|1500|2000)\s*x\s*\1\b/);
    const size = Number(sizeMatch?.[1]);
    if (!HQ_SIZES.has(size)) return null;
    const frame = [...root.children].find((child) => child.classList.contains("artboard-frame"));
    const tileLayer = frame?.querySelector(".hq-tile-layer");
    if (!frame || !tileLayer) return null;
    return {
      kind: "hq",
      root,
      frame,
      baseCanvas: null,
      tileLayer,
      width: size,
      height: size,
    };
  }

  function readEditor() {
    return readAllianceEditor() || readProfileEditor() || readHqEditor();
  }

  function viewportKey() {
    return `${state.editorKind}:${editorKey()}`;
  }

  function captureAllianceViewport() {
    if (state.editorKind === "profile" || !state.frame?.isConnected) return;
    const rect = state.frame.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const width = Number.parseFloat(state.frame.style.width) || rect.width;
    const height = Number.parseFloat(state.frame.style.height) || rect.height;
    const transform = new DOMMatrixReadOnly(
      state.frame.style.transform || getComputedStyle(state.frame).transform,
    );
    state.viewport = {
      key: viewportKey(),
      scale: width / state.width,
      aspectRatio: width / height,
      translateX: transform.m41,
      translateY: transform.m42,
    };
  }

  function readAllianceViewport(frame) {
    const rect = frame.getBoundingClientRect();
    const width = Number.parseFloat(frame.style.width) || rect.width;
    const transform = new DOMMatrixReadOnly(frame.style.transform || getComputedStyle(frame).transform);
    return {
      scale: width / state.width,
      translateX: transform.m41,
      translateY: transform.m42,
    };
  }

  function nextFrame() {
    return new Promise((resolve) => requestAnimationFrame(resolve));
  }

  async function restorePreservedViewport(root, frame) {
    const viewport = state.viewport;
    if (!state.preserveView || !viewport || viewport.key !== viewportKey()) return;
    await nextFrame();
    if (!root.isConnected || !frame.isConnected) return;

    let current = readAllianceViewport(frame);
    const rootRect = root.getBoundingClientRect();
    const centerX = rootRect.left + rootRect.width / 2;
    const centerY = rootRect.top + rootRect.height / 2;
    const rawZoomSteps = Math.log(viewport.scale / current.scale) / Math.log(1.2);
    const zoomSteps = Number.isFinite(rawZoomSteps)
      ? Math.max(-24, Math.min(24, Math.round(rawZoomSteps)))
      : 0;
    const deltaY = zoomSteps > 0 ? -1 : 1;

    for (let step = 0; step < Math.abs(zoomSteps); step += 1) {
      root.dispatchEvent(new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        composed: true,
        clientX: centerX,
        clientY: centerY,
        deltaY,
      }));
      await nextFrame();
    }

    current = readAllianceViewport(frame);
    const deltaX = viewport.translateX - current.translateX;
    const deltaTranslateY = viewport.translateY - current.translateY;
    if (Math.abs(deltaX) >= 0.01 || Math.abs(deltaTranslateY) >= 0.01) {
      const common = {
        bubbles: true,
        cancelable: true,
        composed: true,
        pointerId: SYNTHETIC_POINTER_ID,
        pointerType: "mouse",
        isPrimary: true,
        button: 1,
      };
      const target = paintEventTarget();
      if (!target) return;
      withSyntheticPointerCapture(root, () => {
        target.dispatchEvent(new PointerEvent("pointerdown", {
          ...common, buttons: 4, clientX: centerX, clientY: centerY,
        }));
        target.dispatchEvent(new PointerEvent("pointermove", {
          ...common,
          buttons: 4,
          clientX: centerX + deltaX,
          clientY: centerY + deltaTranslateY,
        }));
        target.dispatchEvent(new PointerEvent("pointerup", {
          ...common,
          buttons: 0,
          clientX: centerX + deltaX,
          clientY: centerY + deltaTranslateY,
        }));
      });
      await nextFrame();
    }

    captureAllianceViewport();
  }

  function installViewportCapture(root, frame) {
    state.viewportObserver?.disconnect();
    if (state.viewportRoot && state.viewportCaptureHandler) {
      state.viewportRoot.removeEventListener("wheel", state.viewportCaptureHandler);
      state.viewportRoot.removeEventListener("pointerup", state.viewportCaptureHandler);
    }
    state.viewportRoot = null;
    state.viewportCaptureHandler = null;
    if (state.editorKind === "profile") return;

    const captureSoon = () => requestAnimationFrame(() => {
      captureAllianceViewport();
      syncTemplateMoveUi();
    });
    state.viewportRoot = root;
    state.viewportCaptureHandler = captureSoon;
    root.addEventListener("wheel", captureSoon, { passive: true });
    root.addEventListener("pointerup", captureSoon);
    state.viewportObserver = new MutationObserver(captureSoon);
    state.viewportObserver.observe(frame, { attributes: true, attributeFilter: ["style"] });
    captureSoon();
  }

  function makeOverlayCanvas(frame, width, height) {
    let canvas = frame.querySelector(`:scope > canvas.${OVERLAY_CLASS}`);
    if (!canvas) {
      canvas = document.createElement("canvas");
      canvas.className = OVERLAY_CLASS;
      canvas.setAttribute("aria-hidden", "true");
      Object.assign(canvas.style, {
        position: "absolute",
        inset: "0",
        width: "100%",
        height: "100%",
        pointerEvents: "none",
        imageRendering: "pixelated",
        zIndex: "7",
      });
      frame.append(canvas);
    }
    installTemplateMoveHandlers(canvas);
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }

  function ensureTemplateMoveToolbar(frame) {
    const toolbarHost = state.root?.closest('[role="dialog"], dialog') || document.body;
    let toolbar = document.querySelector(`.${MOVE_TOOLBAR_CLASS}`);
    if (!toolbar) {
      toolbar = document.createElement("div");
      // Mirrors Wplace's own floating overlay-edit panel: soft square buttons
      // on a blurred base-100 surface with the box radius.
      toolbar.className = `${MOVE_TOOLBAR_CLASS} rounded-box bg-base-100/95 border-base-300 flex items-center gap-1.5 border p-1.5 shadow-2xl backdrop-blur`;
      toolbar.hidden = true;
      toolbar.setAttribute("role", "toolbar");
      toolbar.setAttribute("aria-label", "Confirm or cancel template position");
      toolbar.innerHTML = `
        <button class="btn btn-soft btn-sm btn-square" type="button" data-action="cancel" aria-label="Cancel template position" title="Cancel repositioning">${icon("close")}</button>
        <button class="btn btn-primary btn-sm btn-square" type="button" data-action="confirm" aria-label="Confirm template position" title="Confirm position">${icon("check")}</button>
      `;
      for (const eventName of ["pointerdown", "pointerup", "click"]) {
        toolbar.addEventListener(eventName, (event) => event.stopPropagation());
      }
      toolbar.querySelector('[data-action="confirm"]').addEventListener("click", confirmTemplateMove);
      toolbar.querySelector('[data-action="cancel"]').addEventListener("click", cancelTemplateMove);
    }
    if (toolbar.parentElement !== toolbarHost) toolbarHost.append(toolbar);
    state.templateMoveToolbar = toolbar;
    return toolbar;
  }

  function installTemplateMoveHandlers(canvas) {
    if (state.templateMoveHandlersInstalled) return;
    state.templateMoveHandlersInstalled = true;
    // The toolbar is fixed-position chrome anchored to a pixel on the artboard,
    // so it has to follow whenever the artboard moves under it.
    const followSurface = () => {
      if (state.templateMoveActive) requestAnimationFrame(syncTemplateMoveUi);
    };
    window.addEventListener("scroll", followSurface, { capture: true, passive: true });
    window.addEventListener("resize", followSurface, { passive: true });
    window.addEventListener("pointerdown", (event) => {
      if (
        !state.templateMoveActive
        || !event.composedPath().includes(state.overlayCanvas)
        || event.button !== 0
        || !state.templateSource
      ) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const pixel = editorPixelFromClient(event.clientX, event.clientY);
      if (!pixel) return;
      const withinTemplate = pixel.x >= state.templateMoveDraftX
        && pixel.y >= state.templateMoveDraftY
        && pixel.x < state.templateMoveDraftX + state.templateSource.width
        && pixel.y < state.templateMoveDraftY + state.templateSource.height;
      if (!withinTemplate) return;
      state.templateMoveDragging = true;
      state.templateMoveStartClientX = event.clientX;
      state.templateMoveStartClientY = event.clientY;
      state.templateMoveStartX = state.templateMoveDraftX;
      state.templateMoveStartY = state.templateMoveDraftY;
      state.overlayCanvas.setPointerCapture(event.pointerId);
      syncTemplateMoveUi();
    }, true);
    window.addEventListener("pointermove", (event) => {
      if (!state.templateMoveActive || !event.composedPath().includes(state.overlayCanvas)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!state.templateMoveDragging) return;
      const rect = editorSurfaceRect();
      if (!rect?.width || !rect.height) return;
      const deltaX = Math.round(
        ((event.clientX - state.templateMoveStartClientX) / rect.width) * state.width,
      );
      const deltaY = Math.round(
        ((event.clientY - state.templateMoveStartClientY) / rect.height) * state.height,
      );
      queueTemplateMovePreview(
        state.templateMoveStartX + deltaX,
        state.templateMoveStartY + deltaY,
      );
    }, true);
    const finishDrag = (event) => {
      if (
        !state.templateMoveActive
        || (!state.templateMoveDragging && !event.composedPath().includes(state.overlayCanvas))
      ) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!state.templateMoveDragging) return;
      flushTemplateMovePreview();
      state.templateMoveDragging = false;
      if (state.overlayCanvas?.hasPointerCapture(event.pointerId)) {
        state.overlayCanvas.releasePointerCapture(event.pointerId);
      }
      syncTemplateMoveUi();
    };
    window.addEventListener("pointerup", finishDrag, true);
    window.addEventListener("pointercancel", finishDrag, true);
  }

  function paintEventTarget() {
    return state.editorKind === "hq" ? state.root : state.baseCanvas;
  }

  function editorSurfaceRect() {
    return (state.editorKind === "hq" ? state.frame : state.baseCanvas)?.getBoundingClientRect();
  }

  function readEditorPixels() {
    if (state.editorKind !== "hq") {
      return state.baseCanvas.getContext("2d", { willReadFrequently: true })
        .getImageData(0, 0, state.width, state.height);
    }

    const canvas = document.createElement("canvas");
    canvas.width = state.width;
    canvas.height = state.height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    const frameWidth = Number.parseFloat(state.frame.style.width)
      || state.frame.getBoundingClientRect().width;
    const cssScale = frameWidth / state.width;
    if (!cssScale) throw new Error("The HQ artboard has no readable scale.");

    for (const tile of state.tileLayer.querySelectorAll("canvas")) {
      const left = Number.parseFloat(tile.style.left);
      const top = Number.parseFloat(tile.style.top);
      if (!Number.isFinite(left) || !Number.isFinite(top)) continue;
      const x = Math.round(left / cssScale);
      const y = Math.round(top / cssScale);
      context.drawImage(tile, x, y, tile.width, tile.height);
    }
    return context.getImageData(0, 0, state.width, state.height);
  }

  function hqTilePixelSignature() {
    if (state.editorKind !== "hq" || !state.tileLayer?.isConnected) return null;
    let hash = 2166136261;
    let canvasCount = 0;
    for (const canvas of state.tileLayer.querySelectorAll("canvas")) {
      canvasCount += 1;
      const style = canvas.getAttribute("style") || "";
      for (let index = 0; index < style.length; index += 1) {
        hash ^= style.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
      }
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) return null;
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      for (let index = 0; index < pixels.length; index += 4) {
        hash ^= pixels[index];
        hash = Math.imul(hash, 16777619);
        hash ^= pixels[index + 1];
        hash = Math.imul(hash, 16777619);
        hash ^= pixels[index + 2];
        hash = Math.imul(hash, 16777619);
        hash ^= pixels[index + 3];
        hash = Math.imul(hash, 16777619);
      }
    }
    return `${canvasCount}:${hash >>> 0}`;
  }

  async function waitForHqTilesToSettle(hqTilesBeforePaint) {
    const root = state.root;
    const tileLayer = state.tileLayer;
    const result = await waitForStableTileSnapshot({
      readSignature: () => (
        state.root === root && state.tileLayer === tileLayer
          ? hqTilePixelSignature()
          : null
      ),
      wait,
      requiredChangeFrom: hqTilesBeforePaint,
      maximumSamples: Math.ceil(EDITOR_SESSION_WAIT_MS / 50),
    });
    return result.stable && root?.isConnected && tileLayer?.isConnected;
  }

  function bytesToBase64(bytes) {
    let binary = "";
    const chunkSize = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
    }
    return btoa(binary);
  }

  function base64ToBytes(base64) {
    const binary = atob(base64);
    const bytes = new Uint8ClampedArray(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  }

  function openTemplateDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(TEMPLATE_DB_NAME, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains("templates")) {
          request.result.createObjectStore("templates");
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("Could not open template storage."));
    });
  }

  async function writeLargeTemplate(key, file) {
    const database = await openTemplateDatabase();
    try {
      await new Promise((resolve, reject) => {
        const transaction = database.transaction("templates", "readwrite");
        transaction.objectStore("templates").put(file, key);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error || new Error("Could not save the HQ template."));
      });
    } finally {
      database.close();
    }
  }

  async function readLargeTemplate(key) {
    const database = await openTemplateDatabase();
    try {
      return await new Promise((resolve, reject) => {
        const transaction = database.transaction("templates", "readonly");
        const request = transaction.objectStore("templates").get(key);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error || new Error("Could not read the HQ template."));
      });
    } finally {
      database.close();
    }
  }

  async function deleteLargeTemplate(key) {
    const database = await openTemplateDatabase();
    try {
      await new Promise((resolve, reject) => {
        const transaction = database.transaction("templates", "readwrite");
        transaction.objectStore("templates").delete(key);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error || new Error("Could not clear the HQ template."));
      });
    } finally {
      database.close();
    }
  }

  async function listLargeTemplateKeys() {
    const database = await openTemplateDatabase();
    try {
      return await new Promise((resolve, reject) => {
        const transaction = database.transaction("templates", "readonly");
        const request = transaction.objectStore("templates").getAllKeys();
        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => reject(request.error || new Error("Could not list stored templates."));
      });
    } finally {
      database.close();
    }
  }

  // Earlier builds keyed HQ templates by the live revision counter, so each load
  // wrote a record nothing would ever read again. Adopt the newest of those for
  // this canvas, then drop every blob no longer referenced by localStorage.
  async function reclaimLegacyHqTemplates() {
    const legacyKeys = legacyHqStorageKeys();
    const adoptable = legacyKeys.at(-1);
    if (adoptable && !localStorage.getItem(storageKey())) {
      const file = await readLargeTemplate(adoptable);
      if (file) {
        await writeLargeTemplate(storageKey(), file);
        localStorage.setItem(storageKey(), localStorage.getItem(adoptable));
      }
    }
    for (const key of legacyKeys) localStorage.removeItem(key);
  }

  async function pruneOrphanedTemplates() {
    const live = new Set(Object.keys(localStorage).filter((key) => key.startsWith(STORAGE_PREFIX)));
    for (const key of await listLargeTemplateKeys()) {
      if (!live.has(key)) await deleteLargeTemplate(key);
    }
  }

  async function urlToImageData(url, width, height) {
    const image = new Image();
    image.decoding = "async";
    image.src = url;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.imageSmoothingEnabled = false;
    context.drawImage(image, 0, 0, width, height);
    return context.getImageData(0, 0, width, height);
  }

  function paethPredictor(left, above, upperLeft) {
    const estimate = left + above - upperLeft;
    const leftDistance = Math.abs(estimate - left);
    const aboveDistance = Math.abs(estimate - above);
    const upperLeftDistance = Math.abs(estimate - upperLeft);
    if (leftDistance <= aboveDistance && leftDistance <= upperLeftDistance) return left;
    return aboveDistance <= upperLeftDistance ? above : upperLeft;
  }

  async function decodePngSamples(file, expectedWidth, expectedHeight, allowSmaller = false) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const signature = [137, 80, 78, 71, 13, 10, 26, 10];
    if (bytes.length < 8 || signature.some((value, index) => bytes[index] !== value)) {
      throw new Error("Choose a valid PNG file.");
    }

    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let offset = 8;
    let header = null;
    let palette = null;
    let transparency = null;
    const compressedParts = [];
    while (offset + 12 <= bytes.length) {
      const length = view.getUint32(offset);
      const typeOffset = offset + 4;
      const dataOffset = offset + 8;
      const endOffset = dataOffset + length;
      if (endOffset + 4 > bytes.length) throw new Error("The PNG is truncated.");
      const type = String.fromCharCode(
        bytes[typeOffset], bytes[typeOffset + 1], bytes[typeOffset + 2], bytes[typeOffset + 3],
      );
      const data = bytes.slice(dataOffset, endOffset);
      if (type === "IHDR") {
        if (length !== 13) throw new Error("The PNG header is invalid.");
        const headerView = new DataView(data.buffer, data.byteOffset, data.byteLength);
        header = {
          width: headerView.getUint32(0),
          height: headerView.getUint32(4),
          bitDepth: data[8],
          colorType: data[9],
          compression: data[10],
          filter: data[11],
          interlace: data[12],
        };
        const dimensionsMatch = header.width === expectedWidth && header.height === expectedHeight;
        const dimensionsFit = header.width <= expectedWidth && header.height <= expectedHeight;
        if (!dimensionsMatch && (!allowSmaller || !dimensionsFit)) {
          const expectation = allowSmaller
            ? `at most ${expectedWidth}x${expectedHeight}`
            : `${expectedWidth}x${expectedHeight}`;
          throw new Error(`Expected ${expectation}, got ${header.width}x${header.height}. Resize it outside this script.`);
        }
      } else if (type === "PLTE") {
        palette = data;
      } else if (type === "tRNS") {
        transparency = data;
      } else if (type === "IDAT") {
        compressedParts.push(data);
      } else if (type === "IEND") {
        break;
      }
      offset = endOffset + 4;
    }

    if (!header || !compressedParts.length) throw new Error("The PNG has no readable image data.");
    if (header.bitDepth !== 8 || header.compression !== 0 || header.filter !== 0 || header.interlace !== 0) {
      throw new Error("Use an 8-bit, non-interlaced PNG.");
    }
    const channelsByType = new Map([[0, 1], [2, 3], [3, 1], [4, 2], [6, 4]]);
    const channels = channelsByType.get(header.colorType);
    if (!channels) throw new Error(`PNG color type ${header.colorType} is not supported.`);
    if (header.colorType === 3 && (!palette || palette.length % 3 !== 0)) {
      throw new Error("The indexed PNG palette is missing or invalid.");
    }

    const compressedLength = compressedParts.reduce((sum, part) => sum + part.length, 0);
    const compressed = new Uint8Array(compressedLength);
    let compressedOffset = 0;
    for (const part of compressedParts) {
      compressed.set(part, compressedOffset);
      compressedOffset += part.length;
    }
    if (typeof DecompressionStream !== "function") {
      throw new Error("This browser cannot decode raw PNG samples without color conversion.");
    }
    const decompressedStream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream("deflate"));
    const filtered = new Uint8Array(await new Response(decompressedStream).arrayBuffer());
    const rowLength = header.width * channels;
    const expectedLength = (rowLength + 1) * header.height;
    if (filtered.length !== expectedLength) throw new Error("The PNG pixel data has an unexpected size.");

    const samples = new Uint8Array(rowLength * header.height);
    let sourceOffset = 0;
    for (let y = 0; y < header.height; y += 1) {
      const filterType = filtered[sourceOffset++];
      if (filterType > 4) throw new Error(`PNG filter ${filterType} is not supported.`);
      const rowOffset = y * rowLength;
      const previousOffset = rowOffset - rowLength;
      for (let x = 0; x < rowLength; x += 1) {
        const raw = filtered[sourceOffset++];
        const left = x >= channels ? samples[rowOffset + x - channels] : 0;
        const above = y > 0 ? samples[previousOffset + x] : 0;
        const upperLeft = y > 0 && x >= channels ? samples[previousOffset + x - channels] : 0;
        let value = raw;
        if (filterType === 1) value += left;
        else if (filterType === 2) value += above;
        else if (filterType === 3) value += Math.floor((left + above) / 2);
        else if (filterType === 4) value += paethPredictor(left, above, upperLeft);
        samples[rowOffset + x] = value & 255;
      }
    }

    const rgba = new Uint8ClampedArray(header.width * header.height * 4);
    for (let pixel = 0; pixel < header.width * header.height; pixel += 1) {
      const source = pixel * channels;
      const target = pixel * 4;
      if (header.colorType === 6) {
        rgba[target] = samples[source];
        rgba[target + 1] = samples[source + 1];
        rgba[target + 2] = samples[source + 2];
        rgba[target + 3] = samples[source + 3];
      } else if (header.colorType === 2) {
        rgba[target] = samples[source];
        rgba[target + 1] = samples[source + 1];
        rgba[target + 2] = samples[source + 2];
        const transparentRgb = transparency?.length >= 6
          && samples[source] === ((transparency[0] << 8) | transparency[1])
          && samples[source + 1] === ((transparency[2] << 8) | transparency[3])
          && samples[source + 2] === ((transparency[4] << 8) | transparency[5]);
        rgba[target + 3] = transparentRgb ? 0 : 255;
      } else if (header.colorType === 3) {
        const paletteIndex = samples[source];
        const paletteOffset = paletteIndex * 3;
        if (paletteOffset + 2 >= palette.length) throw new Error("The PNG uses an invalid palette index.");
        rgba[target] = palette[paletteOffset];
        rgba[target + 1] = palette[paletteOffset + 1];
        rgba[target + 2] = palette[paletteOffset + 2];
        rgba[target + 3] = transparency?.[paletteIndex] ?? 255;
      } else {
        const gray = samples[source];
        rgba[target] = gray;
        rgba[target + 1] = gray;
        rgba[target + 2] = gray;
        const transparentGray = header.colorType === 0
          && transparency?.length >= 2
          && gray === ((transparency[0] << 8) | transparency[1]);
        rgba[target + 3] = header.colorType === 4 ? samples[source + 1] : (transparentGray ? 0 : 255);
      }
    }
    return new ImageData(rgba, header.width, header.height);
  }

  function placeTemplateOnEditor(imageData, requestedX, requestedY) {
    const position = resolveTemplatePosition(
      state.width,
      state.height,
      imageData.width,
      imageData.height,
      requestedX,
      requestedY,
    );
    const offsetX = position.x;
    const offsetY = position.y;
    if (
      imageData.width === state.width
      && imageData.height === state.height
      && offsetX === 0
      && offsetY === 0
    ) {
      return { imageData, offsetX, offsetY };
    }
    const placed = new ImageData(state.width, state.height);
    for (let y = 0; y < imageData.height; y += 1) {
      const sourceStart = y * imageData.width * 4;
      const targetStart = ((y + offsetY) * state.width + offsetX) * 4;
      placed.data.set(
        imageData.data.subarray(sourceStart, sourceStart + imageData.width * 4),
        targetStart,
      );
    }
    return { imageData: placed, offsetX, offsetY };
  }

  function positionTemplate(requestedX, requestedY) {
    if (state.editorKind !== "hq" || !state.templateSource || state.paintActive) return;
    const placed = placeTemplateOnEditor(state.templateSource, requestedX, requestedY);
    state.target = placed.imageData;
    state.templateOffsetX = placed.offsetX;
    state.templateOffsetY = placed.offsetY;
    persistTarget();
    syncControls();
    renderOverlay();
    setStatus(`Template positioned at X ${placed.offsetX}, Y ${placed.offsetY}.`);
  }

  function beginTemplateMove() {
    if (
      state.editorKind !== "hq"
      || !state.templateSource
      || !state.target
      || state.paintActive
      || state.hidden
    ) return;
    state.templateMoveActive = true;
    state.templateMoveDragging = false;
    state.templateMoveOriginX = state.templateOffsetX;
    state.templateMoveOriginY = state.templateOffsetY;
    state.templateMoveDraftX = state.templateOffsetX;
    state.templateMoveDraftY = state.templateOffsetY;
    syncControls();
    renderOverlay();
    setStatus("Drag the template, then confirm or cancel its new position.");
  }

  function previewTemplateMove(requestedX, requestedY) {
    if (!state.templateMoveActive || !state.templateSource) return;
    const position = resolveTemplatePosition(
      state.width,
      state.height,
      state.templateSource.width,
      state.templateSource.height,
      requestedX,
      requestedY,
    );
    state.templateMoveDraftX = position.x;
    state.templateMoveDraftY = position.y;
    syncTemplateMoveUi();
    renderOverlay();
  }

  function queueTemplateMovePreview(requestedX, requestedY) {
    state.templateMovePending = { x: requestedX, y: requestedY };
    if (state.templateMoveFrame) return;
    state.templateMoveFrame = requestAnimationFrame(() => {
      state.templateMoveFrame = 0;
      flushTemplateMovePreview();
    });
  }

  function flushTemplateMovePreview() {
    const pending = state.templateMovePending;
    state.templateMovePending = null;
    if (pending) previewTemplateMove(pending.x, pending.y);
  }

  function finishTemplateMoveState() {
    if (state.templateMoveFrame) cancelAnimationFrame(state.templateMoveFrame);
    state.templateMoveFrame = 0;
    state.templateMovePending = null;
    state.templateMoveActive = false;
    state.templateMoveDragging = false;
    syncTemplateMoveUi();
  }

  function confirmTemplateMove() {
    if (!state.templateMoveActive) return;
    flushTemplateMovePreview();
    const x = state.templateMoveDraftX;
    const y = state.templateMoveDraftY;
    finishTemplateMoveState();
    positionTemplate(x, y);
  }

  function cancelTemplateMove() {
    if (!state.templateMoveActive) return;
    const x = state.templateMoveOriginX;
    const y = state.templateMoveOriginY;
    finishTemplateMoveState();
    syncControls();
    renderOverlay();
    setStatus(`Template move cancelled; kept X ${x}, Y ${y}.`);
  }

  function syncTemplateMoveUi() {
    const canvas = state.overlayCanvas;
    const toolbar = state.templateMoveToolbar;
    const moveButton = document.getElementById(`${PANEL_ID}-template-move`);
    const templateX = document.getElementById(`${PANEL_ID}-template-x`);
    const templateY = document.getElementById(`${PANEL_ID}-template-y`);
    if (canvas) {
      canvas.style.pointerEvents = state.templateMoveActive ? "auto" : "none";
      canvas.style.cursor = state.templateMoveActive
        ? (state.templateMoveDragging ? "grabbing" : "grab")
        : "default";
    }
    if (moveButton) {
      setButtonFace(moveButton, "openWith", state.templateMoveActive ? "Moving…" : "Move");
      moveButton.className = state.templateMoveActive ? "btn btn-primary btn-sm gap-1" : "btn btn-sm gap-1";
      moveButton.setAttribute("aria-pressed", String(state.templateMoveActive));
      moveButton.disabled = !state.target
        || state.paintActive
        || state.hidden
        || state.templateMoveActive;
    }
    if (templateX && state.templateMoveActive) {
      templateX.value = String(state.templateMoveDraftX);
    }
    if (templateY && state.templateMoveActive) {
      templateY.value = String(state.templateMoveDraftY);
    }
    if (!toolbar) return;
    toolbar.hidden = !state.templateMoveActive || !state.templateSource;
    if (toolbar.hidden) return;
    const rect = editorSurfaceRect();
    if (!rect?.width || !rect.height) {
      toolbar.hidden = true;
      return;
    }
    const centerX = state.templateMoveDraftX + state.templateSource.width / 2;
    const viewportX = rect.left + (centerX / state.width) * rect.width;
    const viewportY = rect.top + (state.templateMoveDraftY / state.height) * rect.height;
    const stage = visibleStageBox();
    const halfWidth = (toolbar.offsetWidth || 84) / 2;
    const clearance = (toolbar.offsetHeight || 46) + 8;
    const clamp = (value, low, high) => Math.min(Math.max(value, low), Math.max(low, high));
    toolbar.style.left = `${clamp(
      viewportX,
      stage.left + halfWidth,
      stage.right - halfWidth,
    )}px`;
    toolbar.style.top = `${clamp(viewportY, stage.top + clearance, stage.bottom)}px`;
  }

  // The stage scrolls behind Wplace's sticky modal chrome, so its layout rect can
  // reach far outside what the user can see. Intersect it with every clipping
  // ancestor and the viewport to get the box the toolbar may actually sit in.
  function visibleStageBox() {
    let box = { left: 8, top: 8, right: innerWidth - 8, bottom: innerHeight - 8 };
    const intersect = (rect) => {
      box = {
        left: Math.max(box.left, rect.left),
        top: Math.max(box.top, rect.top),
        right: Math.min(box.right, rect.right),
        bottom: Math.min(box.bottom, rect.bottom),
      };
    };
    for (let node = state.root; node instanceof Element; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (node === state.root || /auto|scroll|hidden/.test(`${style.overflowY}${style.overflowX}`)) {
        intersect(node.getBoundingClientRect());
      }
    }
    if (box.right <= box.left) box.right = box.left;
    if (box.bottom <= box.top) box.bottom = box.top;
    return box;
  }

  function persistTarget() {
    if (!state.target) return;
    try {
      const saved = {
        width: state.target.width,
        height: state.target.height,
        templateWidth: state.templateWidth || state.target.width,
        templateHeight: state.templateHeight || state.target.height,
        templateOffsetX: state.templateOffsetX,
        templateOffsetY: state.templateOffsetY,
        name: state.sourceName,
        opacity: state.opacity,
        displayMode: state.displayMode,
        mismatchesOnly: state.mismatchesOnly,
        overlaySelectedColorOnly: state.overlaySelectedColorOnly,
        fixWrongColors: state.fixWrongColors,
      };
      if (state.editorKind === "hq") saved.indexedDb = true;
      else saved.rgba = bytesToBase64(state.target.data);
      localStorage.setItem(
        storageKey(),
        JSON.stringify(saved),
      );
    } catch (error) {
      console.warn(`${SCRIPT_ID}: unable to save the local template`, error);
      setStatus("Overlay works, but could not be saved locally.", "warn");
    }
  }

  async function restoreTarget() {
    finishTemplateMoveState();
    state.target = null;
    state.templateSource = null;
    try {
      if (state.editorKind === "hq") {
        await reclaimLegacyHqTemplates();
        await pruneOrphanedTemplates();
      }
      const saved = JSON.parse(localStorage.getItem(storageKey()) || "null");
      if (!saved?.rgba && !saved?.image && !saved?.indexedDb) return;
      if (saved.indexedDb) {
        const file = await readLargeTemplate(storageKey());
        if (!file) throw new Error("The saved HQ template file is missing.");
        const decoded = await decodePngSamples(file, state.width, state.height, true);
        const validationError = validateTemplate(decoded);
        if (validationError) throw new Error(`Saved template is no longer valid: ${validationError}`);
        const placed = placeTemplateOnEditor(
          decoded,
          saved.templateOffsetX,
          saved.templateOffsetY,
        );
        state.templateSource = decoded;
        state.target = placed.imageData;
        state.templateWidth = decoded.width;
        state.templateHeight = decoded.height;
        state.templateOffsetX = placed.offsetX;
        state.templateOffsetY = placed.offsetY;
      } else if (saved.rgba) {
        if (saved.width !== state.width || saved.height !== state.height) {
          throw new Error("Saved template dimensions do not match this editor.");
        }
        const rgba = base64ToBytes(saved.rgba);
        if (rgba.length !== state.width * state.height * 4) {
          throw new Error("Saved template pixel data has an unexpected size.");
        }
        state.target = new ImageData(rgba, state.width, state.height);
        state.templateSource = state.target;
        state.templateWidth = saved.templateWidth || state.width;
        state.templateHeight = saved.templateHeight || state.height;
        state.templateOffsetX = saved.templateOffsetX || 0;
        state.templateOffsetY = saved.templateOffsetY || 0;
      } else {
        state.target = await urlToImageData(saved.image, state.width, state.height);
        state.templateSource = state.target;
        state.templateWidth = state.width;
        state.templateHeight = state.height;
        state.templateOffsetX = 0;
        state.templateOffsetY = 0;
      }
      const validationError = validateTemplate(state.target);
      if (validationError) throw new Error(`Saved template is no longer valid: ${validationError}`);
      state.sourceName = saved.name || "reference";
      state.opacity = Number.isFinite(saved.opacity) ? saved.opacity : 0.55;
      state.displayMode = saved.displayMode === "center" ? "center" : "full";
      state.mismatchesOnly = Boolean(saved.mismatchesOnly);
      state.overlaySelectedColorOnly = Boolean(saved.overlaySelectedColorOnly);
      state.fixWrongColors = typeof saved.fixWrongColors === "boolean"
        ? saved.fixWrongColors
        : !Boolean(saved.onlyUnpainted);
      syncControls();
      renderOverlay();
      setStatus(`Restored ${state.sourceName}.`);
    } catch (error) {
      console.warn(`${SCRIPT_ID}: unable to restore the local template`, error);
      localStorage.removeItem(storageKey());
      setStatus(error instanceof Error ? error.message : "Could not restore the saved template.", "warn");
    }
  }

  function renderOverlay(updateStatus = true) {
    const canvas = state.overlayCanvas;
    if (!canvas) return;
    canvas.style.opacity = String(state.opacity);
    canvas.style.display = state.hidden ? "none" : "block";
    if (!state.target) {
      canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height);
      syncTemplateMoveUi();
      return;
    }
    if (state.hidden) return;

    if (state.templateMoveActive && state.templateSource) {
      renderOverlayImage(
        state.templateSource,
        state.templateMoveDraftX,
        state.templateMoveDraftY,
      );
      syncTemplateMoveUi();
      return;
    }

    const output = new ImageData(new Uint8ClampedArray(state.target.data), state.width, state.height);
    const selectedOverlayColor = state.overlaySelectedColorOnly
      ? readSelectedPaletteColor(state.root)
      : null;
    if (state.overlaySelectedColorOnly) {
      const selectedRgb = selectedOverlayColor?.rgb || null;
      for (let index = 0; index < output.data.length; index += 4) {
        if (output.data[index + 3] < 64 || !templatePixelMatchesSelectedColor(
          output.data[index],
          output.data[index + 1],
          output.data[index + 2],
          selectedRgb,
        )) output.data[index + 3] = 0;
      }
    }
    if (state.mismatchesOnly && !state.paintActive) {
      try {
        const actual = readEditorPixels().data;
        for (let index = 0; index < output.data.length; index += 4) {
          const targetAlpha = output.data[index + 3];
          if (targetAlpha < 64) {
            output.data[index + 3] = 0;
            continue;
          }
          const matches = pixelMatchesColor(actual, index, {
            rgb: [output.data[index], output.data[index + 1], output.data[index + 2]],
          });
          if (matches) output.data[index + 3] = 0;
        }
      } catch (error) {
        console.warn(`${SCRIPT_ID}: could not read the editor canvas for mismatch mode`, error);
        setStatus("Could not read Wplace's canvas; showing the full overlay.", "warn");
      }
    }

    renderOverlayImage(output, 0, 0);
    const visiblePixels = countVisiblePixels(output);
    if (!state.paintActive && updateStatus) {
      if (state.overlaySelectedColorOnly && !selectedOverlayColor) {
        setStatus("Open Wplace's Paint menu and select a colour to filter the overlay.", "warn");
      } else if (state.overlaySelectedColorOnly && state.mismatchesOnly) {
        setStatus(`${visiblePixels.toLocaleString()} selected-colour pixels still differ.`);
      } else if (state.overlaySelectedColorOnly) {
        setStatus(`${visiblePixels.toLocaleString()} selected-colour template pixels.`);
      } else if (state.mismatchesOnly) {
        setStatus(`${visiblePixels.toLocaleString()} pixels still differ.`);
      } else {
        setStatus(`${countVisiblePixels(state.target).toLocaleString()} template pixels.`);
      }
    }
  }

  function refreshOverlayAfterPaint() {
    requestAnimationFrame(() => renderOverlay(false));
  }

  function renderOverlayImage(imageData, offsetX, offsetY) {
    const canvas = state.overlayCanvas;
    if (!canvas) return;
    const scale = state.displayMode === "center" ? 3 : 1;
    const renderWidth = state.width * scale;
    const renderHeight = state.height * scale;
    if (canvas.width !== renderWidth) canvas.width = renderWidth;
    if (canvas.height !== renderHeight) canvas.height = renderHeight;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.clearRect(0, 0, canvas.width, canvas.height);
    if (scale === 1) {
      context.putImageData(imageData, offsetX, offsetY);
    } else {
      const centeredWidth = imageData.width * 3;
      const centeredHeight = imageData.height * 3;
      const centered = context.createImageData(centeredWidth, centeredHeight);
      for (let y = 0; y < imageData.height; y += 1) {
        for (let x = 0; x < imageData.width; x += 1) {
          const source = (y * imageData.width + x) * 4;
          if (imageData.data[source + 3] === 0) continue;
          const target = ((y * 3 + 1) * centeredWidth + x * 3 + 1) * 4;
          centered.data[target] = imageData.data[source];
          centered.data[target + 1] = imageData.data[source + 1];
          centered.data[target + 2] = imageData.data[source + 2];
          centered.data[target + 3] = imageData.data[source + 3];
        }
      }
      context.putImageData(centered, offsetX * 3, offsetY * 3);
    }
  }

  function countVisiblePixels(imageData) {
    let count = 0;
    for (let index = 3; index < imageData.data.length; index += 4) {
      if (imageData.data[index] >= 64) count += 1;
    }
    return count;
  }

  function preparePaintColor(color) {
    state.paintFailureMessage = null;
    if (state.paintSelectedColorOnly) {
      const selected = readSelectedPaletteColor(state.root);
      if (!selected || colorKey(selected) !== colorKey(color)) {
        state.paintFailureMessage = selected
          ? `Selected color changed to ${colorLabel(selected)}. Reselect ${colorLabel(color)} and use Resume.`
          : `Could not confirm the selected Wplace color. Reselect ${colorLabel(color)} and use Resume.`;
        return false;
      }
      state.paintColor = colorKey(color);
      return true;
    }
    if (state.paintColor === colorKey(color)) return true;
    const selected = selectPaletteColor(color);
    if (!selected && !state.paintFailureMessage) {
      state.paintFailureMessage = `Could not select ${colorLabel(color)} by exact RGB. Paused; use Resume to retry.`;
    }
    return selected;
  }

  function selectPaletteColor(color, announce = false) {
    if (state.editorKind === "profile") {
      const input = state.root?.querySelector('input[type="color"]');
      if (!input) {
        setStatus("Could not find Wplace's profile color picker.", "warn");
        return false;
      }
      input.value = colorHex(color);
      input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
      input.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
      state.paintColor = colorKey(color);
      if (announce) setStatus(`Selected ${colorLabel(color)} from the template.`);
      return true;
    }
    const button = paletteButtonForColor(state.root, color);
    if (!button) {
      state.paintFailureMessage = `Wplace has no palette swatch for ${colorLabel(color)} (${colorHex(color).toUpperCase()}).`;
      setStatus(state.paintFailureMessage, "warn");
      return false;
    }
    button.click();
    state.paintColor = colorKey(color);
    if (announce) setStatus(`Selected ${colorLabel(color)} from the template.`);
    return true;
  }

  function editorDialog() {
    return state.root?.closest('[role="dialog"], dialog') || null;
  }

  function editorFullscreen(root = state.root) {
    return isFullscreenEditorClassName(root?.className);
  }

  function syncPanelLayout(panel = document.getElementById(PANEL_ID), root = state.root) {
    if (panel) panel.dataset.fullscreen = String(editorFullscreen(root));
  }

  function visibleButton(button) {
    return button.getClientRects().length > 0 && button.offsetParent !== null;
  }

  function paintSessionActive() {
    const container = editorDialog();
    if (!container || state.editorKind === "profile") return false;
    return [...container.querySelectorAll('button[aria-label="Color Picker"]')]
      .some(visibleButton);
  }

  function wplacePaintButtons(enabledOnly = true) {
    const container = editorDialog();
    if (!container) return [];
    return [...container.querySelectorAll("button")].filter((button) => (
      (!enabledOnly || !button.disabled)
      && visibleButton(button)
      && !button.closest(`#${PANEL_ID}`)
      && isWplacePaintButtonLabel(button.textContent)
    ));
  }

  function paintSessionHasPendingPixels() {
    return wplacePaintButtons(false).some((button) => !button.disabled);
  }

  async function waitForPaintSession(active, runId = null) {
    const deadline = Date.now() + EDITOR_SESSION_WAIT_MS;
    while ((runId === null || runId === state.paintRunId) && Date.now() < deadline) {
      if (paintSessionActive() === active) return true;
      await wait(25);
    }
    return false;
  }

  async function ensurePaintTool(runId = null) {
    if (state.editorKind === "profile") return true;
    if (paintSessionActive()) return true;
    const rootPaintButtons = [...state.root.querySelectorAll("button")].filter((button) => (
      !button.disabled && visibleButton(button) && isWplacePaintButtonLabel(button.textContent)
    ));
    const paintButtons = rootPaintButtons.length ? rootPaintButtons : wplacePaintButtons();
    if (paintButtons.length !== 1) return false;
    paintButtons[0].click();
    if (!await waitForPaintSession(true, runId)) return false;
    return settlePaintSessionActivation(
      nextFrame,
      () => (runId === null || runId === state.paintRunId) && paintSessionActive(),
    );
  }

  async function commitPaintSession(runId) {
    if (state.editorKind === "profile" || !paintSessionActive()) return true;
    const paintButtons = wplacePaintButtons(false);
    if (paintButtons.length !== 1) return false;
    // Wplace disables Paint when every dispatched HQ event was a no-op. That
    // is an empty checkpoint, not a submission failure; keep the session open
    // and let the caller continue with a fresh server-reported charge budget.
    if (paintButtons[0].disabled) return true;
    paintButtons[0].click();
    return waitForPaintSession(false, runId);
  }

  async function readHqCharges() {
    if (state.editorKind !== "hq") return null;
    try {
      const response = await fetch(HQ_METADATA_URL, { credentials: "include" });
      if (!response.ok) return null;
      const metadata = await response.json();
      const current = Number(metadata.charges);
      const maximum = Number(metadata.maxCharges);
      if (!Number.isFinite(current) || !Number.isFinite(maximum)) return null;
      return { current: Math.max(0, Math.floor(current)), maximum };
    } catch (error) {
      console.warn(`${SCRIPT_ID}: could not read HQ charges`, error);
      return null;
    }
  }

  async function refreshHqChargeBudget(runId) {
    const previousReportedCharges = state.hqReportedCharges;
    const deadline = Date.now() + HQ_CHARGE_SETTLE_TIMEOUT_MS;
    let fresh = null;
    do {
      await wait(HQ_CHARGE_POLL_MS);
      if (runId !== state.paintRunId) return null;
      fresh = await readHqCharges();
      if (fresh && fresh.current !== previousReportedCharges) break;
    } while (Date.now() < deadline);
    if (!fresh) return null;
    state.hqReportedCharges = fresh.current;
    return resolveHqChargeCheckpoint(fresh.current);
  }

  function editorPixelFromClient(clientX, clientY) {
    const rect = editorSurfaceRect();
    if (!rect) return null;
    if (!rect.width || !rect.height) return null;
    const x = Math.floor(((clientX - rect.left) / rect.width) * state.width);
    const y = Math.floor(((clientY - rect.top) / rect.height) * state.height);
    if (x < 0 || y < 0 || x >= state.width || y >= state.height) return null;
    return { x, y };
  }

  function hqStageViewport() {
    if (state.editorKind !== "hq" || !state.root?.isConnected || !state.frame?.isConnected) {
      return null;
    }
    const rootRect = state.root.getBoundingClientRect();
    const frameWidth = Number.parseFloat(state.frame.style.width);
    const scale = frameWidth / state.width;
    if (!Number.isFinite(scale) || scale <= 0) return null;
    const transform = new DOMMatrixReadOnly(
      state.frame.style.transform || getComputedStyle(state.frame).transform,
    );
    return {
      rootLeft: rootRect.left,
      rootTop: rootRect.top,
      scale,
      translateX: transform.m41,
      translateY: transform.m42,
    };
  }

  function installTemplateColorPicker(root) {
    if (state.pickerRoot && state.pickerPointerHandler) {
      state.pickerRoot.removeEventListener("pointerdown", state.pickerPointerHandler, true);
      state.pickerRoot.removeEventListener("auxclick", state.pickerAuxHandler, true);
    }

    const chooseTemplateColor = (event) => {
      if (event.button !== 1 || !state.target) return;
      const pixel = editorPixelFromClient(event.clientX, event.clientY);
      if (!pixel) return;
      const color = paletteColorAt(state.target, pixel.x, pixel.y);
      if (!color) {
        setStatus(`Template pixel ${pixel.x}, ${pixel.y} is transparent.`, "warn");
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      selectPaletteColor(color, true);
    };
    const suppressAuxClick = (event) => {
      if (event.button !== 1 || !state.target) return;
      const pixel = editorPixelFromClient(event.clientX, event.clientY);
      if (!pixel || !paletteColorAt(state.target, pixel.x, pixel.y)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };

    state.pickerRoot = root;
    state.pickerPointerHandler = chooseTemplateColor;
    state.pickerAuxHandler = suppressAuxClick;
    root.addEventListener("pointerdown", chooseTemplateColor, true);
    root.addEventListener("auxclick", suppressAuxClick, true);
  }

  function installOverlayPaletteWatcher(root) {
    state.overlayPaletteObserver?.disconnect();
    state.overlayPaletteObserver = null;
    if (state.overlayPaletteRenderFrame) {
      cancelAnimationFrame(state.overlayPaletteRenderFrame);
      state.overlayPaletteRenderFrame = 0;
    }
    if (state.editorKind === "profile") return;

    const container = root.closest('[role="dialog"], dialog') || root.parentElement;
    if (!container) return;
    const isPaletteSwatch = (element) => element instanceof HTMLButtonElement
      && element.hasAttribute("aria-pressed")
      && Boolean(element.style.backgroundColor);
    const containsPaletteSwatch = (node) => {
      if (!(node instanceof Element)) return false;
      if (isPaletteSwatch(node)) return true;
      return [...node.querySelectorAll("button[aria-pressed]")].some(isPaletteSwatch);
    };
    const scheduleOverlayRender = () => {
      if (!state.overlaySelectedColorOnly || state.paintActive || state.overlayPaletteRenderFrame) {
        return;
      }
      state.overlayPaletteRenderFrame = requestAnimationFrame(() => {
        state.overlayPaletteRenderFrame = 0;
        requestAnimationFrame(renderOverlay);
      });
    };

    state.overlayPaletteObserver = new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === "attributes" && isPaletteSwatch(record.target)) {
          scheduleOverlayRender();
          return;
        }
        if (record.type === "childList" && [...record.addedNodes].some(containsPaletteSwatch)) {
          scheduleOverlayRender();
          return;
        }
      }
    });
    state.overlayPaletteObserver.observe(container, {
      attributes: true,
      attributeFilter: ["aria-pressed", "data-state", "data-selected", "class"],
      childList: true,
      subtree: true,
    });
  }

  function pixelMatchesColor(pixelData, index, color) {
    if (pixelData[index + 3] !== 255) return false;
    const redDelta = pixelData[index] - color.rgb[0];
    const greenDelta = pixelData[index + 1] - color.rgb[1];
    const blueDelta = pixelData[index + 2] - color.rgb[2];
    if (redDelta === 0 && greenDelta === 0 && blueDelta === 0) return true;
    return state.editorKind !== "profile"
      && redDelta ** 2 + greenDelta ** 2 + blueDelta ** 2 <= ALLIANCE_COLOR_TOLERANCE_SQUARED;
  }

  function canvasPixelDisposition(item) {
    try {
      const pixel = state.baseCanvas.getContext("2d", { willReadFrequently: true })
        .getImageData(item.x, item.y, 1, 1).data;
      if (pixelMatchesColor(pixel, 0, item.color)) return "matches";
      if (!state.fixWrongColors && pixel[3] !== 0) return "protected";
      return "paint";
    } catch (error) {
      console.warn(`${SCRIPT_ID}: could not read an editor pixel`, error);
      return "unreadable";
    }
  }

  function buildPaintQueue(onlyColor = null) {
    if (!state.target) return [];
    const buckets = new Map(
      state.editorKind !== "profile" ? activeAlliancePalette().map((color) => [colorKey(color), []]) : [],
    );
    let actual;
    try {
      actual = readEditorPixels().data;
    } catch (error) {
      console.warn(`${SCRIPT_ID}: could not read the editor canvas`, error);
      setStatus("Could not read the editor canvas.", "warn");
      return [];
    }

    for (let y = 0; y < state.height; y += 1) {
      for (let x = 0; x < state.width; x += 1) {
        const index = (y * state.width + x) * 4;
        if (state.target.data[index + 3] !== 255) continue;
        const color = editorColor(
          state.target.data[index], state.target.data[index + 1], state.target.data[index + 2],
        );
        if (!color) continue;
        if (onlyColor && colorKey(color) !== colorKey(onlyColor)) continue;
        const matches = pixelMatchesColor(actual, index, color);
        const disposition = matches
          ? "matching"
          : actual[index + 3] === 0
          ? "transparent"
          : "wrong-colour";
        if (shouldQueuePaintPixel(disposition, state.fixWrongColors)) {
          const key = colorKey(color);
          if (!buckets.has(key)) buckets.set(key, []);
          buckets.get(key).push({ x, y, color });
        }
      }
    }
    return [...buckets.values()].flatMap((bucket) => (
      orderPaintItems(bucket, state.paintPath, state.width, state.height)
    ));
  }

  function wait(milliseconds) {
    return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
  }

  async function waitForPaintArtboard(runId) {
    const isConnected = () => (
      state.root?.isConnected
      && (
        (state.editorKind === "alliance"
          && ALLIANCE_SIZES.has(editorKey())
          && state.baseCanvas?.isConnected)
        || (state.editorKind === "hq"
          && ENABLE_HQ_AUTO_PAINT
          && HQ_SIZES.has(state.width)
          && state.frame?.isConnected
          && state.tileLayer?.isConnected)
      )
    );
    if (isConnected()) return true;

    const deadline = Date.now() + ALLIANCE_REFRESH_GRACE_MS;
    setStatus("Wplace refreshed the artboard; waiting for it to return…");
    while (runId === state.paintRunId && Date.now() < deadline) {
      queueScan();
      await wait(50);
      if (isConnected()) {
        state.paintColor = null;
        setStatus("Artboard restored; continuing auto-paint…");
        return true;
      }
    }
    return false;
  }

  function visibleEnabledButtons(root, label) {
    return [...root.querySelectorAll("button")].filter((button) => (
      !button.disabled
      && button.getClientRects().length > 0
      && (
        button.textContent.trim() === label
        || button.getAttribute("aria-label") === label
      )
    ));
  }

  async function reopenAllianceEditorAfterRefresh(runId, refreshedRoot) {
    if (!refreshedRoot?.isConnected || !refreshedRoot.closest("dialog")) return false;
    const recycleRoot = refreshedRoot;
    setStatus("Wplace refreshed the artboard; resetting its editor session…");

    // An artboard replacement keeps Wplace's in-memory stroke history. Leave
    // and reopen the exact draft after Wplace forces a refresh to clear it.
    const editorChromeDeadline = Date.now() + ALLIANCE_REFRESH_GRACE_MS;
    let dialog = null;
    let backButton = null;
    while (runId === state.paintRunId && Date.now() < editorChromeDeadline) {
      dialog = recycleRoot.closest("dialog");
      const backButtons = dialog ? visibleEnabledButtons(dialog, "Back") : [];
      if (backButtons.length === 1) {
        backButton = backButtons[0];
        break;
      }
      await wait(50);
    }
    if (runId !== state.paintRunId || !dialog || !backButton) return false;

    captureAllianceViewport();
    const revision = dialog.textContent.match(/Revision\s+\d+/i)?.[0] || null;

    setStatus(
      "Reopening Wplace's editor after its forced refresh…",
    );
    backButton.click();

    const studioDeadline = Date.now() + ALLIANCE_REFRESH_GRACE_MS;
    let continueButton = null;
    while (runId === state.paintRunId && Date.now() < studioDeadline) {
      const candidates = [...dialog.querySelectorAll("button")].filter((button) => (
        !button.disabled
        && button.getClientRects().length > 0
        && button.textContent.includes("Continue painting")
      ));
      const revisionMatches = revision
        ? candidates.filter((button) => button.textContent.includes(revision))
        : [];
      if (revisionMatches.length === 1) continueButton = revisionMatches[0];
      else if (candidates.length === 1) continueButton = candidates[0];
      if (continueButton) break;
      await wait(50);
    }
    if (runId !== state.paintRunId || !continueButton) return false;
    continueButton.click();

    const editorDeadline = Date.now() + ALLIANCE_REFRESH_GRACE_MS;
    while (runId === state.paintRunId && Date.now() < editorDeadline) {
      queueScan();
      await wait(50);
      if (
        state.root !== recycleRoot
        && state.root?.isConnected
        && state.baseCanvas?.isConnected
        && state.editorKind === "alliance"
      ) {
        state.paintColor = null;
        setStatus("Wplace editor reset; continuing auto-paint…");
        return true;
      }
    }
    return false;
  }

  function withSyntheticPointerCapture(root, callback) {
    const originalDescriptor = root
      ? Object.getOwnPropertyDescriptor(root, "setPointerCapture")
      : null;
    const originalSetPointerCapture = root?.setPointerCapture;

    try {
      if (root && typeof originalSetPointerCapture === "function") {
        Object.defineProperty(root, "setPointerCapture", {
          configurable: true,
          value(pointerId) {
            try {
              return originalSetPointerCapture.call(this, pointerId);
            } catch (error) {
              if (pointerId === SYNTHETIC_POINTER_ID && error?.name === "NotFoundError") return;
              throw error;
            }
          },
        });
      }
      return callback();
    } finally {
      if (root && typeof originalSetPointerCapture === "function") {
        if (originalDescriptor) Object.defineProperty(root, "setPointerCapture", originalDescriptor);
        else delete root.setPointerCapture;
      }
    }
  }

  function dispatchPaintEvents(item) {
    const rect = editorSurfaceRect();
    const target = paintEventTarget();
    if (!rect?.width || !rect.height || !target) return false;
    let clientX;
    let clientY;
    if (state.editorKind === "hq") {
      const viewport = hqStageViewport();
      if (!viewport) return false;
      const client = hqClientPoint(item, viewport);
      const resolved = hqPixelFromClient(client, viewport);
      if (resolved.x !== item.x || resolved.y !== item.y) {
        state.paintFailureMessage = `HQ coordinate safety check rejected pixel ${item.x}, ${item.y}.`;
        return false;
      }
      clientX = client.x;
      clientY = client.y;
    } else {
      clientX = rect.left + ((item.x + 0.5) / state.width) * rect.width;
      clientY = rect.top + ((item.y + 0.5) / state.height) * rect.height;
    }
    const mouse = {
      bubbles: true,
      cancelable: true,
      composed: true,
      clientX,
      clientY,
      button: 0,
    };

    if (editorInputKind(state.editorKind) === "profile") {
      target.dispatchEvent(new pageWindow.MouseEvent("click", { ...mouse, buttons: 0 }));
      return true;
    }

    const pointer = {
      ...mouse,
      pointerId: SYNTHETIC_POINTER_ID,
      pointerType: "mouse",
      isPrimary: true,
    };

    return withSyntheticPointerCapture(state.root, () => {
      target.dispatchEvent(new pageWindow.PointerEvent("pointermove", { ...pointer, buttons: 0 }));
      target.dispatchEvent(new pageWindow.PointerEvent("pointerdown", { ...pointer, buttons: 1 }));
      target.dispatchEvent(new pageWindow.PointerEvent("pointerup", { ...pointer, buttons: 0 }));
      return true;
    });
  }

  async function dispatchPaintBatch(items, runId) {
    while (state.viewportRestoring) await nextFrame();
    if (!await waitForPaintArtboard(runId)) return { ok: false, dispatched: 0 };
    if (!preparePaintColor(items[0].color)) {
      return { ok: false, dispatched: 0, message: state.paintFailureMessage };
    }
    await wait(0);

    const dispatchedSurface = paintEventTarget();
    let dispatched = 0;
    for (const item of items) {
      if (runId !== state.paintRunId) return { ok: true, dispatched, stopped: true };
      if (state.editorKind === "hq") {
        if (!state.hqChargesRemaining || state.hqChargesRemaining <= 0) {
          return { ok: true, dispatched, outOfCharges: true };
        }
      }
      if (paintEventTarget() !== dispatchedSurface || !dispatchedSurface?.isConnected) {
        return { ok: true, dispatched, refreshed: true };
      }
      if (!dispatchPaintEvents(item)) {
        return {
          ok: false,
          dispatched,
          failedItem: item,
          message: state.paintFailureMessage,
        };
      }
      dispatched += 1;
      if (state.editorKind === "hq") state.hqChargesRemaining -= 1;
    }
    return { ok: true, dispatched };
  }

  function syncPaintControls() {
    const start = document.getElementById(`${PANEL_ID}-paint-start`);
    const pause = document.getElementById(`${PANEL_ID}-paint-pause`);
    const stop = document.getElementById(`${PANEL_ID}-paint-stop`);
    const interval = document.getElementById(`${PANEL_ID}-paint-interval`);
    const fixWrongColors = document.getElementById(`${PANEL_ID}-fix-wrong-colours`);
    const overlaySelectedColour = document.getElementById(`${PANEL_ID}-overlay-selected-colour`);
    const selectedColorOnly = document.getElementById(`${PANEL_ID}-selected-color-only`);
    const paintPath = document.getElementById(`${PANEL_ID}-paint-path`);
    const delay = document.getElementById(`${PANEL_ID}-paint-delay`);
    const label = document.getElementById(`${PANEL_ID}-paint-label`);
    const progress = document.getElementById(`${PANEL_ID}-progress`);
    if (start) {
      start.disabled = state.paintActive || state.templateMoveActive || !state.target;
      setButtonFace(start, "play", state.editorKind === "profile" ? "Fill draft" : "Auto-paint");
    }
    if (label) label.textContent = state.editorKind === "profile" ? "Draft fill" : "Auto-paint";
    if (pause) {
      pause.disabled = !state.paintActive;
      pause.innerHTML = icon(state.paintPaused ? "play" : "pause");
      const pauseLabel = state.paintPaused ? "Resume auto-paint" : "Pause auto-paint";
      pause.setAttribute("aria-label", pauseLabel);
      pause.title = pauseLabel;
    }
    if (stop) stop.disabled = !state.paintActive;
    if (interval) interval.checked = state.paintIntervalEnabled;
    if (fixWrongColors) {
      fixWrongColors.checked = state.fixWrongColors;
      fixWrongColors.disabled = state.paintActive;
    }
    if (overlaySelectedColour) overlaySelectedColour.disabled = state.paintActive;
    if (selectedColorOnly) {
      selectedColorOnly.checked = state.paintSelectedColorOnly;
      selectedColorOnly.disabled = state.paintActive;
    }
    if (paintPath) paintPath.disabled = state.paintActive;
    if (delay) {
      delay.disabled = !state.paintIntervalEnabled;
      if (document.activeElement !== delay) delay.value = String(state.paintDelay);
    }
    if (progress) {
      const ratio = state.paintQueue.length ? state.paintIndex / state.paintQueue.length : 0;
      progress.style.transform = `scaleX(${Math.max(0, Math.min(1, ratio))})`;
    }
  }

  function stopAutoFill(message = "Auto-paint stopped.") {
    state.paintRunId += 1;
    state.paintActive = false;
    state.paintPaused = false;
    state.paintQueue = [];
    state.paintIndex = 0;
    state.paintColor = null;
    state.paintFailureMessage = null;
    state.hqChargesRemaining = null;
    state.hqReportedCharges = null;
    syncPaintControls();
    if (message) setStatus(message);
  }

  async function stopAndCommitAutoFill() {
    if (!state.paintActive) return;
    const runId = state.paintRunId;
    state.paintPaused = true;
    syncPaintControls();
    const committed = await commitPaintSession(runId);
    if (runId !== state.paintRunId) return;
    stopAutoFill(
      committed
        ? "Auto-paint stopped; pending Wplace pixels were submitted."
        : "Auto-paint stopped, but Wplace's pending paint session could not be submitted.",
    );
  }

  async function startProfileFill(queue) {
    if (!await ensurePaintTool()) {
      setStatus("Could not activate Wplace's profile-picture Paint tool.", "warn");
      return;
    }

    const runId = ++state.paintRunId;
    state.paintQueue = queue;
    state.paintIndex = 0;
    state.paintActive = true;
    state.paintPaused = false;
    state.paintColor = null;
    syncPaintControls();
    setStatus(`Filling ${queue.length.toLocaleString()} local draft pixels…`);

    for (const item of queue) {
      if (runId !== state.paintRunId) return;
      if (!state.root?.isConnected || !state.baseCanvas?.isConnected) {
        stopAutoFill("The profile editor changed; fill stopped.");
        return;
      }
      const disposition = canvasPixelDisposition(item);
      if (disposition === "matches" || disposition === "protected") {
        state.paintIndex += 1;
        continue;
      }
      if (state.paintColor !== colorKey(item.color)) {
        if (!selectPaletteColor(item.color)) {
          stopAutoFill(`Could not select ${colorLabel(item.color)}; fill stopped.`);
          return;
        }
        await wait(0);
      }
      const selectedDisposition = canvasPixelDisposition(item);
      if (selectedDisposition === "matches" || selectedDisposition === "protected") {
        state.paintIndex += 1;
        continue;
      }
      if (!dispatchPaintEvents(item)) {
        stopAutoFill(`Could not paint pixel ${item.x}, ${item.y}; fill stopped.`);
        return;
      }
      state.paintIndex += 1;
    }

    await wait(0);
    if (runId !== state.paintRunId) return;
    state.paintActive = false;
    state.paintPaused = false;
    state.paintColor = null;
    syncPaintControls();
    renderOverlay();
    const remaining = buildPaintQueue();
    setStatus(
      remaining.length
        ? `Filled the local draft, but ${remaining.length.toLocaleString()} pixels could not be confirmed.`
        : `Filled ${queue.length.toLocaleString()} local draft pixels. Use Wplace's Save control to submit.`,
      remaining.length ? "warn" : "normal",
    );
  }

  async function startAutoFill() {
    if (state.paintActive) return;
    if (!state.target) {
      setStatus("Load a valid template first.", "warn");
      return;
    }
    const isAlliance = state.editorKind === "alliance"
      && state.root?.getAttribute("aria-label") === "Alliance asset canvas"
      && ALLIANCE_SIZES.has(editorKey());
    const isProfile = state.editorKind === "profile"
      && location.pathname.replace(/\/+$/, "") === "/profile-picture"
      && editorKey() === PROFILE_SIZE;
    const isHq = ENABLE_HQ_AUTO_PAINT
      && state.editorKind === "hq"
      && state.root?.getAttribute("aria-label") === "Headquarters canvas"
      && HQ_SIZES.has(state.width);
    if (!state.root?.isConnected || (!isAlliance && !isProfile && !isHq)) {
      setStatus("Auto-paint is only available inside a supported Wplace asset editor.", "warn");
      return;
    }

    const hqCharges = isHq ? await readHqCharges() : null;
    if (isHq && (!hqCharges || hqCharges.current <= 0)) {
      setStatus(
        hqCharges ? "HQ charges are empty; auto-paint did not start." : "Could not read the HQ charge counter.",
        "warn",
      );
      return;
    }
    const hqPaintSessionWasActive = isHq && paintSessionActive();
    const hqTilesBeforePaint = isHq && !hqPaintSessionWasActive
      ? hqTilePixelSignature()
      : undefined;
    if (!isProfile && !await ensurePaintTool()) {
      setStatus(`Could not activate Wplace's ${isHq ? "HQ" : "alliance"} Paint tool.`, "warn");
      return;
    }
    if (isHq) {
      setStatus("Waiting for Wplace's HQ tiles to finish rendering…");
      if (!await waitForHqTilesToSettle(hqTilesBeforePaint)) {
        setStatus("Wplace's HQ tiles did not finish rendering; auto-paint did not start.", "warn");
        return;
      }
    }
    const paletteEditor = isAlliance || isHq;
    const lockedColor = paletteEditor && state.paintSelectedColorOnly
      ? readSelectedPaletteColor(state.root)
      : null;
    if (paletteEditor && state.paintSelectedColorOnly && !lockedColor) {
      setStatus("Select a Wplace palette color before starting selected-color auto-paint.", "warn");
      return;
    }
    const queue = buildPaintQueue(lockedColor);
    if (!queue.length) {
      setStatus(
        lockedColor
          ? `No ${colorLabel(lockedColor)} template pixels need painting.`
          : !state.fixWrongColors
          ? "No transparent editor pixels need painting. Existing colours were left unchanged."
          : "This asset already matches the template.",
      );
      return;
    }
    if (isProfile) {
      await startProfileFill(queue);
      return;
    }

    const runId = ++state.paintRunId;
    state.paintQueue = queue;
    state.paintIndex = 0;
    state.paintActive = true;
    state.paintPaused = false;
    state.paintColor = null;
    state.paintFailureMessage = null;
    state.hqChargesRemaining = hqCharges?.current ?? null;
    state.hqReportedCharges = hqCharges?.current ?? null;
    syncPaintControls();
    let dispatchedCount = 0;
    let dispatchedSinceRecycle = 0;
    let paintEditorRoot = state.root;

    while (state.paintIndex < state.paintQueue.length && runId === state.paintRunId) {
      while (state.paintPaused && runId === state.paintRunId) await wait(100);
      if (runId !== state.paintRunId) return;
      if (!await waitForPaintArtboard(runId)) {
        if (runId !== state.paintRunId) return;
        stopAutoFill("Wplace did not restore the paint artboard; auto-paint stopped.");
        return;
      }
      if (state.root !== paintEditorRoot || !paintEditorRoot?.isConnected) {
        if (isAlliance && !state.paintIntervalEnabled) {
          const reopened = await reopenAllianceEditorAfterRefresh(runId, state.root);
          if (runId !== state.paintRunId) return;
          if (!reopened) {
            state.paintPaused = true;
            syncPaintControls();
            setStatus(
              "Could not reopen Wplace's refreshed editor. Paused; use Resume to retry.",
              "warn",
            );
            continue;
          }
        }
        state.paintColor = null;
        paintEditorRoot = state.root;
      }
      const item = state.paintQueue[state.paintIndex];
      const batch = [];
      const batchColor = colorKey(item.color);
      const batchLimit = state.paintIntervalEnabled || isHq ? 1 : UNPACED_BATCH_SIZE;
      for (
        let index = state.paintIndex;
        index < state.paintQueue.length && batch.length < batchLimit;
        index += 1
      ) {
        const candidate = state.paintQueue[index];
        if (colorKey(candidate.color) !== batchColor) break;
        batch.push(candidate);
      }
      const result = await dispatchPaintBatch(batch, runId);
      if (runId !== state.paintRunId || result.stopped) return;
      if (result.dispatched) {
        dispatchedCount += result.dispatched;
        dispatchedSinceRecycle += result.dispatched;
        state.paintIndex += result.dispatched;
      }
      if (result.outOfCharges) {
        await nextFrame();
        const hadPendingPixels = paintSessionHasPendingPixels();
        const committed = await commitPaintSession(runId);
        if (runId !== state.paintRunId) return;
        if (!committed) {
          state.paintPaused = true;
          syncPaintControls();
          setStatus("Could not submit Wplace's pending HQ paint session. Paused; use Resume to retry.", "warn");
          continue;
        }
        const checkpoint = hadPendingPixels
          ? await refreshHqChargeBudget(runId)
          : resolveHqChargeCheckpoint(state.hqReportedCharges ?? 0);
        if (runId !== state.paintRunId) return;
        if (!checkpoint) {
          state.paintPaused = true;
          syncPaintControls();
          setStatus("Could not refresh Wplace's HQ charge counter. Paused; use Resume to retry.", "warn");
          continue;
        }
        if (checkpoint.exhausted) {
          stopAutoFill("HQ charges exhausted; auto-paint stopped.");
          return;
        }
        state.hqChargesRemaining = checkpoint.nextDispatchBudget;
        setStatus(
          `Wplace reports ${checkpoint.nextDispatchBudget.toLocaleString()} HQ charges remaining; continuing…`,
        );
        if (!await ensurePaintTool(runId)) {
          if (runId !== state.paintRunId) return;
          state.paintPaused = true;
          syncPaintControls();
          setStatus("Could not reopen Wplace's HQ Paint tool. Paused; use Resume to retry.", "warn");
        }
        continue;
      }
      if (result.refreshed) continue;
      if (!result.ok) {
        state.paintPaused = true;
        syncPaintControls();
        const failed = result.failedItem || state.paintQueue[state.paintIndex] || item;
        setStatus(
          result.message
            || `Could not dispatch the paint event near pixel ${failed.x}, ${failed.y}. Paused; use Resume to retry.`,
          "warn",
        );
        continue;
      }
      syncPaintControls();
      setStatus(
        `Auto-paint ${state.paintIndex.toLocaleString()} / ${state.paintQueue.length.toLocaleString()} · `
        + `${dispatchedCount.toLocaleString()} events dispatched.`,
      );
      if (state.paintIntervalEnabled) await wait(state.paintDelay);

      if (isAlliance && shouldRecycleAllianceEditor({
        dispatchedSinceRecycle,
        intervalEnabled: state.paintIntervalEnabled,
        queueRemaining: state.paintQueue.length - state.paintIndex,
      })) {
        setStatus(
          `Painted ${ALLIANCE_EDITOR_RECYCLE_EVENTS.toLocaleString()} pixels; `
          + "submitting this Wplace paint session…",
        );
        const committed = await commitPaintSession(runId);
        if (runId !== state.paintRunId) return;
        if (!committed) {
          state.paintPaused = true;
          syncPaintControls();
          setStatus(
            "Could not submit Wplace's pending paint session. Paused; use Resume to retry.",
            "warn",
          );
          continue;
        }
        setStatus("Wplace session submitted; opening a fresh paint session…");
        const reopened = await ensurePaintTool(runId);
        if (runId !== state.paintRunId) return;
        if (!reopened) {
          state.paintPaused = true;
          syncPaintControls();
          setStatus("Could not open a fresh Wplace paint session. Paused; use Resume to retry.", "warn");
          continue;
        }
        dispatchedSinceRecycle = 0;
        state.paintColor = null;
        paintEditorRoot = state.root;
      }
    }

    if (runId === state.paintRunId) {
      const committed = await commitPaintSession(runId);
      if (runId !== state.paintRunId) return;
      if (!committed) {
        state.paintPaused = true;
        syncPaintControls();
        setStatus("Could not submit Wplace's pending paint session. Paused; use Resume to retry.", "warn");
        return;
      }
      state.paintActive = false;
      state.paintPaused = false;
      state.paintColor = null;
      state.paintFailureMessage = null;
      syncPaintControls();
      refreshOverlayAfterPaint();
      setStatus(
        `Auto-paint complete: ${dispatchedCount.toLocaleString()} events dispatched. `
        + "Use Refresh or start Auto-paint again to rescan the canvas.",
      );
    }
  }

  function syncControls() {
    const opacity = document.getElementById(`${PANEL_ID}-opacity`);
    const opacityValue = document.getElementById(`${PANEL_ID}-opacity-value`);
    const displayMode = document.getElementById(`${PANEL_ID}-display-mode`);
    const mismatch = document.getElementById(`${PANEL_ID}-mismatch`);
    const overlaySelectedColour = document.getElementById(`${PANEL_ID}-overlay-selected-colour`);
    const fixWrongColors = document.getElementById(`${PANEL_ID}-fix-wrong-colours`);
    const selectedColorOnly = document.getElementById(`${PANEL_ID}-selected-color-only`);
    const paintPath = document.getElementById(`${PANEL_ID}-paint-path`);
    const preserveView = document.getElementById(`${PANEL_ID}-preserve-view`);
    const visibility = document.getElementById(`${PANEL_ID}-visibility`);
    const title = document.getElementById(`${PANEL_ID}-title`);
    const size = document.getElementById(`${PANEL_ID}-size`);
    const source = document.getElementById(`${PANEL_ID}-source`);
    const templateX = document.getElementById(`${PANEL_ID}-template-x`);
    const templateY = document.getElementById(`${PANEL_ID}-template-y`);
    const templateCenter = document.getElementById(`${PANEL_ID}-template-center`);
    const templateMove = document.getElementById(`${PANEL_ID}-template-move`);
    const load = document.getElementById(`${PANEL_ID}-load`);
    const clear = document.getElementById(`${PANEL_ID}-clear`);
    if (opacity) opacity.value = String(Math.round(state.opacity * 100));
    if (opacityValue) opacityValue.textContent = `${Math.round(state.opacity * 100)}%`;
    if (displayMode) displayMode.value = state.displayMode;
    if (mismatch) mismatch.checked = state.mismatchesOnly;
    if (overlaySelectedColour) overlaySelectedColour.checked = state.overlaySelectedColorOnly;
    if (fixWrongColors) fixWrongColors.checked = state.fixWrongColors;
    if (selectedColorOnly) selectedColorOnly.checked = state.paintSelectedColorOnly;
    if (paintPath) {
      paintPath.value = state.paintPath;
      paintPath.disabled = state.paintActive;
    }
    if (preserveView) preserveView.checked = state.preserveView;
    if (visibility) {
      setButtonFace(
        visibility,
        state.hidden ? "visibilityOff" : "visibility",
        state.hidden ? "Show" : "Hide",
      );
      visibility.disabled = !state.target;
    }
    if (title) title.textContent = state.editorKind === "hq" ? "HQ template" : "Template";
    // Badge carries the fixed constraint (the canvas), the line below it carries
    // what the user chose (the file), so the two facts stop reading as one.
    if (size) size.textContent = `${state.width} × ${state.height}`;
    if (source) {
      if (state.target) {
        source.textContent = state.editorKind === "hq"
          ? `${state.sourceName} · ${state.templateWidth} × ${state.templateHeight}`
          : state.sourceName;
      } else {
        source.textContent = state.editorKind === "profile"
          ? "Load any 8-bit RGB PNG"
          : state.editorKind === "hq"
          ? "Load a PNG up to canvas size"
          : "Load an exact-palette PNG";
      }
    }
    const maxTemplateX = Math.max(0, state.width - state.templateWidth);
    const maxTemplateY = Math.max(0, state.height - state.templateHeight);
    if (templateX) {
      templateX.max = String(maxTemplateX);
      templateX.value = String(
        state.templateMoveActive ? state.templateMoveDraftX : state.templateOffsetX,
      );
      templateX.disabled = !state.target || state.paintActive;
    }
    if (templateY) {
      templateY.max = String(maxTemplateY);
      templateY.value = String(
        state.templateMoveActive ? state.templateMoveDraftY : state.templateOffsetY,
      );
      templateY.disabled = !state.target || state.paintActive;
    }
    if (templateCenter) templateCenter.disabled = !state.target || state.paintActive;
    if (load) {
      load.disabled = state.templateMoveActive;
      // One focal point: Load leads until there is something to paint.
      load.className = state.target ? "btn btn-sm gap-1" : "btn btn-primary btn-sm gap-1";
    }
    if (clear) clear.disabled = state.templateMoveActive || !state.target;
    if (templateMove) templateMove.disabled = !state.target
      || state.paintActive
      || state.hidden
      || state.templateMoveActive;
    syncPaintControls();
    syncTemplateMoveUi();
  }

  async function loadFile(file) {
    if (!file) {
      setStatus("Choose a PNG file.", "warn");
      return;
    }
    try {
      if (state.templateMoveActive) cancelTemplateMove();
      setStatus("Reading raw PNG pixels…");
      const imageData = await decodePngSamples(
        file,
        state.width,
        state.height,
        state.editorKind === "hq",
      );
      const validationError = validateTemplate(imageData);
      if (validationError) {
        setStatus(validationError, "warn");
        return;
      }
      state.sourceName = file.name.replace(/\.[^.]+$/, "") || "reference";
      state.templateSource = imageData;
      state.templateWidth = imageData.width;
      state.templateHeight = imageData.height;
      const placed = placeTemplateOnEditor(imageData);
      state.templateOffsetX = placed.offsetX;
      state.templateOffsetY = placed.offsetY;
      state.target = placed.imageData;
      if (state.editorKind === "hq") await writeLargeTemplate(storageKey(), file);
      persistTarget();
      syncControls();
      renderOverlay();
    } catch (error) {
      console.warn(`${SCRIPT_ID}: unable to decode PNG samples`, error);
      setStatus(error instanceof Error ? error.message : "Could not read that PNG.", "warn");
    }
  }

  function clearTarget() {
    if (state.templateMoveActive) cancelTemplateMove();
    stopAutoFill(null);
    state.target = null;
    state.templateSource = null;
    state.templateWidth = 0;
    state.templateHeight = 0;
    state.templateOffsetX = 0;
    state.templateOffsetY = 0;
    localStorage.removeItem(storageKey());
    if (state.editorKind === "hq") {
      deleteLargeTemplate(storageKey()).catch((error) => {
        console.warn(`${SCRIPT_ID}: unable to clear the saved HQ template`, error);
      });
    }
    syncControls();
    renderOverlay();
    setStatus("Template cleared.");
  }

  function injectStyles() {
    if (document.getElementById(`${SCRIPT_ID}-style`)) return;
    const style = document.createElement("style");
    style.id = `${SCRIPT_ID}-style`;
    style.textContent = `
      #${PANEL_ID} {
        position: relative;
        z-index: 2;
        container-type: inline-size;
      }
      #${PANEL_ID}[data-editor="profile"] {
        margin-top: 0;
        margin-bottom: 0.5rem;
      }
      #${PANEL_ID}[data-fullscreen="true"] {
        position: fixed;
        top: 5rem;
        left: 1rem;
        z-index: 45;
        width: min(27rem, calc(100vw - 2rem));
        max-height: calc(100dvh - 6rem);
        margin: 0;
        overflow: hidden;
        box-shadow: 0 18px 50px rgb(0 0 0 / 0.24);
      }
      #${PANEL_ID}[data-fullscreen="true"] .waa-collapsible {
        max-height: calc(100dvh - 11rem);
        overflow-y: auto;
        overscroll-behavior: contain;
      }
      #${PANEL_ID}[data-fullscreen="true"][data-collapsed="true"] {
        width: min(24rem, calc(100vw - 2rem));
      }
      #${PANEL_ID}[data-collapsed="true"] .waa-collapsible { display: none; }
      #${PANEL_ID} .waa-groups { column-gap: 2rem; row-gap: 1rem; }
      #${PANEL_ID} .waa-group { flex: 0 1 19rem; min-width: 13rem; }
      #${PANEL_ID} .waa-group-wide { flex-basis: 24rem; }
      #${PANEL_ID} .waa-range { max-width: 15rem; }
      #${PANEL_ID} .waa-value { min-width: 2.75rem; text-align: right; }
      #${PANEL_ID} .waa-select { width: auto; max-width: 100%; align-self: flex-start; }
      #${PANEL_ID} .waa-number { width: 4.5rem; }
      #${PANEL_ID} .waa-coord { width: 4.75rem; }
      #${PANEL_ID} .waa-file { display: none; }
      /* .waa-alliance: only the alliance artboard gets replaced mid-run.
         .waa-paced: surfaces that dispatch through the paced loop.
         .waa-palette: surfaces that paint from a Wplace palette. */
      #${PANEL_ID}:not([data-editor="alliance"]) .waa-alliance { display: none; }
      #${PANEL_ID}[data-editor="profile"] .waa-paced { display: none; }
      #${PANEL_ID}[data-editor="profile"] .waa-palette { display: none; }
      #${PANEL_ID}:not([data-editor="profile"]) .waa-profile { display: none; }
      #${PANEL_ID} .waa-profile { flex-basis: 100%; }
      #${PANEL_ID}:not([data-editor="hq"]) .waa-hq { display: none; }
      #${PANEL_ID}[data-editor="hq"][data-hq-auto-paint="false"] .waa-paint { display: none; }
      #${PANEL_ID} .waa-progress {
        position: relative;
        height: 2px;
        margin: 0.75rem -0.75rem 0;
        overflow: hidden;
      }
      #${PANEL_ID} .waa-progress::before {
        content: "";
        position: absolute;
        inset: 0;
        background: currentColor;
        opacity: 0.1;
      }
      #${PANEL_ID} .waa-progress > span {
        position: absolute;
        inset: 0;
        transform: scaleX(0);
        transform-origin: left;
        background: var(--color-primary, currentColor);
      }
      @media (prefers-reduced-motion: no-preference) {
        #${PANEL_ID} .waa-progress > span {
          transition: transform 180ms cubic-bezier(0.23, 1, 0.32, 1);
        }
      }
      @container (max-width: 34rem) {
        #${PANEL_ID} .waa-group { flex-basis: 100%; }
        #${PANEL_ID} .waa-group-wide { flex-basis: 100%; }
        /* Truncation hides most of the message at phone width; let it wrap. */
        #${PANEL_ID} .waa-status { overflow: visible; text-overflow: clip; white-space: normal; }
      }
      .${MOVE_TOOLBAR_CLASS} {
        position: fixed;
        z-index: 2147483646;
        transform: translate(-50%, calc(-100% - 0.5rem));
      }
      .${MOVE_TOOLBAR_CLASS}[hidden] { display: none; }
    `;
    document.head.append(style);
  }

  function buildPanel(root) {
    document.getElementById(PANEL_ID)?.remove();
    const panel = document.createElement("section");
    panel.id = PANEL_ID;
    panel.dataset.collapsed = String(state.collapsed);
    panel.dataset.editor = state.editorKind;
    panel.dataset.hqAutoPaint = String(ENABLE_HQ_AUTO_PAINT);
    panel.dataset.version = SCRIPT_VERSION;
    panel.className = "border-base-200 bg-base-100 mt-3 shrink-0 rounded-2xl border p-3";
    syncPanelLayout(panel, root);
    panel.innerHTML = `
      <div class="waa-head flex flex-wrap items-center gap-2">
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2">
            <p class="truncate text-sm font-semibold" id="${PANEL_ID}-title">Template</p>
            <span class="badge badge-sm shrink-0 tabular-nums" id="${PANEL_ID}-size"></span>
          </div>
          <p class="text-base-content/85 truncate text-xs" id="${PANEL_ID}-source"></p>
        </div>
        <div class="flex items-center gap-1">
          <button class="btn btn-sm gap-1" id="${PANEL_ID}-load" type="button">
            ${icon("upload")}<span>Load PNG</span>
          </button>
          <input class="waa-file" id="${PANEL_ID}-file" type="file" accept="image/png" tabindex="-1" aria-hidden="true">
          <button class="btn btn-ghost btn-sm btn-circle" id="${PANEL_ID}-clear" type="button" aria-label="Remove template">
            ${icon("delete")}
          </button>
          <button class="btn btn-ghost btn-sm btn-circle" id="${PANEL_ID}-collapse" type="button" aria-expanded="true" aria-label="Collapse template controls">
            ${icon("expandLess")}
          </button>
        </div>
      </div>

      <div class="waa-collapsible">
        <div class="waa-groups mt-3 flex flex-wrap">
          <section class="waa-hq waa-group flex flex-col gap-2">
            <span class="text-base-content/85 text-[11px] font-medium tracking-wide uppercase">Position</span>
            <div class="flex items-center gap-1.5">
              <label class="text-base-content/85 text-xs" for="${PANEL_ID}-template-x">X</label>
              <input class="input input-xs waa-coord tabular-nums" id="${PANEL_ID}-template-x" type="number" min="0" step="1" value="0" aria-label="Template X coordinate">
              <label class="text-base-content/85 text-xs" for="${PANEL_ID}-template-y">Y</label>
              <input class="input input-xs waa-coord tabular-nums" id="${PANEL_ID}-template-y" type="number" min="0" step="1" value="0" aria-label="Template Y coordinate">
            </div>
            <div class="flex items-center gap-1">
              <button class="btn btn-sm gap-1" id="${PANEL_ID}-template-move" type="button" aria-pressed="false">
                ${icon("openWith")}<span>Move</span>
              </button>
              <button class="btn btn-ghost btn-sm gap-1" id="${PANEL_ID}-template-center" type="button">
                ${icon("center")}<span>Center</span>
              </button>
            </div>
          </section>

          <section class="waa-group flex flex-col gap-2">
            <span class="text-base-content/85 text-[11px] font-medium tracking-wide uppercase">Overlay</span>
            <div class="flex items-center gap-2">
              <input class="waa-range range range-xs range-primary min-w-0 flex-1" id="${PANEL_ID}-opacity" type="range" min="5" max="100" step="5" value="55" aria-label="Overlay opacity">
              <span class="waa-value text-base-content/85 text-xs tabular-nums" id="${PANEL_ID}-opacity-value">55%</span>
              <button class="btn btn-ghost btn-xs gap-1" id="${PANEL_ID}-visibility" type="button">
                ${icon("visibility")}<span>Hide</span>
              </button>
            </div>
            <div class="flex flex-wrap items-center gap-x-3 gap-y-2">
              <select class="select select-xs waa-select" id="${PANEL_ID}-display-mode" aria-label="Template pixel size" title="How much of each template pixel is drawn">
                <option value="full">Full pixel</option>
                <option value="center">Center third</option>
              </select>
              <label class="flex cursor-pointer items-center gap-1.5" title="Hide template pixels that already match the editor canvas">
                <input class="toggle toggle-xs" id="${PANEL_ID}-mismatch" type="checkbox">
                <span class="text-base-content/85 text-xs">Only differences</span>
              </label>
              <label class="waa-palette flex cursor-pointer items-center gap-1.5" title="Show only template pixels matching Wplace's selected paint colour">
                <input class="toggle toggle-xs" id="${PANEL_ID}-overlay-selected-colour" type="checkbox">
                <span class="text-base-content/85 text-xs">Only selected colour</span>
              </label>
            </div>
            <label class="waa-alliance flex cursor-pointer items-center gap-1.5" title="Restore zoom and canvas position when Wplace replaces the artboard">
              <input class="toggle toggle-xs" id="${PANEL_ID}-preserve-view" type="checkbox">
              <span class="text-base-content/85 text-xs">Keep zoom and position</span>
            </label>
          </section>

          <section class="waa-paint waa-group waa-group-wide flex flex-col gap-2">
            <span class="text-base-content/85 text-[11px] font-medium tracking-wide uppercase" id="${PANEL_ID}-paint-label">Auto-paint</span>
            <div class="flex items-center gap-1">
              <button class="btn btn-primary btn-sm gap-1" id="${PANEL_ID}-paint-start" type="button">
                ${icon("play")}<span>Auto-paint</span>
              </button>
              <button class="waa-paced btn btn-soft btn-sm btn-square" id="${PANEL_ID}-paint-pause" type="button" aria-label="Pause auto-paint" disabled>
                ${icon("pause")}
              </button>
              <button class="waa-paced btn btn-soft btn-sm btn-square" id="${PANEL_ID}-paint-stop" type="button" aria-label="Stop auto-paint" disabled>
                ${icon("stop")}
              </button>
            </div>
            <div class="flex flex-wrap items-center gap-x-3 gap-y-2">
              <select class="select select-xs waa-select" id="${PANEL_ID}-paint-path" aria-label="Paint order" title="Spatial order used within each color">
                <option value="start-end">Start &rarr; end</option>
                <option value="end-start">End &rarr; start</option>
                <option value="middle-out">Middle &rarr; out</option>
                <option value="edge-in">Edge &rarr; in</option>
                <option value="zigzag">Zigzag</option>
                <option value="hilbert">Hilbert curve</option>
              </select>
              <div class="waa-paced flex items-center gap-1.5">
                <label class="flex cursor-pointer items-center gap-1.5" title="Wait between dispatched paint events">
                  <input class="toggle toggle-xs" id="${PANEL_ID}-paint-interval" type="checkbox" checked>
                  <span class="text-base-content/85 text-xs">Delay</span>
                </label>
                <input class="input input-xs waa-number tabular-nums" id="${PANEL_ID}-paint-delay" type="number" min="1" max="5000" step="1" value="150" aria-label="Delay between paint events in milliseconds">
                <span class="text-base-content/85 text-xs">ms</span>
              </div>
            </div>
            <div class="flex flex-wrap items-center gap-x-4 gap-y-2">
              <label class="flex cursor-pointer items-center gap-1.5" title="Correct template pixels that already have a different colour">
                <input class="toggle toggle-xs" id="${PANEL_ID}-fix-wrong-colours" type="checkbox" checked>
                <span class="text-base-content/85 text-xs">Fix wrong colours</span>
              </label>
              <label class="waa-palette flex cursor-pointer items-center gap-1.5" title="Paint only template pixels matching the Wplace color selected when auto-paint starts">
                <input class="toggle toggle-xs" id="${PANEL_ID}-selected-color-only" type="checkbox">
                <span class="text-base-content/85 text-xs">Only selected color</span>
              </label>
              <span class="waa-profile text-base-content/85 text-xs">Wplace&rsquo;s Save submits the draft</span>
            </div>
          </section>
        </div>

        <div class="waa-progress" aria-hidden="true"><span id="${PANEL_ID}-progress"></span></div>
        <div class="flex items-center gap-2 pt-2">
          <span class="text-base-content/70 shrink-0" id="${PANEL_ID}-status-icon">${icon("info")}</span>
          <p class="waa-status text-base-content min-w-0 flex-1 truncate text-xs" id="${PANEL_ID}-status" role="status" aria-live="polite"></p>
          <button class="btn btn-ghost btn-xs gap-1 shrink-0" id="${PANEL_ID}-refresh" type="button" title="Re-read Wplace's canvas and redraw the overlay">
            ${icon("refresh", "size-3.5")}<span>Refresh</span>
          </button>
        </div>
      </div>
    `;

    for (const eventName of ["pointerdown", "pointerup", "mousedown", "mouseup", "click", "wheel"]) {
      panel.addEventListener(eventName, (event) => event.stopPropagation());
    }

    const fileInput = panel.querySelector(`#${PANEL_ID}-file`);
    panel.querySelector(`#${PANEL_ID}-load`).addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", () => {
      loadFile(fileInput.files?.[0]);
      fileInput.value = "";
    });
    panel.querySelector(`#${PANEL_ID}-opacity`).addEventListener("input", (event) => {
      state.opacity = Number(event.target.value) / 100;
      panel.querySelector(`#${PANEL_ID}-opacity-value`).textContent = `${event.target.value}%`;
      if (state.overlayCanvas) state.overlayCanvas.style.opacity = String(state.opacity);
      persistTarget();
    });
    panel.querySelector(`#${PANEL_ID}-visibility`).addEventListener("click", () => {
      if (state.templateMoveActive) cancelTemplateMove();
      state.hidden = !state.hidden;
      syncControls();
      renderOverlay();
    });
    panel.querySelector(`#${PANEL_ID}-display-mode`).addEventListener("change", (event) => {
      state.displayMode = event.target.value === "center" ? "center" : "full";
      persistTarget();
      renderOverlay();
    });
    panel.querySelector(`#${PANEL_ID}-mismatch`).addEventListener("change", (event) => {
      state.mismatchesOnly = event.target.checked;
      persistTarget();
      renderOverlay();
    });
    panel.querySelector(`#${PANEL_ID}-overlay-selected-colour`).addEventListener("change", (event) => {
      state.overlaySelectedColorOnly = event.target.checked;
      persistTarget();
      renderOverlay();
    });
    panel.querySelector(`#${PANEL_ID}-fix-wrong-colours`).addEventListener("change", (event) => {
      state.fixWrongColors = event.target.checked;
      persistTarget();
      setStatus(
        state.fixWrongColors
          ? "Auto-paint will fill transparent pixels and correct colours that differ."
          : "Auto-paint will fill transparent pixels and leave existing colours unchanged.",
      );
    });
    panel.querySelector(`#${PANEL_ID}-selected-color-only`).addEventListener("change", (event) => {
      state.paintSelectedColorOnly = event.target.checked;
      persistSettings();
      setStatus(
        state.paintSelectedColorOnly
          ? "Auto-paint will use only the currently selected Wplace color and will not change swatches."
          : "Auto-paint will select each required Wplace color automatically.",
      );
    });
    panel.querySelector(`#${PANEL_ID}-paint-path`).addEventListener("change", (event) => {
      state.paintPath = event.target.value;
      persistSettings();
      setStatus(`Auto-paint path set to ${event.target.selectedOptions[0].textContent}.`);
    });
    panel.querySelector(`#${PANEL_ID}-preserve-view`).addEventListener("change", (event) => {
      state.preserveView = event.target.checked;
      if (state.preserveView) captureAllianceViewport();
      persistSettings();
      setStatus(
        state.preserveView
          ? "Zoom and canvas position will be restored after Wplace refreshes the artboard."
          : "Wplace may reset zoom and canvas position after painting.",
      );
    });
    panel.querySelector(`#${PANEL_ID}-refresh`).addEventListener("click", renderOverlay);
    panel.querySelector(`#${PANEL_ID}-clear`).addEventListener("click", clearTarget);
    const templateX = panel.querySelector(`#${PANEL_ID}-template-x`);
    const templateY = panel.querySelector(`#${PANEL_ID}-template-y`);
    const applyTemplatePosition = () => {
      if (templateX.value === "" || templateY.value === "") return;
      const x = Number(templateX.value);
      const y = Number(templateY.value);
      if (state.templateMoveActive) previewTemplateMove(x, y);
      else positionTemplate(x, y);
    };
    templateX.addEventListener("input", applyTemplatePosition);
    templateY.addEventListener("input", applyTemplatePosition);
    panel.querySelector(`#${PANEL_ID}-template-center`).addEventListener("click", () => {
      if (!state.templateSource) return;
      const centered = resolveTemplatePosition(
        state.width,
        state.height,
        state.templateSource.width,
        state.templateSource.height,
      );
      if (state.templateMoveActive) previewTemplateMove(centered.x, centered.y);
      else positionTemplate(centered.x, centered.y);
    });
    panel.querySelector(`#${PANEL_ID}-template-move`).addEventListener("click", beginTemplateMove);
    panel.querySelector(`#${PANEL_ID}-paint-interval`).addEventListener("change", (event) => {
      state.paintIntervalEnabled = event.target.checked;
      persistSettings();
      syncPaintControls();
      setStatus(
        state.paintIntervalEnabled
          ? `Auto-paint interval enabled at ${state.paintDelay} ms.`
          : "Auto-paint interval disabled; paint events will run without an added delay.",
      );
    });
    panel.querySelector(`#${PANEL_ID}-paint-delay`).addEventListener("change", (event) => {
      state.paintDelay = Math.max(1, Math.min(5000, Number(event.target.value) || 150));
      event.target.value = String(state.paintDelay);
      persistSettings();
    });
    panel.querySelector(`#${PANEL_ID}-paint-start`).addEventListener("click", startAutoFill);
    panel.querySelector(`#${PANEL_ID}-paint-pause`).addEventListener("click", () => {
      if (!state.paintActive) return;
      state.paintPaused = !state.paintPaused;
      syncPaintControls();
      setStatus(state.paintPaused ? "Auto-paint paused." : "Auto-paint resumed.");
    });
    panel.querySelector(`#${PANEL_ID}-paint-stop`).addEventListener("click", () => {
      void stopAndCommitAutoFill();
    });
    panel.querySelector(`#${PANEL_ID}-collapse`).addEventListener("click", () => {
      state.collapsed = !state.collapsed;
      persistSettings();
      syncCollapse(panel);
    });

    // Above the editor on every surface, between Wplace's header and its canvas.
    root.before(panel);
    syncCollapse(panel);
    syncControls();
    setStatus(state.statusMessage, state.statusKind);
  }

  function syncCollapse(panel) {
    const collapse = panel.querySelector(`#${PANEL_ID}-collapse`);
    const label = state.collapsed ? "Expand template controls" : "Collapse template controls";
    panel.dataset.collapsed = String(state.collapsed);
    collapse.innerHTML = icon(state.collapsed ? "expandMore" : "expandLess");
    collapse.setAttribute("aria-expanded", String(!state.collapsed));
    collapse.setAttribute("aria-label", label);
    collapse.title = label;
  }

  async function attach(editor) {
    const sameAsset = Boolean(state.root)
      && state.editorKind === editor.kind
      && state.width === editor.width
      && state.height === editor.height;
    const changedEditor = state.root !== editor.root
      || state.baseCanvas !== editor.baseCanvas
      || state.tileLayer !== (editor.tileLayer || null)
      || state.editorKind !== editor.kind
      || state.width !== editor.width
      || state.height !== editor.height;
    const existingPanel = document.getElementById(PANEL_ID);
    syncPanelLayout(existingPanel, editor.root);
    if (!changedEditor && existingPanel && state.overlayCanvas?.isConnected) return;

    if (state.paintActive && !sameAsset) stopAutoFill("The asset editor changed; auto-paint stopped.");
    if (changedEditor && state.templateMoveActive) finishTemplateMoveState();
    if (sameAsset) state.paintColor = null;

    state.editorKind = editor.kind;
    state.root = editor.root;
    state.frame = editor.frame;
    state.baseCanvas = editor.baseCanvas;
    state.tileLayer = editor.tileLayer || null;
    state.width = editor.width;
    state.height = editor.height;
    state.paletteColors = [...alliancePalette(editor.root)];
    state.viewportRestoring = true;
    try {
      await restorePreservedViewport(editor.root, editor.frame);
    } finally {
      state.viewportRestoring = false;
    }
    state.overlayCanvas = makeOverlayCanvas(editor.frame, editor.width, editor.height);
    ensureTemplateMoveToolbar(editor.frame);
    injectStyles();
    buildPanel(editor.root);
    installTemplateColorPicker(editor.root);
    installOverlayPaletteWatcher(editor.root);
    installViewportCapture(editor.root, editor.frame);
    if (!sameAsset || !state.target) await restoreTarget();
    renderOverlay();

    editor.root.addEventListener("pointerup", (event) => {
      if (shouldRefreshMismatchOverlay({
        mismatchesOnly: state.mismatchesOnly,
        paintActive: state.paintActive,
        pointerId: event.pointerId,
        syntheticPointerId: SYNTHETIC_POINTER_ID,
      })) requestAnimationFrame(renderOverlay);
    });
  }

  let scanQueued = false;
  function queueScan() {
    if (scanQueued) return;
    scanQueued = true;
    requestAnimationFrame(async () => {
      scanQueued = false;
      const editor = readEditor();
      if (editor) await attach(editor);
      else if (state.templateMoveActive) finishTemplateMoveState();
    });
  }

  const observer = new MutationObserver(queueScan);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class"],
    childList: true,
    subtree: true,
  });
  installSyntheticPointerCaptureBridge();
  restoreSettings();
  queueScan();
