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
    `SELECT c.* FROM sessions s JOIN customers c ON c.id = s.customer_id
     WHERE s.token = ?1 AND s.expires_at > datetime('now')`
  ).bind(token).first();
  return row || null;
}

async function createSession(env, customerId) {
  const token = crypto.randomUUID() + crypto.randomUUID().replace(/-/g, "");
  await env.DB.prepare(
    `INSERT INTO sessions (token, customer_id, expires_at)
     VALUES (?1, ?2, datetime('now', '+${SESSION_DAYS} days'))`
  ).bind(token, customerId).run();
  return `mira_session=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}`;
}

async function stripeGet(env, path) {
  const res = await fetch(`https://api.stripe.com${path}`, {
    headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` },
  });
  const data = await res.json();
  return res.ok ? data : null;
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

  const paid = session.payment_status === "paid" || session.payment_status === "no_payment_required";
  if (paid) {
    const points = Math.floor((session.amount_total || 0) / 100);
    const inserted = await env.DB.prepare(
      `INSERT OR IGNORE INTO orders (customer_id, stripe_session_id, amount_total, currency, mode, points_earned)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6)`
    ).bind(customer.id, session.id, session.amount_total || 0, session.currency || "eur", session.mode, points).run();
    if (inserted.meta.changes > 0) {
      if (points > 0)
        await env.DB.prepare(`UPDATE customers SET points = points + ?1 WHERE id = ?2`).bind(points, customer.id).run();
      const redeemed = parseInt((session.metadata && session.metadata.points_redeemed) || "0", 10);
      if (redeemed > 0)
        await env.DB.prepare(`UPDATE customers SET points = MAX(points - ?1, 0) WHERE id = ?2`).bind(redeemed, customer.id).run();
    }
  }
  return customer;
}

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

      /* points redemption: 100 pts = €8 off, one-off orders of €8+, signed-in only */
      let redeemer = null;
      if (body.usePoints === true && mode === "payment" && subtotal >= 800) {
        const c = await currentCustomer(env, request);
        if (c && c.points >= 100) redeemer = c;
      }

      const p = new URLSearchParams();
      p.set("ui_mode", "embedded_page");
      p.set("mode", mode);
      if (redeemer) {
        p.set("discounts[0][coupon]", POINTS_COUPON);
        p.set("metadata[points_redeemed]", "100");
      }
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

    /* after a successful checkout: create/refresh the mira account + sign in */
    if (url.pathname === "/api/claim" && request.method === "POST") {
      let body;
      try { body = await request.json(); } catch { return json({ error: "bad json" }, 400); }
      const sid = String(body.session_id || "");
      if (!/^cs_(live|test)_[A-Za-z0-9]+$/.test(sid)) return json({ error: "bad session" }, 400);

      const session = await stripeGet(env, `/v1/checkout/sessions/${sid}`);
      if (!session || session.status !== "complete") return json({ error: "not a completed checkout" }, 400);

      const customer = await processSession(env, session);
      if (!customer) return json({ error: "no email on session" }, 400);

      const cookie = await createSession(env, customer.id);
      const fresh = await env.DB.prepare(`SELECT points FROM customers WHERE id = ?1`).bind(customer.id).first();
      return json({ ok: true, email: customer.email, name: customer.name, points: fresh.points }, 200, { "Set-Cookie": cookie });
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
        const session = await stripeGet(env, `/v1/checkout/sessions/${objId}`);
        if (session && session.status === "complete") await processSession(env, session);
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
              const it = s.items && s.items.data[0];
              return {
                id: s.id,
                cancelAtEnd: !!s.cancel_at_period_end,
                paused: !!s.pause_collection,
                status: s.status,
                plan: (it && it.price && it.price.nickname) || "subscription",
                amount: it && it.price ? it.price.unit_amount * (it.quantity || 1) : null,
                interval: it && it.price && it.price.recurring
                  ? `${it.price.recurring.interval_count > 1 ? it.price.recurring.interval_count + " " : ""}${it.price.recurring.interval}`
                  : null,
                renews: s.current_period_end ? new Date(s.current_period_end * 1000).toISOString().slice(0, 10) : null,
              };
            });
        }
      }
      return json({
        loggedIn: true,
        customer: {
          email: c.email, name: c.name, phone: c.phone, points: c.points,
          address: { line1: c.address_line1, line2: c.address_line2, postal_code: c.postal_code, city: c.city, country: c.country },
        },
        orders: orders.results || [],
        subscriptions: subs,
      });
    }

    /* email login — step 1: send a 6-digit code */
    if (url.pathname === "/api/login-request" && request.method === "POST") {
      let body;
      try { body = await request.json(); } catch { return json({ error: "bad json" }, 400); }
      const email = String(body.email || "").trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: "invalid email" }, 400);
      if (!env.BREVO_API_KEY)
        return json({ error: "email login isn't connected yet — your account signs in automatically after any order" }, 503);
      /* max one code per email per minute */
      const recent = await env.DB.prepare(
        `SELECT 1 AS hit FROM login_codes WHERE email = ?1 AND created_at > datetime('now', '-60 seconds')`
      ).bind(email).first();
      if (recent) return json({ error: "code already sent — wait a minute before requesting another" }, 429);
      const code = String(Math.floor(100000 + Math.random() * 900000));
      await env.DB.prepare(
        `INSERT INTO login_codes (email, code, attempts, expires_at)
         VALUES (?1, ?2, 0, datetime('now', '+10 minutes'))
         ON CONFLICT(email) DO UPDATE SET code = excluded.code, attempts = 0,
           expires_at = excluded.expires_at, created_at = datetime('now')`
      ).bind(email, code).run();
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
      await env.DB.prepare(`INSERT OR IGNORE INTO customers (email) VALUES (?1)`).bind(email).run();
      const customer = await env.DB.prepare(`SELECT * FROM customers WHERE email = ?1`).bind(email).first();
      const cookie = await createSession(env, customer.id);
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

    if (url.pathname === "/api/logout" && request.method === "POST") {
      const token = getCookie(request, "mira_session");
      if (token) await env.DB.prepare(`DELETE FROM sessions WHERE token = ?1`).bind(token).run();
      return json({ ok: true }, 200, {
        "Set-Cookie": "mira_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0",
      });
    }

    return json({ error: "not found" }, 404);
  },
};
