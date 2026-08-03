import { build } from "esbuild";
import packageJson from "../package.json" with { type: "json" };

const metadata = `// ==UserScript==
// @name         Wplace Asset Reference Overlay
// @namespace    https://wplace.live/
// @version      ${packageJson.version}
// @description  Byte-exact overlays and editor-assisted painting for Wplace alliance assets, headquarters, and profile pictures.
// @author       You
// @match        https://wplace.live/*
// @run-at       document-idle
// @grant        unsafeWindow
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
  define: { __WAA_VERSION__: JSON.stringify(packageJson.version) },
});
