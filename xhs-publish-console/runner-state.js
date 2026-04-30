export function buildImageGeneratedRun(imagePath, updatedAt = new Date().toISOString()) {
  return {
    status: "image-generated",
    updatedAt,
    imagePath,
    wechatPushTarget: "pending",
    xhsAutomationDisabled: true,
    stoppedBeforeXhs: true
  };
}
