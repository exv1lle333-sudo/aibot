function envInt(name: string, def: number): number {
  const v = process.env[name];
  if (v === undefined || v === "") return def;
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

function envList(name: string): number[] {
  return (process.env[name] ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map(Number)
    .filter((n) => Number.isFinite(n));
}

export const cfg = {
  get botToken() {
    return process.env.BOT_TOKEN ?? "";
  },
  get botUsername() {
    return (process.env.BOT_USERNAME ?? "").replace(/^@/, "");
  },
  get adminIds() {
    return envList("ADMIN_IDS");
  },
  get supportUsername() {
    return process.env.SUPPORT_USERNAME ?? "@support";
  },
  get channelUrl() {
    return process.env.CHANNEL_URL ?? "";
  },
  get webhookSecret() {
    return process.env.TELEGRAM_WEBHOOK_SECRET ?? "";
  },

  // ForgetAPI
  get forgetapiKey() {
    return process.env.FORGETAPI_KEY ?? "";
  },
  get forgetapiBaseUrl() {
    return (process.env.FORGETAPI_BASE_URL ?? "https://api.forgetapi.ru/v1").replace(/\/$/, "");
  },

  // Platega
  get plategaMerchantId() {
    return process.env.PLATEGA_MERCHANT_ID ?? "";
  },
  get plategaSecret() {
    return process.env.PLATEGA_SECRET ?? "";
  },
  get plategaBaseUrl() {
    return (process.env.PLATEGA_BASE_URL ?? "https://app.platega.io").replace(/\/$/, "");
  },
  get plategaApiVersion() {
    return process.env.PLATEGA_API_VERSION ?? "v1";
  },
  get plategaActiveMethods() {
    const l = envList("PLATEGA_ACTIVE_METHODS");
    return l.length ? l : [2, 10, 11];
  },
  get plategaReturnUrl() {
    return process.env.PLATEGA_RETURN_URL ?? (this.botUsername ? `https://t.me/${this.botUsername}` : "");
  },
  get plategaFailedUrl() {
    return process.env.PLATEGA_FAILED_URL ?? this.plategaReturnUrl;
  },
  get plategaHeaderMerchant() {
    return process.env.PLATEGA_HEADER_MERCHANT ?? "X-MerchantId";
  },
  get plategaHeaderSecret() {
    return process.env.PLATEGA_HEADER_SECRET ?? "X-Secret";
  },

  get publicBaseUrl() {
    return (process.env.PUBLIC_BASE_URL ?? "").replace(/\/$/, "");
  },

  // бизнес-правила
  get minTopupRub() {
    return envInt("MIN_TOPUP_RUB", 10);
  },
  get referralFreeRequests() {
    return envInt("REFERRAL_FREE_REQUESTS", 7);
  },
  get referralCommissionPercent() {
    return envInt("REFERRAL_COMMISSION_PERCENT", 5);
  },
  get signupBonusTokens() {
    return envInt("SIGNUP_BONUS_TOKENS", 5000);
  },
  get userAgreementUrl() {
    return process.env.USER_AGREEMENT_URL ?? "";
  },
  get privacyPolicyUrl() {
    return process.env.PRIVACY_POLICY_URL ?? "";
  },
  get miniappDemo() {
    return process.env.MINIAPP_DEMO === "1";
  },
  get whisperModel() {
    return process.env.WHISPER_MODEL ?? "whisper-1";
  },
};

export function isAdmin(userId: number): boolean {
  return cfg.adminIds.includes(userId);
}

export function fmtNum(n: number): string {
  return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

export function fmtRub(n: number): string {
  const rounded = Math.round(n * 100) / 100;
  return (Number.isInteger(rounded) ? rounded.toString() : rounded.toFixed(2)).replace(/\B(?=(\d{3})+(?!\d))/g, " ") + " ₽";
}
