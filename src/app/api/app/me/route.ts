import { requireUser, jsonError } from "@/lib/miniapp-auth";
import { cabinet, referralLink } from "@/lib/services";
import { cfg } from "@/lib/config";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const user = await requireUser(req);
    const c = await cabinet(user.userId);
    return Response.json({
      ...c,
      referralLink: referralLink(user.userId),
      config: {
        minTopupRub: cfg.minTopupRub,
        referralFreeRequests: cfg.referralFreeRequests,
        referralCommissionPercent: cfg.referralCommissionPercent,
        channelUrl: cfg.channelUrl,
        supportUsername: cfg.supportUsername,
        userAgreementUrl: cfg.userAgreementUrl,
        privacyPolicyUrl: cfg.privacyPolicyUrl,
        botUsername: cfg.botUsername,
        demo: cfg.miniappDemo,
      },
    });
  } catch (e) {
    return jsonError(e);
  }
}
