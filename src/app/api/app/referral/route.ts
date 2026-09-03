import { requireUser, jsonError } from "@/lib/miniapp-auth";
import * as repo from "@/lib/repo";
import { referralLink } from "@/lib/services";
import { cfg } from "@/lib/config";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const user = await requireUser(req);
    return Response.json({
      link: referralLink(user.userId),
      count: await repo.referralCount(user.userId),
      freeRequests: cfg.referralFreeRequests,
      percent: cfg.referralCommissionPercent,
    });
  } catch (e) {
    return jsonError(e);
  }
}
