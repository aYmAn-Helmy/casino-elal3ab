'use strict';
window.GameUtil = (() => {
  const escapeHTML = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
  const phaseText = { idle: 'في انتظار أول جولة', open: 'الجرس مفتوح', answering: 'فيه لاعب بيجاوب', closed: 'الجرس مقفول' };
  function connectGame({ onOpen = () => {}, onMessage = () => {}, onClose = () => {} }) {
    let socket = null; let stopped = false; let retry = 500;
    const api = {
      send(type, data = {}) {
        if (socket && socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type, ...data })); return true;
        }
        return false;
      },
      close() { stopped = true; if (socket) socket.close(); }
    };
    function open() {
      if (stopped) return;
      const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
      socket = new WebSocket(`${protocol}//${location.host}/ws`);
      socket.onopen = () => { retry = 500; onOpen(api); };
      socket.onmessage = (event) => {
        try { onMessage(JSON.parse(event.data), api); } catch (error) { console.error('Invalid server message', error); }
      };
      socket.onclose = () => {
        onClose();
        if (!stopped) { setTimeout(open, retry); retry = Math.min(8000, retry * 1.7); }
      };
      socket.onerror = () => {};
    }
    open(); return api;
  }
  return { escapeHTML, phaseText, connectGame };
})();
