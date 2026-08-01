# Wplace Asset Reference Overlay

A focused userscript for Wplace's asset editors:

- Alliance profile pictures: **64×64**
- Alliance profile banners: **384×128**
- User profile pictures: **16×16**
- Accepts only an image whose dimensions exactly match the open editor
- Alliance templates accept only transparent pixels or exact colors from Wplace's current 63-color palette
- User profile-picture templates accept every opaque 8-bit RGB color exposed by Wplace's custom color picker
- Reads raw PNG sample bytes, ignoring color-profile metadata that could shift exact RGB values
- Does not resize, crop, fit, dither, or otherwise prepare templates
- Adjustable overlay opacity and a mismatch-only view
- A compact toolbar docked above the editor, with responsive one-, two-, and three-column layouts
- Middle-click a template pixel to select its color in Wplace's palette
- Optional alliance-editor auto-fill queue with configurable pacing, pause, resume, and stop
- Instant local fill for the user profile-picture draft; Wplace is contacted only when you use its Save control
- Optional **Only unpainted pixels** constraint that never overwrites non-transparent canvas pixels
- Optional **Keep view on refresh** restoration for alliance-editor zoom and canvas position
- Alliance paint confirmation survives same-editor artboard replacements and waits up to five seconds before pausing
- Synthetic alliance strokes tolerate Wplace's native pointer-capture requirement without changing real mouse or touch input
- Remembers one template per editor size in local browser storage

Auto-fill is hard-limited to the DOM element named **Alliance asset canvas** at the two alliance dimensions above, or to the visible 16×16 canvas on `/profile-picture`. It cannot activate on Wplace's global canvas. It uses Wplace's visible palette and editor input events; it does not call private APIs, directly access the backend, or click Save.

## Install

1. Install a userscript manager such as Tampermonkey or Violentmonkey.
2. [Install the latest userscript](https://github.com/mia-riezebos/wplace-misc-templates/releases/latest/download/wplace-alliance-reference.user.js). Your userscript manager should prompt you to confirm the installation.
3. Open Wplace's **Alliance → Asset studio** and choose a profile-picture or banner draft, or open the user profile-picture editor.
4. Load an externally prepared, exact-size palette PNG.

## Controls

- **Middle-click** an opaque template pixel to select that template color.
- **Only differences** hides target pixels that already match the editor canvas.
- **Refresh** recalculates the mismatch overlay.
- **Auto-fill** builds a queue from opaque template pixels that do not yet match.
- **Fill now** applies all needed pixels to the local 16×16 user-profile draft without pacing.
- **Only unpainted pixels** limits either fill mode to fully transparent editor pixels.
- **Keep view on refresh** restores alliance zoom and canvas position when Wplace replaces the artboard after a revision update.
- **Pace** controls the pause between queued pixels; the default is 150 ms.
- **Pause/Resume** and **Stop** keep the queue under your control.

Transparent template pixels are treated as “do not paint,” not as eraser instructions.

## Wplace policy note

The Community Guidelines describe the bot rule in the context of unfair advantage on the community map, while the asset editors are separate from that canvas. However, the public Terms of Service currently use broader language about unauthorized automation across the Services and do not publish an explicit asset-editor exception. Use the fill options only if Wplace has authorized this use for these editors.

- https://wplace.live/terms/community-guidelines
- https://wplace.live/terms/terms-of-service
