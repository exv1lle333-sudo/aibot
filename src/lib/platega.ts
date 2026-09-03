/**
 * Интеграция с Platega (https://platega.io).
 *  - создание платежа: POST {base}/transaction/process, заголовки X-MerchantId / X-Secret
 *  - колбэк аутентифицируется теми же заголовками; статус CONFIRMED = оплачено, CANCELED = отмена
 *  - проверка статуса: GET {base}/transaction/{id}
 */
import { cfg } from "./config";

export class PlategaError extends Error {}

export const PAID_STATUSES = new Set(["CONFIRMED", "PAID", "SUCCESS"]);
export const FAILED_STATUSES = new Set(["CANCELED", "CANCELLED", "EXPIRED", "FAILED"]);

export function plategaConfigured(): boolean {
  return Boolean(cfg.plategaMerchantId && cfg.plategaSecret);
}

export async function createPayment(amountRub: number, txId: string, description: string): Promise<string> {
  if (!plategaConfigured()) {
    throw new PlategaError("Оплата временно недоступна: PLATEGA_MERCHANT_ID / PLATEGA_SECRET не заданы.");
  }
  const endpoint = cfg.plategaApiVersion === "v2" ? "/v2/transaction/process" : "/transaction/process";
  const payload = {
    paymentMethod: cfg.plategaActiveMethods[0] ?? 2,
    id: txId,
    paymentDetails: { amount: Math.round(amountRub * 100) / 100, currency: "RUB" },
    description,
    return: cfg.plategaReturnUrl || undefined,
    failedUrl: cfg.plategaFailedUrl || undefined,
  };
  let resp: Response;
  try {
    resp = await fetch(`${cfg.plategaBaseUrl}${endpoint}`, {
      method: "POST",
      headers: {
        [cfg.plategaHeaderMerchant]: cfg.plategaMerchantId,
        [cfg.plategaHeaderSecret]: cfg.plategaSecret,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (e) {
    throw new PlategaError(`Не удалось подключиться к Platega: ${(e as Error).message}`);
  }
  const text = await resp.text();
  if (!resp.ok) {
    console.error("Platega error", resp.status, text.slice(0, 1000));
    throw new PlategaError(`Platega вернула ${resp.status}: ${text.slice(0, 300)}`);
  }
  let data: Record<string, unknown> = {};
  try {
    data = JSON.parse(text);
  } catch {
    throw new PlategaError("Platega вернула не-JSON ответ");
  }
  const url = (data.redirect || data.redirectUrl || data.paymentUrl || data.url || "") as string;
  if (!url) throw new PlategaError(`Platega не вернула ссылку на оплату: ${text.slice(0, 300)}`);
  return url;
}

export async function getTransactionStatus(txId: string): Promise<{ status: string } | null> {
  if (!plategaConfigured()) return null;
  try {
    const resp = await fetch(`${cfg.plategaBaseUrl}/transaction/${txId}`, {
      headers: { [cfg.plategaHeaderMerchant]: cfg.plategaMerchantId, [cfg.plategaHeaderSecret]: cfg.plategaSecret },
      signal: AbortSignal.timeout(15_000),
    });
    if (!resp.ok) return null;
    const data = (await resp.json()) as { status?: string };
    return { status: String(data.status ?? "").toUpperCase() };
  } catch {
    return null;
  }
}

/** Проверка заголовков колбэка (timing-safe). */
export function verifyWebhookHeaders(headers: Headers): boolean {
  if (!plategaConfigured()) return false;
  const gotMerchant = headers.get(cfg.plategaHeaderMerchant) ?? "";
  const gotSecret = headers.get(cfg.plategaHeaderSecret) ?? "";
  return safeEqual(gotMerchant, cfg.plategaMerchantId) && safeEqual(gotSecret, cfg.plategaSecret);
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
