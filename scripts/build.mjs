import { build } from "esbuild";

const metadata = `// ==UserScript==
// @name         Wplace Asset Reference Overlay
// @namespace    https://wplace.live/
// @version      0.6.0
// @description  Byte-exact overlays, spatial paint paths, and editor-only auto-paint for Wplace alliance assets and user profile pictures.
// @author       You
// @match        https://wplace.live/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==`;

await build({
  entryPoints: ["src/main.ts"],
  outfile: "wplace-alliance-reference.user.js",
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "chrome120",
  legalComments: "none",
  banner: { js: metadata },
});
