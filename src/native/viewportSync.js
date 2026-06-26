/** Keep CSS in sync with the visible viewport (iOS keyboard, safe areas). */
export function initViewportSync() {
  if (typeof window === "undefined" || !window.visualViewport) return () => {};

  const root = document.documentElement;

  const sync = () => {
    const vv = window.visualViewport;
    if (!vv) return;

    root.style.setProperty("--ih-vv-top", `${vv.offsetTop}px`);
    root.style.setProperty("--ih-vv-height", `${vv.height}px`);

    const keyboardInset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
    const wasOpen = document.body.classList.contains("keyboard-open");
    const isOpen = keyboardInset > 50;
    document.body.classList.toggle("keyboard-open", isOpen);
    if (isOpen && !wasOpen) {
      window.dispatchEvent(new CustomEvent("inhand:keyboard-show"));
    }
  };

  sync();
  window.visualViewport.addEventListener("resize", sync);
  window.visualViewport.addEventListener("scroll", sync);
  window.addEventListener("orientationchange", () => {
    setTimeout(sync, 100);
    setTimeout(sync, 350);
  });

  return () => {
    window.visualViewport.removeEventListener("resize", sync);
    window.visualViewport.removeEventListener("scroll", sync);
  };
}
