// cloudflare-worker/worker.js
// Mã nguồn Cloudflare Worker đồng bộ lịch sử cho Instagram Live Translator
// Hướng dẫn: Copy toàn bộ nội dung file này dán vào phần Edit Code của Worker trên Cloudflare.

export default {
  async fetch(request, env) {
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    };

    // Xử lý preflight CORS request
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    // Kiểm tra biến môi trường KV đã được liên kết (Bind) chưa
    if (!env.IG_SYNC_KV) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: "Chưa liên kết KV Namespace tên 'IG_SYNC_KV' trong phần Settings -> Bindings của Worker.",
        }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Lấy Sync Key từ header Authorization
    const authHeader = request.headers.get("Authorization") || "";
    const syncKey = authHeader.replace(/^Bearer\s+/i, "").trim();

    if (!syncKey || syncKey.length < 6) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: "Sync Key không hợp lệ (cần tối thiểu 6 ký tự).",
        }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Băm SHA-256 của Sync Key để làm khoá lưu trữ ẩn danh trên KV
    const kvKey = "igt_sync_" + (await sha256(syncKey));

    try {
      // GET: Tải lịch sử đã mã hóa từ Cloud về máy
      if (request.method === "GET") {
        const stored = await env.IG_SYNC_KV.get(kvKey);
        if (!stored) {
          return new Response(
            JSON.stringify({ ok: true, empty: true, updatedAt: 0 }),
            {
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            }
          );
        }
        return new Response(stored, {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // POST: Lưu lịch sử đã mã hóa từ máy lên Cloud
      if (request.method === "POST") {
        const bodyText = await request.text();
        if (!bodyText || bodyText.length > 5 * 1024 * 1024) {
          return new Response(
            JSON.stringify({ ok: false, error: "Dữ liệu không hợp lệ hoặc quá lớn." }),
            {
              status: 400,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            }
          );
        }

        await env.IG_SYNC_KV.put(kvKey, bodyText);
        return new Response(
          JSON.stringify({ ok: true, savedAt: Date.now() }),
          {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      return new Response(
        JSON.stringify({ ok: false, error: "Method not allowed" }),
        {
          status: 405,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    } catch (err) {
      return new Response(
        JSON.stringify({ ok: false, error: err?.message || String(err) }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }
  },
};

async function sha256(text) {
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode("igt_kv_key_v1:" + text)
  );
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
