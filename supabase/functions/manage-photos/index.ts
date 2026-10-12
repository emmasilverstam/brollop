import { createClient } from "npm:@supabase/supabase-js@2";

const projectUrl = Deno.env.get("SUPABASE_URL");
const bucketName = "kvallens-bilder";
const tokenTable = "photo_delete_tokens";
const allowedOrigin = "https://emmasilverstam.github.io";
const maxFileSize = 10 * 1024 * 1024;
const maxFileCount = 8;
const maxRequestSize = 50 * 1024 * 1024;
const allowedMimeTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);

const mimeTypesByExtension: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
  heif: "image/heif",
};

const getAdminClient = () => {
  if (!projectUrl) throw new Error("Supabase URL is missing.");

  let secretKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const secretKeysJson = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (secretKeysJson) {
    try {
      const secretKeys = JSON.parse(secretKeysJson);
      secretKey = secretKeys.default || secretKey;
    } catch {
      // Use the legacy runtime variable when the secret-key map is unavailable.
    }
  }
  if (!secretKey) throw new Error("Supabase server key is missing.");

  return createClient(projectUrl, secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
};

const corsHeaders = {
  "Access-Control-Allow-Origin": allowedOrigin,
  "Access-Control-Allow-Headers": "apikey, authorization, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
};

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
  });

const safeSegment = (value: string) =>
  value.normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .replace(/[\\/]/g, "-")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 100) || "bild";

const getContentType = (file: File) => {
  if (allowedMimeTypes.has(file.type)) return file.type;
  const extension = file.name.split(".").pop()?.toLowerCase() || "";
  return mimeTypesByExtension[extension] || "";
};

const hashToken = async (token: string) => {
  const bytes = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
};

const createDeleteToken = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) => byte.toString(16).padStart(2, "0")).join("");

const uploadPhotos = async (request: Request, supabase: ReturnType<typeof getAdminClient>) => {
  const formData = await request.formData();
  const uploaderName = String(formData.get("uploaderName") || "").trim();
  const files = formData.getAll("photos").filter((entry): entry is File => entry instanceof File && entry.size > 0);

  if (!uploaderName || uploaderName.length > 60) {
    return jsonResponse({ error: "Skriv ditt namn (högst 60 tecken)." }, 400);
  }
  if (files.length === 0 || files.length > maxFileCount) {
    return jsonResponse({ error: `Välj mellan 1 och ${maxFileCount} bilder per uppladdning.` }, 400);
  }
  if (files.reduce((total, file) => total + file.size, 0) > maxRequestSize) {
    return jsonResponse({ error: "Den sammanlagda storleken får vara högst 50 MB per uppladdning." }, 413);
  }

  const normalizedFiles = files.map((file) => ({ file, contentType: getContentType(file) }));
  const invalidFile = normalizedFiles.find(({ file, contentType }) => !contentType || file.size > maxFileSize);
  if (invalidFile) {
    return jsonResponse({
      error: !invalidFile.contentType
        ? "Välj JPG-, PNG-, WebP- eller HEIC-bilder."
        : "Varje bild får vara högst 10 MB.",
    }, 400);
  }

  const uploadedPaths: string[] = [];
  const photos: Array<{ path: string; guestName: string; fileName: string; deleteToken: string }> = [];
  try {
    for (const { file, contentType } of normalizedFiles) {
      const path = `${Date.now()}-${crypto.randomUUID()}--${safeSegment(uploaderName)}--${safeSegment(file.name)}`;
      const { error: uploadError } = await supabase.storage.from(bucketName).upload(path, file, {
        contentType,
        upsert: false,
        metadata: { guestName: uploaderName, fileName: file.name },
      });
      if (uploadError) throw uploadError;
      uploadedPaths.push(path);

      const deleteToken = createDeleteToken();
      const tokenHash = await hashToken(deleteToken);
      const { error: tokenError } = await supabase.from(tokenTable).insert({
        photo_path: path,
        token_hash: tokenHash,
      });
      if (tokenError) throw tokenError;

      photos.push({ path, guestName: uploaderName, fileName: file.name, deleteToken });
    }
    return jsonResponse({ success: true, photos });
  } catch (error) {
    if (uploadedPaths.length) {
      await supabase.storage.from(bucketName).remove(uploadedPaths);
      await supabase.from(tokenTable).delete().in("photo_path", uploadedPaths);
    }
    console.error("Photo upload failed.", error instanceof Error ? error.message : "Unknown error");
    return jsonResponse({ error: "Bilderna kunde inte sparas. Försök igen om en stund." }, 500);
  }
};

const deletePhoto = async (request: Request, supabase: ReturnType<typeof getAdminClient>) => {
  let body: { path?: unknown; token?: unknown };
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Ogiltig begäran." }, 400);
  }

  const path = typeof body.path === "string" ? body.path : "";
  const token = typeof body.token === "string" ? body.token : "";
  if (!path || path.includes("/") || !/^[a-f0-9]{64}$/.test(token)) {
    return jsonResponse({ error: "Borttagningslänken är ogiltig." }, 400);
  }

  const { data: tokenRecord, error: lookupError } = await supabase
    .from(tokenTable)
    .select("token_hash")
    .eq("photo_path", path)
    .maybeSingle();
  if (lookupError) return jsonResponse({ error: "Bilden kunde inte verifieras." }, 500);
  if (!tokenRecord || tokenRecord.token_hash !== await hashToken(token)) {
    return jsonResponse({ error: "Borttagningslänken är ogiltig eller redan använd." }, 403);
  }

  const { error: removeError } = await supabase.storage.from(bucketName).remove([path]);
  if (removeError) return jsonResponse({ error: "Bilden kunde inte tas bort. Försök igen." }, 500);

  const { error: tokenDeleteError } = await supabase.from(tokenTable).delete().eq("photo_path", path);
  if (tokenDeleteError) console.error("Photo deletion token cleanup failed.", tokenDeleteError.message);
  return jsonResponse({ success: true });
};

Deno.serve(async (request) => {
  const origin = request.headers.get("origin");
  if (origin && origin !== allowedOrigin) return jsonResponse({ error: "Origin not allowed." }, 403);
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return jsonResponse({ error: "Method not allowed." }, 405);

  try {
    const supabase = getAdminClient();
    if (request.headers.get("content-type")?.includes("application/json")) {
      return await deletePhoto(request, supabase);
    }
    return await uploadPhotos(request, supabase);
  } catch (error) {
    console.error("Photo function failed.", error instanceof Error ? error.message : "Unknown error");
    return jsonResponse({ error: "Tjänsten kunde inte hantera begäran just nu." }, 500);
  }
});
