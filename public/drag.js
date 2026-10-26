// Pointer-based drag state: idle → dragging → accepted/rejected → settling.
// No album mutation happens until the controller accepts a concrete drop.
export function enableWorkspacePan(area, content) {
  let pan = null;
  const cancel = () => {
    if (pan) try { if (area.hasPointerCapture(pan.id)) area.releasePointerCapture(pan.id); } catch {}
    pan = null; area.classList.remove('panning');
  };
  area.addEventListener('pointerdown', e => {
    if (!e.isPrimary || e.button !== 0 || e.target.closest('button,input,select,a,textarea,summary')) return;
    pan = { id: e.pointerId, x: e.clientX, y: e.clientY, left: content.scrollLeft, top: content.scrollTop };
    area.setPointerCapture(e.pointerId); area.classList.add('panning'); e.preventDefault();
  });
  area.addEventListener('pointermove', e => {
    if (!pan || e.pointerId !== pan.id) return;
    content.scrollLeft = pan.left + pan.x - e.clientX;
    content.scrollTop = pan.top + pan.y - e.clientY;
    e.preventDefault();
  });
  document.addEventListener('pointerdown', e => { if (pan && pan.id !== e.pointerId) cancel(); });
  area.addEventListener('pointerup', cancel);
  area.addEventListener('pointercancel', cancel);
  area.addEventListener('lostpointercapture', cancel);
  for (const name of ['blur', 'resize', 'pagehide']) window.addEventListener(name, cancel);
  area.addEventListener('wheel', e => {
    if (e.ctrlKey) return;
    const factor = e.deltaMode === 1 ? 20 : e.deltaMode === 2 ? content.clientHeight : 1;
    let dx = e.deltaX * factor, dy = e.deltaY * factor;
    if (e.shiftKey || content.scrollHeight <= content.clientHeight && content.scrollWidth > content.clientWidth) { dx += dy; dy = 0; }
    const before = [content.scrollLeft, content.scrollTop];
    content.scrollLeft += dx; content.scrollTop += dy;
    if (before[0] !== content.scrollLeft || before[1] !== content.scrollTop) e.preventDefault();
  }, { passive: false });
}

export class DragController {
  constructor({ identify, resolve, highlight, drop, tap, cue, motion }) {
    Object.assign(this, { identify, resolve, highlight, drop, tap, cue, motion });
    this.drag = null; this.suppressUntil = 0;
    document.addEventListener('pointerdown', e => this.down(e));
    document.addEventListener('pointermove', e => this.move(e), { passive: false });
    document.addEventListener('pointerup', e => this.up(e));
    document.addEventListener('pointercancel', () => this.cancel());
    document.addEventListener('click', e => { if (e.detail !== 0 && performance.now() < this.suppressUntil && e.target.closest('[data-drag]')) { e.preventDefault(); e.stopImmediatePropagation(); } }, true);
    window.addEventListener('blur', () => this.cancel());
    window.addEventListener('resize', () => this.cancel());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.cancel(); });
  }
  down(e) {
    if (this.drag) { this.cancel(); this.suppressUntil = performance.now() + 500; return; }
    // A new physical press is intentional, even immediately after another drag.
    // Only the synthetic click belonging to the completed gesture is suppressed.
    this.suppressUntil = 0;
    if (!e.isPrimary || e.button !== 0 || e.target.closest('[data-action]')) return;
    const el = e.target.closest('[data-drag]');
    if (!el) return;
    const item = this.identify(el);
    if (!item) return;
    this.drag = { item, el, pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, x: e.clientX, y: e.clientY, rect: el.getBoundingClientRect(), started: false };
    try { el.setPointerCapture(e.pointerId); } catch {}
  }
  move(e) {
    const d = this.drag;
    if (!d || d.pointerId !== e.pointerId || d.settling) return;
    d.x = e.clientX; d.y = e.clientY;
    if (!d.started && Math.hypot(d.x - d.startX, d.y - d.startY) < 8) return;
    e.preventDefault();
    if (!d.started) {
      d.started = true; this.suppressUntil = Infinity;
      d.ghost = d.el.cloneNode(true); d.ghost.removeAttribute('id'); d.ghost.removeAttribute('data-drag'); d.ghost.removeAttribute('data-card-id');
      d.ghost.setAttribute('aria-hidden', 'true'); d.ghost.classList.remove('selected'); d.ghost.classList.add('drag-ghost');
      Object.assign(d.ghost.style, { width: `${d.rect.width}px`, height: `${d.rect.height}px`, left: `${d.rect.left}px`, top: `${d.rect.top}px` });
      document.body.append(d.ghost); d.el.classList.add('drag-origin'); document.body.classList.add('dragging');
      this.cue('lift'); this.frame = requestAnimationFrame(() => this.autoScroll());
    }
    d.ghost.style.left = `${d.rect.left + d.x - d.startX}px`;
    d.ghost.style.top = `${d.rect.top + d.y - d.startY}px`;
    d.zone = this.resolve(d.item, d.x, d.y); this.highlight(d.zone);
  }
  autoScroll() {
    const d = this.drag;
    if (!d?.started || d.settling) return;
    const board = document.querySelector('#board'), line = document.querySelector('.line-items');
    for (const area of [board, line]) {
      if (!area) continue;
      const r = area.getBoundingClientRect();
      if (d.y < r.top || d.y > r.bottom || d.x < r.left - 15 || d.x > r.right + 15) continue;
      const speed = v => Math.max(-12, Math.min(12, v));
      if (d.x < r.left + 35) area.scrollLeft -= speed((r.left + 35 - d.x) / 3);
      if (d.x > r.right - 35) area.scrollLeft += speed((d.x - r.right + 35) / 3);
      if (area === board) {
        if (d.y < r.top + 35) area.scrollTop -= speed((r.top + 35 - d.y) / 3);
        if (d.y > r.bottom - 35) area.scrollTop += speed((d.y - r.bottom + 35) / 3);
      }
    }
    d.zone = this.resolve(d.item, d.x, d.y); this.highlight(d.zone);
    this.frame = requestAnimationFrame(() => this.autoScroll());
  }
  async up(e) {
    const d = this.drag;
    if (!d || d.pointerId !== e.pointerId || d.settling) return;
    if (!d.started) { this.cleanup(); return; }
    d.settling = true; cancelAnimationFrame(this.frame); this.highlight(null);
    this.suppressUntil = performance.now() + 800;
    const zone = this.resolve(d.item, e.clientX, e.clientY);
    let accepted = false;
    try { accepted = zone ? await this.drop(d.item, zone) : false; } catch { accepted = false; }
    if (this.drag !== d) return;
    this.cue(accepted ? 'place' : 'return');
    const rect = accepted ? zone?.rect : d.rect;
    const reduce = this.motion() !== 'full' || matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (rect && !reduce) {
      const animation = d.ghost.animate([{ left: d.ghost.style.left, top: d.ghost.style.top, transform: 'scale(1.05) rotate(-2deg)', opacity: .96 }, { left: `${rect.left}px`, top: `${rect.top}px`, transform: 'scale(1)', opacity: accepted ? 0 : .9 }], { duration: accepted ? 210 : 280, easing: 'cubic-bezier(.2,.7,.3,1)', fill: 'forwards' });
      await animation.finished.catch(() => {});
    }
    this.cleanup();
  }
  cancel() {
    if (this.drag?.started) { this.suppressUntil = performance.now() + 500; this.cue('return'); }
    this.cleanup();
  }
  cleanup() {
    const d = this.drag;
    cancelAnimationFrame(this.frame);
    if (d) {
      try { if (d.el.hasPointerCapture(d.pointerId)) d.el.releasePointerCapture(d.pointerId); } catch {}
      d.el.classList.remove('drag-origin'); d.ghost?.remove();
    }
    if (this.suppressUntil === Infinity) this.suppressUntil = performance.now() + 500;
    document.body.classList.remove('dragging'); this.highlight(null); this.drag = null;
  }
}
