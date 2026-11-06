import { NextResponse } from 'next/server';
export async function POST(req: Request) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return NextResponse.json({ configured:false, advice:null, message:'Gemini API key is not configured. Showing built-in suggestions instead.' });
  try {
    const body = await req.json();
    const checklistRequest = body?.mode === 'checklist';
    if (checklistRequest && (typeof body?.trip?.type !== 'string' || !body.trip.type.trim())) {
      return NextResponse.json({ configured:true, error:'A trip type is required to generate a checklist.' }, { status:400 });
    }
    const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
    const prompt = checklistRequest
      ? `You are Motteku, a practical trip packing assistant. Create a useful starter packing checklist for the user's trip type, including concrete and relevant items. Return JSON only with keys advice (string), suggestedItems (array of strings containing 8 to 15 item names), and cautions (array of strings). Use ${body.language === 'ja' ? 'Japanese' : 'English'} for item names and advice. Do not invent weather or assume special requirements not provided. Trip details: ${JSON.stringify(body.trip).slice(0,5000)}`
      : `You are Motteku, a practical trip packing assistant. Reply in concise English. Return JSON only with keys advice (string), suggestedItems (array of strings), and cautions (array of strings). Do not invent weather. Trip: ${JSON.stringify(body).slice(0,7000)}`;
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`, {
      method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({contents:[{parts:[{text:prompt}]}],generationConfig:{responseMimeType:'application/json',temperature:0.4}}), cache:'no-store'
    });
    const data = await r.json();
    if (!r.ok) return NextResponse.json({configured:true,error:data?.error?.message || 'Gemini request failed.'},{status:502});
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    try {
      const result = JSON.parse(text);
      if (checklistRequest) {
        const suggestedItems = Array.isArray(result?.suggestedItems)
          ? [...new Set(result.suggestedItems.filter((item: unknown): item is string => typeof item === 'string').map((item: string) => item.trim()).filter(Boolean))].slice(0, 20)
          : [];
        if (!suggestedItems.length) return NextResponse.json({configured:true,error:'The AI did not return a usable checklist. Please try again.'},{status:502});
        return NextResponse.json({configured:true,result:{...result,suggestedItems}});
      }
      return NextResponse.json({configured:true,result});
    }
    catch { return NextResponse.json({configured:true,result:{advice:text || 'No advice returned.',suggestedItems:[],cautions:[]}}); }
  } catch { return NextResponse.json({configured:true,error:'Could not generate advice.'},{status:500}); }
}
