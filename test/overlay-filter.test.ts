import assert from "node:assert/strict";
import test from "node:test";

import { templatePixelMatchesSelectedColor } from "../src/core/overlay-filter.ts";

test("selected-colour overlay filtering uses exact Wplace RGB", () => {
  assert.equal(templatePixelMatchesSelectedColor(246, 170, 9, [246, 170, 9]), true);
  assert.equal(templatePixelMatchesSelectedColor(247, 170, 11, [246, 170, 9]), false);
  assert.equal(templatePixelMatchesSelectedColor(246, 170, 9, null), false);
});
