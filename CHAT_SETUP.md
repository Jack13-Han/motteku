# Group chat — Reply နှင့် reactions

ဟန်ဝေ၊ group chat မှာ စာပို့ခြင်း၊ အရင် message ကို Reply ပြန်ခြင်းနှင့် reaction ပေးခြင်းတို့ကို အသုံးပြုနိုင်သည်။ Chat ထဲက ပုံရွေးခြင်းနှင့် ပုံ upload လုပ်ခြင်းကို ဖယ်ထားသည်။ ယခု chat အတွက် Firebase Authentication နှင့် Cloud Firestore ကို အသုံးပြုသည်။ Chat အသုံးပြုရန် Firebase Storage bucket သို့မဟုတ် Storage အတွက် Blaze upgrade လုပ်စရာ မလိုပါ။ Firestore ၏ လက်ရှိ usage quota များကတော့ သက်ဆိုင်ဆဲဖြစ်သည်။

## သာမန်စာရပြီး Reply ပို့မရသည့်အခါ

Reply ပို့ခြင်းက ပုံမှန်စာထက် `replyTo` field တစ်ခု ထပ်ပါသည်။ Rules အဟောင်းသည် သာမန်စာကို လက်ခံသော်လည်း ထို field ကို ခွင့်မပြုသဖြင့် `permission-denied` ဖြစ်နိုင်သည်။ Project ထဲမှာ code ပြင်ထားရုံနဲ့ Cloud ပေါ်က Rules မပြောင်းပါ။

1. [Motteku Firestore Rules](https://console.firebase.google.com/project/motteku-7a721/firestore/rules) ကို ဖွင့်ပါ။
2. Project ၏ `firestore.rules` ဖိုင်တစ်ခုလုံးကို ကူးယူပြီး Console editor ထဲက အဟောင်းနေရာမှာ အစားထိုးပါ။
3. **Publish** နှိပ်ပြီး success ဖြစ်ကြောင်း စစ်ပါ။ Rules ထဲမှာ `validChatReply` နှင့် `validChatReactionUpdate` ပါရပါမည်။
4. App ကို refresh လုပ်ပြီး မူရင်း message တစ်ခုကို Reply ပြန်စမ်းပါ။
5. ပို့မရသေးလျှင် စာရိုက်သည့်နေရာနားမှာ ပြသည့် error နှင့် safe error code ကို စစ်ပါ။ မူရင်း message ဖတ်မရခြင်း၊ Reply write ပိတ်ခြင်းနှင့် connection ပြဿနာတို့ကို အဆင့်ခွဲပြထားသည်။ စာနှင့် Reply ရွေးထားမှုကို ထိန်းထားပေးသည်။

Console မှာ အခြား browser extension script ၏ warning ပေါ်နေရုံဖြင့် Firebase write failure ဟု မသတ်မှတ်ပါနှင့်။ App ၏ Send နားမှာပြသည့် error code ကို အခြေခံပါ။

## Reply ပြန်ပို့ရန်

1. Group chat ထဲမှာ Reply ပြန်လိုသည့် message ၏ **Reply** ကို နှိပ်ပါ။
2. စာရိုက်သည့်နေရာအပေါ်မှာ မူရင်းပို့သူနှင့် မူရင်းစာကို ပြပါမည်။ မိမိပြန်ပို့မည့်စာကို ရိုက်ပါ။
3. မူရင်း message မရွေးချင်တော့လျှင် **Cancel reply** ကို နှိပ်ပါ။ ရိုက်ထားသောစာကို ဆက်အသုံးပြုနိုင်သည်။
4. **Send message** နှိပ်ပါ။ ပို့ပြီးသော reply မှာ မူရင်းစာကို ကိုးကားဖော်ပြပါမည်။ ပို့မအောင်မြင်ပါက ပြန်စမ်းနိုင်ရန် စာနှင့် reply ရွေးချယ်မှုကို ထိန်းထားပေးသည်။
5. Reply ထဲက မူရင်းစာကို နှိပ်လျှင် လက်ရှိဖော်ပြနေသော messages ထဲ၌ မူရင်းစာကို ရှာပြပေးသည်။ နောက်ဆုံး messages 100 ခု၏ အပြင်ရောက်နေလျှင် အကြောင်းကြားစာ ပြပါမည်။

## Reaction ပေးရန်

Message အောက်က reaction button တစ်ခုကို နှိပ်ပါ။ Reaction ၅ ခုသာ ရှိသည်။

| Reaction | အဓိပ္ပာယ် |
| --- | --- |
| 👍 Like | သဘောကျသည် |
| 😡 Angry | စိတ်ဆိုးသည် |
| 👌 OK | အိုခေ |
| 😂 Haha | ရယ်သည် |
| 😢 Sad | ဝမ်းနည်းသည် / ငိုသည် |

- Member တစ်ယောက်သည် message တစ်ခုအတွက် reaction တစ်ခု ရွေးနိုင်သည်။ မိမိရွေးထားသော reaction ကို အရောင်ဖြင့် ပြပေးသည်။
- အခြား reaction ကို နှိပ်လျှင် မိမိ reaction ကို ပြောင်းပေးသည်။ ရွေးထားပြီးသော reaction ကို ထပ်နှိပ်လျှင် မိမိ reaction ကို ဖယ်ပေးသည်။
- Reaction တစ်ခုစီ၏ အရေအတွက်သည် member များပေးထားသော reaction များကို ရေတွက်ပြထားခြင်းဖြစ်သည်။ အခြားသူ၏ reaction ကို ပြောင်းခြင်း၊ ဖယ်ခြင်းတို့ကို ခွင့်မပြုပါ။

## Firebase Console မှာ Rules ကို publish လုပ်ရန်

Local `firestore.rules` ဖိုင်ပြင်ထားခြင်းက Cloud ပေါ်က Rules ကို မပြောင်းပါ။ Reply နှင့် reactions အသုံးပြုမည့် Firebase project မှာ Rules အသစ်ကို publish လုပ်ရပါမည်။

1. Firebase Console မှာ မိမိအသုံးပြုနေသည့် Motteku project ကို ဖွင့်ပါ။
2. **Cloud Firestore → Rules** ကို ဝင်ပါ။
3. Project ထဲက လက်ရှိ `firestore.rules` ဖိုင်နှင့် Console ထဲက Rules ကို နှိုင်းယှဉ်ပါ။ လက်ရှိဖိုင်တွင် chat အပြင် packing နှင့် trip permissions များလည်း ပါဝင်သည်။
4. လက်ရှိ `firestore.rules` အကြောင်းအရာတစ်ခုလုံးကို ကူးထည့်ပြီး syntax error မရှိကြောင်း စစ်ကာ **Publish** နှိပ်ပါ။ `storage.rules` ကို ဒီ editor ထဲ မထည့်ပါနှင့်။
5. Group member account နှစ်ခုဖြင့် အောက်ပါစမ်းသပ်မှုကို လုပ်ပါ။

Rules အသစ်သည် reply ၏ မူရင်း message ကို အဆိုပါ group ထဲမှာ အမှန်တကယ်ရှိကြောင်း စစ်သည်။ Reaction အတွက် မိမိ account UID နှင့်ဆိုင်သည့် entry ကိုသာ ပြောင်းနိုင်သည်။ Message body၊ sender နှင့် အခြားသူ၏ reaction တို့ကို ပြောင်းခွင့် မပေးပါ။ Rules အဟောင်းဖြစ်နေပါက စာပို့ခြင်း ရနေသော်လည်း Reply သို့မဟုတ် reaction ပြောင်းခြင်းမှာ `permission-denied` ဖြစ်နိုင်သည်။

## Account နှစ်ခုဖြင့် စမ်းသပ်ရန်

1. Account A ဖြင့် group တည်ဆောက်ပါ။ Account B ကို invite link ဖြင့် group ထဲ ဝင်စေပါ။
2. A က စာပို့ပြီး B မှာ ပေါ်ကြောင်း စစ်ပါ။
3. B က A ၏ message ကို Reply ပြန်ပို့ပါ။ Account နှစ်ခုစလုံးမှာ မူရင်းစာနှင့် reply စာကို မြင်ရကြောင်း စစ်ပါ။
4. A နှင့် B က မူရင်း message ကို 👍 ပေးကြည့်ပါ။ အရေအတွက် `2` ပြရပါမည်။ A က 😡 သို့ပြောင်းလျှင် 👍 `1` နှင့် 😡 `1` ဖြစ်ရပါမည်။
5. A က 😡 ကို ထပ်နှိပ်ပါ။ A ၏ reaction ဖယ်သွားပြီး B ၏ 👍 ကျန်ရပါမည်။ ကျန် reaction ၃ ခုကိုလည်း ရွေးကြည့်ပါ။
6. Page refresh လုပ်ပါ။ ပို့ထားသော reply နှင့် reactions များ ဆက်ရှိရပါမည်။
7. Reply ရွေးပြီး Cancel လုပ်ကာ စာသာပို့ကြည့်ပါ။ Message အသစ်တွင် reply ကိုးကားချက် မပါရပါ။
8. မတူသော trip/group သို့မဟုတ် account သို့ ပြောင်းကြည့်ပါ။ အရင် group/account ၏ reply ရွေးချယ်မှုနှင့် operation error တို့ မကျန်ရပါ။

Automated handler tests၊ Rules emulator tests နှင့် production build သည် သီးခြား verification များဖြစ်သည်။ ထိုစမ်းသပ်မှုများ အောင်မြင်ခြင်းက Cloud Rules publish ဖြစ်ပြီး အကောင့်အစစ်များဖြင့် အလုပ်လုပ်ပြီဟု အတည်ပြုခြင်း မဟုတ်ပါ။ Live အလုပ်လုပ်ကြောင်းကို အထက်ပါ account နှစ်ခုစမ်းသပ်မှုဖြင့် စစ်ပါ။
