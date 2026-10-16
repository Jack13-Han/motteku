# Motteku စတင်အသုံးပြုနည်း (မြန်မာလို)

## အလွယ်ဆုံး Run လုပ်နည်း
1. ZIP ကို Extract လုပ်ပါ။
2. Node.js 20.9 သို့မဟုတ် ပိုသစ်တဲ့ Version ကို install လုပ်ပါ။ https://nodejs.org/
3. `motteku-app` folder ကို VS Code နဲ့ဖွင့်ပါ။
4. VS Code → Terminal → New Terminal ကိုဖွင့်ပါ။
5. `npm install` လို့ရိုက်ပြီး Enter နှိပ်ပါ။ ပထမဆုံးအကြိမ်မှာ အချိန်နည်းနည်းကြာနိုင်ပါတယ်။
6. ပြီးရင် `npm run dev` လို့ရိုက်ပါ။
7. Terminal မှာပြတဲ့ local address ကိုဖွင့်ပါ။ ပုံမှန်အားဖြင့် http://localhost:3000 ဖြစ်ပါတယ်။
8. ရပ်ချင်ရင် Terminal ထဲမှာ `Ctrl + C` နှိပ်ပါ။

## Firebase မထည့်ရသေးရင်ရော?
ရပါတယ်။ App က Demo Mode နဲ့ အလုပ်လုပ်ပြီး Data ကို အဲဒီ Browser ရဲ့ localStorage ထဲသိမ်းပါတယ်။ ဒါကြောင့် အခြားကွန်ပျူတာ/Browser နဲ့ အလိုအလျောက်မျှဝေမှာ မဟုတ်ပါဘူး။

## Firebase ချိတ်ချင်ရင်
- Firebase Console မှာ Project နဲ့ Web App ဖန်တီးပါ။
- Authentication ထဲက Anonymous sign-in ကို Enable လုပ်ပါ။
- Cloud Firestore Database ဖန်တီးပါ။
- `.env.example` ကို `.env.local` အဖြစ် copy လုပ်ပြီး Firebase config တန်ဖိုးတွေဖြည့်ပါ။
- `firestore.rules` ထဲက Rules ကို Firestore Rules မှာ Publish လုပ်ပါ။
- Dev Server ကိုပိတ်ပြီး `npm run dev` နဲ့ ပြန်ဖွင့်ပါ။

## Gemini AI ချိတ်ချင်ရင်
- https://aistudio.google.com/apikey မှာ API Key ရယူပါ။
- `.env.local` ထဲမှာ `GEMINI_API_KEY=သင့်_API_KEY` ထည့်ပါ။
- Server ကို restart လုပ်ပါ။ API Key ကို Frontend code ထဲမှာ မထည့်ပါနဲ့။

## ပါဝင်တဲ့ Function များ
- Trip create / templates
- Packing list: Owned, Need to buy, Purchased, Packed
- Group member management
- Unassigned items auto-assign
- Weight, price, item comments
- Budget tracking and expense split summary
- Packing list CSV export
- Open-Meteo weather forecast
- Gemini AI advice (API key ထည့်ထားလျှင်)
- Trip copy / history

မှတ်ချက်: ဒီဟာက School Project MVP ဖြစ်ပါတယ်။ Multi-user group invitation, real-time group sharing, push notifications, receipt image upload စတာတွေကို production-level အဖြစ် မပြီးသေးပါဘူး။ README.md မှာ limitation တွေကိုကြည့်ပါ။
