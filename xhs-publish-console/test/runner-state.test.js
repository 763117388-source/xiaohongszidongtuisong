import assert from "node:assert/strict";
import test from "node:test";

import { buildImageGeneratedRun } from "../runner-state.js";

test("buildImageGeneratedRun records that XHS automation is stopped before upload or publish", () => {
  assert.deepEqual(buildImageGeneratedRun("/tmp/cover.png", "2026-04-30T01:02:03.000Z"), {
    status: "image-generated",
    updatedAt: "2026-04-30T01:02:03.000Z",
    imagePath: "/tmp/cover.png",
    wechatPushTarget: "pending",
    xhsAutomationDisabled: true,
    stoppedBeforeXhs: true
  });
});
