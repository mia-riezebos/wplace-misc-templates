# Wplace Asset Reference Overlay

A userscript for image-reference overlays and assisted filling in Wplace's alliance asset and profile-picture editors.

## Install

Install Tampermonkey or Violentmonkey, then [install the latest userscript](https://github.com/mia-riezebos/wplace-misc-templates/releases/latest/download/wplace-alliance-reference.user.js).

## Features

- Exact-size overlays for alliance profile pictures (64×64), alliance banners (384×128), and user profile pictures (16×16)
- Byte-exact PNG colors with no resizing, fitting, or dithering
- Live RGB palette discovery for alliance assets; any opaque 8-bit RGB color for user profile pictures
- Full-pixel or center-third display, adjustable opacity, and a differences-only overlay
- Middle-click a template pixel to select its editor color
- Alliance auto-paint with an optional 1–5000 ms interval or 50-pixel unpaced batches, plus instant local user-profile fill
- Selected-color-only auto-paint for coordinating multiple painters without automatic swatch changes
- Start-to-end, end-to-start, middle-out, edge-in, zigzag, and Hilbert-curve paint paths
- Optional fill of transparent pixels only
- Alliance zoom and position restoration that stays synchronized with Wplace's coordinate mapper
- Per-editor template persistence in local browser storage
