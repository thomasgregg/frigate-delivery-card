/**
 * Frigate Delivery Card
 * https://github.com/thomasgregg/frigate-delivery-card
 *
 * A lightweight Lovelace card that shows Frigate event snapshots filtered by
 * sub_label (e.g. delivery companies recognized by a Frigate+ model), with an
 * auto-advancing slideshow, thumbnail strip, per-company filter chips, an
 * event list view and a fullscreen lightbox.
 *
 * Data source: the official Frigate Home Assistant integration websocket API
 * (frigate/events/get) — no files on disk, no shell commands, no polling of
 * the Frigate server from the browser.
 *
 * License: MIT
 */

const FDC_VERSION = "1.12.0";

/** Brand colors for well-known delivery sub_labels (bg / fg). */
const FDC_COLORS = {
  dhl: { bg: "#FFCC00", fg: "#D40511" },
  dpd: { bg: "#DC0032", fg: "#FFFFFF" },
  gls: { bg: "#061AB1", fg: "#FFD100" },
  ups: { bg: "#351C15", fg: "#FFB500" },
  amazon: { bg: "#232F3E", fg: "#FF9900" },
  hermes: { bg: "#0091DF", fg: "#FFFFFF" },
  fedex: { bg: "#4D148C", fg: "#FF6600" },
};

const FDC_SCHEMA = [
  { name: "camera", required: true, selector: { text: {} } },
  { name: "sub_labels", selector: { text: { multiple: true } } },
  { name: "labels", selector: { text: { multiple: true } } },
  { name: "zones", selector: { text: { multiple: true } } },
  {
    name: "view",
    selector: {
      select: {
        mode: "dropdown",
        options: [
          { value: "reel", label: "Reel (slideshow + thumbnail strip)" },
          { value: "timeline", label: "Timeline (brand-colored time pills + slideshow)" },
        ],
      },
    },
  },
  {
    name: "sort",
    selector: {
      select: {
        mode: "dropdown",
        options: [
          { value: "newest", label: "Newest first" },
          { value: "oldest", label: "Oldest first" },
        ],
      },
    },
  },
  { name: "clips", selector: { boolean: {} } },
  {
    name: "period",
    selector: {
      select: {
        mode: "dropdown",
        options: [
          { value: "hours", label: "Rolling window (look back N hours)" },
          { value: "today", label: "Today (since local midnight)" },
        ],
      },
    },
  },
  {
    type: "grid",
    name: "",
    schema: [
      { name: "hours", selector: { number: { min: 1, max: 720, mode: "box" } } },
      { name: "slideshow", selector: { number: { min: 0, max: 60, mode: "box" } } },
      { name: "limit", selector: { number: { min: 1, max: 500, mode: "box" } } },
      { name: "refresh", selector: { number: { min: 10, max: 3600, mode: "box" } } },
    ],
  },
  { name: "instance_id", selector: { text: {} } },
];

const FDC_LABELS = {
  camera: "Frigate camera name (as in Frigate config)",
  sub_labels: "Sub labels (e.g. dhl, ups - empty = no sub_label filter)",
  labels: "Labels (optional, e.g. person)",
  zones: "Zones (optional, e.g. mailbox)",
  view: "View",
  sort: "Sort order",
  clips: "Clip playback button (requires 'record' enabled in Frigate)",
  period: "Time range",
  hours: "Look back (hours, only used for rolling window)",
  slideshow: "Slideshow interval (s, 0 = off)",
  limit: "Max events",
  refresh: "Refresh every (s)",
  instance_id: "Frigate instance id",
};

class FrigateDeliveryCardEditor extends HTMLElement {
  setConfig(config) {
    this._config = config || {};
    this._render();
  }
  set hass(h) {
    this._hass = h;
    if (this._form) this._form.hass = h;
  }
  _render() {
    if (!this._form) {
      this._form = document.createElement("ha-form");
      this._form.computeLabel = (s) => FDC_LABELS[s.name] || s.name;
      this._form.addEventListener("value-changed", (ev) => {
        const cfg = { ...this._config, ...ev.detail.value };
        for (const k of ["sub_labels", "labels", "zones"]) {
          if (Array.isArray(cfg[k])) {
            cfg[k] = cfg[k].map((v) => String(v).trim()).filter((v) => v);
            if (!cfg[k].length && k !== "sub_labels") delete cfg[k];
          }
        }
        this._config = cfg;
        this.dispatchEvent(
          new CustomEvent("config-changed", { detail: { config: cfg }, bubbles: true, composed: true })
        );
      });
      this.appendChild(this._form);
    }
    this._form.hass = this._hass;
    this._form.data = {
      view: "reel",
      sort: "newest",
      clips: true,
      period: "hours",
      hours: 24,
      slideshow: 6,
      limit: 100,
      refresh: 120,
      instance_id: "frigate",
      sub_labels: ["dhl", "dpd", "gls", "ups", "amazon"],
      ...this._config,
    };
    this._form.schema = FDC_SCHEMA;
  }
}
customElements.define("frigate-delivery-card-editor", FrigateDeliveryCardEditor);

class FrigateDeliveryCard extends HTMLElement {
  static getConfigElement() {
    return document.createElement("frigate-delivery-card-editor");
  }
  static getStubConfig() {
    return {
      camera: "entrance",
      sub_labels: ["dhl", "dpd", "gls", "ups", "amazon"],
      hours: 24,
    };
  }

  setConfig(cfg) {
    if (!cfg.camera && !cfg.cameras) {
      throw new Error("frigate-delivery-card: please set 'camera' (or 'cameras').");
    }
    this._cfg = Object.assign(
      {
        instance_id: "frigate",
        camera: null,
        cameras: null,
        labels: null,       // optional: e.g. ["person"]
        sub_labels: ["dhl", "dpd", "gls", "ups", "amazon"],
        zones: null,        // optional: e.g. ["mailbox"]
        view: "reel",       // "reel" | "timeline"
        sort: "newest",     // "newest" | "oldest"
        clips: true,        // show the clip playback button (requires record enabled in Frigate)
        period: "hours",    // "hours" = rolling window | "today" = since local midnight
        hours: 24,          // only used when period === "hours"
        limit: 100,
        slideshow: 6,       // seconds; 0 disables auto-advance
        refresh: 120,       // seconds between refetches
      },
      cfg
    );
    if (!["reel", "timeline"].includes(this._cfg.view)) this._cfg.view = "reel"; // list/combined removed in 1.5.0
    if (!["newest", "oldest"].includes(this._cfg.sort)) this._cfg.sort = "newest";
    this._cfg.clips = this._cfg.clips !== false;
    this._events = [];
    this._idx = 0;
    this._filter = null;
    this._hover = false;
    this._playing = false; // false | true (clip playing inline) | "error" (no clip)
    this._clipFor = null;  // event id the clip belongs to
    this._hls = null;      // hls.js instance while a clip is playing
  }

  getCardSize() {
    return 6;
  }

  set hass(h) {
    this._hass = h;
    if (!this.shadowRoot) this._build();
    if (!this._booted) {
      this._booted = true;
      this._fetch();
      this._poll = setInterval(() => this._fetch(), this._cfg.refresh * 1000);
      this._scheduleMidnight();
      this._startShow();
    }
  }

  disconnectedCallback() {
    if (this._poll) clearInterval(this._poll);
    if (this._mid) clearTimeout(this._mid);
    this._stopClip();
    this._stopShow();
    this._poll = null;
    this._mid = null;
    this._booted = false;
  }

  /** In "today" mode, wipe the reel promptly when the day rolls over. */
  _scheduleMidnight() {
    if (this._mid) clearTimeout(this._mid);
    this._mid = null;
    if (this._cfg.period !== "today") return;
    const next = new Date();
    next.setHours(24, 0, 5, 0); // 5 s past local midnight
    this._mid = setTimeout(() => {
      this._fetch();
      this._scheduleMidnight();
    }, next.getTime() - Date.now());
  }

  _startShow() {
    this._stopShow();
    const s = Number(this._cfg.slideshow);
    if (s > 0)
      this._show = setInterval(() => {
        if (!this._hover && !this._playing && this._list().length > 1) {
          this._idx = (this._idx + 1) % this._list().length;
          this._render();
        }
      }, s * 1000);
  }

  _stopShow() {
    if (this._show) {
      clearInterval(this._show);
      this._show = null;
    }
  }

  /** Unix timestamp (s) that events must start after. */
  _after() {
    if (this._cfg.period === "today") {
      const d = new Date();
      d.setHours(0, 0, 0, 0); // local midnight - DST/timezone safe
      return Math.floor(d.getTime() / 1000);
    }
    return Math.floor(Date.now() / 1000) - this._cfg.hours * 3600;
  }

  /** Human wording for the current time range, used in the empty state. */
  _scope() {
    return this._cfg.period === "today" ? "today" : `in the last ${this._cfg.hours} h`;
  }

  async _fetch() {
    if (!this._hass) return;
    const c = this._cfg;
    const msg = {
      type: "frigate/events/get",
      instance_id: c.instance_id,
      cameras: c.cameras || [c.camera],
      after: this._after(),
      limit: c.limit,
    };
    if (Array.isArray(c.labels) && c.labels.length) msg.labels = c.labels;
    if (Array.isArray(c.sub_labels) && c.sub_labels.length) msg.sub_labels = c.sub_labels;
    if (Array.isArray(c.zones) && c.zones.length) msg.zones = c.zones;
    try {
      let res = await this._hass.callWS(msg);
      if (typeof res === "string") res = JSON.parse(res);
      const evs = (Array.isArray(res) ? res : [])
        .map((e) => ({
          id: e.id,
          co: String(
            Array.isArray(e.sub_label) ? e.sub_label[0] : e.sub_label || e.label || ""
          )
            .split(",")[0]
            .trim()
            .toLowerCase(),
          t: e.start_time,
        }))
        .filter((e) => e.id && e.co)
        .sort((a, b) => (c.sort === "oldest" ? a.t - b.t : b.t - a.t));
      const cur = this._list()[this._idx];
      this._events = evs;
      const keep = cur ? this._list().findIndex((e) => e.id === cur.id) : -1;
      this._idx = keep >= 0 ? keep : 0;
      this._err = null;
    } catch (e) {
      this._err = (e && e.message) || "Frigate query failed";
    }
    if (!this._playing) this._render(); // don't interrupt inline clip playback on refresh
  }

  _list() {
    return this._filter ? this._events.filter((e) => e.co === this._filter) : this._events;
  }

  _img(id) {
    return `/api/frigate/notifications/${id}/snapshot.jpg`;
  }

  /** Small object-crop thumbnail - exists for every event, even without a saved snapshot. */
  _thumb(id) {
    return `/api/frigate/notifications/${id}/thumbnail.jpg`;
  }

  /** &#9654; plays the event PREVIEW first: Frigate's low-res fast-forward render
   *  of the whole event (~100 KB) - loads in well under a second even on slow
   *  remote connections. The HD button switches to the full-quality recording. */
  _startClip(id) {
    this._stopClip();
    this._clipFor = id;
    this._playing = "preview";
    this._render();
  }

  /** Frigate's preview GIF is a raw ~1 fps timelapse that plays back far too
   *  fast. Where the browser supports it (Chrome/Edge), decode the GIF frames
   *  and re-play them on a canvas slowed down to a watchable pace. Falls back
   *  to the plain (fast) GIF elsewhere. */
  async _runPreview(id) {
    const token = (this._pvToken = (this._pvToken || 0) + 1);
    const alive = () => this._pvToken === token && this._playing === "preview" && this._clipFor === id;
    const sr = this.shadowRoot;
    const fallbackImg = () => {
      const c = sr && sr.querySelector("#pvc");
      if (!c || !alive()) return;
      const img = document.createElement("img");
      img.className = "pv";
      img.onerror = () => { if (alive()) this._startHd(id); };
      img.src = this._preview(id);
      c.replaceWith(img);
    };
    try {
      if (!("ImageDecoder" in window)) return fallbackImg();
      const res = await fetch(this._preview(id));
      if (!res.ok) { if (alive()) this._startHd(id); return; }
      const buf = await res.arrayBuffer();
      if (!alive()) return;
      const dec = new ImageDecoder({ data: buf, type: "image/gif" });
      await dec.tracks.ready;
      const count = dec.tracks.selectedTrack.frameCount;
      if (!count) return fallbackImg();
      const canvas = sr && sr.querySelector("#pvc");
      if (!canvas || !alive()) return;
      const ctx = canvas.getContext("2d");
      const slow = Number(this._cfg.preview_slowdown) > 0 ? Number(this._cfg.preview_slowdown) : 3;
      let i = 0;
      const step = async () => {
        if (!alive()) { dec.close(); return; }
        try {
          const { image } = await dec.decode({ frameIndex: i });
          if (!alive()) { image.close(); dec.close(); return; }
          if (canvas.width !== image.displayWidth) {
            canvas.width = image.displayWidth;
            canvas.height = image.displayHeight;
          }
          ctx.drawImage(image, 0, 0);
          const frameMs = image.duration ? image.duration / 1000 : 60;
          image.close();
          i = (i + 1) % count;
          this._pvTimer = setTimeout(step, Math.max(frameMs, 20) * slow);
        } catch (e) {
          dec.close();
          fallbackImg();
        }
      };
      step();
    } catch (e) {
      fallbackImg();
    }
  }

  /** Full-quality playback via Frigate's HLS VOD endpoint: real duration known
   *  immediately, seeking fetches only the segments you jump to. Note the
   *  recording bitrate must fit your connection - best on LAN. */
  _startHd(id) {
    this._stopClip();
    this._clipFor = id;
    this._playing = true;
    this._render();
    this._loadClip(id);
  }

  async _loadClip(id) {
    try {
      // sign the VOD playlist path; the Frigate integration pre-signs every
      // segment URL inside the returned playlist, so no further auth is needed
      const signed = await this._hass.callWS({
        type: "auth/sign_path",
        path: `/api/frigate/vod/event/${id}/index.m3u8`,
        expires: 3600,
      });
      if (this._clipFor !== id || this._playing !== true) return; // user moved on
      const probe = await fetch(signed.path);
      if (this._clipFor !== id || this._playing !== true) return;
      if (!probe.ok) throw new Error(`vod HTTP ${probe.status}`);
      const vid = this.shadowRoot && this.shadowRoot.querySelector("#clipvid");
      if (!vid) return;
      if (vid.canPlayType("application/vnd.apple.mpegurl")) {
        vid.src = signed.path; // Safari: native HLS
        return;
      }
      const Hls = await FrigateDeliveryCard._hlsLib();
      if (this._clipFor !== id || this._playing !== true) return;
      if (Hls && Hls.isSupported()) {
        this._hls = new Hls({ maxBufferLength: 60, backBufferLength: 30 });
        this._hls.loadSource(signed.path);
        this._hls.attachMedia(vid);
        this._hls.on(Hls.Events.ERROR, (_e, data) => {
          if (data && data.fatal) this._clipFallback(id);
        });
        return;
      }
      throw new Error("HLS not supported");
    } catch (e) {
      this._clipFallback(id);
    }
  }

  /** Plain progressive stream of the full-quality clip (LAN-friendly fallback). */
  _clipFallback(id) {
    if (this._clipFor !== id || this._playing !== true) return;
    if (this._hls) {
      this._hls.destroy();
      this._hls = null;
    }
    const vid = this.shadowRoot && this.shadowRoot.querySelector("#clipvid");
    if (vid) vid.src = this._clip(id);
  }

  /** Lazy-load hls.js once, shared by all card instances. */
  static _hlsLib() {
    if (window.Hls) return Promise.resolve(window.Hls);
    if (!FrigateDeliveryCard._hlsPromise) {
      FrigateDeliveryCard._hlsPromise = new Promise((resolve) => {
        const s = document.createElement("script");
        s.src = "https://cdn.jsdelivr.net/npm/hls.js@1.5.20/dist/hls.min.js";
        s.onload = () => resolve(window.Hls || null);
        s.onerror = () => resolve(null);
        document.head.appendChild(s);
      });
    }
    return FrigateDeliveryCard._hlsPromise;
  }

  _stopClip() {
    if (this._hls) {
      this._hls.destroy();
      this._hls = null;
    }
    if (this._pvTimer) {
      clearTimeout(this._pvTimer);
      this._pvTimer = null;
    }
    this._pvToken = (this._pvToken || 0) + 1; // invalidates any running preview loop
    this._clipFor = null;
    this._playing = false;
  }

  _clip(id) {
    return `/api/frigate/notifications/${id}/clip.mp4`;
  }

  /** Low-res fast-forward preview of the whole event (small, loads instantly). */
  _preview(id) {
    return `/api/frigate/notifications/${id}/event_preview.gif`;
  }

  _when(t) {
    const d = new Date(t * 1000);
    const now = new Date();
    const hm = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    if (d.toDateString() === now.toDateString()) return hm;
    const yest = new Date(now);
    yest.setDate(now.getDate() - 1);
    if (d.toDateString() === yest.toDateString()) return `yesterday ${hm}`;
    return `${d.toLocaleDateString()} ${hm}`;
  }

  /** Inline style for a company badge; falls back to theme colors. */
  _badge(co) {
    const c = FDC_COLORS[co];
    return c
      ? `background:${c.bg};color:${c.fg};border-color:${c.bg}`
      : `background:var(--secondary-background-color);color:var(--primary-text-color);border-color:var(--divider-color)`;
  }

  _build() {
    const r = this.attachShadow({ mode: "open" });
    r.innerHTML = `<style>
      ha-card{overflow:hidden}
      .chips{display:flex;gap:6px;padding:10px 12px 0;flex-wrap:wrap}
      .chip{border-radius:16px;padding:9px 14px;font-size:12px;cursor:pointer;
        background:var(--secondary-background-color);color:var(--primary-text-color);
        border:1px solid var(--divider-color);text-transform:uppercase;letter-spacing:.5px;
        font-weight:700;line-height:1.2}
      .chip.on{box-shadow:0 0 0 2.5px var(--primary-color)}
      .chip.all.on{background:var(--primary-color);color:var(--text-primary-color,#fff);border-color:var(--primary-color)}
      .badge{text-transform:uppercase;letter-spacing:.8px;font-weight:700;font-size:11px;
        border-radius:12px;padding:2px 10px;border:1px solid transparent;flex:none}
      .tl{display:flex;gap:6px;padding:10px 12px 0;overflow-x:auto;
        scrollbar-width:none;-ms-overflow-style:none}
      .tl::-webkit-scrollbar{display:none}
      .pill{border-radius:16px;padding:9px 14px;font-size:12px;font-weight:700;cursor:pointer;
        border:1px solid transparent;flex:none;letter-spacing:.5px;line-height:1.2;
        text-transform:uppercase}
      .stage{position:relative;margin:10px 12px;border-radius:var(--ha-card-border-radius,12px);overflow:hidden;
        aspect-ratio:16/9;background:var(--secondary-background-color);cursor:pointer}
      .stage img{width:100%;height:100%;object-fit:cover;display:block}
      .stage .pv{width:100%;height:100%;object-fit:contain;background:#000;display:block}
      .stage video{width:100%;height:100%;object-fit:contain;background:#000;display:block}
      .cliperr{display:flex;align-items:center;justify-content:center;height:100%;
        color:#fff;background:#000;font-size:14px;padding:20px;text-align:center;line-height:1.6}
      .cap{position:absolute;left:0;right:0;bottom:0;padding:18px 14px 10px;color:#fff;font-size:14px;font-weight:500;
        background:linear-gradient(transparent,rgba(0,0,0,.65));display:flex;justify-content:space-between;align-items:baseline}
      .cap .badge{font-size:12px}
      .nav{position:absolute;top:50%;transform:translateY(-50%);width:34px;height:34px;border-radius:50%;
        background:rgba(0,0,0,.45);color:#fff;border:0;font-size:18px;cursor:pointer;display:flex;align-items:center;justify-content:center}
      .nav:hover{background:rgba(0,0,0,.7)}
      .prev{left:8px}.next{right:8px}
      .playbtn{position:absolute;right:10px;top:10px;width:38px;height:38px;border-radius:50%;
        background:rgba(0,0,0,.5);color:#fff;border:0;cursor:pointer;padding:0;line-height:0;
        display:flex;align-items:center;justify-content:center;transition:background .15s ease}
      .playbtn:hover{background:rgba(0,0,0,.78)}
      .playbtn svg{display:block;margin-left:2px}
      .playbtn.fs{right:56px}
      .playbtn.fs svg{margin-left:0}
      .playbtn.hd{right:56px;font-size:11px;font-weight:700;letter-spacing:.5px;line-height:1}
      .thumbs{display:flex;gap:8px;overflow-x:auto;padding:0 12px 12px}
      .thumbs img{width:96px;height:54px;object-fit:cover;border-radius:8px;cursor:pointer;opacity:.65;flex:none;
        border:2px solid transparent}
      .thumbs img.on{opacity:1;border-color:var(--primary-color)}
      .empty{padding:28px 16px;text-align:center;color:var(--secondary-text-color)}
      .lb{position:fixed;inset:0;background:rgba(0,0,0,.88);display:flex;align-items:center;justify-content:center;z-index:9999;cursor:zoom-out}
      .lb img{max-width:96vw;max-height:96vh;border-radius:6px}
      .lb video{max-width:96vw;max-height:96vh;border-radius:6px;cursor:default}
      .lbmsg{color:#fff;text-align:center;font-size:14px;line-height:1.7;padding:24px;max-width:420px}
    </style><ha-card><div id="body"></div></ha-card>`;
    r.host.addEventListener("mouseenter", () => (this._hover = true));
    r.host.addEventListener("mouseleave", () => (this._hover = false));
  }

  _render() {
    const b = this.shadowRoot && this.shadowRoot.getElementById("body");
    if (!b) return;
    if (this._err) {
      b.innerHTML = `<div class="empty">${this._err}</div>`;
      return;
    }
    const view = this._cfg.view;
    const list = this._list();
    const companies = [...new Set(this._events.map((e) => e.co))];
    const chips = this._events.length && view !== "timeline"
      ? `<div class="chips">
          <button class="chip all ${this._filter ? "" : "on"}" data-co="">${this._filter ? "" : "&#10003; "}All (${this._events.length})</button>
          ${companies
            .map(
              (c) =>
                `<button class="chip ${this._filter === c ? "on" : ""}" style="${this._badge(c)}" data-co="${c}">${
                  this._filter === c ? "&#10003; " : ""
                }${c} (${this._events.filter((e) => e.co === c).length})</button>`
            )
            .join("")}
        </div>`
      : "";
    if (!list.length) {
      b.innerHTML = chips + `<div class="empty">No matching events ${this._scope()}.</div>`;
    } else {
      if (this._idx >= list.length) this._idx = 0;
      const ev = list[this._idx];
      const tl =
        view === "timeline"
          ? `<div class="tl">${list
              .map(
                (e, i) =>
                  `<button class="pill ${i === this._idx ? "on" : ""}" style="${this._badge(e.co)}" title="${e.co}" data-i="${i}">${
                    i === this._idx ? "&#10003; " : ""
                  }${this._when(e.t)}</button>`
              )
              .join("")}</div>`
          : "";
      const media =
        this._playing === true
          ? `<video id="clipvid" controls autoplay playsinline></video>`
          : this._playing === "preview"
          ? `<canvas class="pv" id="pvc"></canvas>`
          : this._playing === "error"
          ? `<div class="cliperr">No clip available for this event.<br>Clips require <b>record</b> to be enabled in Frigate.</div>`
          : `<img src="${this._img(ev.id)}" alt="${ev.co}" onerror="this.onerror=null;this.src='${this._thumb(ev.id)}'">`;
      const stage = `
        <div class="stage" id="stage">
          ${media}
          ${
            list.length > 1 && !this._playing
              ? `<button class="nav prev" id="prev">&#8249;</button><button class="nav next" id="next">&#8250;</button>`
              : ""
          }
          ${
            this._cfg.clips
              ? this._playing
                ? `<button class="playbtn" id="play" title="Back to image"><svg viewBox="0 0 24 24" width="18" height="18"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" fill="none"/></svg></button>`
                : `<button class="playbtn" id="play" title="Play clip"><svg viewBox="0 0 24 24" width="20" height="20"><path d="M8 5v14l11-7z" fill="currentColor"/></svg></button>`
              : ""
          }
          ${
            this._playing === "preview"
              ? `<button class="playbtn hd" id="hd" title="Full quality (needs fast connection)">HD</button>`
              : this._playing
              ? ""
              : `<button class="playbtn fs" id="fs" title="Fullscreen"><svg viewBox="0 0 24 24" width="18" height="18"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" fill="none"/></svg></button>`
          }
          ${
            this._playing === true
              ? ""
              : `<div class="cap"><span class="badge" style="${this._badge(ev.co)}">${ev.co}</span><span>${this._when(
                  ev.t
                )} &#183; ${this._idx + 1}/${list.length}</span></div>`
          }
        </div>`;
      const thumbs =
        view === "reel"
          ? `<div class="thumbs">${list
              .map(
                (e, i) =>
                  `<img src="${this._img(e.id)}" class="${i === this._idx ? "on" : ""}" data-i="${i}" alt="${e.co}" onerror="this.onerror=null;this.src='${this._thumb(e.id)}'">`
              )
              .join("")}</div>`
          : "";
      b.innerHTML = chips + tl + stage + thumbs;
      const go = (i) => {
        this._idx = (i + list.length) % list.length;
        this._stopClip();
        this._render();
      };
      const q = (s) => b.querySelector(s);
      if (q("#prev")) q("#prev").onclick = (e) => { e.stopPropagation(); go(this._idx - 1); };
      if (q("#next")) q("#next").onclick = (e) => { e.stopPropagation(); go(this._idx + 1); };
      if (q("#fs"))
        q("#fs").onclick = (e) => {
          e.stopPropagation();
          this._lightbox(ev.id);
        };
      if (q("#hd"))
        q("#hd").onclick = (e) => {
          e.stopPropagation();
          this._startHd(ev.id);
        };
      if (q("#pvc")) this._runPreview(ev.id);
      if (q("#play"))
        q("#play").onclick = (e) => {
          e.stopPropagation();
          if (this._playing) {
            this._stopClip();
            this._render();
          } else {
            this._startClip(ev.id);
          }
        };
      const vid = q("#clipvid");
      if (vid) {
        vid.onended = () => { this._stopClip(); this._render(); };
        vid.onerror = () => {
          if (this._hls) return; // hls.js handles its own errors (with mp4 fallback)
          if (!vid.src) return;  // no source attached yet
          this._stopClip();
          this._playing = "error";
          this._render();
        };
      }
      b.querySelectorAll(".thumbs img").forEach((el) => (el.onclick = () => go(Number(el.dataset.i))));
      b.querySelectorAll(".pill").forEach((el) => (el.onclick = () => go(Number(el.dataset.i))));
      const onPill = b.querySelector(".pill.on");
      if (onPill) onPill.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
    b.querySelectorAll(".chip").forEach(
      (el) =>
        (el.onclick = () => {
          this._filter = el.dataset.co || null;
          this._idx = 0;
          this._stopClip();
          this._render();
        })
    );
  }

  _lightbox(id) {
    const d = document.createElement("div");
    d.className = "lb";
    d.innerHTML = `<img src="${this._img(id)}" onerror="this.onerror=null;this.src='${this._thumb(id)}'">`;
    d.onclick = () => d.remove();
    this.shadowRoot.appendChild(d);
  }

}

customElements.define("frigate-delivery-card", FrigateDeliveryCard);
// Legacy alias (pre-1.0 inline version used this element name)
if (!customElements.get("delivery-reel-card")) {
  customElements.define("delivery-reel-card", class extends FrigateDeliveryCard {});
}

window.customCards = window.customCards || [];
window.customCards.push({
  type: "frigate-delivery-card",
  name: "Frigate Delivery Card",
  description:
    "Frigate event snapshots filtered by sub_label (delivery companies, faces, plates) with slideshow, list view, filter chips and lightbox.",
});

console.info(
  `%c FRIGATE-DELIVERY-CARD %c v${FDC_VERSION} `,
  "color:#fff;background:#03a9f4;font-weight:700",
  "color:#03a9f4;background:#fff;font-weight:700"
);
