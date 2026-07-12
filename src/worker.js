/* mira tortillas — checkout API (Cloudflare Worker)
   run_worker_first: every request lands here (canonical-host 301s), then
   non-/api/ paths fall through to env.ASSETS. */

/* every price this API will sell — anything else is rejected */
const PRICES = {
  // one-off (amount = cents per pack, used for shipping rules)
  "price_1Tp6jR2KMRu6Fi6htz56SDPI": { mode: "payment", amount: 800 },   // small ×12 €8
  "price_1Tp6jS2KMRu6Fi6hI68OSLWD": { mode: "payment", amount: 1000 },  // medium ×12 €10
  "price_1Tp6jU2KMRu6Fi6hj58ozoRh": { mode: "payment", amount: 900 },   // large ×6 €9
  // subscriptions (cad = billing rhythm; a multi-item subscription must share one cad)
  "price_1Tp6je2KMRu6Fi6hri2mQkM8": { mode: "subscription", cad: "weekly" },   // small
  "price_1Tp6jf2KMRu6Fi6hnOZhEOkg": { mode: "subscription", cad: "biweekly" }, // small
  "price_1Tp6jg2KMRu6Fi6h26hVNFiV": { mode: "subscription", cad: "monthly" },  // small
  "price_1Tp6jh2KMRu6Fi6hvlaea75S": { mode: "subscription", cad: "weekly" },   // medium
  "price_1Tp6jj2KMRu6Fi6hCJSEMrlK": { mode: "subscription", cad: "biweekly" }, // medium
  "price_1Tp6jk2KMRu6Fi6h7svhoyec": { mode: "subscription", cad: "monthly" },  // medium
  "price_1Tp6jm2KMRu6Fi6hJ0jJ2qVn": { mode: "subscription", cad: "weekly" },   // large
  "price_1Tp6jn2KMRu6Fi6h47lAOYZs": { mode: "subscription", cad: "biweekly" }, // large
  "price_1Tp6jo2KMRu6Fi6hOAHj9Uo4": { mode: "subscription", cad: "monthly" },  // large
};

/* sku per price id — stock caps + sold-out accounting + sales-by-size.
   Includes subscription prices so every pack line item is tagged at write time
   (order items are unbackfillable — a null sku would vanish from analytics). */
const PRICE_SKU = {
  "price_1Tp6jR2KMRu6Fi6htz56SDPI": "small",
  "price_1Tp6jS2KMRu6Fi6hI68OSLWD": "medium",
  "price_1Tp6jU2KMRu6Fi6hj58ozoRh": "large",
  "price_1Tp6je2KMRu6Fi6hri2mQkM8": "small",  "price_1Tp6jf2KMRu6Fi6hnOZhEOkg": "small",  "price_1Tp6jg2KMRu6Fi6h26hVNFiV": "small",
  "price_1Tp6jh2KMRu6Fi6hvlaea75S": "medium", "price_1Tp6jj2KMRu6Fi6hCJSEMrlK": "medium", "price_1Tp6jk2KMRu6Fi6h7svhoyec": "medium",
  "price_1Tp6jm2KMRu6Fi6hJ0jJ2qVn": "large",  "price_1Tp6jn2KMRu6Fi6h47lAOYZs": "large",  "price_1Tp6jo2KMRu6Fi6hOAHj9Uo4": "large",
};

/* owner dashboard access (email-code login as one of these = admin) */
const ADMIN_EMAILS = ["nicholascalkins@gmail.com"];

async function getSettings(env) {
  const rows = (await env.DB.prepare(`SELECT k, v FROM settings`).all()).results || [];
  const s = {};
  for (const r of rows) s[r.k] = r.v;
  return {
    open: s.store_open === "1",
    caps: { small: +s.cap_small || 0, medium: +s.cap_medium || 0, large: +s.cap_large || 0 },
    sold: { small: +s.sold_small || 0, medium: +s.sold_medium || 0, large: +s.sold_large || 0 },
  };
}

async function isAdmin(env, request) {
  const c = await currentCustomer(env, request);
  /* admin requires a code-VERIFIED session (proved inbox control), not a
     claim-minted one — a Stripe-checkout email is not an authenticated identity */
  return !!(c && c._verified === 1 && ADMIN_EMAILS.includes((c.email || "").toLowerCase()));
}

const json = (data, status = 200, extraHeaders = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...extraHeaders },
  });

/* ── mira's own accounts (D1) ── */
const SESSION_DAYS = 90;

function getCookie(request, name) {
  const raw = request.headers.get("Cookie") || "";
  const m = raw.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return m ? m[1] : null;
}

async function currentCustomer(env, request) {
  const token = getCookie(request, "mira_session");
  if (!token) return null;
  const row = await env.DB.prepare(
    `SELECT c.*, s.verified AS _verified FROM sessions s JOIN customers c ON c.id = s.customer_id
     WHERE s.token = ?1 AND s.expires_at > datetime('now')`
  ).bind(token).first();
  return row || null;
}

/* verified=1 = email-code login (proved inbox); verified=0 = claim after checkout (weak identity) */
async function createSession(env, customerId, verified = 0) {
  const token = crypto.randomUUID() + crypto.randomUUID().replace(/-/g, "");
  await env.DB.prepare(
    `INSERT INTO sessions (token, customer_id, verified, expires_at)
     VALUES (?1, ?2, ?3, datetime('now', '+${SESSION_DAYS} days'))`
  ).bind(token, customerId, verified ? 1 : 0).run();
  return `mira_session=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}`;
}

async function stripeGet(env, path) {
  const res = await fetch(`https://api.stripe.com${path}`, {
    headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` },
  });
  const data = await res.json();
  return res.ok ? data : null;
}

/* like stripePost but surfaces Stripe's error message (admin tools need real errors) */
async function stripePostRaw(env, path, params) {
  const res = await fetch(`https://api.stripe.com${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params,
  });
  const data = await res.json();
  return { ok: res.ok, data, err: !res.ok ? (data.error && data.error.message) || "stripe error" : null };
}

async function stripePost(env, path, params) {
  const res = await fetch(`https://api.stripe.com${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params,
  });
  const data = await res.json();
  return res.ok ? data : null;
}

/* transactional email via Brevo (BREVO_API_KEY + MAIL_FROM env) */
async function sendEmail(env, to, subject, text) {
  if (!env.BREVO_API_KEY) return false;
  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": env.BREVO_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      sender: { name: "mira tortillas", email: env.MAIL_FROM || "ola@miratortillas.pt" },
      to: [{ email: to }],
      subject,
      textContent: text,
    }),
  });
  return res.ok;
}

/* owner SMS via Brevo transactional SMS (same API key; needs SMS credits +
   OWNER_PHONE env var, intl format, comma-separated for several owners
   e.g. +3519XXXXXXXX,+3519YYYYYYYY — silently skips if unset) */
async function sendSMS(env, text) {
  if (!env.BREVO_API_KEY || !env.OWNER_PHONE) return false;
  let ok = false;
  for (const to of String(env.OWNER_PHONE).split(",").map((s) => s.trim()).filter(Boolean)) {
    const res = await fetch("https://api.brevo.com/v3/transactionalSMS/sms", {
      method: "POST",
      headers: { "api-key": env.BREVO_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "transactional", unicodeEnabled: true, sender: "mira",
        recipient: to, content: text.slice(0, 155),
      }),
    });
    ok = ok || res.ok;
  }
  return ok;
}

const POINTS_COUPON = "MIRA-POINTS-800"; // 100 points → €8 off

/* upsert customer + (if paid) record order & settle points. Idempotent per session. */
async function processSession(env, session) {
  const cd = session.customer_details || {};
  const email = (cd.email || "").toLowerCase();
  if (!email) return null;
  const addr = (session.shipping_details && session.shipping_details.address) || cd.address || {};

  await env.DB.prepare(
    `INSERT INTO customers (email, name, phone, address_line1, address_line2, postal_code, city, country, stripe_customer_id)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
     ON CONFLICT(email) DO UPDATE SET
       name = COALESCE(excluded.name, name),
       phone = COALESCE(excluded.phone, phone),
       address_line1 = COALESCE(excluded.address_line1, address_line1),
       address_line2 = COALESCE(excluded.address_line2, address_line2),
       postal_code = COALESCE(excluded.postal_code, postal_code),
       city = COALESCE(excluded.city, city),
       country = COALESCE(excluded.country, country),
       stripe_customer_id = COALESCE(excluded.stripe_customer_id, stripe_customer_id),
       updated_at = datetime('now')`
  ).bind(
    email, cd.name || null, cd.phone || null,
    addr.line1 || null, addr.line2 || null, addr.postal_code || null,
    addr.city || null, addr.country || "PT",
    typeof session.customer === "string" ? session.customer : null
  ).run();

  const customer = await env.DB.prepare(`SELECT * FROM customers WHERE email = ?1`).bind(email).first();

  /* newsletter consent from our cart checkbox (only ever upgrades to yes) */
  if (session.metadata && session.metadata.newsletter === "1") {
    await env.DB.prepare(`UPDATE customers SET marketing_ok = 1 WHERE id = ?1`).bind(customer.id).run();
  }

  const paid = session.payment_status === "paid" || session.payment_status === "no_payment_required";
  if (paid) {
    const points = Math.floor((session.amount_total || 0) / 100);
    /* what's inside the order — feeds sales-by-size analytics + the bake sheet.
       Delivery line items carry sku:"delivery" so they're skipped in pack tallies. */
    const isDelivery = (li) => /entrega|envio|delivery|shipping/i.test(li.description || "");
    const itemsJson = JSON.stringify(((session.line_items && session.line_items.data) || []).map((li) => ({
      sku: PRICE_SKU[(li.price && li.price.id) || ""] || (isDelivery(li) ? "delivery" : null),
      d: (li.description || "").slice(0, 40),
      q: li.quantity || 1,
    })));
    /* chosen shipping option (Lisboa €5 / continente €10) from the paid session */
    const sc = session.shipping_cost || {};
    const shipMethod = (sc.shipping_rate && typeof sc.shipping_rate === "object" && sc.shipping_rate.display_name) ||
      (session.shipping_options && session.shipping_options[0] && session.shipping_options[0].shipping_rate_data && session.shipping_options[0].shipping_rate_data.display_name) || null;
    const inserted = await env.DB.prepare(
      `INSERT OR IGNORE INTO orders
        (customer_id, stripe_session_id, amount_total, currency, mode, points_earned, items,
         ship_name, ship_phone, ship_line1, ship_line2, ship_postal, ship_city, ship_method, status)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, 'new')`
    ).bind(customer.id, session.id, session.amount_total || 0, session.currency || "eur", session.mode, points, itemsJson,
      cd.name || null, cd.phone || null, addr.line1 || null, addr.line2 || null,
      addr.postal_code || null, addr.city || null, shipMethod).run();
    if (inserted.meta.changes > 0) {
      if (points > 0)
        await env.DB.prepare(`UPDATE customers SET points = points + ?1 WHERE id = ?2`).bind(points, customer.id).run();
      const redeemed = parseInt((session.metadata && session.metadata.points_redeemed) || "0", 10);
      if (redeemed > 0)
        await env.DB.prepare(`UPDATE customers SET points = MAX(points - ?1, 0) WHERE id = ?2`).bind(redeemed, customer.id).run();
      /* stock accounting: count packs sold per size (one-off orders, once per session) */
      if (session.mode === "payment" && session.line_items && session.line_items.data) {
        for (const li of session.line_items.data) {
          const sku = PRICE_SKU[(li.price && li.price.id) || ""];
          if (sku) await env.DB.prepare(
            `UPDATE settings SET v = CAST(CAST(v AS INTEGER) + ?1 AS TEXT) WHERE k = ?2`
          ).bind(li.quantity || 1, "sold_" + sku).run();
        }
      }
      /* owner heads-up: one email per new order via ola@ (best-effort, never blocks the order) */
      try {
        const lis = (session.line_items && session.line_items.data) || [];
        const itemsTxt = lis.map((li) => `${li.quantity}× ${li.description || (li.price && li.price.id) || "item"}`).join("\n") || `(${session.mode})`;
        const total = ((session.amount_total || 0) / 100).toFixed(2);
        const packs = lis.filter((li) => PRICE_SKU[(li.price && li.price.id) || ""]).map((li) => li.quantity).reduce((a, b) => a + b, 0);
        await sendEmail(env, "ola@miratortillas.pt", `🌯 nova encomenda — €${total}`,
          `nova encomenda / new order\n\n${itemsTxt}\n\ntotal: €${total} · ${session.mode}\nentrega / shipping: ${shipMethod || "—"}\n\n${cd.name || "?"} · ${email}${cd.phone ? " · " + cd.phone : ""}\n${[addr.line1, addr.line2, [addr.postal_code, addr.city].filter(Boolean).join(" ")].filter(Boolean).join("\n")}\n\nstripe: https://dashboard.stripe.com/payments\ndashboard: https://miratortillas.pt/admin`);
        await sendSMS(env, `mira: nova encomenda €${total} — ${cd.name || email} (${packs || "?"} packs)`);
      } catch (e) { /* notification failure must never fail an order */ }
    }
  }
  return customer;
}

/* subscription RENEWALS arrive as invoice.paid (no checkout session) — record them
   the same way so revenue/points/alerts/backup all include recurring charges.
   Untrusted payload: caller only passes the invoice id; we re-fetch from Stripe. */
async function processInvoice(env, invoiceId) {
  const inv = await stripeGet(env, `/v1/invoices/${invoiceId}?expand[]=lines`);
  if (!inv || inv.status !== "paid") return;
  /* the very first subscription invoice is already covered by the checkout.session flow — skip it */
  if (inv.billing_reason === "subscription_create") return;
  const email = (inv.customer_email || "").toLowerCase();
  if (!email) return;
  const customer = await env.DB.prepare(`SELECT * FROM customers WHERE email = ?1`).bind(email).first();
  if (!customer) return; /* unknown customer — first order always precedes a renewal */
  const points = Math.floor((inv.amount_paid || 0) / 100);
  const lines = (inv.lines && inv.lines.data) || [];
  const isDelivery = (l) => /entrega|envio|delivery|shipping/i.test((l.description || "") + " " + ((l.price && l.price.nickname) || ""));
  const itemsJson = JSON.stringify(lines.map((l) => ({
    sku: PRICE_SKU[(l.price && l.price.id) || ""] || (isDelivery(l) ? "delivery" : null),
    d: (l.description || "").slice(0, 40),
    q: l.quantity || 1,
  })));
  const inserted = await env.DB.prepare(
    `INSERT OR IGNORE INTO orders (customer_id, stripe_session_id, amount_total, currency, mode, points_earned, items, status)
     VALUES (?1, ?2, ?3, ?4, 'subscription', ?5, ?6, 'new')`
  ).bind(customer.id, inv.id, inv.amount_paid || 0, inv.currency || "eur", points, itemsJson).run();
  if (inserted.meta.changes === 0) return; /* already recorded (idempotent on invoice id) */
  if (points > 0)
    await env.DB.prepare(`UPDATE customers SET points = points + ?1 WHERE id = ?2`).bind(points, customer.id).run();
  try {
    const total = ((inv.amount_paid || 0) / 100).toFixed(2);
    const itemsTxt = lines.map((l) => `${l.quantity || 1}× ${l.description || "item"}`).join("\n");
    await sendEmail(env, "ola@miratortillas.pt", `🔁 renovação de assinatura — €${total}`,
      `subscription renewal / renovação\n\n${itemsTxt}\n\ntotal: €${total}\n\n${customer.name || "?"} · ${email}${customer.phone ? " · " + customer.phone : ""}\n${[customer.address_line1, [customer.postal_code, customer.city].filter(Boolean).join(" ")].filter(Boolean).join("\n")}\n\ndashboard: https://miratortillas.pt/admin`);
    const packs = lines.filter((l) => PRICE_SKU[(l.price && l.price.id) || ""]).map((l) => l.quantity || 1).reduce((a, b) => a + b, 0);
    await sendSMS(env, `mira: renovação €${total} — ${customer.name || email} (${packs || "?"} packs)`);
  } catch (e) { /* never block */ }
}

export default {
  /* daily heartbeat (cron): self-check the live endpoints, email owner on failure;
     Mondays also email a full customers+orders CSV backup — the data IS the business */
  async scheduled(event, env, ctx) {
    ctx.waitUntil((async () => {
      let alert = "";
      try {
        const s = await fetch("https://miratortillas.pt/api/status");
        const sd = await s.json().catch(() => ({}));
        if (!s.ok || typeof sd.open !== "boolean") alert += `/api/status broken (${s.status})\n`;
        const c = await fetch("https://miratortillas.pt/api/checkout", {
          method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
        });
        const cd = await c.json().catch(() => ({}));
        if (!cd.error) alert += `/api/checkout unexpected (${c.status})\n`;
      } catch (e) { alert += "self-check fetch failed: " + e.message + "\n"; }
      if (alert)
        await sendEmail(env, "ola@miratortillas.pt", "⚠️ mira self-check FAILED", alert + "\ncheck: https://dash.cloudflare.com → mira-shop");
      if (new Date().getUTCDay() === 1) {
        const cell = (v) => '"' + String(v ?? "").replace(/"/g, '""') + '"'; /* RFC-4180 CSV escaping */
        const csv = (rows) => rows.length
          ? Object.keys(rows[0]).join(",") + "\n" + rows.map((r) => Object.values(r).map(cell).join(",")).join("\n")
          : "(empty)";
        const cust = (await env.DB.prepare(`SELECT * FROM customers`).all()).results || [];
        const ord = (await env.DB.prepare(`SELECT * FROM orders`).all()).results || [];
        await sendEmail(env, "ola@miratortillas.pt",
          `📦 mira weekly backup — ${cust.length} customers · ${ord.length} orders`,
          `automatic Monday backup (keep these emails!)\n\nCUSTOMERS\n${csv(cust)}\n\nORDERS\n${csv(ord)}`);
      }
    })());
  },

  async fetch(request, env) {
    const url = new URL(request.url);

    /* canonical host: www + .com variants 301 to the apex (workers.dev stays live for testing) */
    const host = url.hostname;
    if (host === "www.miratortillas.pt" || host === "miratortillas.com" || host === "www.miratortillas.com") {
      return Response.redirect("https://miratortillas.pt" + url.pathname + url.search, 301);
    }

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
      const cads = new Set();
      for (const it of items) {
        const known = PRICES[it.price];
        const qty = Number(it.quantity);
        if (!known || !Number.isInteger(qty) || qty < 1 || qty > 20)
          return json({ error: "bad item" }, 400);
        if (known.mode === "subscription") { mode = "subscription"; cads.add(known.cad); }
        else { subtotal += known.amount * qty; packs += qty; }
      }
      if (mode === "subscription") {
        // no mixing one-off packs into a subscription, and one rhythm per subscription
        if (items.some((it) => PRICES[it.price].mode !== "subscription"))
          return json({ error: "subscriptions and one-off packs check out separately" }, 400);
        if (cads.size > 1)
          return json({ error: "one rhythm per subscription" }, 400);
      }

      /* owner controls: store pause + per-size stock caps (caps apply to one-off packs) */
      const shop = await getSettings(env);
      if (!shop.open) return json({ error: "loja em pausa — back soon" }, 503);
      if (mode === "payment") {
        for (const it of items) {
          const sku = PRICE_SKU[it.price];
          if (!sku) continue;
          const left = Math.max(shop.caps[sku] - shop.sold[sku], 0);
          if (Number(it.quantity) > left)
            return json({ error: `${sku}: esgotado / sold out${left > 0 ? ` — only ${left} left` : ""}` }, 409);
        }
      }

      /* points redemption: 100 pts = €8 off, one-off orders of €8+, signed-in only */
      let redeemer = null;
      if (body.usePoints === true && mode === "payment" && subtotal >= 800) {
        const c = await currentCustomer(env, request);
        if (c && c.points >= 100) redeemer = c;
      }

      const p = new URLSearchParams();
      p.set("ui_mode", "embedded_page");
      p.set("mode", mode);
      /* newsletter opt-in from our own cart checkbox (Stripe's consent_collection
         isn't available for PT accounts) */
      if (body.newsletter === true) p.set("metadata[newsletter]", "1");
      if (redeemer) {
        p.set("discounts[0][coupon]", POINTS_COUPON);
        p.set("metadata[points_redeemed]", "100");
      } else {
        /* Stripe's native promo-code box in checkout (can't combine with discounts) */
        p.set("allow_promotion_codes", "true");
      }
      /* 30-min session expiry: shrinks the window where a checkout opened
         before a pause/sell-out could still complete (default is 24h) */
      p.set("expires_at", String(Math.floor(Date.now() / 1000) + 1800));
      p.set("return_url", `${url.origin}/?checkout=success&session_id={CHECKOUT_SESSION_ID}`);
      p.set("shipping_address_collection[allowed_countries][0]", "PT");
      p.set("phone_number_collection[enabled]", "true");
      items.forEach((it, i) => {
        p.set(`line_items[${i}][price]`, it.price);
        p.set(`line_items[${i}][quantity]`, String(it.quantity));
      });

      /* subscriptions: delivery is charged as a recurring line item matching the
         box rhythm (zone picked in the builder: Lisboa €5 / continente €10 per delivery) */
      if (mode === "subscription") {
        const zone = body.zone === "continente"
          ? { amt: 1000, name: "envio refrigerado · continente / refrigerated shipping" }
          : { amt: 500, name: "entrega em casa · lisboa / home delivery" };
        const cad = (PRICES[items[0].price] || {}).cad || "weekly";
        const rec = cad === "weekly" ? ["week", 1] : cad === "biweekly" ? ["week", 2] : ["month", 1];
        const di = items.length;
        p.set(`line_items[${di}][quantity]`, "1");
        p.set(`line_items[${di}][price_data][currency]`, "eur");
        p.set(`line_items[${di}][price_data][unit_amount]`, String(zone.amt));
        p.set(`line_items[${di}][price_data][product_data][name]`, zone.name);
        p.set(`line_items[${di}][price_data][recurring][interval]`, rec[0]);
        p.set(`line_items[${di}][price_data][recurring][interval_count]`, String(rec[1]));
      }

      /* shipping choices (one-off orders only): every delivery costs us money,
         so every delivery is charged — Lisboa courier flat + mainland frozen box.
         Amounts are owner-set (2026-07-12): Lisboa €5, continente €10. */
      if (mode === "payment") {
        const rates = [
          { name: "Lisboa · entrega em casa / home delivery", amount: 500 },
          { name: "Portugal continental · envio refrigerado, seg–qua / ships Mon–Wed", amount: 1000 },
        ];
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

    /* after a successful checkout: create/refresh the mira account + sign in */
    if (url.pathname === "/api/claim" && request.method === "POST") {
      let body;
      try { body = await request.json(); } catch { return json({ error: "bad json" }, 400); }
      const sid = String(body.session_id || "");
      if (!/^cs_(live|test)_[A-Za-z0-9]+$/.test(sid)) return json({ error: "bad session" }, 400);

      const session = await stripeGet(env, `/v1/checkout/sessions/${sid}?expand[]=line_items`);
      if (!session || session.status !== "complete") return json({ error: "not a completed checkout" }, 400);

      const customer = await processSession(env, session);
      if (!customer) return json({ error: "no email on session" }, 400);

      const paid = session.payment_status === "paid" || session.payment_status === "no_payment_required";
      /* auto-login ONLY on the fresh post-checkout redirect (bounds the leaked-session_id
         replay window); never a verified session — a checkout email isn't proven identity */
      const fresh = String(Date.now() / 1000 - (session.created || 0) < 3600); /* < 1h old */
      let cookie = null;
      if (fresh === "true") cookie = await createSession(env, customer.id, 0);
      const bal = await env.DB.prepare(`SELECT points FROM customers WHERE id = ?1`).bind(customer.id).first();
      return json({ ok: true, paid, email: customer.email, name: customer.name, points: bal.points },
        200, cookie ? { "Set-Cookie": cookie } : {});
    }

    /* Stripe webhook: records orders/points even if the buyer never returns to the site
       (closed tab, or async methods like Multibanco that settle later).
       Payload is untrusted — we only take the session id and re-fetch from Stripe. */
    if (url.pathname === "/api/webhook" && request.method === "POST") {
      let evt;
      try { evt = await request.json(); } catch { return json({ received: true }); }
      const type = evt.type || "";
      const objId = evt.data && evt.data.object && evt.data.object.id;
      if (
        (type === "checkout.session.completed" || type === "checkout.session.async_payment_succeeded") &&
        /^cs_(live|test)_[A-Za-z0-9]+$/.test(objId || "")
      ) {
        const session = await stripeGet(env, `/v1/checkout/sessions/${objId}?expand[]=line_items`);
        if (session && session.status === "complete") await processSession(env, session);
      } else if (
        (type === "invoice.paid" || type === "invoice.payment_succeeded") &&
        /^in_[A-Za-z0-9]+$/.test(objId || "")
      ) {
        await processInvoice(env, objId);
      }
      return json({ received: true });
    }

    /* who am i + my orders + my subscriptions */
    if (url.pathname === "/api/me" && request.method === "GET") {
      const c = await currentCustomer(env, request);
      if (!c) return json({ loggedIn: false }, 200);
      const orders = await env.DB.prepare(
        `SELECT amount_total, currency, mode, points_earned, created_at
         FROM orders WHERE customer_id = ?1 ORDER BY id DESC LIMIT 20`
      ).bind(c.id).all();
      let subs = [];
      if (c.stripe_customer_id) {
        const list = await stripeGet(env, `/v1/subscriptions?customer=${c.stripe_customer_id}&status=all&limit=10`);
        if (list && list.data) {
          subs = list.data
            .filter((s) => s.status !== "incomplete_expired" && s.status !== "incomplete")
            .map((s) => {
              const items = (s.items && s.items.data) || [];
              const it = items[0];
              /* sum ALL line items (box sizes + the recurring delivery fee), not just the first */
              const amount = items.reduce((t, i) => t + ((i.price && i.price.unit_amount) || 0) * (i.quantity || 1), 0) || null;
              const plan = items.map((i) => i.price && i.price.nickname).filter(Boolean).join(" + ") || "subscription";
              /* current_period_end moved to item level in Stripe API ≥2025-03-31 */
              const periodEnd = s.current_period_end || (it && it.current_period_end);
              return {
                id: s.id,
                cancelAtEnd: !!s.cancel_at_period_end,
                paused: !!s.pause_collection,
                status: s.status,
                plan,
                amount,
                interval: it && it.price && it.price.recurring
                  ? `${it.price.recurring.interval_count > 1 ? it.price.recurring.interval_count + " " : ""}${it.price.recurring.interval}`
                  : null,
                renews: periodEnd ? new Date(periodEnd * 1000).toISOString().slice(0, 10) : null,
              };
            });
        }
      }
      return json({
        loggedIn: true,
        customer: {
          email: c.email, name: c.name, phone: c.phone, points: c.points, birthday: c.birthday,
          newsletter: c.marketing_ok === 1,
          address: { line1: c.address_line1, line2: c.address_line2, postal_code: c.postal_code, city: c.city, country: c.country },
        },
        orders: orders.results || [],
        subscriptions: subs,
      });
    }

    /* profile self-service: whatever the customer wants to share (all fields optional) */
    if (url.pathname === "/api/profile" && request.method === "POST") {
      const c = await currentCustomer(env, request);
      if (!c) return json({ error: "not signed in" }, 401);
      let b;
      try { b = await request.json(); } catch { return json({ error: "bad json" }, 400); }
      const clean = (v, max) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
      const birthday = clean(b.birthday, 10);
      if (birthday && !/^\d{4}-\d{2}-\d{2}$/.test(birthday)) return json({ error: "birthday must be YYYY-MM-DD" }, 400);
      /* newsletter is a customer right (GDPR): honor an explicit true/false, both directions */
      const news = b.newsletter === true ? 1 : b.newsletter === false ? 0 : null;
      await env.DB.prepare(
        `UPDATE customers SET
           name = ?1, phone = ?2, address_line1 = ?3, address_line2 = ?4,
           postal_code = ?5, city = ?6, birthday = ?7,
           marketing_ok = COALESCE(?8, marketing_ok), updated_at = datetime('now')
         WHERE id = ?9`
      ).bind(
        clean(b.name, 80), clean(b.phone, 24), clean(b.line1, 120), clean(b.line2, 120),
        clean(b.postal_code, 12), clean(b.city, 60), birthday, news, c.id
      ).run();
      return json({ ok: true });
    }

    /* Stripe billing portal — saved cards + subscription management, Stripe-hosted */
    if (url.pathname === "/api/portal" && request.method === "POST") {
      const c = await currentCustomer(env, request);
      if (!c) return json({ error: "not signed in" }, 401);
      if (!c.stripe_customer_id) return json({ error: "no payment profile yet — appears after your first order" }, 400);
      const p = new URLSearchParams();
      p.set("customer", c.stripe_customer_id);
      p.set("return_url", `${url.origin}/account#payments`);
      const sess = await stripePost(env, "/v1/billing_portal/sessions", p);
      if (!sess) return json({ error: "portal unavailable" }, 502);
      return json({ url: sess.url });
    }

    /* email login — step 1: send a 6-digit code */
    if (url.pathname === "/api/login-request" && request.method === "POST") {
      let body;
      try { body = await request.json(); } catch { return json({ error: "bad json" }, 400); }
      const email = String(body.email || "").trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: "invalid email" }, 400);
      if (!env.BREVO_API_KEY)
        return json({ error: "email login isn't connected yet — your account signs in automatically after any order" }, 503);
      /* throttle: one code per email/minute AND per-IP burst AND a global daily
         ceiling — stops flooding arbitrary inboxes + draining Brevo credits */
      const recent = await env.DB.prepare(
        `SELECT 1 AS hit FROM login_codes WHERE email = ?1 AND created_at > datetime('now', '-60 seconds')`
      ).bind(email).first();
      if (recent) return json({ error: "code already sent — wait a minute before requesting another" }, 429);
      const ip = request.headers.get("CF-Connecting-IP") || "?";
      const ipHits = await env.DB.prepare(
        `SELECT COUNT(*) n FROM login_codes WHERE ip = ?1 AND created_at > datetime('now', '-1 hour')`
      ).bind(ip).first().catch(() => ({ n: 0 }));
      if ((ipHits.n || 0) >= 8) return json({ error: "too many requests — try again later" }, 429);
      const dayHits = await env.DB.prepare(
        `SELECT COUNT(*) n FROM login_codes WHERE created_at > datetime('now', '-1 day')`
      ).first().catch(() => ({ n: 0 }));
      if ((dayHits.n || 0) >= 500) return json({ error: "login temporarily unavailable — try again later" }, 429);
      const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1000000).padStart(6, "0");
      await env.DB.prepare(
        `INSERT INTO login_codes (email, code, attempts, ip, expires_at)
         VALUES (?1, ?2, 0, ?3, datetime('now', '+10 minutes'))
         ON CONFLICT(email) DO UPDATE SET code = excluded.code, attempts = 0,
           ip = excluded.ip, expires_at = excluded.expires_at, created_at = datetime('now')`
      ).bind(email, code, ip).run();
      const sent = await sendEmail(env, email, "your mira login code",
        `your login code: ${code}\n\nit's valid for 10 minutes.\n\no teu código de acesso: ${code} (válido 10 minutos)\n\n— mira tortillas`);
      if (!sent) return json({ error: "couldn't send the email — try again in a minute" }, 502);
      return json({ ok: true });
    }

    /* email login — step 2: verify the code, open a session */
    if (url.pathname === "/api/login-verify" && request.method === "POST") {
      let body;
      try { body = await request.json(); } catch { return json({ error: "bad json" }, 400); }
      const email = String(body.email || "").trim().toLowerCase();
      const code = String(body.code || "").trim();
      const row = await env.DB.prepare(
        `SELECT * FROM login_codes WHERE email = ?1 AND expires_at > datetime('now')`
      ).bind(email).first();
      if (!row || row.attempts >= 5) return json({ error: "code expired — request a new one" }, 400);
      if (row.code !== code) {
        await env.DB.prepare(`UPDATE login_codes SET attempts = attempts + 1 WHERE email = ?1`).bind(email).run();
        return json({ error: "wrong code" }, 400);
      }
      await env.DB.prepare(`DELETE FROM login_codes WHERE email = ?1`).bind(email).run();
      const created = await env.DB.prepare(`INSERT OR IGNORE INTO customers (email) VALUES (?1)`).bind(email).run();
      const customer = await env.DB.prepare(`SELECT * FROM customers WHERE email = ?1`).bind(email).first();
      /* mailing-list opt-in ticked on the sign-in form (only ever upgrades to yes) */
      if (body.newsletter === true) {
        await env.DB.prepare(`UPDATE customers SET marketing_ok = 1 WHERE id = ?1`).bind(customer.id).run();
      }
      /* owner heads-up on brand-new profiles (never blocks the login) */
      if (created.meta.changes > 0) {
        try {
          const n = await env.DB.prepare(`SELECT COUNT(*) n FROM customers`).first();
          await sendEmail(env, "ola@miratortillas.pt", `🌯 new tortilla lover — ${email}`,
            `new account on miratortillas.pt\n\n${email}${body.newsletter === true ? "\njoined the mailing list ✓" : ""}\n\ncustomers total: ${n.n}\ndashboard: https://miratortillas.pt/admin`);
        } catch (e) { /* notification failure must never block login */ }
      }
      const cookie = await createSession(env, customer.id, 1); /* code-verified = trusted */
      return json({ ok: true }, 200, { "Set-Cookie": cookie });
    }

    /* manage own subscription: cancel at period end / keep / pause / resume */
    if (url.pathname === "/api/sub-action" && request.method === "POST") {
      const c = await currentCustomer(env, request);
      if (!c || !c.stripe_customer_id) return json({ error: "not signed in" }, 401);
      let body;
      try { body = await request.json(); } catch { return json({ error: "bad json" }, 400); }
      const id = String(body.id || "");
      const action = String(body.action || "");
      if (!/^sub_[A-Za-z0-9]+$/.test(id)) return json({ error: "bad id" }, 400);
      const sub = await stripeGet(env, `/v1/subscriptions/${id}`);
      if (!sub || sub.customer !== c.stripe_customer_id) return json({ error: "not yours" }, 403);
      const p = new URLSearchParams();
      if (action === "cancel") p.set("cancel_at_period_end", "true");
      else if (action === "keep") p.set("cancel_at_period_end", "false");
      else if (action === "pause") p.set("pause_collection[behavior]", "void");
      else if (action === "resume") p.set("pause_collection", "");
      else return json({ error: "bad action" }, 400);
      const updated = await stripePost(env, `/v1/subscriptions/${id}`, p);
      if (!updated) return json({ error: "stripe error" }, 502);
      return json({ ok: true });
    }

    /* public shop status: open/paused + remaining stock per size */
    if (url.pathname === "/api/status") {
      const s = await getSettings(env);
      return json({
        open: s.open,
        remaining: {
          small: Math.max(s.caps.small - s.sold.small, 0),
          medium: Math.max(s.caps.medium - s.sold.medium, 0),
          large: Math.max(s.caps.large - s.sold.large, 0),
        },
      });
    }

    /* owner: send yourself a test SMS (admin-only, POST so it can't fire from a GET/link) */
    if (url.pathname === "/api/admin/test-sms" && request.method === "POST") {
      if (!(await isAdmin(env, request))) return json({ error: "not authorized — sign in at /account first" }, 401);
      if (!env.OWNER_PHONE) return json({ error: "OWNER_PHONE var not set in Cloudflare yet" }, 400);
      const ok = await sendSMS(env, "mira: SMS test OK — order alerts armed 🌯");
      return json({ sent: ok, to: env.OWNER_PHONE, hint: ok ? "check your phone!" : "check Brevo SMS credits" });
    }

    /* owner dashboard API — requires email-code login as an ADMIN_EMAILS address */
    if (url.pathname === "/api/admin/state") {
      if (!(await isAdmin(env, request))) return json({ error: "not authorized" }, 401);
      return json(await getSettings(env));
    }
    /* owner: sales + customer stats for the dashboard */
    if (url.pathname === "/api/admin/stats") {
      if (!(await isAdmin(env, request))) return json({ error: "not authorized" }, 401);
      const allTime = await env.DB.prepare(
        `SELECT COUNT(*) n, COALESCE(SUM(amount_total),0) cents FROM orders`).first();
      const week = await env.DB.prepare(
        `SELECT COUNT(*) n, COALESCE(SUM(amount_total),0) cents FROM orders WHERE created_at >= datetime('now','-7 days')`).first();
      const prevWeek = await env.DB.prepare(
        `SELECT COUNT(*) n, COALESCE(SUM(amount_total),0) cents FROM orders
         WHERE created_at >= datetime('now','-14 days') AND created_at < datetime('now','-7 days')`).first();
      const today = await env.DB.prepare(
        `SELECT COUNT(*) n, COALESCE(SUM(amount_total),0) cents FROM orders WHERE date(created_at) = date('now')`).first();
      const daily = (await env.DB.prepare(
        `SELECT date(created_at) d, COUNT(*) n, COALESCE(SUM(amount_total),0) cents FROM orders
         WHERE date(created_at) >= date('now','-13 days') GROUP BY date(created_at)`).all()).results || [];
      const customers = await env.DB.prepare(
        `SELECT COUNT(*) n, COALESCE(SUM(marketing_ok),0) newsletter FROM customers`).first();
      const newCustomers = await env.DB.prepare(
        `SELECT COUNT(*) n FROM customers WHERE created_at >= datetime('now','-7 days')`).first();
      /* packs sold by size, last 30 days (from order items JSON) */
      const itemRows = (await env.DB.prepare(
        `SELECT items FROM orders WHERE created_at >= datetime('now','-30 days') AND items IS NOT NULL`).all()).results || [];
      const bySize = { small: 0, medium: 0, large: 0 };
      for (const r of itemRows) {
        try {
          for (const it of JSON.parse(r.items)) {
            const s = it.sku || (/pequen|small/i.test(it.d || "") ? "small"
              : /m[eé]di|medium/i.test(it.d || "") ? "medium"
              : /grand|large/i.test(it.d || "") ? "large" : null);
            if (s && bySize[s] !== undefined) bySize[s] += it.q || 1;
          }
        } catch (e) { /* ignore malformed rows */ }
      }
      const recent = (await env.DB.prepare(
        `SELECT o.created_at, o.amount_total, o.mode, o.points_earned, o.items, c.email, c.name, c.city
         FROM orders o JOIN customers c ON c.id = o.customer_id ORDER BY o.id DESC LIMIT 15`).all()).results || [];
      return json({ allTime, week, prevWeek, today, daily, customers, newCustomers, bySize, recent });
    }

    /* owner: orders to fulfill — the pack/deliver list, newest first, with address + status */
    if (url.pathname === "/api/admin/orders") {
      if (!(await isAdmin(env, request))) return json({ error: "not authorized" }, 401);
      const rows = (await env.DB.prepare(
        `SELECT o.id, o.created_at, o.amount_total, o.mode, o.items, o.status,
                o.ship_name, o.ship_phone, o.ship_line1, o.ship_line2, o.ship_postal, o.ship_city, o.ship_method,
                c.email, c.name AS cust_name, c.city AS cust_city
         FROM orders o JOIN customers c ON c.id = o.customer_id
         WHERE COALESCE(o.status,'new') != 'delivered' ORDER BY o.id DESC LIMIT 60`).all()).results || [];
      return json({ orders: rows });
    }

    if (url.pathname === "/api/admin/order-status" && request.method === "POST") {
      if (!(await isAdmin(env, request))) return json({ error: "not authorized" }, 401);
      let b; try { b = await request.json(); } catch { return json({ error: "bad json" }, 400); }
      const st = ["new", "packed", "delivered"].includes(b.status) ? b.status : null;
      if (!st || !Number.isInteger(b.id)) return json({ error: "bad params" }, 400);
      await env.DB.prepare(`UPDATE orders SET status = ?1 WHERE id = ?2`).bind(st, b.id).run();
      return json({ ok: true });
    }

    /* owner: this week's bake sheet — active Stripe subscriptions grouped by size */
    if (url.pathname === "/api/admin/subs") {
      if (!(await isAdmin(env, request))) return json({ error: "not authorized" }, 401);
      const list = await stripeGet(env, "/v1/subscriptions?status=active&limit=100&expand[]=data.items");
      if (!list) return json({ error: "stripe error" }, 502);
      const tally = { small: 0, medium: 0, large: 0 };
      const subs = (list.data || []).map((s) => {
        const items = (s.items && s.items.data) || [];
        const sizes = [];
        for (const it of items) {
          const sku = PRICE_SKU[(it.price && it.price.id) || ""];
          if (sku && tally[sku] !== undefined) { tally[sku] += it.quantity || 1; sizes.push(`${it.quantity || 1}×${sku[0].toUpperCase()}`); }
        }
        const first = items[0];
        return {
          id: s.id, sizes: sizes.join(" "),
          interval: first && first.price && first.price.recurring ? first.price.recurring.interval : "?",
          renews: (s.current_period_end || (first && first.current_period_end))
            ? new Date((s.current_period_end || first.current_period_end) * 1000).toISOString().slice(0, 10) : null,
          paused: !!s.pause_collection, cancelAtEnd: !!s.cancel_at_period_end,
        };
      });
      return json({ subs, tally, count: subs.length });
    }

    /* owner: visitor analytics pulled from Cloudflare Web Analytics (GraphQL) */
    if (url.pathname === "/api/admin/visitors") {
      if (!(await isAdmin(env, request))) return json({ error: "not authorized" }, 401);
      if (!env.CF_ANALYTICS_TOKEN || !env.CF_SITE_TAG) return json({ error: "analytics not configured" }, 500);
      const now = new Date();
      const iso = (d) => d.toISOString().slice(0, 19) + "Z";
      const ago = (days) => new Date(now.getTime() - days * 86400000);
      const q = `query {
        viewer { accounts(filter: {accountTag: "77f21a888cac91e9fdbbf4d84bd068b1"}) {
          daily: rumPageloadEventsAdaptiveGroups(filter: {siteTag: "${env.CF_SITE_TAG}", datetime_geq: "${iso(ago(14))}", datetime_leq: "${iso(now)}"}, limit: 20, orderBy: [date_ASC]) {
            count sum { visits } dimensions { date }
          }
          countries: rumPageloadEventsAdaptiveGroups(filter: {siteTag: "${env.CF_SITE_TAG}", datetime_geq: "${iso(ago(7))}", datetime_leq: "${iso(now)}"}, limit: 6, orderBy: [sum_visits_DESC]) {
            sum { visits } dimensions { countryName }
          }
          devices: rumPageloadEventsAdaptiveGroups(filter: {siteTag: "${env.CF_SITE_TAG}", datetime_geq: "${iso(ago(7))}", datetime_leq: "${iso(now)}"}, limit: 5) {
            sum { visits } dimensions { deviceType }
          }
        } }
      }`;
      const res = await fetch("https://api.cloudflare.com/client/v4/graphql", {
        method: "POST",
        headers: { Authorization: `Bearer ${env.CF_ANALYTICS_TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify({ query: q }),
      });
      const data = await res.json();
      const acct = data && data.data && data.data.viewer.accounts[0];
      if (!acct) return json({ error: "analytics query failed" }, 502);
      return json({
        daily: (acct.daily || []).map((r) => ({ date: r.dimensions.date, visits: r.sum.visits, views: r.count })),
        countries: (acct.countries || []).map((r) => ({ country: r.dimensions.countryName, visits: r.sum.visits })),
        devices: (acct.devices || []).map((r) => ({ device: r.dimensions.deviceType, visits: r.sum.visits })),
      });
    }

    /* owner: the customer book — who they are, what they've spent, who's on the list */
    if (url.pathname === "/api/admin/customers") {
      if (!(await isAdmin(env, request))) return json({ error: "not authorized" }, 401);
      const rows = (await env.DB.prepare(
        `SELECT c.id, c.email, c.name, c.city, c.points, c.marketing_ok, c.wholesale, c.company, c.created_at,
                COUNT(o.id) orders, COALESCE(SUM(o.amount_total), 0) cents
         FROM customers c LEFT JOIN orders o ON o.customer_id = c.id
         GROUP BY c.id ORDER BY c.id DESC LIMIT 300`).all()).results || [];
      return json({ customers: rows });
    }

    /* owner: promo codes managed from /admin (Stripe coupons + promotion codes under the hood) */
    if (url.pathname === "/api/admin/promos") {
      if (!(await isAdmin(env, request))) return json({ error: "not authorized" }, 401);
      /* API ≥2025-09-30: coupon lives under promotion.coupon; older versions: top-level coupon */
      let list = await stripeGet(env, "/v1/promotion_codes?limit=20&expand[]=data.promotion.coupon");
      if (!list) list = await stripeGet(env, "/v1/promotion_codes?limit=20&expand[]=data.coupon");
      if (!list) return json({ error: "stripe error" }, 502);
      const couponOf = (p) => {
        const c = (p.promotion && p.promotion.coupon) || p.coupon;
        return c && typeof c === "object" ? c : null;
      };
      return json({ promos: list.data
        .filter((p) => { const c = couponOf(p); return c && !c.deleted && c.valid !== false; })
        .map((p) => { const c = couponOf(p); return {
          id: p.id, code: p.code, active: p.active, couponId: c.id,
          off: c.percent_off ? c.percent_off + "%" : "€" + (c.amount_off / 100),
          used: p.times_redeemed, max: p.max_redemptions || null,
          expires: p.expires_at ? new Date(p.expires_at * 1000).toISOString().slice(0, 10) : null,
        }; }) });
    }

    if (url.pathname === "/api/admin/promo-create" && request.method === "POST") {
      if (!(await isAdmin(env, request))) return json({ error: "not authorized" }, 401);
      let b; try { b = await request.json(); } catch { return json({ error: "bad json" }, 400); }
      const code = String(b.code || "").toUpperCase().replace(/[^A-Z0-9_-]/g, "").slice(0, 20);
      if (code.length < 3) return json({ error: "code needs 3+ letters/numbers" }, 400);
      const cp = new URLSearchParams();
      cp.set("duration", "once"); /* subscriptions: discount applies to first delivery only */
      cp.set("name", code);
      if (b.percentOff) {
        const p = Number(b.percentOff);
        if (!(p > 0 && p <= 100)) return json({ error: "percent must be 1-100" }, 400);
        cp.set("percent_off", String(p));
      } else if (b.amountOff) {
        const a = Math.round(Number(b.amountOff) * 100);
        if (!(a > 0 && a <= 50000)) return json({ error: "€ amount looks wrong" }, 400);
        cp.set("amount_off", String(a));
        cp.set("currency", "eur");
      } else return json({ error: "set a % or € discount" }, 400);
      const coupon = await stripePostRaw(env, "/v1/coupons", cp);
      if (!coupon.ok) return json({ error: "coupon: " + coupon.err }, 502);
      const pcParams = (newShape) => {
        const pc = new URLSearchParams();
        if (newShape) { /* API ≥2025-09-30 (clover): polymorphic promotion field */
          pc.set("promotion[type]", "coupon");
          pc.set("promotion[coupon]", coupon.data.id);
        } else {
          pc.set("coupon", coupon.data.id);
        }
        pc.set("code", code);
        const maxUses = parseInt(b.maxUses, 10);
        if (maxUses > 0) pc.set("max_redemptions", String(maxUses));
        const expDays = parseInt(b.expiresDays, 10);
        if (expDays > 0) pc.set("expires_at", String(Math.floor(Date.now() / 1000) + expDays * 86400));
        return pc;
      };
      let promo = await stripePostRaw(env, "/v1/promotion_codes", pcParams(true));
      if (!promo.ok && /unknown parameter: promotion/i.test(promo.err || "")) {
        promo = await stripePostRaw(env, "/v1/promotion_codes", pcParams(false));
      }
      if (!promo.ok) return json({ error: "code: " + promo.err }, 502);
      return json({ ok: true, code: promo.data.code });
    }

    if (url.pathname === "/api/admin/promo-toggle" && request.method === "POST") {
      if (!(await isAdmin(env, request))) return json({ error: "not authorized" }, 401);
      let b; try { b = await request.json(); } catch { return json({ error: "bad json" }, 400); }
      const p = new URLSearchParams();
      p.set("active", b.active ? "true" : "false");
      const r = await stripePost(env, `/v1/promotion_codes/${encodeURIComponent(String(b.id || ""))}`, p);
      if (!r) return json({ error: "stripe error" }, 502);
      return json({ ok: true, active: r.active });
    }

    /* delete = deactivate the code + delete its coupon (Stripe can't hard-delete promo codes) */
    if (url.pathname === "/api/admin/promo-delete" && request.method === "POST") {
      if (!(await isAdmin(env, request))) return json({ error: "not authorized" }, 401);
      let b; try { b = await request.json(); } catch { return json({ error: "bad json" }, 400); }
      const off = new URLSearchParams();
      off.set("active", "false");
      await stripePost(env, `/v1/promotion_codes/${encodeURIComponent(String(b.id || ""))}`, off);
      const res = await fetch(`https://api.stripe.com/v1/coupons/${encodeURIComponent(String(b.couponId || ""))}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` },
      });
      if (!res.ok) return json({ error: "couldn't delete the coupon" }, 502);
      return json({ ok: true });
    }

    /* owner: raw-materials & packaging inventory (flour/salt/oil/labels/bags/tape) */
    if (url.pathname === "/api/admin/inventory") {
      if (!(await isAdmin(env, request))) return json({ error: "not authorized" }, 401);
      const rows = (await env.DB.prepare(`SELECT * FROM inventory ORDER BY id`).all()).results || [];
      return json({ items: rows });
    }

    if (url.pathname === "/api/admin/inventory-save" && request.method === "POST") {
      if (!(await isAdmin(env, request))) return json({ error: "not authorized" }, 401);
      let b; try { b = await request.json(); } catch { return json({ error: "bad json" }, 400); }
      const items = Array.isArray(b.items) ? b.items.slice(0, 50) : [];
      for (const it of items) {
        const name = String(it.name || "").trim().slice(0, 60);
        if (!name) continue;
        const qty = Number(it.qty) || 0, low = Number(it.low_at) || 0, cost = Number(it.cost) || 0;
        const unit = String(it.unit || "").slice(0, 12), sup = String(it.supplier || "").slice(0, 80);
        if (it.id) {
          await env.DB.prepare(
            `UPDATE inventory SET name=?1, unit=?2, qty=?3, low_at=?4, supplier=?5, cost=?6, updated_at=datetime('now') WHERE id=?7`
          ).bind(name, unit, qty, low, sup, cost, it.id).run();
        } else {
          await env.DB.prepare(
            `INSERT OR IGNORE INTO inventory (name, unit, qty, low_at, supplier, cost) VALUES (?1, ?2, ?3, ?4, ?5, ?6)`
          ).bind(name, unit, qty, low, sup, cost).run();
        }
      }
      return json({ ok: true });
    }

    if (url.pathname === "/api/admin/inventory-delete" && request.method === "POST") {
      if (!(await isAdmin(env, request))) return json({ error: "not authorized" }, 401);
      let b; try { b = await request.json(); } catch { return json({ error: "bad json" }, 400); }
      await env.DB.prepare(`DELETE FROM inventory WHERE id = ?1`).bind(Number(b.id) || 0).run();
      return json({ ok: true });
    }

    if (url.pathname === "/api/admin/update" && request.method === "POST") {
      if (!(await isAdmin(env, request))) return json({ error: "not authorized" }, 401);
      let b;
      try { b = await request.json(); } catch { return json({ error: "bad json" }, 400); }
      const up = (k, v) => env.DB.prepare(`INSERT OR REPLACE INTO settings (k, v) VALUES (?1, ?2)`).bind(k, String(v)).run();
      if (typeof b.open === "boolean") await up("store_open", b.open ? "1" : "0");
      for (const sku of ["small", "medium", "large"]) {
        if (b.caps && Number.isInteger(b.caps[sku]) && b.caps[sku] >= 0 && b.caps[sku] <= 9999) await up("cap_" + sku, b.caps[sku]);
        if (b.resetSold === true) await up("sold_" + sku, "0");
      }
      return json(await getSettings(env));
    }

    /* newsletter opt-in — used by the post-checkout confirmation (signed-in only) */
    if (url.pathname === "/api/newsletter-optin" && request.method === "POST") {
      const c = await currentCustomer(env, request);
      if (!c) return json({ error: "not signed in" }, 401);
      await env.DB.prepare(`UPDATE customers SET marketing_ok = 1 WHERE id = ?1`).bind(c.id).run();
      return json({ ok: true });
    }

    if (url.pathname === "/api/logout" && request.method === "POST") {
      const token = getCookie(request, "mira_session");
      if (token) await env.DB.prepare(`DELETE FROM sessions WHERE token = ?1`).bind(token).run();
      return json({ ok: true }, 200, {
        "Set-Cookie": "mira_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0",
      });
    }

    if (url.pathname.startsWith("/api/")) return json({ error: "not found" }, 404);

    /* run_worker_first is on (for the canonical-host 301s) — everything else is a static asset.
       Add baseline security headers; deny framing on the owner-only pages (clickjacking). */
    const assetRes = await env.ASSETS.fetch(request);
    const res = new Response(assetRes.body, assetRes);
    res.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
    res.headers.set("X-Content-Type-Options", "nosniff");
    res.headers.set("Permissions-Policy", "geolocation=(), microphone=(), camera=()");
    if (/^\/(admin|account|inventory)\b/.test(url.pathname)) {
      res.headers.set("X-Frame-Options", "DENY");
      res.headers.set("Content-Security-Policy", "frame-ancestors 'none'");
      res.headers.set("Cache-Control", "no-store");
    }
    return res;
  },
};
