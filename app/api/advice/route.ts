import { NextResponse } from 'next/server';
import { generateAdvice, normalizeAdviceInput } from '@/lib/advice';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  let input;
  try {
    if (!req.body) throw new Error('Check your input.');
    const reader = req.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 100000) { await reader.cancel(); throw new Error('Check your input.'); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    input = normalizeAdviceInput(JSON.parse(new TextDecoder().decode(bytes)));
  } catch (error) {
    const message = error instanceof Error && error.message === 'A trip type is required to generate a checklist.' ? error.message : 'Check your input.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
  const result = await generateAdvice(input, { apiKey: process.env.GEMINI_API_KEY, model: process.env.GEMINI_MODEL });
  return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
}
