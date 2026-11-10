import { NextResponse } from 'next/server';
import { translate } from '@/lib/messages';
export async function POST(req: Request) {
  const key = process.env.GEMINI_API_KEY;
  try {
    const body = await req.json();
    const language = body.language === 'en' ? 'en' : 'ja';
    if (!key) return NextResponse.json({ configured:false, advice:null });
    const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
    const prompt = `You are Motteku, a practical trip packing assistant. Reply in concise ${language === 'ja' ? 'Japanese' : 'English'}, including every suggested item and caution. Keep user names and place names unchanged. Return JSON only with keys advice (string), suggestedItems (array of strings), and cautions (array of strings). Do not invent weather. Trip: ${JSON.stringify(body).slice(0,7000)}`;
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`, {
      method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({contents:[{parts:[{text:prompt}]}],generationConfig:{responseMimeType:'application/json',temperature:0.4}}), cache:'no-store'
    });
    const data = await r.json();
    if (!r.ok) return NextResponse.json({configured:true,error:'Gemini request failed.',message:translate(language,'Gemini request failed.')},{status:502});
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    try { return NextResponse.json({configured:true,result:JSON.parse(text)}); }
    catch { return NextResponse.json({configured:true,result:{advice:text || translate(language,'No advice returned.'),suggestedItems:[],cautions:[]}}); }
  } catch { return NextResponse.json({configured:true,error:'Could not generate advice.'},{status:500}); }
}
