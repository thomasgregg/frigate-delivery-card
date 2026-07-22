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

const FDC_VERSION = "1.24.0";

/** Brand colors for well-known delivery sub_labels (bg / fg). */
const FDC_COLORS = {
  dhl: { bg: "#FFCC00", fg: "#D40511" },
  dpd: { bg: "#DC0032", fg: "#FFFFFF" },
  gls: { bg: "#061AB1", fg: "#FFD100" },
  ups: { bg: "#351C15", fg: "#FFB500" },
  amazon: { bg: "#232F3E", fg: "#FF9900" },
  hermes: { bg: "#0091DF", fg: "#FFFFFF" },
  fedex: { bg: "#4D148C", fg: "#FF6600" },
  usps: { bg: "#333366", fg: "#FFFFFF" },
  postnl: { bg: "#FF6200", fg: "#001A70" },
  postnord: { bg: "#00A0D6", fg: "#FFFFFF" },
  royal_mail: { bg: "#DA202A", fg: "#FFDD00" },
  an_post: { bg: "#00594C", fg: "#FFFFFF" },
  canada_post: { bg: "#E31837", fg: "#FFFFFF" },
  purolator: { bg: "#003087", fg: "#FFFFFF" },
  nzpost: { bg: "#E4002B", fg: "#FFFFFF" },
  other: { bg: "#607D8B", fg: "#FFFFFF" },
};

const FDC_SCHEMA = [
  { name: "camera", required: true, selector: { text: {} } },
  {
    name: "sub_labels",
    selector: {
      select: {
        multiple: true,
        mode: "list",
        options: [
          // every courier logo the current Frigate+ model supports (hermes is
          // still only a candidate label - add it via YAML if you need it)
          "dhl", "dpd", "gls", "ups", "amazon", "fedex", "usps", "postnl",
          "postnord", "royal_mail", "an_post", "canada_post", "purolator", "nzpost",
        ],
      },
    },
  },
  {
    name: "",
    type: "expandable",
    title: "View & playback",
    icon: "mdi:palette-outline",
    schema: [
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
      { name: "show_all", selector: { boolean: {} } },
      { name: "clips", selector: { boolean: {} } },
      {
        type: "grid",
        name: "",
        schema: [
          { name: "slideshow", selector: { number: { min: 0, max: 60, mode: "box" } } },
          { name: "refresh", selector: { number: { min: 10, max: 3600, mode: "box" } } },
        ],
      },
    ],
  },
  {
    name: "",
    type: "expandable",
    title: "Time range",
    icon: "mdi:clock-outline",
    schema: [
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
          { name: "limit", selector: { number: { min: 1, max: 500, mode: "box" } } },
        ],
      },
    ],
  },
  {
    name: "",
    type: "expandable",
    title: "OTHER stops (vehicles without a courier logo)",
    icon: "mdi:truck-alert-outline",
    schema: [
      { name: "unrecognized", selector: { boolean: {} } },
      { name: "unrecognized_min_duration", selector: { number: { min: 5, max: 600, mode: "box" } } },
    ],
  },
  {
    name: "",
    type: "expandable",
    title: "Advanced",
    icon: "mdi:tune",
    schema: [
      {
        name: "labels",
        selector: {
          select: { multiple: true, mode: "list", options: ["person", "car", "package", "bicycle", "motorcycle"] },
        },
      },
      { name: "zones", selector: { text: { multiple: true } } },
      { name: "instance_id", selector: { text: {} } },
    ],
  },
];

const FDC_HELPERS = {
  sub_labels: "Untick all to disable sub_label filtering; custom values can be added via YAML",
  labels: "optional, e.g. person",
  zones: "optional, type your Frigate zone names, e.g. mailbox",
  camera: "as named in your Frigate config",
};

const FDC_LABELS = {
  camera: "Frigate camera name (as in Frigate config)",
  sub_labels: "Couriers / sub labels",
  view: "View",
  sort: "Sort order",
  show_all: "Show the ALL filter chip",
  clips: "Clip playback button (requires 'record' enabled in Frigate)",
  slideshow: "Slideshow interval (s, 0 = off)",
  refresh: "Refresh every (s)",
  period: "Time range",
  hours: "Look back (hours, rolling window only)",
  limit: "Max events",
  unrecognized: "Show stops without a courier logo as OTHER",
  unrecognized_min_duration: "Minimum stop duration (s)",
  labels: "Labels",
  zones: "Zones",
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
      // give focus/press rings of inner controls room to render - without this
      // the rounded outline of e.g. the courier picker gets clipped at the edges
      this.style.display = "block";
      this.style.padding = "0 4px 4px";
      this.style.overflow = "visible";
      this._form = document.createElement("ha-form");
      this._form.computeLabel = (s) => FDC_LABELS[s.name] || s.name;
      this._form.computeHelper = (s) => FDC_HELPERS[s.name];
      this._form.addEventListener("value-changed", (ev) => {
        // NOTE: do not strip empty entries here - the "+ Add" button appends an
        // empty row, and sanitizing it away made the first click appear dead.
        // Empty/whitespace entries are cleaned in the card's setConfig instead.
        const cfg = { ...this._config, ...ev.detail.value };
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
      show_all: true,
      unrecognized: false,
      unrecognized_min_duration: 30,
      period: "hours",
      hours: 24,
      slideshow: 6,
      limit: 100,
      refresh: 120,
      instance_id: "frigate",
      sub_labels: ["dhl", "dpd", "gls", "ups", "amazon", "fedex", "usps", "postnl", "postnord", "royal_mail", "an_post", "canada_post", "purolator", "nzpost"],
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
      sub_labels: ["dhl", "dpd", "gls", "ups", "amazon", "fedex", "usps", "postnl", "postnord", "royal_mail", "an_post", "canada_post", "purolator", "nzpost"],
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
        sub_labels: ["dhl", "dpd", "gls", "ups", "amazon", "fedex", "usps", "postnl", "postnord", "royal_mail", "an_post", "canada_post", "purolator", "nzpost"],
        zones: null,        // optional: e.g. ["mailbox"]
        view: "reel",       // "reel" | "timeline"
        sort: "newest",     // "newest" | "oldest"
        clips: true,        // show the clip playback button (requires record enabled in Frigate)
        show_all: true,     // show the ALL filter chip (total count + one-tap filter reset)
        unrecognized: false, // also show long vehicle stops without a courier logo
        unrecognized_min_duration: 30, // seconds a vehicle must stay to count as a stop
        period: "hours",    // "hours" = rolling window | "today" = since local midnight
        hours: 24,          // only used when period === "hours"
        limit: 100,
        slideshow: 6,       // seconds; 0 disables auto-advance
        refresh: 120,       // seconds between refetches
      },
      cfg
    );
    // clean whitespace/empty entries left over from editing in the visual editor
    for (const k of ["sub_labels", "labels", "zones"]) {
      if (Array.isArray(this._cfg[k])) {
        this._cfg[k] = this._cfg[k].map((v) => String(v).trim()).filter((v) => v);
        if (!this._cfg[k].length && k !== "sub_labels") this._cfg[k] = null;
      }
    }
    if (!["reel", "timeline"].includes(this._cfg.view)) this._cfg.view = "reel"; // list/combined removed in 1.5.0
    if (!["newest", "oldest"].includes(this._cfg.sort)) this._cfg.sort = "newest";
    this._cfg.clips = this._cfg.clips !== false;
    this._events = [];
    this._idx = 0;
    this._filter = null;
    this._hover = false;
    this._playing = false; // false | true (clip playing inline) | "error" (no clip)
    this._clipFor = null;  // event id the clip belongs to
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
      let raw = Array.isArray(res) ? res : [];
      // Optionally include UNRECOGNIZED stops: vehicles that parked long enough
      // to plausibly be a delivery (unbranded subcontractor vans etc.) but got
      // no courier sub_label. Second query without the sub_label filter; only
      // events with no sub_label at all and a minimum duration are added.
      if (c.unrecognized && Array.isArray(c.sub_labels) && c.sub_labels.length) {
        const msg2 = { ...msg, labels: ["car"] };
        delete msg2.sub_labels;
        let res2 = await this._hass.callWS(msg2);
        if (typeof res2 === "string") res2 = JSON.parse(res2);
        const seen = new Set(raw.map((e) => e.id));
        const minDur = Number(c.unrecognized_min_duration) > 0 ? Number(c.unrecognized_min_duration) : 30;
        for (const e of Array.isArray(res2) ? res2 : []) {
          if (seen.has(e.id) || e.sub_label) continue; // already listed / recognized as something else
          const end = e.end_time || Date.now() / 1000;
          if (end - e.start_time < minDur) continue; // drive-by, not a stop
          raw.push({ ...e, __unrecognized: true });
        }
      }
      const evs = raw
        .map((e) => ({
          id: e.id,
          co: e.__unrecognized
            ? "other"
            : String(Array.isArray(e.sub_label) ? e.sub_label[0] : e.sub_label || e.label || "")
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

  /** Inline playback of the full-quality clip as a plain progressive stream -
   *  starts within a couple of seconds and plays at full resolution. The
   *  scrubber only covers what has buffered so far; that's the honest trade-off
   *  of progressive streaming through the HA proxy (no range-request support). */
  _startClip(id) {
    this._stopClip();
    this._clipFor = id;
    this._playing = true;
    this._render();
  }

  _stopClip() {
    this._clipFor = null;
    this._playing = false;
  }

  _clip(id) {
    return `/api/frigate/notifications/${id}/clip.mp4`;
  }

  /** Pick the right clip source for this browser. Safari/iOS (incl. the HA
   *  companion app) refuses progressive MP4 from servers without range-request
   *  support - which the HA proxy lacks - but plays Frigate's HLS VOD natively.
   *  Everything else streams the MP4 directly. The HLS playlist path is signed
   *  via auth/sign_path; the Frigate integration pre-signs every segment URL. */
  async _clipSrc(id) {
    const probe = document.createElement("video");
    if (probe.canPlayType("application/vnd.apple.mpegurl")) {
      try {
        const signed = await this._hass.callWS({
          type: "auth/sign_path",
          path: `/api/frigate/vod/event/${id}/index.m3u8`,
          expires: 3600,
        });
        return signed.path;
      } catch (e) {
        /* fall back to progressive */
      }
    }
    return this._clip(id);
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
      .thumbs{display:flex;gap:8px;overflow-x:auto;padding:0 12px 12px}
      .thumbs img{width:96px;height:54px;object-fit:cover;border-radius:8px;cursor:pointer;opacity:.65;flex:none;
        border:2px solid transparent}
      .thumbs img.on{opacity:1;border-color:var(--primary-color)}
      .empty{padding:28px 16px;text-align:center;color:var(--secondary-text-color)}
      .lb{position:fixed;inset:0;background:rgba(0,0,0,.88);display:flex;align-items:center;justify-content:center;z-index:9999;cursor:zoom-out}
      .lb img{max-width:96vw;max-height:96vh;border-radius:6px}
      .lb video{max-width:96vw;max-height:96vh;border-radius:6px;cursor:default}
      .lbmsg{color:#fff;text-align:center;font-size:14px;line-height:1.7;padding:24px;max-width:420px}
      .lb .playbtn{position:absolute;top:16px;right:16px}
      .lb .playbtn.lbplay{right:64px}
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
    const companies = [...new Set(this._events.map((e) => e.co))].sort(
      (a, b) => (a === "other") - (b === "other") // "other" always last, courier order otherwise unchanged
    );
    const chips = this._events.length && view !== "timeline"
      ? `<div class="chips">
          ${
            this._cfg.show_all !== false
              ? `<button class="chip all ${this._filter ? "" : "on"}" data-co="">${this._filter ? "" : "&#10003; "}All (${this._events.length})</button>`
              : ""
          }
          ${companies
            .map(
              (c) =>
                `<button class="chip ${this._filter === c ? "on" : ""}" style="${this._badge(c)}" data-co="${c}">${
                  this._filter === c ? "&#10003; " : ""
                }${c.replace(/_/g, " ")} (${this._events.filter((e) => e.co === c).length})</button>`
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
            this._playing
              ? ""
              : `<button class="playbtn fs" id="fs" title="Fullscreen"><svg viewBox="0 0 24 24" width="18" height="18"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" fill="none"/></svg></button>`
          }
          ${
            this._playing === true
              ? ""
              : `<div class="cap"><span class="badge" style="${this._badge(ev.co)}">${ev.co.replace(/_/g, " ")}</span><span>${this._when(
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
      const stageImg = q(".stage > img");
      if (stageImg) stageImg.onclick = () => this._lightbox(ev.id); // tap the image = same as the fullscreen button
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
        this._clipSrc(ev.id).then((src) => {
          if (this._playing === true && this._clipFor === ev.id && vid.isConnected) vid.src = src;
        });
        // on clip end the player stays open - replay via the native controls, close via the X
        vid.onerror = () => {
          if (!vid.src) return; // source not attached yet
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
          const co = el.dataset.co || null;
          this._filter = co === this._filter ? null : co; // tapping the active chip clears the filter
          this._idx = 0;
          this._stopClip();
          this._render();
        })
    );
  }

  _lightbox(id) {
    const d = document.createElement("div");
    d.className = "lb";
    d.innerHTML = `
      <img src="${this._img(id)}" onerror="this.onerror=null;this.src='${this._thumb(id)}'">
      ${
        this._cfg.clips
          ? `<button class="playbtn lbplay" title="Play clip"><svg viewBox="0 0 24 24" width="20" height="20"><path d="M8 5v14l11-7z" fill="currentColor"/></svg></button>`
          : ""
      }
      <button class="playbtn lbclose" title="Close"><svg viewBox="0 0 24 24" width="18" height="18"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" fill="none"/></svg></button>`;
    d.onclick = () => d.remove();
    d.querySelector(".lbclose").onclick = (e) => {
      e.stopPropagation();
      d.remove();
    };
    const pb = d.querySelector(".lbplay");
    if (pb)
      pb.onclick = (e) => {
        e.stopPropagation();
        const img = d.querySelector("img");
        if (img) img.remove();
        pb.remove();
        const v = document.createElement("video");
        v.controls = true;
        v.autoplay = true;
        v.playsInline = true;
        v.onclick = (ev2) => ev2.stopPropagation(); // clicking the player must not close the overlay
        v.onerror = () => {
          if (!v.src) return; // source not attached yet
          v.replaceWith(
            Object.assign(document.createElement("div"), {
              className: "lbmsg",
              innerHTML: "No clip available for this event.<br>Clips require <b>record</b> to be enabled in Frigate.",
            })
          );
        };
        d.insertBefore(v, d.querySelector(".lbclose"));
        this._clipSrc(id).then((src) => {
          if (v.isConnected) v.src = src;
        });
      };
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
    "Frigate event snapshots filtered by sub_label (delivery companies, faces, plates) with slideshow, timeline, filter chips and clip playback.",
});
window.customCards.push({
  type: "delivery-reel-card",
  name: "Frigate Delivery Card (legacy name)",
  description: "Legacy element name of the Frigate Delivery Card - same card, kept for old configs.",
});

console.info(
  `%c FRIGATE-DELIVERY-CARD %c v${FDC_VERSION} `,
  "color:#fff;background:#03a9f4;font-weight:700",
  "color:#03a9f4;background:#fff;font-weight:700"
);
