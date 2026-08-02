# Wplace Asset Reference Overlay

A userscript for image-reference overlays and assisted filling in Wplace's alliance asset, headquarters, and profile-picture editors.

## Install

Install Tampermonkey or Violentmonkey, then [install the latest userscript](https://github.com/mia-riezebos/wplace-misc-templates/releases/latest/download/wplace-alliance-reference.user.js).

## Features

- Exact-size overlays for alliance profile pictures (64×64), alliance banners (384×128), and user profile pictures (16×16)
- HQ overlays from any palette PNG no larger than the current 250–2000px canvas, movable live by X/Y or confirmable drag-and-drop and never resized
- Byte-exact PNG colors with no resizing, fitting, or dithering
- Live RGB palette discovery for alliance assets and HQ; any opaque 8-bit RGB color for user profile pictures
- Full-pixel or center-third display, adjustable opacity, and a differences-only overlay
- Middle-click a template pixel to select its editor color
- Alliance auto-paint with an optional 1–5000 ms interval or 50-pixel unpaced batches, plus instant local user-profile fill
- Experimental HQ auto-paint hidden by default; edit `ENABLE_HQ_AUTO_PAINT` before installation to expose charge-limited controls
- Selected-color-only auto-paint for coordinating multiple painters without automatic swatch changes
- Start-to-end, end-to-start, middle-out, edge-in, zigzag, and Hilbert-curve paint paths
- Optional fill of transparent pixels only
- Alliance and HQ zoom/position restoration synchronized with Wplace's coordinate mapper
- Per-editor template persistence, using IndexedDB for large HQ PNGs
