import { NextResponse } from 'next/server';
export async function POST(req: Request) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return NextResponse.json({ configured:false, advice:null, message:'Gemini API key is not configured. Showing built-in suggestions instead.' });
  try {
    const body = await req.json();
    const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
    const prompt = `You are Motteku, a practical trip packing assistant. Reply in concise English. Return JSON only with keys advice (string), suggestedItems (array of strings), and cautions (array of strings). Do not invent weather. Trip: ${JSON.stringify(body).slice(0,7000)}`;
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`, {
      method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({contents:[{parts:[{text:prompt}]}],generationConfig:{responseMimeType:'application/json',temperature:0.4}}), cache:'no-store'
    });
    const data = await r.json();
    if (!r.ok) return NextResponse.json({configured:true,error:data?.error?.message || 'Gemini request failed.'},{status:502});
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    try { return NextResponse.json({configured:true,result:JSON.parse(text)}); }
    catch { return NextResponse.json({configured:true,result:{advice:text || 'No advice returned.',suggestedItems:[],cautions:[]}}); }
  } catch { return NextResponse.json({configured:true,error:'Could not generate advice.'},{status:500}); }
}
