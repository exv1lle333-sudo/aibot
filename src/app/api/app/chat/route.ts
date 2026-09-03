import { requireUser, jsonError } from "@/lib/miniapp-auth";
import * as repo from "@/lib/repo";
import { runTextTurn, runImageTurn } from "@/lib/services";
import { MODELS } from "@/lib/pricing";
import type { Attachment } from "@/lib/forgetapi";

export const dynamic = "force-dynamic";
export const maxDuration = 900;

const MAX_IMAGE_B64 = 14 * 1024 * 1024; // ~10 МБ картинка

function serialize(d: Awaited<ReturnType<typeof repo.getDialog>>[number]) {
  const atts = (d.attachments as Attachment[] | null) ?? null;
  return {
    id: d.id,
    role: d.role,
    content: d.content,
    imageB64: d.imageB64,
    tokens: d.tokens,
    createdAt: d.createdAt,
    attachments: atts?.map((a) => ({ kind: a.kind, filename: a.filename ?? null, preview: a.kind === "image" ? `data:${a.mime_type ?? "image/jpeg"};base64,${a.data_b64 ?? ""}` : null })) ?? null,
  };
}

/** GET /api/app/chat?model=key — история диалога */
export async function GET(req: Request) {
  try {
    const user = await requireUser(req);
    const modelKey = new URL(req.url).searchParams.get("model") ?? "";
    if (!MODELS[modelKey]) return Response.json({ error: "unknown model" }, { status: 400 });
    const rows = await repo.getDialog(user.userId, modelKey, 40);
    return Response.json({ messages: rows.map(serialize), remaining: Math.floor(await repo.getWallet(user.userId, modelKey)) });
  } catch (e) {
    return jsonError(e);
  }
}

/** POST — отправить сообщение модели. body: { modelKey, text, image?: {dataB64, mime}, file?: {name, mime, dataB64} } */
export async function POST(req: Request) {
  try {
    const user = await requireUser(req);
    const body = (await req.json()) as {
      modelKey?: string;
      text?: string;
      image?: { dataB64: string; mime: string } | null;
      file?: { name: string; mime: string; dataB64: string } | null;
    };
    const modelKey = String(body.modelKey ?? "");
    const model = MODELS[modelKey];
    if (!model) return Response.json({ error: "unknown model" }, { status: 400 });
    const text = String(body.text ?? "").trim().slice(0, 20_000);
    if (body.image && body.image.dataB64.length > MAX_IMAGE_B64) return Response.json({ error: "Картинка слишком большая (макс. 10 МБ)" }, { status: 400 });
    if (body.file && body.file.dataB64.length > MAX_IMAGE_B64) return Response.json({ error: "Файл слишком большой (макс. 10 МБ)" }, { status: 400 });
    if (!text && !body.image && !body.file) return Response.json({ error: "Пустое сообщение" }, { status: 400 });
    await repo.setActiveModel(user.userId, modelKey);

    if (model.kind === "image") {
      const ref = body.image ? { data: Buffer.from(body.image.dataB64, "base64"), mime: body.image.mime || "image/jpeg" } : null;
      const res = await runImageTurn(user.userId, modelKey, text || "Сделай вариацию этого изображения", ref);
      if (!res.ok) return Response.json({ error: res.error, code: res.code }, { status: res.code === "no_tokens" ? 402 : 500 });
      if (res.kind !== "image") return Response.json({ error: "unexpected" }, { status: 500 });
      return Response.json({ ok: true, kind: "image", image: `data:${res.mime};base64,${res.imageB64}`, tokens: res.tokens, remaining: Math.floor(await repo.getWallet(user.userId, modelKey)) });
    }

    const attachments: Attachment[] = [];
    if (body.image) attachments.push({ kind: "image", mime_type: body.image.mime || "image/jpeg", data_b64: body.image.dataB64 });
    if (body.file) {
      const isText = body.file.mime.startsWith("text/") || body.file.mime === "application/json" || /\.(txt|md|csv|json|xml|yaml|yml|py|js|ts|tsx|html|css|sql|sh|java|go|rs|c|cpp|php|rb)$/i.test(body.file.name);
      if (isText) attachments.push({ kind: "text_file", filename: body.file.name, text: Buffer.from(body.file.dataB64, "base64").toString("utf8").slice(0, 200_000) });
      else if (body.file.mime.startsWith("image/")) attachments.push({ kind: "image", mime_type: body.file.mime, data_b64: body.file.dataB64 });
      else attachments.push({ kind: "document", filename: body.file.name, mime_type: body.file.mime, data_b64: body.file.dataB64 });
    }
    const res = await runTextTurn(user.userId, modelKey, text || (body.image ? "Что на этом изображении?" : "Проанализируй этот файл."), attachments.length ? attachments : null);
    if (!res.ok) return Response.json({ error: res.error, code: res.code }, { status: res.code === "no_tokens" ? 402 : 500 });
    if (res.kind !== "text") return Response.json({ error: "unexpected" }, { status: 500 });
    const fresh = await repo.getUser(user.userId);
    return Response.json({ ok: true, kind: "text", answer: res.answer, tokens: res.tokens, usedFree: res.usedFree, remaining: Math.floor(await repo.getWallet(user.userId, modelKey)), freeRequests: fresh?.freeRequests ?? 0 });
  } catch (e) {
    return jsonError(e);
  }
}

/** DELETE /api/app/chat?model=key — очистить историю */
export async function DELETE(req: Request) {
  try {
    const user = await requireUser(req);
    const modelKey = new URL(req.url).searchParams.get("model") ?? "";
    if (!MODELS[modelKey]) return Response.json({ error: "unknown model" }, { status: 400 });
    await repo.clearDialog(user.userId, modelKey);
    return Response.json({ ok: true });
  } catch (e) {
    return jsonError(e);
  }
}
