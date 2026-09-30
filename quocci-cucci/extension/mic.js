// Side panels can't show Chrome's permission prompt, so this tab asks once.
(async () => {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());
    document.getElementById('h').textContent = 'Microphone is on';
    document.getElementById('p').textContent = 'Go back to the side panel and tap the mic. This tab will close.';
    setTimeout(() => window.close(), 1500);
  } catch (e) {
    document.getElementById('h').textContent = 'Microphone blocked';
    document.getElementById('p').textContent =
      'Click the icon at the left of the address bar, set Microphone to Allow, then reload this tab.';
  }
})();
