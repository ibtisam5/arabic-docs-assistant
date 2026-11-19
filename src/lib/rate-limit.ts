import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

// Protects the Claude API budget on a public deployment.
//
// - Each visitor (by IP) gets a few questions and uploads per day.
// - All visitors together share a daily cap on questions, so the total spend
//   per day has a ceiling even if many people use the link.
//
// In production the counters live in Upstash Redis, so they are shared by every
// serverless instance. Without Redis env vars (local development) it falls back
// to in-memory counters, which reset when the server restarts.

const num = (value: string | undefined, fallback: number) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

export const LIMITS = {
  questionsPerVisitor: num(process.env.RATE_LIMIT_QUESTIONS_PER_VISITOR, 10),
  uploadsPerVisitor: num(process.env.RATE_LIMIT_UPLOADS_PER_VISITOR, 10),
  questionsPerDayTotal: num(process.env.RATE_LIMIT_QUESTIONS_PER_DAY, 100),
};

type Kind = "question" | "upload";
type Check = { success: boolean; remaining: number; reset: number };
type Limiter = { limit: (id: string) => Promise<Check> };

// Vercel's Upstash integration names the variables KV_REST_API_*; Upstash's own
// dashboard names them UPSTASH_REDIS_REST_*. Accept either.
const redisUrl = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
const redis = redisUrl && redisToken ? new Redis({ url: redisUrl, token: redisToken }) : null;

const DAY_MS = 24 * 60 * 60 * 1000;

function memoryLimiter(max: number): Limiter {
  const hits = new Map<string, { count: number; reset: number }>();
  return {
    async limit(id) {
      const now = Date.now();
      let entry = hits.get(id);
      if (!entry || entry.reset <= now) {
        entry = { count: 0, reset: now + DAY_MS };
        hits.set(id, entry);
      }
      if (entry.count >= max) return { success: false, remaining: 0, reset: entry.reset };
      entry.count++;
      return { success: true, remaining: max - entry.count, reset: entry.reset };
    },
  };
}

function makeLimiter(prefix: string, max: number, window: "sliding" | "fixed"): Limiter {
  if (!redis) return memoryLimiter(max);
  return new Ratelimit({
    redis,
    prefix: `docs-assistant:${prefix}`,
    limiter:
      window === "sliding"
        ? Ratelimit.slidingWindow(max, "1 d")
        : Ratelimit.fixedWindow(max, "1 d"),
  });
}

const limiters = {
  question: makeLimiter("question", LIMITS.questionsPerVisitor, "sliding"),
  upload: makeLimiter("upload", LIMITS.uploadsPerVisitor, "sliding"),
  globalQuestions: makeLimiter("global-questions", LIMITS.questionsPerDayTotal, "fixed"),
};

function visitorId(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip") || "unknown";
}

export type LimitResult =
  | { ok: true; remaining: number }
  | { ok: false; message: string; retryAfterSeconds: number };

export async function checkLimit(kind: Kind, request: Request): Promise<LimitResult> {
  try {
    const visitor = await limiters[kind].limit(visitorId(request));
    if (!visitor.success) {
      return {
        ok: false,
        message:
          kind === "question"
            ? `وصلت للحد اليومي (${LIMITS.questionsPerVisitor} أسئلة). جرّب بكرة 🙏`
            : `وصلت للحد اليومي لرفع الملفات (${LIMITS.uploadsPerVisitor} ملفات). جرّب بكرة 🙏`,
        retryAfterSeconds: Math.max(1, Math.ceil((visitor.reset - Date.now()) / 1000)),
      };
    }

    if (kind === "question") {
      const global = await limiters.globalQuestions.limit("all");
      if (!global.success) {
        return {
          ok: false,
          message: "الموقع وصل للحد اليومي للأسئلة لكل الزوار. جرّب بكرة 🙏",
          retryAfterSeconds: Math.max(1, Math.ceil((global.reset - Date.now()) / 1000)),
        };
      }
    }

    return { ok: true, remaining: visitor.remaining };
  } catch (error) {
    // If Redis is unreachable, block rather than spend without a limit.
    console.error("rate limit check failed", error);
    return {
      ok: false,
      message: "الخدمة مشغولة حاليًا، حاول بعد شوي.",
      retryAfterSeconds: 60,
    };
  }
}

export function limitedResponse(result: Extract<LimitResult, { ok: false }>) {
  return Response.json(
    { error: result.message },
    { status: 429, headers: { "Retry-After": String(result.retryAfterSeconds) } },
  );
}
