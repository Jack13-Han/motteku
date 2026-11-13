# Weather နှင့် Smart advice

1. Server ကို restart လုပ်ပါ (`npm run dev`)။
2. `Weather & AI` ကိုဖွင့်ပြီး `Tokyo, Japan`၊ `Paris, France` သို့မဟုတ် ကိုယ်သွားမည့်မြို့ကို ရိုက်ကာ `Search places` နှိပ်ပါ။ Search result ထဲက မြို့နှင့်နိုင်ငံအမှန်ကို ရွေးပါ။ ရွေးထားသည့်နေရာအတွက် forecast အလိုအလျောက် ပြပါမည်။
3. ခရီးရက်အတွက် ရနိုင်သော forecast ကိုသာ ပြပါသည်။ ခရီးရက်က forecast range အပြင်ရောက်နေလျှင် preview ဖြစ်ကြောင်း ရှင်းပြထားပြီး၊ အဲဒီ preview ကို ခရီးသွားမည့်နေ့၏ ရာသီဥတုအဖြစ် advice ထဲ မပို့ပါ။
4. `Generate suggestions` နှိပ်ပါ။ `Gemini AI suggestions` ဆိုလျှင် Gemini မှ အဖြေဖြစ်ပြီး `Built-in suggestions` ဆိုလျှင် AI ချိတ်ဆက်မှု မရသည့်အချိန် သုံးနိုင်သော စည်းမျဉ်းအခြေပြု အကြံပြုချက်ဖြစ်သည်။
5. Organizer/Admin က `Personal` သို့မဟုတ် `Shared` ရွေးပြီး ပစ္စည်းတစ်ခုကို နှိပ်ကာ checklist အသစ်ထဲ တိုက်ရိုက်ထည့်နိုင်သည်။ Personal ပစ္စည်းဆို active member တစ်ဦးချင်းအတွက် checklist row ရမည်။ Shared ဆို တာဝန်ခံတစ်ဦးပါသော unit တစ်ခု ရမည်။

## Gemini setup

`.env.local` တွင် server-side `GEMINI_API_KEY` နှင့် `GEMINI_MODEL=gemini-3.5-flash-lite` သတ်မှတ်ပါ။ API key ကို `NEXT_PUBLIC_` prefix မတပ်ပါနှင့်။ Git ထဲ မတင်ပါနှင့်။ Setting ပြောင်းပြီးလျှင် server restart လုပ်ပါ။ Hosting ရှိလျှင် hosting environment တွင်လည်း setting တူအောင်ထားပြီး redeploy လုပ်ရန်လိုသည်။

ဤစစ်ဆေးမှုတွင် model အဟောင်း `gemini-2.5-flash` ကို အသုံးမပြုနိုင်တော့ကြောင်း provider က `404` ပြန်ခဲ့သည်။ `gemini-3.5-flash-lite` ဖြင့် တကယ့် Gemini response အောင်မြင်ကြောင်း စစ်ထားသည်။ Model အဟောင်း၊ provider busy၊ timeout၊ quota သို့မဟုတ် output error ဖြစ်လျှင် အသုံးပြုသူအတွက် built-in advice ပြန်ပေးသည်။

Weather အတွက် Open-Meteo geocoding/forecast ကို အသုံးပြုပြီး API key မလိုပါ။ Forecast တစ်ခုလုံးကို ခရီးရက်အဖြစ် မယူဘဲ ရက်အလိုက် စစ်ထားသည်။

Firebase ဖြင့် checklist ကို cloud ထဲသိမ်းထားလျှင် ကိုက်ညီသော Firebase project တွင် `firestore.rules` ကို publish လုပ်ထားရန်လိုသည်။ Shared/managed checklist ထဲ suggestion ထည့်နိုင်ရန် Organizer/Admin ဖြစ်ပြီး checklist ပြင်ဆင်ခွင့် ရှိရမည်။ Weather နှင့် advice ထုတ်ခြင်းအတွက် Firebase မလိုပါ။ ဤအလုပ်တွင် production Firebase Rules ကို publish မလုပ်ထားပါ။

စစ်ဆေးမှုအထောက်အထား: မူရင်း project တွင် automated tests 67 ခုနှင့် production build အောင်မြင်သည်။ Tokyo/Paris geocoding၊ forecast နှင့် Japanese Gemini advice ကို တကယ့် app API ဖြင့် စစ်ပြီး `200 OK` ရသည်။ Browser URL ကို tool က အတည်မပြုနိုင်သဖြင့် browser click စမ်းသပ်မှု မပြီးပါ။ Client interaction နှင့် stale-response handling ကို actual component test ဖြင့် စစ်ထားသည်။

## စစ်ဆေးရန်

```powershell
node --test tests/weather.test.cjs tests/advice.test.cjs tests/weather-advice-ui.test.cjs tests/advice-packing.test.cjs tests/i18n.test.cjs
node --experimental-strip-types --test tests/trips.test.mjs tests/packing.test.mjs tests/quantity.test.mjs
npm run build
```

References: [Open-Meteo geocoding](https://open-meteo.com/en/docs/geocoding-api), [forecast](https://open-meteo.com/en/docs), [Gemini GenerateContent](https://ai.google.dev/api/generate-content).
