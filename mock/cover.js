/*
 * cover.js - render three mock frames inline (no iframes) so html2canvas
 * can capture the whole composition as a clean PNG.
 *
 * Also provides a "Capture cover.png" button that downloads the composed
 * cover at exact 1280x640 PNG.
 */

// Render each frame's content using mock.js's exported helper
document.querySelectorAll(".frame[data-theme-target]").forEach(frame => {
  const theme = frame.dataset.themeTarget;
  frame.innerHTML = window.renderMockMainViewHTML({
    theme,
    view: "main",
  });
});

// Capture button: downloads the cover as a 1280x640 PNG
const captureBtn = document.getElementById("capture-btn");
if (captureBtn) {
  captureBtn.addEventListener("click", async () => {
    captureBtn.disabled = true;
    captureBtn.textContent = "Loading library...";

    // Inject html2canvas if not present
    if (!window.html2canvas) {
      const s = document.createElement("script");
      s.src = "https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js";
      document.head.appendChild(s);
      await new Promise(r => (s.onload = r));
    }

    captureBtn.textContent = "Rendering...";
    const cover = document.getElementById("cover");
    // Switch to flat mode: replace transform: scale with CSS zoom (layout-affecting,
    // captured correctly by html2canvas).
    cover.classList.add("flat");
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

    const canvas = await window.html2canvas(cover, {
      width: 1280,
      height: 640,
      scale: 2,            // 2x for sharper PNG (final saved at 2560x1280, downscale on display)
      useCORS: true,
      allowTaint: true,
      backgroundColor: "#050609",
      logging: false,
    });

    // Restore visual mode after capture
    cover.classList.remove("flat");

    const dataUrl = canvas.toDataURL("image/png");
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = "cover.png";
    document.body.appendChild(a);
    a.click();
    a.remove();

    captureBtn.disabled = false;
    captureBtn.textContent = "Capture cover.png";
  });
}

// Hide the capture button in screenshot mode
if (new URLSearchParams(window.location.search).has("clean")) {
  document.body.classList.add("clean");
}
