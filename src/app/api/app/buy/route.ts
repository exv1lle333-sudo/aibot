import { requireUser, jsonError } from "@/lib/miniapp-auth";
import { buyPackage, cabinet } from "@/lib/services";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const user = await requireUser(req);
    const body = (await req.json()) as { modelKey?: string; tokens?: number };
    const res = await buyPackage(user.userId, String(body.modelKey ?? ""), Number(body.tokens ?? 0));
    if (!res.ok) {
      const msg =
        res.reason === "not_enough"
          ? `Недостаточно средств: не хватает ${res.missing} ₽`
          : res.reason === "bad_package"
            ? "Такого пакета нет"
            : "Модель недоступна";
      return Response.json({ ...res, error: msg }, { status: 400 });
    }
    return Response.json({ ...res, cabinet: await cabinet(user.userId) });
  } catch (e) {
    return jsonError(e);
  }
}
