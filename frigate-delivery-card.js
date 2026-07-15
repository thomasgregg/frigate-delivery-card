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

const FDC_VERSION = "1.3.1";

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
          { value: "list", label: "List (event rows with thumbnails)" },
          { value: "combined", label: "Combined (slideshow + event rows)" },
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
        view: "reel",       // "reel" | "list" | "combined"
        sort: "newest",     // "newest" | "oldest"
        period: "hours",    // "hours" = rolling window | "today" = since local midnight
        hours: 24,          // only used when period === "hours"
        limit: 100,
        slideshow: 6,       // seconds; 0 disables auto-advance
        refresh: 120,       // seconds between refetches
      },
      cfg
    );
    if (!["reel", "list", "combined"].includes(this._cfg.view)) this._cfg.view = "reel";
    if (!["newest", "oldest"].includes(this._cfg.sort)) this._cfg.sort = "newest";
    this._events = [];
    this._idx = 0;
    this._filter = null;
    this._hover = false;
  }

  getCardSize() {
    return this._cfg && this._cfg.view === "list" ? 4 : 6;
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
    if (this._cfg.view === "list") return; // nothing to advance
    const s = Number(this._cfg.slideshow);
    if (s > 0)
      this._show = setInterval(() => {
        if (!this._hover && this._list().length > 1) {
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
      has_snapshot: true,
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
    this._render();
  }

  _list() {
    return this._filter ? this._events.filter((e) => e.co === this._filter) : this._events;
  }

  _img(id) {
    return `/api/frigate/notifications/${id}/snapshot.jpg`;
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
      .chip{border-radius:14px;padding:3px 12px;font-size:12px;cursor:pointer;
        background:var(--secondary-background-color);color:var(--primary-text-color);
        border:1px solid var(--divider-color);text-transform:uppercase;letter-spacing:.5px;
        opacity:.7;font-weight:700}
      .chip.on{opacity:1;box-shadow:0 0 0 2px var(--primary-color)}
      .chip.all{background:var(--primary-color);color:var(--text-primary-color,#fff);border-color:var(--primary-color)}
      .stage{position:relative;margin:10px 12px;border-radius:var(--ha-card-border-radius,12px);overflow:hidden;
        aspect-ratio:16/9;background:var(--secondary-background-color);cursor:pointer}
      .stage img{width:100%;height:100%;object-fit:cover;display:block}
      .cap{position:absolute;left:0;right:0;bottom:0;padding:18px 14px 10px;color:#fff;font-size:14px;font-weight:500;
        background:linear-gradient(transparent,rgba(0,0,0,.65));display:flex;justify-content:space-between;align-items:baseline}
      .cap .co{text-transform:uppercase;letter-spacing:1px;font-weight:700;border-radius:10px;padding:1px 10px;border:1px solid transparent}
      .nav{position:absolute;top:50%;transform:translateY(-50%);width:34px;height:34px;border-radius:50%;
        background:rgba(0,0,0,.45);color:#fff;border:0;font-size:18px;cursor:pointer;display:flex;align-items:center;justify-content:center}
      .nav:hover{background:rgba(0,0,0,.7)}
      .prev{left:8px}.next{right:8px}
      .thumbs{display:flex;gap:8px;overflow-x:auto;padding:0 12px 12px}
      .thumbs img{width:96px;height:54px;object-fit:cover;border-radius:8px;cursor:pointer;opacity:.65;flex:none;
        border:2px solid transparent}
      .thumbs img.on{opacity:1;border-color:var(--primary-color)}
      .rows{display:flex;flex-direction:column;padding:2px 12px 10px;gap:2px}
      .row{display:flex;align-items:center;gap:10px;padding:3px 4px;border-radius:8px;cursor:pointer;
        border:2px solid transparent;background:transparent}
      .row:hover{background:var(--secondary-background-color)}
      .row.on{border-color:var(--primary-color);background:var(--secondary-background-color)}
      .row img{width:64px;height:36px;object-fit:cover;border-radius:6px;flex:none}
      .row .badge{text-transform:uppercase;letter-spacing:.8px;font-weight:700;font-size:10px;
        border-radius:9px;padding:1px 8px;border:1px solid transparent;flex:none}
      .row .time{color:var(--secondary-text-color);font-size:12px;margin-left:auto;flex:none}
      .empty{padding:28px 16px;text-align:center;color:var(--secondary-text-color)}
      .lb{position:fixed;inset:0;background:rgba(0,0,0,.88);display:flex;align-items:center;justify-content:center;z-index:9999;cursor:zoom-out}
      .lb img{max-width:96vw;max-height:96vh;border-radius:6px}
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
    const chips = this._events.length
      ? `<div class="chips">
          <button class="chip all ${this._filter ? "" : "on"}" data-co="">All (${this._events.length})</button>
          ${companies
            .map(
              (c) =>
                `<button class="chip ${this._filter === c ? "on" : ""}" style="${this._badge(c)}" data-co="${c}">${c} (${
                  this._events.filter((e) => e.co === c).length
                })</button>`
            )
            .join("")}
        </div>`
      : "";
    if (!list.length) {
      b.innerHTML = chips + `<div class="empty">No matching events ${this._scope()}.</div>`;
    } else {
      if (this._idx >= list.length) this._idx = 0;
      const ev = list[this._idx];
      const stage =
        view === "list"
          ? ""
          : `
        <div class="stage" id="stage">
          <img src="${this._img(ev.id)}" alt="${ev.co}">
          ${
            list.length > 1
              ? `<button class="nav prev" id="prev">&#8249;</button><button class="nav next" id="next">&#8250;</button>`
              : ""
          }
          <div class="cap"><span class="co" style="${this._badge(ev.co)}">${ev.co}</span><span>${this._when(
              ev.t
            )} &#183; ${this._idx + 1}/${list.length}</span></div>
        </div>`;
      const thumbs =
        view === "reel"
          ? `<div class="thumbs">${list
              .map(
                (e, i) =>
                  `<img src="${this._img(e.id)}" class="${i === this._idx ? "on" : ""}" data-i="${i}" alt="${e.co}">`
              )
              .join("")}</div>`
          : "";
      const rows =
        view === "reel"
          ? ""
          : `<div class="rows">${list
              .map(
                (e, i) =>
                  `<div class="row ${view === "combined" && i === this._idx ? "on" : ""}" data-i="${i}">
                    <img src="${this._img(e.id)}" loading="lazy" alt="${e.co}">
                    <span class="badge" style="${this._badge(e.co)}">${e.co}</span>
                    <span class="time">${this._when(e.t)}</span>
                  </div>`
              )
              .join("")}</div>`;
      b.innerHTML = chips + stage + thumbs + rows;
      const go = (i) => {
        this._idx = (i + list.length) % list.length;
        this._render();
      };
      const q = (s) => b.querySelector(s);
      if (q("#prev")) q("#prev").onclick = (e) => { e.stopPropagation(); go(this._idx - 1); };
      if (q("#next")) q("#next").onclick = (e) => { e.stopPropagation(); go(this._idx + 1); };
      if (q("#stage")) q("#stage").onclick = () => this._lightbox(this._img(ev.id));
      b.querySelectorAll(".thumbs img").forEach((el) => (el.onclick = () => go(Number(el.dataset.i))));
      b.querySelectorAll(".row").forEach(
        (el) =>
          (el.onclick = () => {
            const i = Number(el.dataset.i);
            if (view === "combined") go(i);
            else this._lightbox(this._img(list[i].id));
          })
      );
    }
    b.querySelectorAll(".chip").forEach(
      (el) =>
        (el.onclick = () => {
          this._filter = el.dataset.co || null;
          this._idx = 0;
          this._render();
        })
    );
  }

  _lightbox(src) {
    const d = document.createElement("div");
    d.className = "lb";
    d.innerHTML = `<img src="${src}">`;
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
