import { requireUser, jsonError } from "@/lib/miniapp-auth";
import { MODELS, CATEGORY_TITLES, categoriesWithModels, publicModel, MIN_TOKENS_FOR_TEXT_REQUEST } from "@/lib/pricing";
import * as repo from "@/lib/repo";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const user = await requireUser(req);
    const wallets = await repo.getAllWallets(user.userId);
    const models = Object.values(MODELS).map((m) => ({ ...publicModel(m), remaining: Math.floor(wallets[m.key] ?? 0) }));
    return Response.json({
      categories: categoriesWithModels().map((c) => ({ key: c, title: CATEGORY_TITLES[c] })),
      models,
      minTokensForText: MIN_TOKENS_FOR_TEXT_REQUEST,
      freeRequests: user.freeRequests,
    });
  } catch (e) {
    return jsonError(e);
  }
}
