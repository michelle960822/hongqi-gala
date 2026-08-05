// 临时 debug：直接 round-trip 测试加密/解密
export async function onRequestGet(context) {
  const { env } = context;
  const url = new URL(context.request.url);
  if (url.searchParams.get('pin') !== '404112') return json({ error: 'unauthorized' }, 401);

  const results = [];

  // Test 1: 用硬编码 key 加密一个固定字符串，再解密
  try {
    const secret = 'NPkJGuRULNDLyvmzOCDhIrS6Dpw+f8tG5Gw6eiDxQNY=';
    const raw = Uint8Array.from(atob(secret), c => c.charCodeAt(0));
    const keyBytes = new Uint8Array(32);
    keyBytes.set(raw.slice(0, 32));
    const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);

    const plain = '220122199302100716';
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const enc = new TextEncoder().encode(plain);
    const cipherBuf = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc);
    const combined = new Uint8Array(iv.length + cipherBuf.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(cipherBuf), iv.length);
    let bin = '';
    for (let i = 0; i < combined.length; i++) bin += String.fromCharCode(combined[i]);
    const cipherB64 = btoa(bin);

    // Decrypt
    const decoded = Uint8Array.from(atob(cipherB64), c => c.charCodeAt(0));
    const iv2 = decoded.slice(0, 12);
    const cipher2 = decoded.slice(12);
    const plainBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv2 }, key, cipher2);
    const decodedPlain = new TextDecoder().decode(plainBuf);

    results.push({ test: 'round_trip_same_isolate', cipher: cipherB64.slice(0, 30) + '...', decoded: decodedPlain, match: decodedPlain === plain });
  } catch (e) {
    results.push({ test: 'round_trip_same_isolate', error: e.message });
  }

  // Test 2: 从 DB 取密文，用硬编码 key 解密
  try {
    const { DB } = env;
    if (!DB) { results.push({ test: 'db_decrypt', error: 'no DB' }); }
    else {
      const row = await DB.prepare('SELECT id_number FROM records WHERE id_number IS NOT NULL LIMIT 1').first();
      const storedCipher = row ? row.id_number : null;
      results.push({ test: 'db_decrypt', stored_value_type: typeof storedCipher, stored_value_len: storedCipher ? storedCipher.length : 0, sample: storedCipher ? storedCipher.slice(0, 30) : null });

      if (storedCipher && typeof storedCipher === 'string' && storedCipher.length > 10) {
        try {
          const secret = 'NPkJGuRULNDLyvmzOCDhIrS6Dpw+f8tG5Gw6eiDxQNY=';
          const raw = Uint8Array.from(atob(secret), c => c.charCodeAt(0));
          const keyBytes = new Uint8Array(32);
          keyBytes.set(raw.slice(0, 32));
          const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);

          const decoded = Uint8Array.from(atob(storedCipher), c => c.charCodeAt(0));
          results.push({ test: 'db_decrypt', decoded_len: decoded.length });

          const iv2 = decoded.slice(0, 12);
          const cipher2 = decoded.slice(12);
          const plainBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv2 }, key, cipher2);
          const plain = new TextDecoder().decode(plainBuf);
          results.push({ test: 'db_decrypt', plain });
        } catch (e) {
          results.push({ test: 'db_decrypt_inner', error: e.message });
        }
      }
    }
  } catch (e) {
    results.push({ test: 'db_decrypt_outer', error: e.message });
  }

  return json({ results }, 200);
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' },
  });
}