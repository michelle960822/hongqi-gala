
      let global = globalThis;
      globalThis.global = globalThis;

      if (typeof global.navigator === 'undefined') {
        global.navigator = {
          userAgent: 'edge-runtime',
          language: 'en-US',
          languages: ['en-US'],
        };
      } else {
        if (typeof global.navigator.language === 'undefined') {
          global.navigator.language = 'en-US';
        }
        if (!global.navigator.languages || global.navigator.languages.length === 0) {
          global.navigator.languages = [global.navigator.language];
        }
        if (typeof global.navigator.userAgent === 'undefined') {
          global.navigator.userAgent = 'edge-runtime';
        }
      }

      class MessageChannel {
        constructor() {
          this.port1 = new MessagePort();
          this.port2 = new MessagePort();
        }
      }
      class MessagePort {
        constructor() {
          this.onmessage = null;
        }
        postMessage(data) {
          if (this.onmessage) {
            setTimeout(() => this.onmessage({ data }), 0);
          }
        }
      }
      global.MessageChannel = MessageChannel;

      '__MIDDLEWARE_BUNDLE_CODE__'

      function recreateRequest(request, overrides = {}) {
        const cloned = typeof request.clone === 'function' ? request.clone() : request;
        const headers = new Headers(cloned.headers);

        if (overrides.headerPatches) {
          Object.keys(overrides.headerPatches).forEach((key) => {
            const value = overrides.headerPatches[key];
            if (value === null || typeof value === 'undefined') {
              headers.delete(key);
            } else {
              headers.set(key, value);
            }
          });
        }

        if (overrides.headers) {
          const extraHeaders = new Headers(overrides.headers);
          extraHeaders.forEach((value, key) => headers.set(key, value));
        }

        const url = overrides.url || cloned.url;
        const method = overrides.method || cloned.method || 'GET';
        const canHaveBody = method && method.toUpperCase() !== 'GET' && method.toUpperCase() !== 'HEAD';
        const body = overrides.body !== undefined ? overrides.body : canHaveBody ? cloned.body : undefined;

        // 如果rewrite传入的是完整URL（第三方地址），需要更新host
        if (overrides.url) {
          try {
            const newUrl = new URL(overrides.url, cloned.url);
            // 只有当新URL是绝对路径（包含协议和host）时才更新host
            if (overrides.url.startsWith('http://') || overrides.url.startsWith('https://')) {
              headers.set('host', newUrl.host);
            }
            // 相对路径时保持原有host不变
          } catch (e) {
            // URL解析失败时保持原有host
          }
        }

        const init = {
          method,
          headers,
          redirect: cloned.redirect,
          credentials: cloned.credentials,
          cache: cloned.cache,
          mode: cloned.mode,
          referrer: cloned.referrer,
          referrerPolicy: cloned.referrerPolicy,
          integrity: cloned.integrity,
          keepalive: cloned.keepalive,
          signal: cloned.signal,
        };

        if (canHaveBody && body !== undefined) {
          init.body = body;
        }

        if ('duplex' in cloned) {
          init.duplex = cloned.duplex;
        }

        return new Request(url, init);

      }

      
      async function executeMiddleware(context) {
        return null; // 没有中间件，继续执行后续函数
      }
    

      function usercode(ev, hookCtx) {
        hookCtx = hookCtx || { fetch: globalThis.fetch };
        const { fetch } = hookCtx;
        const globalthis = hookCtx;
        "use strict";
        // ↓ 用户原始代码
        return (async function handleRequest(context) {
          let routeParams = {};
          let pagesFunctionResponse = null;
          let request = context.request;
          const waitUntil = context.waitUntil;
          let urlInfo = new URL(request.url);
          const eo = request.eo || {};


          const normalizePathname = () => {
            if (urlInfo.pathname !== '/' && urlInfo.pathname.endsWith('/')) {
              urlInfo.pathname = urlInfo.pathname.slice(0, -1);
            }
          };

          function getSuffix(pathname = '') {
            // Use a regular expression to extract the file extension from the URL
            const suffix = pathname.match(/\.([^\.]+)$/);
            // If an extension is found, return it, otherwise return an empty string
            return suffix ? '.' + suffix[1] : null;
          }

          normalizePathname();

          let matchedFunc = false;

          
        const runEdgeFunctions = () => {
          
            if(!matchedFunc && '/api/admin/wipe' === urlInfo.pathname && request.method === 'POST') {
              matchedFunc = true;
                (() => {
  // functions/api/admin/wipe.js
  async function onRequestPost(context) {
    const { env, request } = context;
    if (!env.DB)
      return json({ error: "DB binding missing" }, 500);
    const body = await request.json().catch(() => ({}));
    const pin = body.adminPin || "";
    if (pin !== "404112")
      return json({ error: "unauthorized" }, 401);
    try {
      await env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS access_log (
        id TEXT PRIMARY KEY, action TEXT NOT NULL, actor_ip TEXT, actor_ua TEXT, meta TEXT, time TEXT NOT NULL
      )
    `).run();
    } catch (e) {
    }
    const mode = body.mode || "all";
    const ip = (request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for") || "").slice(0, 64);
    const ua = (request.headers.get("user-agent") || "").slice(0, 256);
    const logId = "al_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);
    const logAction = mode === "expired" ? "admin_cleanup_expired" : "admin_wipe_all";
    try {
      if (mode === "expired") {
        const today = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
        const expiredRecords = await env.DB.prepare(
          "SELECT id FROM records WHERE retention_until IS NOT NULL AND retention_until < ?"
        ).bind(today).all();
        const expiredIds = (expiredRecords.results || []).map((r) => r.id);
        if (expiredIds.length === 0) {
          await writeLog(env, logId, logAction, ip, ua, { deleted: 0, today });
          return json({ ok: true, deleted: 0, message: "\u6CA1\u6709\u9700\u8981\u6E05\u7406\u7684\u8FC7\u671F\u6570\u636E" });
        }
        const placeholders = expiredIds.map(() => "?").join(",");
        await env.DB.prepare(`DELETE FROM visit_log WHERE rid IN (${placeholders})`).bind(...expiredIds).run();
        const delRes = await env.DB.prepare(`DELETE FROM records WHERE id IN (${placeholders})`).bind(...expiredIds).run();
        await writeLog(env, logId, logAction, ip, ua, { deleted: expiredIds.length, today });
        return json({
          ok: true,
          deleted: expiredIds.length,
          message: `\u5DF2\u6E05\u7406 ${expiredIds.length} \u6761\u5230\u671F\u8BB0\u5F55\u53CA\u5173\u8054\u7B7E\u5230\u6D41\u6C34`
        });
      }
      await env.DB.prepare("DELETE FROM visit_log").run();
      await env.DB.prepare("DELETE FROM records").run();
      await writeLog(env, logId, logAction, ip, ua, { deleted: "all" });
      return json({ ok: true, message: "\u5DF2\u6E05\u7A7A\u6240\u6709\u6570\u636E" });
    } catch (err) {
      return json({ error: "cleanup failed: " + err.message }, 500);
    }
  }
  async function writeLog(env, id, action, ip, ua, meta) {
    try {
      await env.DB.prepare(
        "INSERT INTO access_log (id, action, actor_ip, actor_ua, meta, time) VALUES (?, ?, ?, ?, ?, ?)"
      ).bind(id, action, ip, ua, JSON.stringify(meta || {}), (/* @__PURE__ */ new Date()).toISOString()).run();
    } catch (e) {
      console.error("[access_log] write failed:", e.message);
    }
  }
  function json(obj, status = 200) {
    return new Response(JSON.stringify(obj), {
      status,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": "*"
      }
    });
  }

          pagesFunctionResponse = onRequestPost;
        })();
            }
          

            if(!matchedFunc && '/api/debug/crypto' === urlInfo.pathname && request.method === 'GET') {
              matchedFunc = true;
                (() => {
  // functions/api/debug/crypto.js
  async function onRequestGet(context) {
    const { env } = context;
    const url = new URL(context.request.url);
    if (url.searchParams.get("pin") !== "404112")
      return json({ error: "unauthorized" }, 401);
    const results = [];
    try {
      const secret = "NPkJGuRULNDLyvmzOCDhIrS6Dpw+f8tG5Gw6eiDxQNY=";
      const raw = Uint8Array.from(atob(secret), (c) => c.charCodeAt(0));
      const keyBytes = new Uint8Array(32);
      keyBytes.set(raw.slice(0, 32));
      const key = await crypto.subtle.importKey("raw", keyBytes, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
      const plain = "220122199302100716";
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const enc = new TextEncoder().encode(plain);
      const cipherBuf = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc);
      const combined = new Uint8Array(iv.length + cipherBuf.byteLength);
      combined.set(iv, 0);
      combined.set(new Uint8Array(cipherBuf), iv.length);
      let bin = "";
      for (let i = 0; i < combined.length; i++)
        bin += String.fromCharCode(combined[i]);
      const cipherB64 = btoa(bin);
      const decoded = Uint8Array.from(atob(cipherB64), (c) => c.charCodeAt(0));
      const iv2 = decoded.slice(0, 12);
      const cipher2 = decoded.slice(12);
      const plainBuf = await crypto.subtle.decrypt({ name: "AES-GCM", iv: iv2 }, key, cipher2);
      const decodedPlain = new TextDecoder().decode(plainBuf);
      results.push({ test: "round_trip_same_isolate", cipher: cipherB64.slice(0, 30) + "...", decoded: decodedPlain, match: decodedPlain === plain });
    } catch (e) {
      results.push({ test: "round_trip_same_isolate", error: e.message });
    }
    try {
      const { DB } = env;
      if (!DB) {
        results.push({ test: "db_decrypt", error: "no DB" });
      } else {
        const row = await DB.prepare("SELECT id_number FROM records WHERE id_number IS NOT NULL LIMIT 1").first();
        const storedCipher = row ? row.id_number : null;
        results.push({ test: "db_decrypt", stored_value_type: typeof storedCipher, stored_value_len: storedCipher ? storedCipher.length : 0, sample: storedCipher ? storedCipher.slice(0, 30) : null });
        if (storedCipher && typeof storedCipher === "string" && storedCipher.length > 10) {
          try {
            const secret = "NPkJGuRULNDLyvmzOCDhIrS6Dpw+f8tG5Gw6eiDxQNY=";
            const raw = Uint8Array.from(atob(secret), (c) => c.charCodeAt(0));
            const keyBytes = new Uint8Array(32);
            keyBytes.set(raw.slice(0, 32));
            const key = await crypto.subtle.importKey("raw", keyBytes, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
            const decoded = Uint8Array.from(atob(storedCipher), (c) => c.charCodeAt(0));
            results.push({ test: "db_decrypt", decoded_len: decoded.length });
            const iv2 = decoded.slice(0, 12);
            const cipher2 = decoded.slice(12);
            const plainBuf = await crypto.subtle.decrypt({ name: "AES-GCM", iv: iv2 }, key, cipher2);
            const plain = new TextDecoder().decode(plainBuf);
            results.push({ test: "db_decrypt", plain });
          } catch (e) {
            results.push({ test: "db_decrypt_inner", error: e.message });
          }
        }
      }
    } catch (e) {
      results.push({ test: "db_decrypt_outer", error: e.message });
    }
    return json({ results }, 200);
  }
  function json(obj, status = 200) {
    return new Response(JSON.stringify(obj), {
      status,
      headers: { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*" }
    });
  }

          pagesFunctionResponse = onRequestGet;
        })();
            }
          

            if(!matchedFunc && '/api/debug/raw' === urlInfo.pathname && request.method === 'GET') {
              matchedFunc = true;
                (() => {
  // functions/api/debug/raw.js
  async function onRequestGet(context) {
    const { env, request } = context;
    if (!env.DB)
      return json({ error: "DB binding missing" }, 500);
    const url = new URL(request.url);
    if (url.searchParams.get("pin") !== "404112")
      return json({ error: "unauthorized" }, 401);
    const { results } = await env.DB.prepare(
      "SELECT id, id_number, phone, id_hmac, phone_hmac, id_masked, phone_masked FROM records"
    ).all();
    return json({ rows: results || [] }, 200);
  }
  function json(obj, status = 200) {
    return new Response(JSON.stringify(obj), {
      status,
      headers: { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*" }
    });
  }

          pagesFunctionResponse = onRequestGet;
        })();
            }
          

            if(!matchedFunc && '/api/health' === urlInfo.pathname && request.method === 'GET') {
              matchedFunc = true;
                (() => {
  // functions/api/health.js
  async function onRequestGet(context) {
    return new Response(JSON.stringify({
      ok: true,
      time: (/* @__PURE__ */ new Date()).toISOString(),
      binding: !!context.env.DB,
      version: "v5-skip-api-cache"
    }), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": "*"
      }
    });
  }

          pagesFunctionResponse = onRequestGet;
        })();
            }
          

            if(!matchedFunc && '/api/records' === urlInfo.pathname && request.method === 'GET') {
              matchedFunc = true;
                (() => {
  // functions/api/records.js
  var ADMIN_PIN_DEFAULT = "404112";
  var ACTIVITY_END = "2026-08-15";
  var RETENTION_DAYS = 30;
  var DEV_ID_ENC_KEY = "NPkJGuRULNDLyvmzOCDhIrS6Dpw+f8tG5Gw6eiDxQNY=";
  var DEV_HMAC_KEY = "N+n/LSL+Z1Zd6RMZ1cx34qjkxnO9fFM8koPLN9Xnths=";
  var _aesKeyCache = null;
  var _hmacKeyCache = null;
  async function onRequestGet(context) {
    const { env, request } = context;
    return jsonResp(await listRecords(env, request));
  }
  async function onRequestPost(context) {
    const { request, env } = context;
    return jsonResp(await createRecord(request, env));
  }
  async function listRecords(env, request) {
    if (!env.DB)
      return { error: "DB binding missing", hint: "\u5728 Pages Settings \u2192 Functions \u2192 D1 database bindings \u914D\u7F6E DB" };
    await ensureSchema(env);
    await migrateLegacyRows(env);
    const url = new URL(request.url);
    const wantFull = url.searchParams.get("full") === "1";
    const adminPin = url.searchParams.get("admin_pin") || "";
    if (wantFull && adminPin !== ADMIN_PIN_DEFAULT) {
      return { error: "unauthorized", hint: "\u9700\u8981\u7BA1\u7406\u5458 PIN \u624D\u80FD\u67E5\u770B\u5B8C\u6574\u6570\u636E" };
    }
    try {
      const { results } = await env.DB.prepare(
        "SELECT * FROM records ORDER BY created_at DESC"
      ).all();
      let records = results || [];
      if (!wantFull) {
        records = records.map((r) => ({
          ...r,
          id_number: r.id_masked || maskIdNumber(r.id_number),
          phone: r.phone_masked || maskPhone(r.phone)
        }));
      } else {
        const aesKey = await getAesKey(env);
        records = await Promise.all(records.map(async (r) => ({
          ...r,
          id_number: await safeDecrypt(r.id_number, aesKey),
          phone: await safeDecrypt(r.phone, aesKey)
        })));
        await logAccess(env, request, "records_full_export", { count: records.length });
      }
      return { records };
    } catch (err) {
      return { error: "DB query failed: " + err.message };
    }
  }
  async function createRecord(request, env) {
    if (!env.DB)
      return { error: "DB binding missing" };
    await ensureSchema(env);
    let r;
    try {
      r = await request.json();
    } catch {
      return { error: "invalid json" };
    }
    if (!r)
      return { error: "empty body" };
    const required = ["id", "roleId", "roleName", "slotIdx", "date", "dateLabel", "time", "realName", "idNumber", "phone"];
    for (const k of required) {
      if (r[k] === void 0 || r[k] === null || r[k] === "") {
        return { error: `missing_field: ${k}` };
      }
    }
    const idNumberPlain = String(r.idNumber).toUpperCase();
    const phonePlain = String(r.phone);
    const aesKey = await getAesKey(env);
    const hmacKey = await getHmacKey(env);
    const idHmac = await hmacHex(idNumberPlain, hmacKey);
    const phoneHmac = await hmacHex(phonePlain, hmacKey);
    const dupId = await env.DB.prepare(
      "SELECT id, real_name, date_label, time FROM records WHERE id_hmac = ? LIMIT 1"
    ).bind(idHmac).first();
    if (dupId) {
      return {
        error: "duplicate_id",
        message: `\u8BE5\u8EAB\u4EFD\u8BC1\u53F7\u5DF2\u62A5\u540D\uFF1A${dupId.real_name}\uFF08${dupId.date_label} ${dupId.time}\uFF09`
      };
    }
    const dupPhone = await env.DB.prepare(
      "SELECT id, real_name, date_label, time FROM records WHERE phone_hmac = ? LIMIT 1"
    ).bind(phoneHmac).first();
    if (dupPhone) {
      return {
        error: "duplicate_phone",
        message: `\u8BE5\u624B\u673A\u53F7\u5DF2\u62A5\u540D\uFF1A${dupPhone.real_name}\uFF08${dupPhone.date_label} ${dupPhone.time}\uFF09`
      };
    }
    const roleSlots = {
      anchor: [25, 25, 25, 25],
      talent: [25, 25, 30],
      media: [25, 25, 25, 25, 25, 25, 25, 25]
    };
    const cap = roleSlots[r.roleId] && roleSlots[r.roleId][r.slotIdx] || 25;
    const used = await env.DB.prepare(
      "SELECT COUNT(*) as n FROM records WHERE role_id = ? AND slot_idx = ?"
    ).bind(r.roleId, r.slotIdx).first();
    if (used && used.n >= cap) {
      return { error: "slot_full", message: `\u8BE5\u65F6\u6BB5\u5DF2\u62A5\u6EE1\uFF08${cap}/${cap}\uFF09` };
    }
    const idCipher = await aesEncrypt(idNumberPlain, aesKey);
    const phoneCipher = await aesEncrypt(phonePlain, aesKey);
    const idMasked = maskIdNumber(idNumberPlain);
    const phoneMasked = maskPhone(phonePlain);
    await migrateLegacyRows(env);
    const retentionUntil = addDays(ACTIVITY_END + "T23:59:59+08:00", RETENTION_DAYS);
    try {
      await env.DB.prepare(`
      INSERT INTO records (
        id, role_id, role_name, slot_idx, date, date_label, time, slots,
        category, real_name, id_number, phone, id_hmac, phone_hmac, id_masked, phone_masked,
        platform_id, platform, followers, comp_count, companions, device_id, created_at, retention_until
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
        r.id,
        r.roleId,
        r.roleName,
        r.slotIdx,
        r.date,
        r.dateLabel,
        r.time,
        Array.isArray(r.slots) ? JSON.stringify(r.slots) : typeof r.slots === "string" ? r.slots : null,
        r.category || "",
        r.realName,
        idCipher,
        phoneCipher,
        idHmac,
        phoneHmac,
        idMasked,
        phoneMasked,
        r.platformId || "",
        Array.isArray(r.platform) ? r.platform.join("|") : r.platform || "",
        r.followers || "",
        Array.isArray(r.companions) ? r.companions.length : 0,
        JSON.stringify(r.companions || []),
        r.deviceId || "",
        r.createdAt || (/* @__PURE__ */ new Date()).toISOString(),
        retentionUntil
      ).run();
    } catch (insertErr) {
      return { error: "DB insert failed: " + insertErr.message };
    }
    return { ok: true, id: r.id, retention_until: retentionUntil };
  }
  async function getAesKey(env) {
    if (_aesKeyCache)
      return _aesKeyCache;
    const secret = env && env.ID_ENC_KEY || DEV_ID_ENC_KEY;
    const raw = base64ToBytes(secret);
    const keyBytes = new Uint8Array(32);
    keyBytes.set(raw.slice(0, 32));
    _aesKeyCache = await crypto.subtle.importKey(
      "raw",
      keyBytes,
      { name: "AES-GCM" },
      false,
      ["encrypt", "decrypt"]
    );
    return _aesKeyCache;
  }
  async function getHmacKey(env) {
    if (_hmacKeyCache)
      return _hmacKeyCache;
    const secret = env && env.HMAC_KEY || DEV_HMAC_KEY;
    const raw = base64ToBytes(secret);
    const keyBytes = new Uint8Array(32);
    keyBytes.set(raw.slice(0, 32));
    _hmacKeyCache = await crypto.subtle.importKey(
      "raw",
      keyBytes,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    return _hmacKeyCache;
  }
  async function aesEncrypt(plain, key) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const enc = new TextEncoder().encode(String(plain));
    const cipherBuf = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc);
    const combined = new Uint8Array(iv.length + cipherBuf.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(cipherBuf), iv.length);
    return bytesToBase64(combined);
  }
  async function aesDecrypt(b64, key) {
    const combined = base64ToBytes(b64);
    const iv = combined.slice(0, 12);
    const cipher = combined.slice(12);
    const plainBuf = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, cipher);
    return new TextDecoder().decode(plainBuf);
  }
  async function safeDecrypt(b64, key) {
    try {
      if (!b64)
        return "";
      return await aesDecrypt(b64, key);
    } catch (e) {
      return b64;
    }
  }
  async function hmacHex(plain, key) {
    const enc = new TextEncoder().encode(String(plain));
    const sig = await crypto.subtle.sign("HMAC", key, enc);
    return bytesToHex(new Uint8Array(sig).slice(0, 16));
  }
  function maskIdNumber(id) {
    if (!id)
      return "";
    const s = String(id).trim().toUpperCase();
    if (s.length < 8)
      return "****";
    return s.slice(0, 6) + "********" + s.slice(-4);
  }
  function maskPhone(p) {
    if (!p)
      return "";
    const s = String(p);
    if (s.length < 7)
      return "****";
    return s.slice(0, 3) + "****" + s.slice(-4);
  }
  function bytesToBase64(bytes) {
    let bin = "";
    for (let i = 0; i < bytes.length; i++)
      bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }
  function base64ToBytes(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++)
      out[i] = bin.charCodeAt(i);
    return out;
  }
  function bytesToHex(bytes) {
    let s = "";
    for (let i = 0; i < bytes.length; i++)
      s += bytes[i].toString(16).padStart(2, "0");
    return s;
  }
  function addDays(isoOrDate, days) {
    const d = new Date(isoOrDate);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString();
  }
  async function logAccess(env, request, action, meta) {
    try {
      const ip = (request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for") || "").slice(0, 64);
      const ua = (request.headers.get("user-agent") || "").slice(0, 256);
      const id = "al_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);
      await env.DB.prepare(`
      INSERT INTO access_log (id, action, actor_ip, actor_ua, meta, time)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(
        id,
        action,
        ip,
        ua,
        JSON.stringify(meta || {}),
        (/* @__PURE__ */ new Date()).toISOString()
      ).run();
    } catch (e) {
      console.error("[access_log] write failed:", e.message);
    }
  }
  async function ensureSchema(env) {
    if (!env.DB)
      return;
    try {
      await env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS records (
        id          TEXT PRIMARY KEY,
        role_id     TEXT NOT NULL,
        role_name   TEXT NOT NULL,
        slot_idx    INTEGER NOT NULL,
        date        TEXT NOT NULL,
        date_label  TEXT NOT NULL,
        time        TEXT NOT NULL,
        slots       TEXT,
        category    TEXT,
        real_name   TEXT NOT NULL,
        id_number   TEXT NOT NULL,
        phone       TEXT NOT NULL,
        id_hmac     TEXT,
        phone_hmac  TEXT,
        id_masked   TEXT,
        phone_masked TEXT,
        platform_id TEXT,
        platform    TEXT,
        followers   TEXT,
        comp_count  INTEGER DEFAULT 0,
        companions  TEXT,
        device_id   TEXT,
        created_at  TEXT NOT NULL,
        retention_until TEXT
      )
    `).run();
    } catch (e) {
    }
    const additions = [
      "ALTER TABLE records ADD COLUMN id_hmac TEXT",
      "ALTER TABLE records ADD COLUMN phone_hmac TEXT",
      "ALTER TABLE records ADD COLUMN id_masked TEXT",
      "ALTER TABLE records ADD COLUMN phone_masked TEXT",
      "ALTER TABLE records ADD COLUMN retention_until TEXT",
      "ALTER TABLE records ADD COLUMN slots TEXT"
    ];
    for (const sql of additions) {
      try {
        await env.DB.prepare(sql).run();
      } catch (e) {
      }
    }
    try {
      await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_records_role_slot ON records(role_id, slot_idx)").run();
    } catch (e) {
    }
    try {
      await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_records_id_hmac ON records(id_hmac)").run();
    } catch (e) {
    }
    try {
      await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_records_phone_hmac ON records(phone_hmac)").run();
    } catch (e) {
    }
    try {
      await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_records_created_at ON records(created_at DESC)").run();
    } catch (e) {
    }
    try {
      await env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS visit_log (
        id          TEXT PRIMARY KEY,
        record_id   TEXT NOT NULL,
        point       TEXT NOT NULL,
        real_name   TEXT,
        platform_id TEXT,
        time        TEXT NOT NULL
      )
    `).run();
    } catch (e) {
    }
    try {
      await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_visit_log_record ON visit_log(record_id)").run();
    } catch (e) {
    }
    try {
      await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_visit_log_time ON visit_log(time DESC)").run();
    } catch (e) {
    }
    try {
      await env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS access_log (
        id TEXT PRIMARY KEY,
        action TEXT NOT NULL,
        actor_ip TEXT,
        actor_ua TEXT,
        meta TEXT,
        time TEXT NOT NULL
      )
    `).run();
    } catch (e) {
    }
    try {
      await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_access_log_time ON access_log(time DESC)").run();
    } catch (e) {
    }
  }
  var _migrationDone = false;
  async function migrateLegacyRows(env) {
    if (_migrationDone || !env.DB)
      return;
    try {
      const rows = await env.DB.prepare(
        "SELECT id, id_number, phone FROM records WHERE id_hmac IS NULL LIMIT 100"
      ).all();
      const list = rows.results || [];
      if (list.length === 0) {
        _migrationDone = true;
        return;
      }
      const aesKey = await getAesKey(env);
      const hmacKey = await getHmacKey(env);
      for (const row of list) {
        try {
          const alreadyEncrypted = row.id_number && /[+/=]/.test(row.id_number);
          if (alreadyEncrypted) {
            await env.DB.prepare("UPDATE records SET id_hmac=?, phone_hmac=?, id_masked=?, phone_masked=? WHERE id=?").bind("", "", maskIdNumber(row.id_number), maskPhone(row.phone), row.id).run();
            continue;
          }
          const idHmac = await hmacHex(row.id_number, hmacKey);
          const phoneHmac = await hmacHex(row.phone, hmacKey);
          const idCipher = await aesEncrypt(row.id_number, aesKey);
          const phoneCipher = await aesEncrypt(row.phone, aesKey);
          const idMasked = maskIdNumber(row.id_number);
          const phoneMasked = maskPhone(row.phone);
          await env.DB.prepare(
            "UPDATE records SET id_number=?, phone=?, id_hmac=?, phone_hmac=?, id_masked=?, phone_masked=? WHERE id=?"
          ).bind(idCipher, phoneCipher, idHmac, phoneHmac, idMasked, phoneMasked, row.id).run();
          console.log("[migrate] encrypted legacy row", row.id);
        } catch (e) {
          console.error("[migrate] row", row.id, "failed:", e.message);
        }
      }
      _migrationDone = true;
    } catch (e) {
      console.error("[migrate] error:", e.message);
    }
  }
  function jsonResp(obj) {
    const status = obj && obj.error ? obj.error.includes("missing_field") || obj.error.includes("invalid") ? 400 : obj.error.includes("unauthorized") ? 401 : obj.error.includes("duplicate") || obj.error.includes("slot_full") ? 409 : 500 : 200;
    return new Response(JSON.stringify(obj), {
      status,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": "*"
      }
    });
  }

          pagesFunctionResponse = onRequestGet;
        })();
            }
          

            if(!matchedFunc && '/api/records' === urlInfo.pathname && request.method === 'POST') {
              matchedFunc = true;
                (() => {
  // functions/api/records.js
  var ADMIN_PIN_DEFAULT = "404112";
  var ACTIVITY_END = "2026-08-15";
  var RETENTION_DAYS = 30;
  var DEV_ID_ENC_KEY = "NPkJGuRULNDLyvmzOCDhIrS6Dpw+f8tG5Gw6eiDxQNY=";
  var DEV_HMAC_KEY = "N+n/LSL+Z1Zd6RMZ1cx34qjkxnO9fFM8koPLN9Xnths=";
  var _aesKeyCache = null;
  var _hmacKeyCache = null;
  async function onRequestGet(context) {
    const { env, request } = context;
    return jsonResp(await listRecords(env, request));
  }
  async function onRequestPost(context) {
    const { request, env } = context;
    return jsonResp(await createRecord(request, env));
  }
  async function listRecords(env, request) {
    if (!env.DB)
      return { error: "DB binding missing", hint: "\u5728 Pages Settings \u2192 Functions \u2192 D1 database bindings \u914D\u7F6E DB" };
    await ensureSchema(env);
    await migrateLegacyRows(env);
    const url = new URL(request.url);
    const wantFull = url.searchParams.get("full") === "1";
    const adminPin = url.searchParams.get("admin_pin") || "";
    if (wantFull && adminPin !== ADMIN_PIN_DEFAULT) {
      return { error: "unauthorized", hint: "\u9700\u8981\u7BA1\u7406\u5458 PIN \u624D\u80FD\u67E5\u770B\u5B8C\u6574\u6570\u636E" };
    }
    try {
      const { results } = await env.DB.prepare(
        "SELECT * FROM records ORDER BY created_at DESC"
      ).all();
      let records = results || [];
      if (!wantFull) {
        records = records.map((r) => ({
          ...r,
          id_number: r.id_masked || maskIdNumber(r.id_number),
          phone: r.phone_masked || maskPhone(r.phone)
        }));
      } else {
        const aesKey = await getAesKey(env);
        records = await Promise.all(records.map(async (r) => ({
          ...r,
          id_number: await safeDecrypt(r.id_number, aesKey),
          phone: await safeDecrypt(r.phone, aesKey)
        })));
        await logAccess(env, request, "records_full_export", { count: records.length });
      }
      return { records };
    } catch (err) {
      return { error: "DB query failed: " + err.message };
    }
  }
  async function createRecord(request, env) {
    if (!env.DB)
      return { error: "DB binding missing" };
    await ensureSchema(env);
    let r;
    try {
      r = await request.json();
    } catch {
      return { error: "invalid json" };
    }
    if (!r)
      return { error: "empty body" };
    const required = ["id", "roleId", "roleName", "slotIdx", "date", "dateLabel", "time", "realName", "idNumber", "phone"];
    for (const k of required) {
      if (r[k] === void 0 || r[k] === null || r[k] === "") {
        return { error: `missing_field: ${k}` };
      }
    }
    const idNumberPlain = String(r.idNumber).toUpperCase();
    const phonePlain = String(r.phone);
    const aesKey = await getAesKey(env);
    const hmacKey = await getHmacKey(env);
    const idHmac = await hmacHex(idNumberPlain, hmacKey);
    const phoneHmac = await hmacHex(phonePlain, hmacKey);
    const dupId = await env.DB.prepare(
      "SELECT id, real_name, date_label, time FROM records WHERE id_hmac = ? LIMIT 1"
    ).bind(idHmac).first();
    if (dupId) {
      return {
        error: "duplicate_id",
        message: `\u8BE5\u8EAB\u4EFD\u8BC1\u53F7\u5DF2\u62A5\u540D\uFF1A${dupId.real_name}\uFF08${dupId.date_label} ${dupId.time}\uFF09`
      };
    }
    const dupPhone = await env.DB.prepare(
      "SELECT id, real_name, date_label, time FROM records WHERE phone_hmac = ? LIMIT 1"
    ).bind(phoneHmac).first();
    if (dupPhone) {
      return {
        error: "duplicate_phone",
        message: `\u8BE5\u624B\u673A\u53F7\u5DF2\u62A5\u540D\uFF1A${dupPhone.real_name}\uFF08${dupPhone.date_label} ${dupPhone.time}\uFF09`
      };
    }
    const roleSlots = {
      anchor: [25, 25, 25, 25],
      talent: [25, 25, 30],
      media: [25, 25, 25, 25, 25, 25, 25, 25]
    };
    const cap = roleSlots[r.roleId] && roleSlots[r.roleId][r.slotIdx] || 25;
    const used = await env.DB.prepare(
      "SELECT COUNT(*) as n FROM records WHERE role_id = ? AND slot_idx = ?"
    ).bind(r.roleId, r.slotIdx).first();
    if (used && used.n >= cap) {
      return { error: "slot_full", message: `\u8BE5\u65F6\u6BB5\u5DF2\u62A5\u6EE1\uFF08${cap}/${cap}\uFF09` };
    }
    const idCipher = await aesEncrypt(idNumberPlain, aesKey);
    const phoneCipher = await aesEncrypt(phonePlain, aesKey);
    const idMasked = maskIdNumber(idNumberPlain);
    const phoneMasked = maskPhone(phonePlain);
    await migrateLegacyRows(env);
    const retentionUntil = addDays(ACTIVITY_END + "T23:59:59+08:00", RETENTION_DAYS);
    try {
      await env.DB.prepare(`
      INSERT INTO records (
        id, role_id, role_name, slot_idx, date, date_label, time, slots,
        category, real_name, id_number, phone, id_hmac, phone_hmac, id_masked, phone_masked,
        platform_id, platform, followers, comp_count, companions, device_id, created_at, retention_until
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
        r.id,
        r.roleId,
        r.roleName,
        r.slotIdx,
        r.date,
        r.dateLabel,
        r.time,
        Array.isArray(r.slots) ? JSON.stringify(r.slots) : typeof r.slots === "string" ? r.slots : null,
        r.category || "",
        r.realName,
        idCipher,
        phoneCipher,
        idHmac,
        phoneHmac,
        idMasked,
        phoneMasked,
        r.platformId || "",
        Array.isArray(r.platform) ? r.platform.join("|") : r.platform || "",
        r.followers || "",
        Array.isArray(r.companions) ? r.companions.length : 0,
        JSON.stringify(r.companions || []),
        r.deviceId || "",
        r.createdAt || (/* @__PURE__ */ new Date()).toISOString(),
        retentionUntil
      ).run();
    } catch (insertErr) {
      return { error: "DB insert failed: " + insertErr.message };
    }
    return { ok: true, id: r.id, retention_until: retentionUntil };
  }
  async function getAesKey(env) {
    if (_aesKeyCache)
      return _aesKeyCache;
    const secret = env && env.ID_ENC_KEY || DEV_ID_ENC_KEY;
    const raw = base64ToBytes(secret);
    const keyBytes = new Uint8Array(32);
    keyBytes.set(raw.slice(0, 32));
    _aesKeyCache = await crypto.subtle.importKey(
      "raw",
      keyBytes,
      { name: "AES-GCM" },
      false,
      ["encrypt", "decrypt"]
    );
    return _aesKeyCache;
  }
  async function getHmacKey(env) {
    if (_hmacKeyCache)
      return _hmacKeyCache;
    const secret = env && env.HMAC_KEY || DEV_HMAC_KEY;
    const raw = base64ToBytes(secret);
    const keyBytes = new Uint8Array(32);
    keyBytes.set(raw.slice(0, 32));
    _hmacKeyCache = await crypto.subtle.importKey(
      "raw",
      keyBytes,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    return _hmacKeyCache;
  }
  async function aesEncrypt(plain, key) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const enc = new TextEncoder().encode(String(plain));
    const cipherBuf = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc);
    const combined = new Uint8Array(iv.length + cipherBuf.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(cipherBuf), iv.length);
    return bytesToBase64(combined);
  }
  async function aesDecrypt(b64, key) {
    const combined = base64ToBytes(b64);
    const iv = combined.slice(0, 12);
    const cipher = combined.slice(12);
    const plainBuf = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, cipher);
    return new TextDecoder().decode(plainBuf);
  }
  async function safeDecrypt(b64, key) {
    try {
      if (!b64)
        return "";
      return await aesDecrypt(b64, key);
    } catch (e) {
      return b64;
    }
  }
  async function hmacHex(plain, key) {
    const enc = new TextEncoder().encode(String(plain));
    const sig = await crypto.subtle.sign("HMAC", key, enc);
    return bytesToHex(new Uint8Array(sig).slice(0, 16));
  }
  function maskIdNumber(id) {
    if (!id)
      return "";
    const s = String(id).trim().toUpperCase();
    if (s.length < 8)
      return "****";
    return s.slice(0, 6) + "********" + s.slice(-4);
  }
  function maskPhone(p) {
    if (!p)
      return "";
    const s = String(p);
    if (s.length < 7)
      return "****";
    return s.slice(0, 3) + "****" + s.slice(-4);
  }
  function bytesToBase64(bytes) {
    let bin = "";
    for (let i = 0; i < bytes.length; i++)
      bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }
  function base64ToBytes(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++)
      out[i] = bin.charCodeAt(i);
    return out;
  }
  function bytesToHex(bytes) {
    let s = "";
    for (let i = 0; i < bytes.length; i++)
      s += bytes[i].toString(16).padStart(2, "0");
    return s;
  }
  function addDays(isoOrDate, days) {
    const d = new Date(isoOrDate);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString();
  }
  async function logAccess(env, request, action, meta) {
    try {
      const ip = (request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for") || "").slice(0, 64);
      const ua = (request.headers.get("user-agent") || "").slice(0, 256);
      const id = "al_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);
      await env.DB.prepare(`
      INSERT INTO access_log (id, action, actor_ip, actor_ua, meta, time)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(
        id,
        action,
        ip,
        ua,
        JSON.stringify(meta || {}),
        (/* @__PURE__ */ new Date()).toISOString()
      ).run();
    } catch (e) {
      console.error("[access_log] write failed:", e.message);
    }
  }
  async function ensureSchema(env) {
    if (!env.DB)
      return;
    try {
      await env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS records (
        id          TEXT PRIMARY KEY,
        role_id     TEXT NOT NULL,
        role_name   TEXT NOT NULL,
        slot_idx    INTEGER NOT NULL,
        date        TEXT NOT NULL,
        date_label  TEXT NOT NULL,
        time        TEXT NOT NULL,
        slots       TEXT,
        category    TEXT,
        real_name   TEXT NOT NULL,
        id_number   TEXT NOT NULL,
        phone       TEXT NOT NULL,
        id_hmac     TEXT,
        phone_hmac  TEXT,
        id_masked   TEXT,
        phone_masked TEXT,
        platform_id TEXT,
        platform    TEXT,
        followers   TEXT,
        comp_count  INTEGER DEFAULT 0,
        companions  TEXT,
        device_id   TEXT,
        created_at  TEXT NOT NULL,
        retention_until TEXT
      )
    `).run();
    } catch (e) {
    }
    const additions = [
      "ALTER TABLE records ADD COLUMN id_hmac TEXT",
      "ALTER TABLE records ADD COLUMN phone_hmac TEXT",
      "ALTER TABLE records ADD COLUMN id_masked TEXT",
      "ALTER TABLE records ADD COLUMN phone_masked TEXT",
      "ALTER TABLE records ADD COLUMN retention_until TEXT",
      "ALTER TABLE records ADD COLUMN slots TEXT"
    ];
    for (const sql of additions) {
      try {
        await env.DB.prepare(sql).run();
      } catch (e) {
      }
    }
    try {
      await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_records_role_slot ON records(role_id, slot_idx)").run();
    } catch (e) {
    }
    try {
      await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_records_id_hmac ON records(id_hmac)").run();
    } catch (e) {
    }
    try {
      await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_records_phone_hmac ON records(phone_hmac)").run();
    } catch (e) {
    }
    try {
      await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_records_created_at ON records(created_at DESC)").run();
    } catch (e) {
    }
    try {
      await env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS visit_log (
        id          TEXT PRIMARY KEY,
        record_id   TEXT NOT NULL,
        point       TEXT NOT NULL,
        real_name   TEXT,
        platform_id TEXT,
        time        TEXT NOT NULL
      )
    `).run();
    } catch (e) {
    }
    try {
      await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_visit_log_record ON visit_log(record_id)").run();
    } catch (e) {
    }
    try {
      await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_visit_log_time ON visit_log(time DESC)").run();
    } catch (e) {
    }
    try {
      await env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS access_log (
        id TEXT PRIMARY KEY,
        action TEXT NOT NULL,
        actor_ip TEXT,
        actor_ua TEXT,
        meta TEXT,
        time TEXT NOT NULL
      )
    `).run();
    } catch (e) {
    }
    try {
      await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_access_log_time ON access_log(time DESC)").run();
    } catch (e) {
    }
  }
  var _migrationDone = false;
  async function migrateLegacyRows(env) {
    if (_migrationDone || !env.DB)
      return;
    try {
      const rows = await env.DB.prepare(
        "SELECT id, id_number, phone FROM records WHERE id_hmac IS NULL LIMIT 100"
      ).all();
      const list = rows.results || [];
      if (list.length === 0) {
        _migrationDone = true;
        return;
      }
      const aesKey = await getAesKey(env);
      const hmacKey = await getHmacKey(env);
      for (const row of list) {
        try {
          const alreadyEncrypted = row.id_number && /[+/=]/.test(row.id_number);
          if (alreadyEncrypted) {
            await env.DB.prepare("UPDATE records SET id_hmac=?, phone_hmac=?, id_masked=?, phone_masked=? WHERE id=?").bind("", "", maskIdNumber(row.id_number), maskPhone(row.phone), row.id).run();
            continue;
          }
          const idHmac = await hmacHex(row.id_number, hmacKey);
          const phoneHmac = await hmacHex(row.phone, hmacKey);
          const idCipher = await aesEncrypt(row.id_number, aesKey);
          const phoneCipher = await aesEncrypt(row.phone, aesKey);
          const idMasked = maskIdNumber(row.id_number);
          const phoneMasked = maskPhone(row.phone);
          await env.DB.prepare(
            "UPDATE records SET id_number=?, phone=?, id_hmac=?, phone_hmac=?, id_masked=?, phone_masked=? WHERE id=?"
          ).bind(idCipher, phoneCipher, idHmac, phoneHmac, idMasked, phoneMasked, row.id).run();
          console.log("[migrate] encrypted legacy row", row.id);
        } catch (e) {
          console.error("[migrate] row", row.id, "failed:", e.message);
        }
      }
      _migrationDone = true;
    } catch (e) {
      console.error("[migrate] error:", e.message);
    }
  }
  function jsonResp(obj) {
    const status = obj && obj.error ? obj.error.includes("missing_field") || obj.error.includes("invalid") ? 400 : obj.error.includes("unauthorized") ? 401 : obj.error.includes("duplicate") || obj.error.includes("slot_full") ? 409 : 500 : 200;
    return new Response(JSON.stringify(obj), {
      status,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": "*"
      }
    });
  }

          pagesFunctionResponse = onRequestPost;
        })();
            }
          

            if(!matchedFunc && '/api/visit_log' === urlInfo.pathname && request.method === 'GET') {
              matchedFunc = true;
                (() => {
  // functions/api/visit_log.js
  async function onRequestGet(context) {
    const { env } = context;
    if (!env.DB)
      return r({ error: "DB binding missing" }, 500);
    await ensureVisitLog(env);
    try {
      const { results } = await env.DB.prepare(
        "SELECT * FROM visit_log ORDER BY time DESC"
      ).all();
      return r({ visitLog: results || [] });
    } catch (err) {
      return r({ error: err.message }, 500);
    }
  }
  async function onRequestPost(context) {
    const { request, env } = context;
    if (!env.DB)
      return r({ error: "DB binding missing" }, 500);
    await ensureVisitLog(env);
    let v;
    try {
      v = await request.json();
    } catch {
      return r({ error: "invalid json" }, 400);
    }
    if (!v || !v.rid || !v.time)
      return r({ error: "missing fields (rid, time)" }, 400);
    const id = v.id || "vl_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);
    try {
      await env.DB.prepare(`
      INSERT INTO visit_log (id, rid, point, operator, note, time)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(id, v.rid, v.point || "", v.operator || "", v.note || "", v.time).run();
    } catch (err) {
      return r({ error: err.message }, 500);
    }
    return r({ ok: true, id });
  }
  function r(obj, status = 200) {
    return new Response(JSON.stringify(obj), {
      status,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": "*"
      }
    });
  }
  async function ensureVisitLog(env) {
    try {
      await env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS visit_log (
        id TEXT PRIMARY KEY,
        rid TEXT NOT NULL,
        point TEXT,
        operator TEXT,
        note TEXT,
        time TEXT NOT NULL
      )
    `).run();
    } catch (e) {
    }
    try {
      await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_visit_log_time ON visit_log(time DESC)").run();
    } catch (e) {
    }
  }

          pagesFunctionResponse = onRequestGet;
        })();
            }
          

            if(!matchedFunc && '/api/visit_log' === urlInfo.pathname && request.method === 'POST') {
              matchedFunc = true;
                (() => {
  // functions/api/visit_log.js
  async function onRequestGet(context) {
    const { env } = context;
    if (!env.DB)
      return r({ error: "DB binding missing" }, 500);
    await ensureVisitLog(env);
    try {
      const { results } = await env.DB.prepare(
        "SELECT * FROM visit_log ORDER BY time DESC"
      ).all();
      return r({ visitLog: results || [] });
    } catch (err) {
      return r({ error: err.message }, 500);
    }
  }
  async function onRequestPost(context) {
    const { request, env } = context;
    if (!env.DB)
      return r({ error: "DB binding missing" }, 500);
    await ensureVisitLog(env);
    let v;
    try {
      v = await request.json();
    } catch {
      return r({ error: "invalid json" }, 400);
    }
    if (!v || !v.rid || !v.time)
      return r({ error: "missing fields (rid, time)" }, 400);
    const id = v.id || "vl_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);
    try {
      await env.DB.prepare(`
      INSERT INTO visit_log (id, rid, point, operator, note, time)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(id, v.rid, v.point || "", v.operator || "", v.note || "", v.time).run();
    } catch (err) {
      return r({ error: err.message }, 500);
    }
    return r({ ok: true, id });
  }
  function r(obj, status = 200) {
    return new Response(JSON.stringify(obj), {
      status,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": "*"
      }
    });
  }
  async function ensureVisitLog(env) {
    try {
      await env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS visit_log (
        id TEXT PRIMARY KEY,
        rid TEXT NOT NULL,
        point TEXT,
        operator TEXT,
        note TEXT,
        time TEXT NOT NULL
      )
    `).run();
    } catch (e) {
    }
    try {
      await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_visit_log_time ON visit_log(time DESC)").run();
    } catch (e) {
    }
  }

          pagesFunctionResponse = onRequestPost;
        })();
            }
          

            if(!matchedFunc && /^\/api\/records\/([^\/]*)$/.test(urlInfo.pathname) && request.method === 'POST') {
              routeParams = {"id":["id"],"mode":1,"left":"\\/api\\/records\\/([^\\/]*)"};
              matchedFunc = true;
                (() => {
  // functions/api/records/[id].js
  async function onRequestDelete(context) {
    const { env, params } = context;
    if (!env.DB)
      return json({ error: "DB binding missing" }, 500);
    const id = decodeURIComponent(params.id);
    await env.DB.prepare("DELETE FROM visit_log WHERE rid = ?").bind(id).run();
    const r = await env.DB.prepare("DELETE FROM records WHERE id = ?").bind(id).run();
    if (r.meta && r.meta.changes === 0)
      return json({ error: "not_found" }, 404);
    return json({ ok: true, deleted: id });
  }
  async function onRequestPost(context) {
    const { env, params, request } = context;
    if (!env.DB)
      return json({ error: "DB binding missing" }, 500);
    const rid = decodeURIComponent(params.id);
    const body = await request.json().catch(() => ({}));
    const rec = await env.DB.prepare("SELECT id FROM records WHERE id = ?").bind(rid).first();
    if (!rec)
      return json({ error: "record_not_found" }, 404);
    const id = "vl_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);
    await env.DB.prepare(`
    INSERT INTO visit_log (id, rid, point, operator, note, time)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(
      id,
      rid,
      body.point || "",
      body.operator || "",
      body.note || "",
      (/* @__PURE__ */ new Date()).toISOString()
    ).run();
    return json({ ok: true, id });
  }
  function json(obj, status = 200) {
    return new Response(JSON.stringify(obj), {
      status,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": "*"
      }
    });
  }

          pagesFunctionResponse = onRequestPost;
        })();
            }
          

            if(!matchedFunc && /^\/api\/records\/([^\/]*)$/.test(urlInfo.pathname) && request.method === 'DELETE') {
              routeParams = {"id":["id"],"mode":1,"left":"\\/api\\/records\\/([^\\/]*)"};
              matchedFunc = true;
                (() => {
  // functions/api/records/[id].js
  async function onRequestDelete(context) {
    const { env, params } = context;
    if (!env.DB)
      return json({ error: "DB binding missing" }, 500);
    const id = decodeURIComponent(params.id);
    await env.DB.prepare("DELETE FROM visit_log WHERE rid = ?").bind(id).run();
    const r = await env.DB.prepare("DELETE FROM records WHERE id = ?").bind(id).run();
    if (r.meta && r.meta.changes === 0)
      return json({ error: "not_found" }, 404);
    return json({ ok: true, deleted: id });
  }
  async function onRequestPost(context) {
    const { env, params, request } = context;
    if (!env.DB)
      return json({ error: "DB binding missing" }, 500);
    const rid = decodeURIComponent(params.id);
    const body = await request.json().catch(() => ({}));
    const rec = await env.DB.prepare("SELECT id FROM records WHERE id = ?").bind(rid).first();
    if (!rec)
      return json({ error: "record_not_found" }, 404);
    const id = "vl_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);
    await env.DB.prepare(`
    INSERT INTO visit_log (id, rid, point, operator, note, time)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(
      id,
      rid,
      body.point || "",
      body.operator || "",
      body.note || "",
      (/* @__PURE__ */ new Date()).toISOString()
    ).run();
    return json({ ok: true, id });
  }
  function json(obj, status = 200) {
    return new Response(JSON.stringify(obj), {
      status,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": "*"
      }
    });
  }

          pagesFunctionResponse = onRequestDelete;
        })();
            }
          

            if(!matchedFunc && /^\/api\/visit_log\/([^\/]*)$/.test(urlInfo.pathname) && request.method === 'DELETE') {
              routeParams = {"id":["id"],"mode":1,"left":"\\/api\\/visit_log\\/([^\\/]*)"};
              matchedFunc = true;
                (() => {
  // functions/api/visit_log/[id].js
  async function onRequestDelete(context) {
    const { env, params } = context;
    if (!env.DB)
      return json({ error: "DB binding missing" }, 500);
    const id = decodeURIComponent(params.id);
    const r = await env.DB.prepare("DELETE FROM visit_log WHERE id = ?").bind(id).run();
    if (r.meta && r.meta.changes === 0)
      return json({ error: "not_found" }, 404);
    return json({ ok: true, deleted: id });
  }
  function json(obj, status = 200) {
    return new Response(JSON.stringify(obj), {
      status,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": "*"
      }
    });
  }

          pagesFunctionResponse = onRequestDelete;
        })();
            }
          
        };
      

          
        const runMiddleware = typeof executeMiddleware !== 'undefined' ? executeMiddleware : async function() { return null; };
        let middlewareResponseHeaders = null; // 保存中间件设置的响应头
        const middlewareResponse = await runMiddleware({
          request,
          urlInfo: new URL(urlInfo.toString()),
          env: {"ProjectId":"makers-chriw3ayzimb","NG_CLI_ANALYTICS":"false","NUXT_TELEMETRY_DISABLED":"1","COREPACK_ENABLE_DOWNLOAD_PROMPT":"0","COREPACK_ENABLE_STRICT":"0","YARN_ENABLE_INTERACTIVE":"0","NPM_CONFIG_YES":"true","CI":"true","TMPDIR":"/var/folders/cv/nmy3n7p53p1bly26t8jb6kk80000gn/T/","EDGEONE_PROJECT_ID":"makers-chriw3ayzimb","PAGES_PROJECT_ID":"makers-chriw3ayzimb"},
          waitUntil,
          hookCtx
        });

        if (middlewareResponse) {
          const headers = middlewareResponse.headers;
          const hasNext = headers && headers.get('x-middleware-next') === '1';
          const rewriteTarget = headers && headers.get('x-middleware-rewrite');
          const requestHeadersOverride = headers && headers.get('x-middleware-request-headers');
          // Next.js 使用 x-middleware-override-headers 传递需要修改的请求头列表
          const overrideHeadersList = headers && headers.get('x-middleware-override-headers');

          if (rewriteTarget) {
            try {
              const rewrittenUrl = rewriteTarget.startsWith('http://') || rewriteTarget.startsWith('https://')
                ? rewriteTarget
                : new URL(rewriteTarget, urlInfo.origin).toString();
              request = recreateRequest(request, { url: rewrittenUrl });
              urlInfo = new URL(rewrittenUrl);
              normalizePathname();
            } catch (rewriteError) {
              console.error('Middleware rewrite error:', rewriteError);
            }
          }

          // 处理 Next.js 的 x-middleware-override-headers 机制
          if (overrideHeadersList) {
            try {
              const overrideKeys = overrideHeadersList.split(',').map(k => k.trim());
              for (const key of overrideKeys) {
                const newValue = headers.get('x-middleware-request-' + key);
                if (newValue !== null) {
                  request.headers.set(key, newValue);
                } else {
                  request.headers.delete(key);
                }
              }
            } catch (overrideError) {
              console.error('Middleware override headers error:', overrideError);
            }
          }
          // 处理旧的 x-middleware-request-headers 机制（兼容）
          else if (requestHeadersOverride) {
            try {
              const decoded = decodeURIComponent(requestHeadersOverride);
              const headerPatch = JSON.parse(decoded);
              Object.keys(headerPatch).forEach((key) => {
                const value = headerPatch[key];
                if (value === null || typeof value === 'undefined') {
                  request.headers.delete(key);
                } else {
                  request.headers.set(key, value);
                }
              });
            } catch (requestPatchError) {
              console.error('Middleware request header override error:', requestPatchError);
            }
          }

          if (!hasNext && !rewriteTarget) {
            return middlewareResponse;
          }

          if (hasNext) {
            middlewareResponseHeaders = new Headers();
            const skipHeaders = new Set([
              'x-middleware-next',
              'x-middleware-rewrite',
              'x-middleware-request-headers',
              'x-middleware-override-headers',
              'x-middleware-set-cookie',
              'date',
              'connection',
              'content-length',
              'content-encoding', // 避免中间件传递的压缩头覆盖到最终响应，破坏流式响应
              'transfer-encoding',
              'set-cookie', // Set-Cookie 需要特殊处理，避免重复
            ]);
            headers.forEach((value, key) => {
              const lowerKey = key.toLowerCase();
              // 过滤内部使用的 header：skipHeaders 中的 + x-middleware-request-* 前缀的请求头修改标记
              if (!skipHeaders.has(lowerKey) && !lowerKey.startsWith('x-middleware-request-')) {
                middlewareResponseHeaders.set(key, value);
              }
            });
            // 特殊处理 Set-Cookie，可能有多个，使用 getSetCookie 获取完整的 cookie 值
            const setCookies = headers.getSetCookie ? headers.getSetCookie() : [];
            setCookies.forEach(cookie => {
              middlewareResponseHeaders.append('Set-Cookie', cookie);
            });
          }
        }
      

          // 走到这里说明：
          // 1. 没有中间件响应（middlewareResponse 为 null/undefined）
          // 2. 或者中间件返回了 next
          // 需要判断是否命中边缘函数

          runEdgeFunctions();

          // 动态路由命中时，检查该路径的 runtime 是否为 edge
          // 如果不是 edge（如 node/file），则跳出边缘函数，走回源逻辑
          if (matchedFunc && routeParams.mode > 0 && hookCtx && hookCtx.getPathRuntime) {
            try {
              const pathRuntime = await hookCtx.getPathRuntime(urlInfo.pathname);
              if (pathRuntime && pathRuntime !== 'edge') {
                matchedFunc = false;
              }
            } catch(e) {
              // getPathRuntime 调用失败时不阻断，继续执行边缘函数
            }
          }

          //没有命中边缘函数，执行回源
          if (!matchedFunc) {
            const originResponse = await fetch(request);

            // 如果中间件设置了响应头，合并到回源响应中
            if (middlewareResponseHeaders) {
              const mergedHeaders = new Headers(originResponse.headers);
              // 删除可能导致问题的编码相关头
              mergedHeaders.delete('content-encoding');
              mergedHeaders.delete('content-length');
              middlewareResponseHeaders.forEach((value, key) => {
                if (key.toLowerCase() === 'set-cookie') {
                  mergedHeaders.append(key, value);
                } else {
                  mergedHeaders.set(key, value);
                }
              });
              return new Response(originResponse.body, {
                status: originResponse.status,
                statusText: originResponse.statusText,
                headers: mergedHeaders,
              });
            }

            return originResponse;
          }

          // 命中了边缘函数，继续执行边缘函数逻辑

          const params = {};
          if (routeParams.id) {
            if (routeParams.mode === 1) {
              const value = urlInfo.pathname.match(routeParams.left);
              for (let i = 1; i < value.length; i++) {
                params[routeParams.id[i - 1]] = value[i];
              }
            } else {
              const value = urlInfo.pathname.replace(routeParams.left, '');
              const splitedValue = value.split('/');
              if (splitedValue.length === 1) {
                params[routeParams.id] = splitedValue[0];
              } else {
                params[routeParams.id] = splitedValue;
              }
            }

          }
          const edgeFunctionResponse = await pagesFunctionResponse({request, params, env: {"ProjectId":"makers-chriw3ayzimb","NG_CLI_ANALYTICS":"false","NUXT_TELEMETRY_DISABLED":"1","COREPACK_ENABLE_DOWNLOAD_PROMPT":"0","COREPACK_ENABLE_STRICT":"0","YARN_ENABLE_INTERACTIVE":"0","NPM_CONFIG_YES":"true","CI":"true","TMPDIR":"/var/folders/cv/nmy3n7p53p1bly26t8jb6kk80000gn/T/","EDGEONE_PROJECT_ID":"makers-chriw3ayzimb","PAGES_PROJECT_ID":"makers-chriw3ayzimb"}, waitUntil, eo });

          // 如果中间件设置了响应头，合并到边缘函数响应中
          if (middlewareResponseHeaders && edgeFunctionResponse) {
            const mergedHeaders = new Headers(edgeFunctionResponse.headers);
            // 删除可能导致问题的编码相关头
            mergedHeaders.delete('content-encoding');
            mergedHeaders.delete('content-length');
            middlewareResponseHeaders.forEach((value, key) => {
              if (key.toLowerCase() === 'set-cookie') {
                mergedHeaders.append(key, value);
              } else {
                mergedHeaders.set(key, value);
              }
            });
            return new Response(edgeFunctionResponse.body, {
              status: edgeFunctionResponse.status,
              statusText: edgeFunctionResponse.statusText,
              headers: mergedHeaders,
            });
          }

          return edgeFunctionResponse;
        })({request: ev.request, params: {}, env: {"ProjectId":"makers-chriw3ayzimb","NG_CLI_ANALYTICS":"false","NUXT_TELEMETRY_DISABLED":"1","COREPACK_ENABLE_DOWNLOAD_PROMPT":"0","COREPACK_ENABLE_STRICT":"0","YARN_ENABLE_INTERACTIVE":"0","NPM_CONFIG_YES":"true","CI":"true","TMPDIR":"/var/folders/cv/nmy3n7p53p1bly26t8jb6kk80000gn/T/","EDGEONE_PROJECT_ID":"makers-chriw3ayzimb","PAGES_PROJECT_ID":"makers-chriw3ayzimb"}, waitUntil: ev.waitUntil.bind(ev) });
        // ↑ 用户原始代码结束
      }

      addEventListener('fetch', (event, hookCtx) => {
        const res = usercode(event, hookCtx);
        event.respondWith(res);
      });