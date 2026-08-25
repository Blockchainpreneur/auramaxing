#!/usr/bin/env node
/**
 * cdp-lite — dependency-free Chrome DevTools Protocol client for AURAMAXING.
 *
 * Why this exists: playwright's connectOverCDP() hangs on the user's CDP Chrome
 * (31+ targets incl. browser_ui / service_worker targets that never finish the
 * auto-attach handshake). This client attaches ONLY to the one page it needs.
 *
 * Bonus (critical for ChatGPT voice mode): input dispatched through
 * Input.dispatchMouseEvent / Input.insertText is TRUSTED by the renderer and
 * grants user-activation, so getUserMedia + audio autoplay are allowed.
 * Synthetic el.click() from Runtime.evaluate does NOT grant activation.
 *
 * Requires Node's WebSocket (node >= 21, or node 20 with --experimental-websocket).
 * Entry scripts should call ensureWebSocket() before importing this module.
 */
import { writeFileSync } from 'fs';

const DEFAULT_TIMEOUT = 30000;
const EVAL_TIMEOUT = 12000;   // page evaluations: fail fast and retry instead of hanging

export function needsWebSocketRespawn() {
  return typeof WebSocket === 'undefined';
}

export class CDP {
  constructor(ws, port) {
    this.ws = ws;
    this.port = port;
    this._id = 0;
    this._pending = new Map();
    this._events = [];
    ws.onmessage = (ev) => this._onMessage(typeof ev.data === 'string' ? ev.data : String(ev.data));
    ws.onclose = () => {
      for (const [, p] of this._pending) p.reject(new Error('CDP socket closed'));
      this._pending.clear();
      this.closed = true;
    };
  }

  static async listTargets(port = 9222) {
    const res = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(5000) });
    return res.json();
  }

  static async connect(port = 9222, timeout = 15000) {
    const res = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(5000) });
    const ver = await res.json();
    const ws = new WebSocket(ver.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('CDP websocket connect timeout')), timeout);
      ws.onopen = () => { clearTimeout(t); resolve(); };
      ws.onerror = () => { clearTimeout(t); reject(new Error('CDP websocket error')); };
    });
    return new CDP(ws, port);
  }

  _onMessage(raw) {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (msg.id !== undefined && this._pending.has(msg.id)) {
      const { resolve, reject, timer, method } = this._pending.get(msg.id);
      clearTimeout(timer);
      this._pending.delete(msg.id);
      if (msg.error) reject(new Error(`CDP ${method} failed: ${msg.error.message || 'error'}${msg.error.data ? ' — ' + msg.error.data : ''}`));
      else resolve(msg.result);
      return;
    }
    if (msg.method) {
      this._events.push(msg);
      if (this._events.length > 500) this._events.splice(0, 250);
    }
  }

  send(method, params = {}, sessionId, timeout = DEFAULT_TIMEOUT) {
    if (this.closed) return Promise.reject(new Error('CDP socket closed'));
    const id = ++this._id;
    const payload = JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._pending.delete(id);
        reject(new Error(`CDP timeout: ${method}`));
      }, timeout);
      this._pending.set(id, { resolve, reject, timer, method });
      this.ws.send(payload);
    });
  }

  /** Attach to an existing page target (by targetId) and return a Session. */
  async attach(targetId) {
    const { sessionId } = await this.send('Target.attachToTarget', { targetId, flatten: true });
    const s = new Session(this, sessionId, targetId);
    await s.init();
    return s;
  }

  /** Open a NEW TAB (never a new window) and return a Session for it. */
  async newTab(url = 'about:blank') {
    const { targetId } = await this.send('Target.createTarget', { url });
    return this.attach(targetId);
  }

  /** Find the first page target whose url matches `re`. HTTP /json/list uses `id`, not `targetId`. */
  async findPage(re) {
    const targets = await CDP.listTargets(this.port);
    const t = targets.find((x) => x.type === 'page' && re.test(x.url));
    return t ? { ...t, targetId: t.targetId || t.id } : null;
  }

  async grantPermissions(origin, permissions) {
    // Browser-level; e.g. permissions: ['audioCapture'] for the microphone.
    return this.send('Browser.grantPermissions', { origin, permissions });
  }

  close() { try { this.ws.close(); } catch {} }
}

export class Session {
  constructor(cdp, sessionId, targetId) {
    this.cdp = cdp;
    this.sessionId = sessionId;
    this.targetId = targetId;
  }

  async init() {
    await this.send('Page.enable').catch(() => {});
    await this.send('Runtime.enable').catch(() => {});
    await this.send('DOM.enable').catch(() => {});
  }

  send(method, params, timeout) { return this.cdp.send(method, params, this.sessionId, timeout); }

  /** Evaluate an expression in the page; returns the value by value. */
  async eval(expression, { awaitPromise = false, timeout = EVAL_TIMEOUT, retries = 1 } = {}) {
    let r;
    for (let attempt = 0; ; attempt++) {
      try {
        r = await this.send('Runtime.evaluate', {
          expression, returnByValue: true, awaitPromise, userGesture: true,
        }, timeout);
        break;
      } catch (err) {
        // A throttled or navigating renderer can drop the reply entirely.
        if (attempt >= retries || !/timeout/i.test(String(err.message))) throw err;
        await new Promise((r2) => setTimeout(r2, 700));
      }
    }
    if (r.exceptionDetails) {
      throw new Error(`page eval failed: ${r.exceptionDetails.exception?.description || r.exceptionDetails.text}`);
    }
    return r.result?.value;
  }

  /** Evaluate a JS function (as a real function, stringified) with JSON args. */
  async call(fn, ...args) {
    const expr = `(${fn.toString()})(${args.map((a) => JSON.stringify(a === undefined ? null : a)).join(',')})`;
    return this.eval(expr);
  }

  async navigate(url, { timeout = 45000 } = {}) {
    await this.send('Page.navigate', { url }, timeout);
    await this.waitFor(() => document.readyState === 'complete' || document.readyState === 'interactive', { timeout });
  }

  async url() { return this.eval('location.href'); }

  /** Poll a page-side predicate until it returns truthy (or timeout). */
  async waitFor(fn, { timeout = 30000, interval = 400, arg } = {}) {
    const deadline = Date.now() + timeout;
    let last;
    while (Date.now() < deadline) {
      try { last = await this.call(fn, arg); } catch { last = null; }
      if (last) return last;
      await new Promise((r) => setTimeout(r, interval));
    }
    return null;
  }

  /** Center point of the first element matching `selector`, after scrolling it into view. */
  async rectOf(selector) {
    return this.call((sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      el.scrollIntoView({ block: 'center', inline: 'center' });
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return null;
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height };
    }, selector);
  }

  /** TRUSTED click (real user activation) at the element's center. */
  async click(selector) {
    const rect = await this.rectOf(selector);
    if (!rect) return false;
    return this.clickAt(rect.x, rect.y);
  }

  /**
   * Hover → settle → press → release. The settle delay is NOT cosmetic: clicking
   * ChatGPT's voice button with press-immediately-after-move silently no-ops
   * (verified 2026-08-25), while hover+250ms activates it every time.
   */
  async clickAt(x, y, { settle = 250 } = {}) {
    const base = { x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1, buttons: 1 };
    await this.send('Input.dispatchMouseEvent', { ...base, type: 'mouseMoved', buttons: 0 });
    await new Promise((r) => setTimeout(r, settle));
    await this.send('Input.dispatchMouseEvent', { ...base, type: 'mousePressed' });
    await new Promise((r) => setTimeout(r, 90));
    await this.send('Input.dispatchMouseEvent', { ...base, type: 'mouseReleased', buttons: 0 });
    return true;
  }

  /** What element is actually at that point (catches overlays stealing the click). */
  async hitTest(x, y) {
    return this.call((p) => {
      const el = document.elementFromPoint(p.x, p.y);
      if (!el) return null;
      const b = el.closest('button,[role="button"],[role="menuitem"]');
      return { tag: el.tagName, label: b?.getAttribute('aria-label') || null, testid: b?.getAttribute('data-testid') || null };
    }, { x: Math.round(x), y: Math.round(y) });
  }

  async focus(selector) {
    return this.call((sel) => {
      const el = document.querySelector(sel);
      if (!el) return false;
      el.focus();
      return document.activeElement === el || el.contains(document.activeElement);
    }, selector);
  }

  /** Trusted text insertion (IME-style commit — works with ProseMirror composers). */
  async insertText(text) { await this.send('Input.insertText', { text }); }

  async pressKey(key, code, keyCode) {
    const common = { key, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode };
    await this.send('Input.dispatchKeyEvent', { type: 'keyDown', ...common });
    await this.send('Input.dispatchKeyEvent', { type: 'keyUp', ...common });
  }

  async pressEnter() { await this.pressKey('Enter', 'Enter', 13); }

  async screenshot(path) {
    const { data } = await this.send('Page.captureScreenshot', { format: 'png' }, 45000);
    writeFileSync(path, Buffer.from(data, 'base64'));
    return path;
  }

  async bringToFront() { await this.send('Page.bringToFront').catch(() => {}); }
}
