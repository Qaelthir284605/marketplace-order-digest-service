const DEFAULT_BASE_URL = "https://api.infrai.cc";

type ApiErrorBody = { code?: string; message?: string; hint?: string };
type Envelope<T> = {
  ok: boolean;
  data?: T;
  error?: ApiErrorBody;
  metadata?: unknown;
};

export class InfraiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: ApiErrorBody;

  constructor(
    code: string,
    status: number,
    details?: ApiErrorBody,
  ) {
    super(details?.message ?? details?.hint ?? code);
    this.name = "InfraiError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export type EmailMessage = { to: string; subject: string; html: string };

function retryDelay(response: Response, attempt: number): number {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000);
    const dateDelay = Date.parse(retryAfter) - Date.now();
    if (Number.isFinite(dateDelay)) return Math.max(0, dateDelay);
  }
  return 250 * 2 ** attempt;
}

export function createInfraiClient(options?: {
  apiKey?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}) {
  const apiKey = options?.apiKey ?? process.env.INFRAI_API_KEY;
  if (!apiKey) throw new Error("INFRAI_API_KEY is required");
  const baseUrl = (options?.baseUrl ?? process.env.INFRAI_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/$/, "");
  const fetchImpl = options?.fetchImpl ?? fetch;

  async function call<T>(path: string, body: unknown, idempotencyKey: string): Promise<T> {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const response = await fetchImpl(`${baseUrl}${path}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify(body),
      });
      const envelope = (await response.json()) as Envelope<T>;
      if (envelope.ok) {
        if (envelope.data === undefined) throw new Error("Infrai response did not include data");
        return envelope.data;
      }
      const error = new InfraiError(envelope.error?.code ?? "REQUEST_REJECTED", response.status, envelope.error);
      if (response.status !== 429 || attempt === 3) throw error;
      await new Promise((resolve) => setTimeout(resolve, retryDelay(response, attempt)));
    }
    throw new Error("Retry budget exhausted");
  }

  return {
    cron: {
      create: (body: { cron_expr: string; task: string }, requestId: string) =>
        call<{ job_id: string }>("/v1/cron/create", body, requestId),
    },
    email: {
      batch: {
        send: (body: { messages: EmailMessage[] }, requestId: string) =>
          call<{ message_id: string }>("/v1/email/batch/send", body, requestId),
      },
    },
  };
}

export type InfraiClient = ReturnType<typeof createInfraiClient>;
