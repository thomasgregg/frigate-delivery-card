import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// Exercise the exact self-contained artifact that HACS downloads.
import "../frigate-delivery-card.js";

type CardElement = HTMLElement & {
  hass: Record<string, unknown>;
  setConfig(config: Record<string, unknown>): void;
};

function makeHass(language = "en") {
  return {
    language,
    locale: {
      language,
      date_format: "DMY",
      time_format: "24",
    },
    callWS: vi.fn().mockResolvedValue([
      {
        id: "event-1",
        start_time: Date.now() / 1000,
        sub_label: "dhl",
      },
    ]),
  };
}

describe("Frigate Delivery Card localization", () => {
  const mounted: HTMLElement[] = [];

  beforeEach(() => {
    document.documentElement.lang = "en";
  });

  afterEach(() => {
    mounted.splice(0).forEach((element) => element.remove());
  });

  it("keeps the existing reel structure and behavior defaults", async () => {
    const Card = customElements.get("frigate-delivery-card") as CustomElementConstructor;
    const card = new Card() as CardElement;
    card.setConfig({ camera: "entrance" });
    document.body.append(card);
    mounted.push(card);
    const hass = makeHass();
    card.hass = hass;

    await vi.waitFor(() => expect(card.shadowRoot?.querySelector(".stage")).not.toBeNull());
    expect(hass.callWS).toHaveBeenCalledWith({
      type: "frigate/events/get",
      instance_id: "frigate",
      cameras: ["entrance"],
      after: expect.any(Number),
      limit: 100,
      sub_labels: [
        "dhl", "dpd", "gls", "ups", "amazon", "fedex", "usps", "postnl",
        "postnord", "royal_mail", "an_post", "canada_post", "purolator", "nzpost",
      ],
    });
    expect(card.shadowRoot?.querySelector(".thumbs")).not.toBeNull();
    expect(card.shadowRoot?.querySelector("#play")?.getAttribute("title")).toBe("Play clip");
    expect(card.shadowRoot?.querySelector("#fs")?.getAttribute("title")).toBe("Fullscreen");
    expect(card.shadowRoot?.querySelector(".chip.all")?.textContent).toContain("All (1)");

    (card.shadowRoot?.querySelector("#play") as HTMLButtonElement).click();
    expect(card.shadowRoot?.querySelector("video#clipvid")).not.toBeNull();
    (card.shadowRoot?.querySelector("#play") as HTMLButtonElement).click();
    expect(card.shadowRoot?.querySelector(".stage > img")).not.toBeNull();
  });

  it("keeps timeline mode separate from reel-only controls", async () => {
    const Card = customElements.get("frigate-delivery-card") as CustomElementConstructor;
    const card = new Card() as CardElement;
    card.setConfig({ camera: "entrance", view: "timeline" });
    document.body.append(card);
    mounted.push(card);
    card.hass = makeHass();

    await vi.waitFor(() => expect(card.shadowRoot?.querySelector(".tl .pill")).not.toBeNull());
    expect(card.shadowRoot?.querySelector(".chips")).toBeNull();
    expect(card.shadowRoot?.querySelector(".thumbs")).toBeNull();
  });

  it("localizes the card from the Home Assistant profile language", async () => {
    const Card = customElements.get("frigate-delivery-card") as CustomElementConstructor;
    const card = new Card() as CardElement;
    card.setConfig({ camera: "entrance" });
    document.body.append(card);
    mounted.push(card);
    card.hass = makeHass("en");

    await vi.waitFor(() => expect(card.shadowRoot?.querySelector(".chip.all")?.textContent).toContain("All (1)"));
    card.hass = makeHass("de-AT");

    await vi.waitFor(() => expect(card.shadowRoot?.querySelector(".chip.all")?.textContent).toContain("Alle (1)"));
    expect(card.shadowRoot?.querySelector("#play")?.getAttribute("title")).toBe("Clip abspielen");
    expect(card.shadowRoot?.querySelector("#fs")?.getAttribute("aria-label")).toBe("Vollbild");
  });

  it("localizes the graphical editor without changing stored values", () => {
    const Editor = customElements.get("frigate-delivery-card-editor") as CustomElementConstructor;
    const editor = new Editor() as CardElement;
    editor.setConfig({ camera: "entrance", view: "reel" });
    document.body.append(editor);
    mounted.push(editor);
    editor.hass = makeHass("en");

    const form = editor.querySelector("ha-form") as HTMLElement & {
      computeLabel: (schema: { name: string }) => string;
      schema: Array<Record<string, unknown>>;
    };
    expect(form.computeLabel({ name: "camera" })).toContain("Frigate camera name");

    editor.hass = makeHass("de-DE");
    expect(form.computeLabel({ name: "camera" })).toContain("Frigate-Kameraname");
    expect(form.computeLabel({ name: "labels" })).toBe("Objekt-Labels (Hauptabfrage)");
    expect(JSON.stringify(form.schema)).toContain('"value":"reel"');
    expect(JSON.stringify(form.schema)).toContain("Diashow + Vorschaubildleiste");
    expect(JSON.stringify(form.schema)).toContain("Zusätzliche Ereigniskategorien");
  });
  it.each([undefined, "contain", "cover", "invalid", "cover; color:red"])(
    "uses safe video fit %s in inline and fullscreen playback", async (fitMode) => {
      const Card = customElements.get("frigate-delivery-card") as CustomElementConstructor;
      const card = new Card() as CardElement;
      card.setConfig({ camera: "entrance", fit_mode: fitMode, slideshow: 0 });
      document.body.append(card);
      mounted.push(card);
      card.hass = makeHass();
      await vi.waitFor(() => expect(card.shadowRoot?.querySelector("#fs")).not.toBeNull());
      const root = card.shadowRoot!;
      (root.querySelector("#fs") as HTMLButtonElement).click();
      (root.querySelector(".lbplay") as HTMLButtonElement).click();
      expect(root.querySelector(".lb video")?.classList.contains("crop")).toBe(fitMode === "cover");
      (root.querySelector(".lbclose") as HTMLButtonElement).click();
      expect(root.querySelector(".lb")).toBeNull();
      (root.querySelector("#play") as HTMLButtonElement).click();
      expect(root.querySelector(".stage video")).not.toBeNull();
      expect(root.querySelector("style")?.textContent).toContain(
        `object-fit:${fitMode === "cover" ? "cover" : "contain"};background:#000`
      );
      (root.querySelector("#play") as HTMLButtonElement).click();
      expect(root.querySelector(".stage > img")).not.toBeNull();
    }
  );

  it("offers and saves video fit in the Appearance group", () => {
    const Editor = customElements.get("frigate-delivery-card-editor") as CustomElementConstructor;
    const editor = new Editor() as CardElement;
    editor.setConfig({ camera: "entrance", view: "timeline" });
    document.body.append(editor);
    mounted.push(editor);
    editor.hass = makeHass();
    const form = editor.querySelector("ha-form") as HTMLElement & {
      data: Record<string, unknown>;
      schema: Array<{title?: string; schema?: Array<{name: string; selector: unknown}>}>;
      computeLabel: (s: {name: string}) => string;
    };
    expect(form.data.fit_mode).toBe("contain");
    const group = form.schema.find(group => group.title === "Appearance");
    expect(group?.schema?.map(field => field.name)).toEqual(["fit_mode"]);
    expect(JSON.stringify(group)).toContain("Crop to fill");
    const changed = vi.fn();
    editor.addEventListener("config-changed", changed);
    form.dispatchEvent(new CustomEvent("value-changed", {detail: {value: {...form.data, fit_mode: "cover"}}}));
    expect(changed.mock.calls[0][0].detail.config).toMatchObject({camera: "entrance", view: "timeline", fit_mode: "cover"});
    editor.hass = makeHass("de");
    expect(form.data.fit_mode).toBe("cover");
    expect(form.computeLabel({name: "fit_mode"})).toBe("Videoanpassung");
    expect(JSON.stringify(form.schema)).toContain("Darstellung");
  });

});
