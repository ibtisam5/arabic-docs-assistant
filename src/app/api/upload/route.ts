import Anthropic, { toFile } from "@anthropic-ai/sdk";
import {
  anthropic,
  FILE_TTL_SECONDS,
  hasApiKey,
  MAX_FILE_BYTES,
  MISSING_KEY_MESSAGE,
} from "@/lib/anthropic";

// Receives one PDF from the browser and stores it with the Claude Files API,
// so later chat requests can reference it by file_id instead of re-sending it.
export async function POST(request: Request) {
  if (!hasApiKey()) {
    return Response.json({ error: MISSING_KEY_MESSAGE }, { status: 500 });
  }

  const form = await request.formData();
  const file = form.get("file");

  if (!(file instanceof File)) {
    return Response.json({ error: "لم يتم إرسال ملف." }, { status: 400 });
  }
  if (file.type !== "application/pdf") {
    return Response.json({ error: "الملف لازم يكون PDF." }, { status: 400 });
  }
  if (file.size > MAX_FILE_BYTES) {
    return Response.json(
      { error: "حجم الملف أكبر من 4 ميجابايت." },
      { status: 400 },
    );
  }

  try {
    const uploaded = await anthropic.files.upload({
      file: await toFile(file, file.name, { type: "application/pdf" }),
      expires_in_seconds: FILE_TTL_SECONDS,
    });
    return Response.json({ fileId: uploaded.id, title: file.name });
  } catch (error) {
    console.error("upload failed", error);
    if (error instanceof Anthropic.AuthenticationError) {
      return Response.json(
        { error: "مفتاح ANTHROPIC_API_KEY غير صحيح أو غير موجود." },
        { status: 500 },
      );
    }
    return Response.json({ error: "تعذّر رفع الملف، حاول مرة ثانية." }, { status: 502 });
  }
}
