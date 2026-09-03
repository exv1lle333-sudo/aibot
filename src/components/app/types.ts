export interface Me {
  userId: number;
  username: string | null;
  firstName: string | null;
  balanceRub: number;
  freeRequests: number;
  chatMode: "normal" | "economy";
  activeModel: string | null;
  banned: boolean;
  isAdmin: boolean;
  referrals: number;
  wallets: { modelKey: string; title: string; emoji: string; kind: string; remaining: number }[];
  referralLink: string;
  config: {
    minTopupRub: number;
    referralFreeRequests: number;
    referralCommissionPercent: number;
    channelUrl: string;
    supportUsername: string;
    userAgreementUrl: string;
    privacyPolicyUrl: string;
    botUsername: string;
    demo: boolean;
  };
}

export interface ModelPublic {
  key: string;
  title: string;
  provider: string;
  kind: "text" | "image";
  category: string;
  categoryTitle: string;
  description: string;
  short: string;
  emoji: string;
  sellRubPer1m: number;
  maxTokensPerGeneration: number;
  pricePerGeneration: number | null;
  supportsFiles: boolean;
  referralEligible: boolean;
  packages: { tokens: number; price: number }[];
  remaining: number;
}

export interface ModelsResponse {
  categories: { key: string; title: string }[];
  models: ModelPublic[];
  minTokensForText: number;
  freeRequests: number;
}

export interface ChatMessage {
  id: number;
  role: "user" | "assistant";
  content: string;
  imageB64: string | null;
  tokens: number | null;
  createdAt: number;
  attachments: { kind: string; filename: string | null; preview: string | null }[] | null;
  pending?: boolean;
  error?: string;
}

export type Tab = "chat" | "models" | "cabinet" | "more";
