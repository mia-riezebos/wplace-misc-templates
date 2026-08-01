// @ts-nocheck -- Legacy DOM controller; strict typed seams live in core/ and adapters/.
import {
  type Color,
  colorHex,
  colorKey,
  colorLabel,
} from "./core/palette.ts";
import { type PaintPath, orderPaintItems } from "./core/paint-path.ts";
import { resolveEditorColor, validateTemplatePixels } from "./core/template.ts";
import {
  alliancePalette,
  paletteButtonForColor,
  selectedPaletteColor as readSelectedPaletteColor,
} from "./adapters/wplace-palette.ts";

  /*
   * Safety boundary:
   * - no fetch/XHR/WebSocket calls or direct backend access
   * - auto-paint is only exposed for the 64x64 / 384x128 Alliance asset canvas
   * - instant fill is only exposed for the local 16x16 user profile-picture draft
   * - both modes use visible editor controls; this script never clicks Save/Submit
   */

  const SCRIPT_ID = "waa-reference-overlay";
  const PANEL_ID = `${SCRIPT_ID}-panel`;
  const OVERLAY_CLASS = `${SCRIPT_ID}-canvas`;
  const STORAGE_PREFIX = `${SCRIPT_ID}:v1:`;
  const SETTINGS_KEY = `${SCRIPT_ID}:settings:v1`;
  const ALLIANCE_SIZES = new Set(["64x64", "384x128"]);
  const PROFILE_SIZE = "16x16";
  const SYNTHETIC_POINTER_ID = 9471;
  const ALLIANCE_COLOR_TOLERANCE_SQUARED = 36;
  const ALLIANCE_REFRESH_GRACE_MS = 15000;
  const UNPACED_BATCH_SIZE = 50;

  const state = {
    editorKind: "alliance",
    root: null,
    frame: null,
    baseCanvas: null,
    overlayCanvas: null,
    target: null,
    sourceName: "reference",
    width: 0,
    height: 0,
    opacity: 0.55,
    displayMode: "full",
    mismatchesOnly: false,
    onlyUnpainted: false,
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
    paintLockedColor: null,
    paintFailureMessage: null,
    paintNeedsRevalidation: false,
    paletteColors: [],
    pickerRoot: null,
    pickerPointerHandler: null,
    pickerAuxHandler: null,
    viewport: null,
    viewportObserver: null,
    viewportRoot: null,
    viewportCaptureHandler: null,
    viewportRestoring: false,
    statusMessage: "Load an image to begin.",
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
    return `${STORAGE_PREFIX}${editorKey()}`;
  }

  function persistSettings() {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({
        preserveView: state.preserveView,
        paintIntervalEnabled: state.paintIntervalEnabled,
        paintSelectedColorOnly: state.paintSelectedColorOnly,
        paintPath: state.paintPath,
        paintDelay: state.paintDelay,
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
    } catch (error) {
      console.warn(`${SCRIPT_ID}: unable to restore settings`, error);
    }
  }

  function setStatus(message, kind = "normal") {
    state.statusMessage = message;
    state.statusKind = kind;
    const status = document.getElementById(`${PANEL_ID}-status`);
    if (!status) return;
    status.textContent = message;
    status.dataset.kind = kind;
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

  function readEditor() {
    return readAllianceEditor() || readProfileEditor();
  }

  function viewportKey() {
    return `${state.editorKind}:${editorKey()}`;
  }

  function captureAllianceViewport() {
    if (state.editorKind !== "alliance" || !state.frame?.isConnected) return;
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
      withSyntheticPointerCapture(root, () => {
        state.baseCanvas.dispatchEvent(new PointerEvent("pointerdown", {
          ...common, buttons: 4, clientX: centerX, clientY: centerY,
        }));
        state.baseCanvas.dispatchEvent(new PointerEvent("pointermove", {
          ...common,
          buttons: 4,
          clientX: centerX + deltaX,
          clientY: centerY + deltaTranslateY,
        }));
        state.baseCanvas.dispatchEvent(new PointerEvent("pointerup", {
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
    if (state.editorKind !== "alliance") return;

    const captureSoon = () => requestAnimationFrame(captureAllianceViewport);
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
    canvas.width = width;
    canvas.height = height;
    return canvas;
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

  async function decodePngSamples(file, expectedWidth, expectedHeight) {
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
        if (header.width !== expectedWidth || header.height !== expectedHeight) {
          throw new Error(`Expected ${expectedWidth}x${expectedHeight}, got ${header.width}x${header.height}. Resize it outside this script.`);
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

  function persistTarget() {
    if (!state.target) return;
    try {
      localStorage.setItem(
        storageKey(),
        JSON.stringify({
          rgba: bytesToBase64(state.target.data),
          width: state.target.width,
          height: state.target.height,
          name: state.sourceName,
          opacity: state.opacity,
          displayMode: state.displayMode,
          mismatchesOnly: state.mismatchesOnly,
          onlyUnpainted: state.onlyUnpainted,
        }),
      );
    } catch (error) {
      console.warn(`${SCRIPT_ID}: unable to save the local template`, error);
      setStatus("Overlay works, but could not be saved locally.", "warn");
    }
  }

  async function restoreTarget() {
    state.target = null;
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey()) || "null");
      if (!saved?.rgba && !saved?.image) return;
      if (saved.rgba) {
        if (saved.width !== state.width || saved.height !== state.height) {
          throw new Error("Saved template dimensions do not match this editor.");
        }
        const rgba = base64ToBytes(saved.rgba);
        if (rgba.length !== state.width * state.height * 4) {
          throw new Error("Saved template pixel data has an unexpected size.");
        }
        state.target = new ImageData(rgba, state.width, state.height);
      } else {
        state.target = await urlToImageData(saved.image, state.width, state.height);
      }
      const validationError = validateTemplate(state.target);
      if (validationError) throw new Error(`Saved template is no longer valid: ${validationError}`);
      state.sourceName = saved.name || "reference";
      state.opacity = Number.isFinite(saved.opacity) ? saved.opacity : 0.55;
      state.displayMode = saved.displayMode === "center" ? "center" : "full";
      state.mismatchesOnly = Boolean(saved.mismatchesOnly);
      state.onlyUnpainted = Boolean(saved.onlyUnpainted);
      syncControls();
      renderOverlay();
      setStatus(`Restored ${state.sourceName}.`);
    } catch (error) {
      console.warn(`${SCRIPT_ID}: unable to restore the local template`, error);
      localStorage.removeItem(storageKey());
      setStatus(error instanceof Error ? error.message : "Could not restore the saved template.", "warn");
    }
  }

  function renderOverlay() {
    const canvas = state.overlayCanvas;
    if (!canvas) return;
    canvas.style.opacity = String(state.opacity);
    canvas.style.display = state.hidden ? "none" : "block";
    if (!state.target) {
      canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height);
      return;
    }
    if (state.hidden) return;

    const output = new ImageData(new Uint8ClampedArray(state.target.data), state.width, state.height);
    if (state.mismatchesOnly) {
      try {
        const actual = state.baseCanvas.getContext("2d", { willReadFrequently: true })
          .getImageData(0, 0, state.width, state.height).data;
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

    const scale = state.displayMode === "center" ? 3 : 1;
    const renderWidth = state.width * scale;
    const renderHeight = state.height * scale;
    if (canvas.width !== renderWidth) canvas.width = renderWidth;
    if (canvas.height !== renderHeight) canvas.height = renderHeight;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.clearRect(0, 0, canvas.width, canvas.height);
    if (scale === 1) {
      context.putImageData(output, 0, 0);
    } else {
      const centered = context.createImageData(renderWidth, renderHeight);
      for (let y = 0; y < state.height; y += 1) {
        for (let x = 0; x < state.width; x += 1) {
          const source = (y * state.width + x) * 4;
          if (output.data[source + 3] === 0) continue;
          const target = ((y * 3 + 1) * renderWidth + x * 3 + 1) * 4;
          centered.data[target] = output.data[source];
          centered.data[target + 1] = output.data[source + 1];
          centered.data[target + 2] = output.data[source + 2];
          centered.data[target + 3] = output.data[source + 3];
        }
      }
      context.putImageData(centered, 0, 0);
    }
    const visiblePixels = countVisiblePixels(output);
    if (!state.paintActive) {
      setStatus(
        state.mismatchesOnly
          ? `${visiblePixels.toLocaleString()} pixels still differ.`
          : `${countVisiblePixels(state.target).toLocaleString()} template pixels.`,
      );
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

  function ensurePaintTool() {
    if (state.editorKind === "profile") return true;
    const container = state.root?.closest('[role="dialog"], dialog');
    if (!container) return false;
    const paintButton = [...container.querySelectorAll("button")].find((button) => (
      button.textContent.trim() === "Paint" && button.offsetParent !== null
    ));
    if (!paintButton) return false;
    paintButton.click();
    return true;
  }

  function editorPixelFromClient(clientX, clientY) {
    if (!state.baseCanvas) return null;
    const rect = state.baseCanvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const x = Math.floor(((clientX - rect.left) / rect.width) * state.width);
    const y = Math.floor(((clientY - rect.top) / rect.height) * state.height);
    if (x < 0 || y < 0 || x >= state.width || y >= state.height) return null;
    return { x, y };
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

  function pixelMatchesColor(pixelData, index, color) {
    if (pixelData[index + 3] !== 255) return false;
    const redDelta = pixelData[index] - color.rgb[0];
    const greenDelta = pixelData[index + 1] - color.rgb[1];
    const blueDelta = pixelData[index + 2] - color.rgb[2];
    if (redDelta === 0 && greenDelta === 0 && blueDelta === 0) return true;
    return state.editorKind === "alliance"
      && redDelta ** 2 + greenDelta ** 2 + blueDelta ** 2 <= ALLIANCE_COLOR_TOLERANCE_SQUARED;
  }

  function canvasPixelDisposition(item) {
    try {
      const pixel = state.baseCanvas.getContext("2d", { willReadFrequently: true })
        .getImageData(item.x, item.y, 1, 1).data;
      if (pixelMatchesColor(pixel, 0, item.color)) return "matches";
      if (state.onlyUnpainted && pixel[3] !== 0) return "protected";
      return "paint";
    } catch (error) {
      console.warn(`${SCRIPT_ID}: could not read an editor pixel`, error);
      return "unreadable";
    }
  }

  function buildPaintQueue(onlyColor = null) {
    if (!state.target) return [];
    const buckets = new Map(
      state.editorKind === "alliance" ? activeAlliancePalette().map((color) => [colorKey(color), []]) : [],
    );
    let actual;
    try {
      actual = state.baseCanvas.getContext("2d", { willReadFrequently: true })
        .getImageData(0, 0, state.width, state.height).data;
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
        if (state.onlyUnpainted && actual[index + 3] !== 0) continue;
        const matches = pixelMatchesColor(actual, index, color);
        if (!matches) {
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

  async function waitForAllianceArtboard(runId) {
    const isConnected = () => (
      state.editorKind === "alliance"
      && ALLIANCE_SIZES.has(editorKey())
      && state.root?.isConnected
      && state.baseCanvas?.isConnected
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

  async function waitForCanvasPixel(item, timeout = 5000) {
    const deadline = Date.now() + timeout;
    do {
      const disposition = canvasPixelDisposition(item);
      if (disposition === "matches" || disposition === "protected") return true;
      await wait(35);
    } while (Date.now() < deadline);
    return false;
  }

  function canvasBatchDispositions(items) {
    try {
      const pixels = state.baseCanvas.getContext("2d", { willReadFrequently: true })
        .getImageData(0, 0, state.width, state.height).data;
      return items.map((item) => {
        const index = (item.y * state.width + item.x) * 4;
        if (pixelMatchesColor(pixels, index, item.color)) return "matches";
        if (state.onlyUnpainted && pixels[index + 3] !== 0) return "protected";
        return "paint";
      });
    } catch (error) {
      console.warn(`${SCRIPT_ID}: could not read an editor pixel batch`, error);
      return null;
    }
  }

  async function waitForCanvasBatch(items, timeout = 5000) {
    const deadline = Date.now() + timeout;
    do {
      if (state.paintNeedsRevalidation || !state.baseCanvas?.isConnected) return { refreshed: true };
      const dispositions = canvasBatchDispositions(items);
      if (dispositions?.every((value) => value === "matches" || value === "protected")) {
        return { ok: true, dispositions };
      }
      await wait(35);
    } while (Date.now() < deadline);
    return { ok: false, dispositions: canvasBatchDispositions(items) };
  }

  function dispatchPaintEvents(item) {
    const rect = state.baseCanvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return false;
    const clientX = rect.left + ((item.x + 0.5) / state.width) * rect.width;
    const clientY = rect.top + ((item.y + 0.5) / state.height) * rect.height;
    const common = {
      bubbles: true,
      cancelable: true,
      composed: true,
      clientX,
      clientY,
      pointerId: SYNTHETIC_POINTER_ID,
      pointerType: "mouse",
      isPrimary: true,
      button: 0,
    };

    return withSyntheticPointerCapture(state.root, () => {
      state.baseCanvas.dispatchEvent(new PointerEvent("pointermove", { ...common, buttons: 0 }));
      state.baseCanvas.dispatchEvent(new PointerEvent("pointerdown", { ...common, buttons: 1 }));
      state.baseCanvas.dispatchEvent(new PointerEvent("pointerup", { ...common, buttons: 0 }));
      return true;
    });
  }

  async function dispatchPaintPixel(item, runId) {
    while (state.viewportRestoring) await nextFrame();
    if (!await waitForAllianceArtboard(runId)) return false;
    if (!preparePaintColor(item.color)) return false;
    await wait(0);
    const beforeDispatch = canvasPixelDisposition(item);
    if (beforeDispatch === "matches" || beforeDispatch === "protected") return true;
    const dispatchedCanvas = state.baseCanvas;
    if (!dispatchPaintEvents(item)) return false;
    if (await waitForCanvasPixel(item)) return true;

    if (state.baseCanvas !== dispatchedCanvas && state.baseCanvas?.isConnected) {
      const refreshedDisposition = canvasPixelDisposition(item);
      if (refreshedDisposition === "matches" || refreshedDisposition === "protected") return true;
      state.paintColor = null;
      if (!preparePaintColor(item.color)) return false;
      await wait(0);
      if (dispatchPaintEvents(item) && await waitForCanvasPixel(item)) return true;
    }

    const rect = state.baseCanvas.getBoundingClientRect();
    const clientX = rect.left + ((item.x + 0.5) / state.width) * rect.width;
    const clientY = rect.top + ((item.y + 0.5) / state.height) * rect.height;
    state.baseCanvas.dispatchEvent(new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      composed: true,
      clientX,
      clientY,
      button: 0,
    }));
    return waitForCanvasPixel(item);
  }

  async function dispatchPaintBatch(items, runId) {
    while (state.viewportRestoring) await nextFrame();
    if (!await waitForAllianceArtboard(runId)) return { ok: false };
    if (state.paintNeedsRevalidation) return { refreshed: true };
    if (!preparePaintColor(items[0].color)) {
      return { ok: false, message: state.paintFailureMessage };
    }
    await wait(0);

    const before = canvasBatchDispositions(items);
    if (!before) return { ok: false };
    const paintItems = items.filter((item, index) => before[index] === "paint");
    const skipped = items.length - paintItems.length;
    const dispatchedCanvas = state.baseCanvas;
    for (const item of paintItems) {
      if (state.paintNeedsRevalidation || state.baseCanvas !== dispatchedCanvas || !dispatchedCanvas.isConnected) {
        return { refreshed: true };
      }
      if (!dispatchPaintEvents(item)) return { ok: false, failedItem: item };
    }

    if (!paintItems.length) return { ok: true, painted: 0, skipped };
    const confirmed = await waitForCanvasBatch(paintItems);
    if (confirmed.refreshed) return confirmed;
    if (!confirmed.ok) {
      const failedIndex = confirmed.dispositions?.findIndex((value) => value === "paint") ?? -1;
      return {
        ok: false,
        failedItem: paintItems[Math.max(0, failedIndex)],
      };
    }
    return { ok: true, painted: paintItems.length, skipped };
  }

  function syncPaintControls() {
    const start = document.getElementById(`${PANEL_ID}-paint-start`);
    const pause = document.getElementById(`${PANEL_ID}-paint-pause`);
    const stop = document.getElementById(`${PANEL_ID}-paint-stop`);
    const interval = document.getElementById(`${PANEL_ID}-paint-interval`);
    const selectedColorOnly = document.getElementById(`${PANEL_ID}-selected-color-only`);
    const paintPath = document.getElementById(`${PANEL_ID}-paint-path`);
    const delay = document.getElementById(`${PANEL_ID}-paint-delay`);
    const label = document.getElementById(`${PANEL_ID}-paint-label`);
    const progress = document.getElementById(`${PANEL_ID}-progress`);
    if (start) {
      start.disabled = state.paintActive || !state.target;
      start.textContent = state.editorKind === "profile" ? "Fill now" : "Auto-paint";
    }
    if (label) label.textContent = state.editorKind === "profile" ? "Local fill" : "Paint queue";
    if (pause) {
      pause.disabled = !state.paintActive;
      pause.textContent = state.paintPaused ? "Resume" : "Pause";
    }
    if (stop) stop.disabled = !state.paintActive;
    if (interval) interval.checked = state.paintIntervalEnabled;
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
    state.paintLockedColor = null;
    state.paintFailureMessage = null;
    state.paintNeedsRevalidation = false;
    syncPaintControls();
    if (message) setStatus(message);
  }

  async function startProfileFill(queue) {
    if (!ensurePaintTool()) {
      setStatus("Could not activate Wplace's profile-picture Paint tool.", "warn");
      return;
    }

    const runId = ++state.paintRunId;
    state.paintQueue = queue;
    state.paintIndex = 0;
    state.paintActive = true;
    state.paintPaused = false;
    state.paintColor = null;
    state.paintNeedsRevalidation = false;
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
    if (!state.root?.isConnected || (!isAlliance && !isProfile)) {
      setStatus("Auto-paint is only available inside a supported Wplace asset editor.", "warn");
      return;
    }

    const lockedColor = isAlliance && state.paintSelectedColorOnly
      ? readSelectedPaletteColor(state.root)
      : null;
    if (isAlliance && state.paintSelectedColorOnly && !lockedColor) {
      setStatus("Select a Wplace palette color before starting selected-color auto-paint.", "warn");
      return;
    }
    const queue = buildPaintQueue(lockedColor);
    if (!queue.length) {
      setStatus(
        lockedColor
          ? `No ${colorLabel(lockedColor)} template pixels need painting.`
          : state.onlyUnpainted
          ? "No transparent editor pixels need painting. Existing pixels were left untouched."
          : "This asset already matches the template.",
      );
      return;
    }
    if (isProfile) {
      await startProfileFill(queue);
      return;
    }
    const intervalDescription = state.paintIntervalEnabled
      ? `with a ${state.paintDelay} ms interval`
      : `in same-color batches of up to ${UNPACED_BATCH_SIZE}`;
    const colorDescription = lockedColor ? ` matching the selected ${colorLabel(lockedColor)} swatch` : "";
    if (!window.confirm(
      `Auto-paint ${queue.length.toLocaleString()} alliance-editor pixels${colorDescription} ${intervalDescription}?`,
    )) {
      return;
    }
    if (!ensurePaintTool()) {
      setStatus("Could not activate Wplace's alliance Paint tool.", "warn");
      return;
    }

    const runId = ++state.paintRunId;
    state.paintQueue = queue;
    state.paintIndex = 0;
    state.paintActive = true;
    state.paintPaused = false;
    state.paintColor = null;
    state.paintLockedColor = lockedColor;
    state.paintFailureMessage = null;
    state.paintNeedsRevalidation = false;
    syncPaintControls();
    let paintedCount = 0;
    let skippedCount = 0;

    while (state.paintIndex < state.paintQueue.length && runId === state.paintRunId) {
      while (state.paintPaused && runId === state.paintRunId) await wait(100);
      if (runId !== state.paintRunId) return;
      if (!await waitForAllianceArtboard(runId)) {
        if (runId !== state.paintRunId) return;
        stopAutoFill("Wplace did not restore the alliance artboard; auto-paint stopped.");
        return;
      }
      if (state.paintNeedsRevalidation) {
        state.paintNeedsRevalidation = false;
        state.paintQueue = buildPaintQueue(state.paintLockedColor);
        state.paintIndex = 0;
        state.paintColor = null;
        syncPaintControls();
        if (!state.paintQueue.length) break;
        setStatus(`Artboard restored; rechecked ${state.paintQueue.length.toLocaleString()} remaining pixels.`);
      }

      const item = state.paintQueue[state.paintIndex];
      if (!state.paintIntervalEnabled) {
        const batch = [];
        const batchColor = colorKey(item.color);
        for (
          let index = state.paintIndex;
          index < state.paintQueue.length && batch.length < UNPACED_BATCH_SIZE;
          index += 1
        ) {
          const candidate = state.paintQueue[index];
          if (colorKey(candidate.color) !== batchColor) break;
          batch.push(candidate);
        }
        const result = await dispatchPaintBatch(batch, runId);
        if (result.refreshed) continue;
        if (!result.ok) {
          state.paintPaused = true;
          syncPaintControls();
          const failed = result.failedItem || item;
          setStatus(
            result.message
              || `Could not confirm the batch near pixel ${failed.x}, ${failed.y}. Paused; use Resume to retry.`,
            "warn",
          );
          continue;
        }
        paintedCount += result.painted;
        skippedCount += result.skipped;
        state.paintIndex += batch.length;
        syncPaintControls();
        setStatus(
          `Auto-paint ${state.paintIndex.toLocaleString()} / ${state.paintQueue.length.toLocaleString()} · `
          + `${paintedCount.toLocaleString()} painted · ${skippedCount.toLocaleString()} skipped.`,
        );
        renderOverlay();
        continue;
      }
      const disposition = canvasPixelDisposition(item);
      let painted = disposition === "matches" || disposition === "protected";
      if (painted) skippedCount += 1;
      else {
        painted = await dispatchPaintPixel(item, runId);
        if (painted) {
          const finalDisposition = canvasPixelDisposition(item);
          if (finalDisposition === "protected") skippedCount += 1;
          else paintedCount += 1;
        }
      }
      if (!painted) {
        state.paintPaused = true;
        syncPaintControls();
        setStatus(
          state.paintFailureMessage
            || `Could not confirm pixel ${item.x}, ${item.y}. Paused; use Resume to retry.`,
          "warn",
        );
        continue;
      }

      state.paintIndex += 1;
      if (state.paintIndex % 10 === 0 || state.paintIndex === state.paintQueue.length) {
        syncPaintControls();
        setStatus(
          `Auto-paint ${state.paintIndex.toLocaleString()} / ${state.paintQueue.length.toLocaleString()} · `
          + `${paintedCount.toLocaleString()} painted · ${skippedCount.toLocaleString()} skipped.`,
        );
      }
      if (state.paintIndex % 25 === 0) renderOverlay();
      if (state.paintIntervalEnabled) await wait(state.paintDelay);
    }

    if (runId === state.paintRunId) {
      state.paintActive = false;
      state.paintPaused = false;
      state.paintColor = null;
      state.paintLockedColor = null;
      state.paintFailureMessage = null;
      syncPaintControls();
      renderOverlay();
      setStatus(
        `Auto-paint complete: ${paintedCount.toLocaleString()} painted, `
        + `${skippedCount.toLocaleString()} already filled or protected.`,
      );
    }
  }

  function syncControls() {
    const opacity = document.getElementById(`${PANEL_ID}-opacity`);
    const opacityValue = document.getElementById(`${PANEL_ID}-opacity-value`);
    const displayMode = document.getElementById(`${PANEL_ID}-display-mode`);
    const mismatch = document.getElementById(`${PANEL_ID}-mismatch`);
    const onlyUnpainted = document.getElementById(`${PANEL_ID}-only-unpainted`);
    const selectedColorOnly = document.getElementById(`${PANEL_ID}-selected-color-only`);
    const paintPath = document.getElementById(`${PANEL_ID}-paint-path`);
    const preserveView = document.getElementById(`${PANEL_ID}-preserve-view`);
    const visibility = document.getElementById(`${PANEL_ID}-visibility`);
    const title = document.getElementById(`${PANEL_ID}-title`);
    const size = document.getElementById(`${PANEL_ID}-size`);
    const templateNote = document.getElementById(`${PANEL_ID}-template-note`);
    if (opacity) opacity.value = String(Math.round(state.opacity * 100));
    if (opacityValue) opacityValue.textContent = `${Math.round(state.opacity * 100)}%`;
    if (displayMode) displayMode.value = state.displayMode;
    if (mismatch) mismatch.checked = state.mismatchesOnly;
    if (onlyUnpainted) onlyUnpainted.checked = state.onlyUnpainted;
    if (selectedColorOnly) selectedColorOnly.checked = state.paintSelectedColorOnly;
    if (paintPath) {
      paintPath.value = state.paintPath;
      paintPath.disabled = state.paintActive;
    }
    if (preserveView) preserveView.checked = state.preserveView;
    if (visibility) visibility.textContent = state.hidden ? "Show" : "Hide";
    if (title) title.textContent = "Reference";
    if (size) size.textContent = editorKey();
    if (templateNote) {
      templateNote.textContent = state.editorKind === "profile"
        ? "Raw PNG · any RGB"
        : "Raw PNG · exact palette";
    }
    syncPaintControls();
  }

  async function loadFile(file) {
    if (!file) {
      setStatus("Choose a PNG file.", "warn");
      return;
    }
    try {
      setStatus("Reading raw PNG pixels…");
      const imageData = await decodePngSamples(file, state.width, state.height);
      const validationError = validateTemplate(imageData);
      if (validationError) {
        setStatus(validationError, "warn");
        return;
      }
      state.sourceName = file.name.replace(/\.[^.]+$/, "") || "reference";
      state.target = imageData;
      persistTarget();
      syncControls();
      renderOverlay();
    } catch (error) {
      console.warn(`${SCRIPT_ID}: unable to decode PNG samples`, error);
      setStatus(error instanceof Error ? error.message : "Could not read that PNG.", "warn");
    }
  }

  function clearTarget() {
    stopAutoFill(null);
    state.target = null;
    localStorage.removeItem(storageKey());
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
        --waa-ink: CanvasText;
        --waa-muted: color-mix(in srgb, CanvasText 62%, transparent);
        --waa-faint: color-mix(in srgb, CanvasText 9%, Canvas);
        --waa-border: color-mix(in srgb, CanvasText 14%, transparent);
        --waa-accent: #1677ff;
        position: relative;
        z-index: 2;
        flex: none;
        width: 100%;
        margin-top: 8px;
        overflow: hidden;
        border: 1px solid var(--waa-border);
        border-radius: 12px;
        background: color-mix(in srgb, Canvas 97%, CanvasText 3%);
        color: var(--waa-ink);
        container-type: inline-size;
        font: 12px/1.3 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        user-select: none;
      }
      #${PANEL_ID}, #${PANEL_ID} * { box-sizing: border-box; }
      #${PANEL_ID} .waa-head {
        display: flex;
        align-items: center;
        gap: 8px;
        min-height: 38px;
        padding: 4px 6px 4px 10px;
        border-bottom: 1px solid var(--waa-border);
      }
      #${PANEL_ID} .waa-head strong { font-size: 13px; font-weight: 700; letter-spacing: -0.01em; }
      #${PANEL_ID} .waa-size {
        border-radius: 6px;
        background: var(--waa-faint);
        padding: 2px 6px;
        color: var(--waa-muted);
        font: 600 11px/1.4 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        font-variant-numeric: tabular-nums;
      }
      #${PANEL_ID} .waa-head-hint {
        flex: 1;
        overflow: hidden;
        color: var(--waa-muted);
        text-align: right;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      #${PANEL_ID} .waa-body {
        display: grid;
        grid-template-columns: minmax(190px, 0.9fr) minmax(240px, 1fr) minmax(330px, 1.25fr);
      }
      #${PANEL_ID}[data-collapsed="true"] .waa-body { display: none; }
      #${PANEL_ID}[data-collapsed="true"] .waa-head { border-bottom: 0; }
      #${PANEL_ID} .waa-group {
        min-width: 0;
        padding: 8px 10px;
      }
      #${PANEL_ID} .waa-group + .waa-group { border-left: 1px solid var(--waa-border); }
      #${PANEL_ID} .waa-group-label {
        margin-bottom: 6px;
        color: var(--waa-muted);
        font-size: 11px;
        font-weight: 650;
      }
      #${PANEL_ID} .waa-row { display: flex; min-width: 0; align-items: center; gap: 6px; }
      #${PANEL_ID} .waa-row + .waa-row { margin-top: 6px; }
      #${PANEL_ID} .waa-paint-options { flex-wrap: wrap; }
      #${PANEL_ID} .waa-row > label:first-child { color: var(--waa-muted); }
      #${PANEL_ID} button, #${PANEL_ID} select, #${PANEL_ID} input[type="range"], #${PANEL_ID} input[type="number"] {
        min-height: 30px;
        border: 1px solid var(--waa-border);
        border-radius: 7px;
        background: var(--waa-faint);
        color: inherit;
        font: inherit;
      }
      #${PANEL_ID} button {
        padding: 4px 9px;
        cursor: pointer;
        font-weight: 600;
        white-space: nowrap;
      }
      #${PANEL_ID} button:hover { background: color-mix(in srgb, Canvas 83%, CanvasText 17%); }
      #${PANEL_ID} button:active { transform: translateY(1px); }
      #${PANEL_ID} button:focus-visible, #${PANEL_ID} select:focus-visible, #${PANEL_ID} input:focus-visible {
        outline: 2px solid color-mix(in srgb, var(--waa-accent) 72%, transparent);
        outline-offset: 2px;
      }
      #${PANEL_ID} button:disabled { cursor: default; opacity: 0.42; transform: none; }
      #${PANEL_ID} input:disabled { cursor: default; opacity: 0.42; }
      #${PANEL_ID} .waa-primary { background: var(--waa-accent); border-color: var(--waa-accent); color: #f8fbff; font-weight: 700; }
      #${PANEL_ID} .waa-primary:hover { background: #0b66df; }
      #${PANEL_ID} .waa-quiet { border-color: transparent; background: transparent; color: var(--waa-muted); }
      #${PANEL_ID} input[type="number"] {
        width: 58px;
        padding: 3px 6px;
        font-variant-numeric: tabular-nums;
      }
      #${PANEL_ID} select { max-width: 100%; padding: 3px 24px 3px 7px; }
      #${PANEL_ID} input[type="range"] { flex: 1; min-width: 64px; accent-color: var(--waa-accent); }
      #${PANEL_ID} .waa-check { display: flex; align-items: center; gap: 5px; white-space: nowrap; }
      #${PANEL_ID} .waa-grow { flex: 1; }
      #${PANEL_ID} .waa-note {
        min-width: 0;
        overflow: hidden;
        color: var(--waa-muted);
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      #${PANEL_ID} .waa-value {
        min-width: 32px;
        text-align: right;
        font-variant-numeric: tabular-nums;
      }
      #${PANEL_ID} .waa-status {
        grid-column: 1 / -1;
        min-height: 28px;
        padding: 6px 10px;
        border-top: 1px solid var(--waa-border);
        overflow: hidden;
        color: var(--waa-muted);
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      #${PANEL_ID} .waa-status[data-kind="warn"] { color: #d97706; }
      #${PANEL_ID} .waa-progress {
        grid-column: 1 / -1;
        height: 2px;
        overflow: hidden;
        background: transparent;
      }
      #${PANEL_ID} .waa-progress > span {
        display: block;
        width: 100%;
        height: 100%;
        transform: scaleX(0);
        transform-origin: left;
        background: var(--waa-accent);
      }
      #${PANEL_ID} .waa-icon { width: 32px; padding: 3px; font-size: 11px; }
      #${PANEL_ID} .waa-file { display: none; }
      #${PANEL_ID} .waa-profile-only { display: none; }
      #${PANEL_ID}[data-editor="profile"] .waa-alliance-only { display: none; }
      #${PANEL_ID}[data-editor="profile"] .waa-profile-only { display: inline; }
      @container (max-width: 780px) {
        #${PANEL_ID} .waa-body { grid-template-columns: 1fr 1fr; }
        #${PANEL_ID} .waa-paint { grid-column: 1 / -1; border-top: 1px solid var(--waa-border); border-left: 0 !important; }
      }
      @container (max-width: 520px) {
        #${PANEL_ID} .waa-head-hint { display: none; }
        #${PANEL_ID} .waa-body { grid-template-columns: 1fr; }
        #${PANEL_ID} .waa-group + .waa-group { border-top: 1px solid var(--waa-border); border-left: 0; }
        #${PANEL_ID} .waa-paint { grid-column: auto; }
        #${PANEL_ID} .waa-paint .waa-row { flex-wrap: wrap; }
      }
      @media (prefers-reduced-motion: reduce) {
        #${PANEL_ID} .waa-progress > span { transition: none; }
      }
    `;
    document.head.append(style);
  }

  function buildPanel(root) {
    document.getElementById(PANEL_ID)?.remove();
    const panel = document.createElement("section");
    panel.id = PANEL_ID;
    panel.dataset.collapsed = String(state.collapsed);
    panel.dataset.editor = state.editorKind;
    panel.innerHTML = `
      <div class="waa-head">
        <strong id="${PANEL_ID}-title">Reference</strong>
        <span class="waa-size" id="${PANEL_ID}-size">${editorKey()}</span>
        <span class="waa-head-hint">Middle-click template → pick color</span>
        <button class="waa-icon waa-quiet" id="${PANEL_ID}-collapse" type="button" aria-expanded="true" aria-label="Collapse reference controls" title="Collapse reference controls">▴</button>
      </div>
      <div class="waa-body">
        <section class="waa-group">
          <div class="waa-group-label">Template</div>
          <div class="waa-row">
            <button class="waa-primary" id="${PANEL_ID}-load" type="button">Load PNG</button>
            <input class="waa-file" id="${PANEL_ID}-file" type="file" accept="image/png">
            <span class="waa-note waa-grow" id="${PANEL_ID}-template-note">Raw PNG · exact palette</span>
            <button class="waa-quiet" id="${PANEL_ID}-clear" type="button">Clear</button>
          </div>
        </section>
        <section class="waa-group">
          <div class="waa-group-label">Overlay</div>
          <div class="waa-row">
            <label for="${PANEL_ID}-opacity">Opacity</label>
            <input id="${PANEL_ID}-opacity" type="range" min="5" max="100" step="5" value="55">
            <span class="waa-value" id="${PANEL_ID}-opacity-value">55%</span>
            <button id="${PANEL_ID}-visibility" type="button">Hide</button>
          </div>
          <div class="waa-row">
            <label for="${PANEL_ID}-display-mode">Display</label>
            <select id="${PANEL_ID}-display-mode" title="Choose how much of each template pixel is shown">
              <option value="full">Full pixel</option>
              <option value="center">Center ⅓</option>
            </select>
            <label class="waa-check waa-grow" title="Hide target pixels that already match the editor canvas">
              <input id="${PANEL_ID}-mismatch" type="checkbox"> Only differences
            </label>
            <button class="waa-quiet" id="${PANEL_ID}-refresh" type="button">Refresh</button>
          </div>
        </section>
        <section class="waa-group waa-paint">
          <div class="waa-group-label" id="${PANEL_ID}-paint-label">Paint queue</div>
          <div class="waa-row">
            <label class="waa-check waa-alliance-only" title="Add a delay after every confirmed paint event">
              <input id="${PANEL_ID}-paint-interval" type="checkbox" checked> Interval
            </label>
            <input class="waa-alliance-only" id="${PANEL_ID}-paint-delay" aria-label="Auto-paint interval in milliseconds" type="number" min="1" max="5000" step="1" value="150">
            <span class="waa-note waa-alliance-only">ms</span>
            <span class="waa-grow waa-alliance-only"></span>
            <span class="waa-note waa-grow waa-profile-only">Local draft · Wplace Save submits</span>
            <button class="waa-primary" id="${PANEL_ID}-paint-start" type="button">Auto-paint</button>
            <button class="waa-alliance-only" id="${PANEL_ID}-paint-pause" type="button" disabled>Pause</button>
            <button class="waa-quiet waa-alliance-only" id="${PANEL_ID}-paint-stop" type="button" disabled>Stop</button>
          </div>
          <div class="waa-row waa-alliance-only">
            <label for="${PANEL_ID}-paint-path">Path</label>
            <select id="${PANEL_ID}-paint-path" title="Choose the spatial order used within each color">
              <option value="start-end">Start → end</option>
              <option value="end-start">End → start</option>
              <option value="middle-out">Middle → out</option>
              <option value="edge-in">Edge → in</option>
              <option value="zigzag">Zigzag</option>
              <option value="hilbert">Hilbert curve</option>
            </select>
            <span class="waa-note waa-grow">within each color</span>
          </div>
          <div class="waa-row waa-paint-options">
            <label class="waa-check" title="Never overwrite a non-transparent editor pixel">
              <input id="${PANEL_ID}-only-unpainted" type="checkbox"> Only unpainted pixels
            </label>
            <label class="waa-check waa-alliance-only" title="Paint only template pixels matching the Wplace color selected when auto-paint starts">
              <input id="${PANEL_ID}-selected-color-only" type="checkbox"> Only selected color
            </label>
            <span class="waa-grow waa-alliance-only"></span>
            <label class="waa-check waa-alliance-only" title="Restore zoom and canvas position when Wplace replaces the artboard">
              <input id="${PANEL_ID}-preserve-view" type="checkbox"> Keep view on refresh
            </label>
          </div>
        </section>
        <div class="waa-status" id="${PANEL_ID}-status">Load an image to begin.</div>
        <div class="waa-progress" aria-hidden="true"><span id="${PANEL_ID}-progress"></span></div>
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
    panel.querySelector(`#${PANEL_ID}-only-unpainted`).addEventListener("change", (event) => {
      state.onlyUnpainted = event.target.checked;
      persistTarget();
      setStatus(
        state.onlyUnpainted
          ? "Auto-paint will only paint fully transparent editor pixels."
          : "Auto-paint may replace pixels whose colors differ.",
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
    panel.querySelector(`#${PANEL_ID}-paint-stop`).addEventListener("click", () => stopAutoFill());
    panel.querySelector(`#${PANEL_ID}-collapse`).addEventListener("click", () => {
      state.collapsed = !state.collapsed;
      panel.dataset.collapsed = String(state.collapsed);
      const collapse = panel.querySelector(`#${PANEL_ID}-collapse`);
      collapse.textContent = state.collapsed ? "▾" : "▴";
      collapse.setAttribute("aria-expanded", String(!state.collapsed));
      collapse.setAttribute("aria-label", state.collapsed ? "Expand reference controls" : "Collapse reference controls");
      collapse.title = collapse.getAttribute("aria-label");
    });

    root.before(panel);
    syncControls();
    setStatus(state.statusMessage, state.statusKind);
  }

  async function attach(editor) {
    const sameAsset = Boolean(state.root)
      && state.editorKind === editor.kind
      && state.width === editor.width
      && state.height === editor.height;
    const changedEditor = state.root !== editor.root
      || state.baseCanvas !== editor.baseCanvas
      || state.editorKind !== editor.kind
      || state.width !== editor.width
      || state.height !== editor.height;
    if (!changedEditor && document.getElementById(PANEL_ID) && state.overlayCanvas?.isConnected) return;

    if (state.paintActive && !sameAsset) stopAutoFill("The asset editor changed; auto-paint stopped.");
    if (state.paintActive && sameAsset && changedEditor) state.paintNeedsRevalidation = true;
    if (sameAsset) state.paintColor = null;

    state.editorKind = editor.kind;
    state.root = editor.root;
    state.frame = editor.frame;
    state.baseCanvas = editor.baseCanvas;
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
    injectStyles();
    buildPanel(editor.root);
    installTemplateColorPicker(editor.root);
    installViewportCapture(editor.root, editor.frame);
    if (!sameAsset || !state.target) await restoreTarget();
    renderOverlay();

    editor.root.addEventListener("pointerup", () => {
      if (state.mismatchesOnly) requestAnimationFrame(renderOverlay);
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
    });
  }

  const observer = new MutationObserver(queueScan);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  restoreSettings();
  queueScan();
