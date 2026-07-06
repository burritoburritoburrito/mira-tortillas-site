/* mira tortillas — checkout API (Cloudflare Worker)
   Static assets are served automatically; only /api/* reaches this code. */

/* every price this API will sell — anything else is rejected */
const PRICES = {
  // one-off (amount = cents per pack, used for shipping rules)
  "price_1Tp6jR2KMRu6Fi6htz56SDPI": { mode: "payment", amount: 800 },   // small ×12 €8
  "price_1Tp6jS2KMRu6Fi6hI68OSLWD": { mode: "payment", amount: 1000 },  // medium ×12 €10
  "price_1Tp6jU2KMRu6Fi6hj58ozoRh": { mode: "payment", amount: 900 },   // large ×6 €9
  // subscriptions
  "price_1Tp6je2KMRu6Fi6hri2mQkM8": { mode: "subscription" }, // small weekly
  "price_1Tp6jf2KMRu6Fi6hnOZhEOkg": { mode: "subscription" }, // small 2-weekly
  "price_1Tp6jg2KMRu6Fi6h26hVNFiV": { mode: "subscription" }, // small monthly
  "price_1Tp6jh2KMRu6Fi6hvlaea75S": { mode: "subscription" }, // medium weekly
  "price_1Tp6jj2KMRu6Fi6hCJSEMrlK": { mode: "subscription" }, // medium 2-weekly
  "price_1Tp6jk2KMRu6Fi6h7svhoyec": { mode: "subscription" }, // medium monthly
  "price_1Tp6jm2KMRu6Fi6hJ0jJ2qVn": { mode: "subscription" }, // large weekly
  "price_1Tp6jn2KMRu6Fi6h47lAOYZs": { mode: "subscription" }, // large 2-weekly
  "price_1Tp6jo2KMRu6Fi6hOAHj9Uo4": { mode: "subscription" }, // large monthly
};

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/config") {
      return json({ publishableKey: env.STRIPE_PUBLISHABLE_KEY || null });
    }

    if (url.pathname === "/api/checkout" && request.method === "POST") {
      let body;
      try { body = await request.json(); } catch { return json({ error: "bad json" }, 400); }

      const items = Array.isArray(body.items) ? body.items : [];
      if (!items.length || items.length > 10) return json({ error: "bad cart" }, 400);

      let mode = "payment";
      let subtotal = 0;
      let packs = 0;
      for (const it of items) {
        const known = PRICES[it.price];
        const qty = Number(it.quantity);
        if (!known || !Number.isInteger(qty) || qty < 1 || qty > 20)
          return json({ error: "bad item" }, 400);
        if (known.mode === "subscription") mode = "subscription";
        else { subtotal += known.amount * qty; packs += qty; }
      }
      // Stripe: one subscription per checkout — keep subs single-item
      if (mode === "subscription" && items.length > 1)
        return json({ error: "subscriptions check out one at a time" }, 400);

      const p = new URLSearchParams();
      p.set("ui_mode", "embedded_page");
      p.set("mode", mode);
      p.set("return_url", `${url.origin}/?checkout=success&session_id={CHECKOUT_SESSION_ID}`);
      p.set("shipping_address_collection[allowed_countries][0]", "PT");
      p.set("phone_number_collection[enabled]", "true");
      items.forEach((it, i) => {
        p.set(`line_items[${i}][price]`, it.price);
        p.set(`line_items[${i}][quantity]`, String(it.quantity));
      });

      /* shipping choices (one-off orders only):
         Lisbon hand delivery always free · mainland CTT €7 from 3 packs · free over €40 */
      if (mode === "payment") {
        const rates = [
          { name: "Lisboa · entrega local / local delivery", amount: 0 },
        ];
        if (subtotal >= 4000) {
          rates.push({ name: "Portugal continental · CTT expresso — grátis / free", amount: 0 });
        } else if (packs >= 3) {
          rates.push({ name: "Portugal continental · CTT expresso", amount: 700 });
        }
        rates.forEach((r, i) => {
          p.set(`shipping_options[${i}][shipping_rate_data][display_name]`, r.name);
          p.set(`shipping_options[${i}][shipping_rate_data][type]`, "fixed_amount");
          p.set(`shipping_options[${i}][shipping_rate_data][fixed_amount][amount]`, String(r.amount));
          p.set(`shipping_options[${i}][shipping_rate_data][fixed_amount][currency]`, "eur");
        });
      }

      const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: p,
      });
      const session = await res.json();
      if (!res.ok) return json({ error: session.error?.message || "stripe error" }, 502);
      return json({ clientSecret: session.client_secret });
    }

    return json({ error: "not found" }, 404);
  },
};
