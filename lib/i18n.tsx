'use client';

import { createContext, useContext, useEffect, useState } from 'react';

export type Language = 'ja' | 'en';
type Translator = (text: string) => string;
const LanguageContext = createContext<{ language: Language; setLanguage: (language: Language) => void; t: Translator } | null>(null);

const ja: Record<string, string> = {
  'Pack together, go further': 'みんなで準備して、もっと遠くへ', WORKSPACE: 'ワークスペース', 'Expand sidebar': 'サイドバーを展開', 'Collapse sidebar': 'サイドバーを折りたたむ', 'Log out': 'ログアウト', 'Signing out…': 'ログアウト中…', 'Could not log out. Please try again.': 'ログアウトできませんでした。もう一度お試しください。',
  'Overview': '概要', 'Packing list': '持ち物リスト', 'Bags & photos': 'バッグ・写真', 'Group chat': 'グループチャット', Reminders: 'リマインダー', Members: 'メンバー', Budget: '予算', 'Weather & AI': '天気・AI', History: '履歴',
  'Firebase connected mode': 'Firebase 接続中', 'Local demo mode': 'ローカルデモモード', 'Changes sync to Firestore': '変更は Firestore に同期されます', 'Data saved in this browser': 'データはこのブラウザーに保存されます',
  'YOUR NEXT ADVENTURE STARTS HERE': '次の冒険をここから始めよう', 'Trip overview': '旅行の概要', 'Packing checklist': '持ち物チェックリスト', 'Bags & item locations': 'バッグと荷物の場所', 'Trip group chat': '旅行グループチャット', 'Preparation reminders': '旅行準備リマインダー', 'Your travel crew': '旅行メンバー', 'Budget & expenses': '予算と支出', 'Weather & smart advice': '天気とおすすめ', 'Trip history': '旅行履歴',
  'New trip': '新しい旅行', 'No active trip': '旅行がありません', Dismiss: '閉じる', 'Ready to plan your next trip?': '次の旅行を計画しませんか？', 'Create a trip below to start your packing list.': '下から旅行を作成して、持ち物リストを始めましょう。',
  'PLAN': 'プラン', 'Open checklist': 'チェックリストを開く', 'Copy trip': '旅行をコピー', 'Packing progress': '荷造りの進捗', 'Still to buy': '購入が必要', 'items on your list': '個の持ち物', 'Total item weight': '荷物の合計重量', 'across all items': 'すべての持ち物', 'Purchased total': '購入済み合計', 'Pack your essentials': '必要な持ち物を準備', 'Check off items as your group gets ready.': '準備できた持ち物にチェックを付けましょう。', 'View all': 'すべて見る', 'Your group': 'グループ', travelers: '人の旅行者', 'Manage group members': 'メンバーを管理',
  'Everything you need to bring': '旅行に必要な持ち物', 'Track ownership, shopping, weight and responsibility.': '持っている物、購入状況、重さ、担当者を管理できます。', items: '個', 'Add an item, e.g. portable charger': '持ち物を追加（例：モバイルバッテリー）', 'Add item': '追加', Item: '持ち物', Status: '状態', 'Assigned to': '担当者', 'Weight (kg)': '重量 (kg)', 'Price (¥)': '価格 (¥)', Comment: 'メモ', 'Add note…': 'メモを追加…', 'Auto-assign unassigned': '未割り当てを自動で担当分け', 'Export CSV': 'CSV を書き出す',
  'Bag photos & item locations': 'バッグの写真と持ち物の場所', 'Choose a bag for each item, add a photo, then verify the packed bag.': '持ち物をバッグに割り当て、写真を追加して、荷造りを確認しましょう。', 'Bag names, photos and item locations sync with this trip chat.': 'バッグ名、写真、持ち物の場所を旅行チャットと同期します。', 'Connect to the group chat to sync bag details across members.': 'グループチャットに接続すると、メンバー間でバッグ情報を同期できます。', 'Bag name, e.g. Blue duffel': 'バッグ名（例：青いダッフルバッグ）', 'Add bag': 'バッグを追加', 'Add a bag to start organizing items by luggage.': 'バッグを追加して、持ち物を整理しましょう。', 'No photo yet': '写真はまだありません', 'Saving…': '保存中…', 'Retake bag photo': 'バッグを撮り直す', 'Take / choose photo': '写真を撮る／選ぶ', 'Final bag checked': '荷物の最終確認済み', 'Pocket / compartment': 'ポケット／収納場所', 'No items assigned to this bag yet.': 'このバッグに割り当てられた持ち物はありません。', 'Assign list items to a bag': '持ち物をバッグに割り当て', 'No bag': 'バッグなし',
  'Share this invite link with trip members to chat together.': '招待リンクを旅行メンバーに共有してチャットしましょう。', 'Your chat name': 'チャットでの名前', 'e.g. Han': '例：Han', 'Creating…': '作成中…', 'Create group chat': 'グループチャットを作成', 'Firebase sign-in is needed for members on different devices to share messages.': '別の端末のメンバーとチャットするには Firebase へのサインインが必要です。', 'Copy invite link': '招待リンクをコピー', 'Your name': 'あなたの名前', 'Write a message…': 'メッセージを書く…', 'Send message': 'メッセージを送信',
  'Set when your group starts preparing for the trip.': 'グループで旅行の準備を始める日を設定します。', 'Start preparing on': '準備を始める日', 'Browser notifications enabled': 'ブラウザー通知は有効です', 'Enable browser notifications': 'ブラウザー通知を有効にする', 'Preparation starts': '準備開始', 'Review the plan and buy': '計画を確認して、購入が必要なものを準備しましょう。', 'Day before departure': '出発前日', 'Pack and verify the bags.': '荷造りをして、バッグの中身を確認しましょう。', 'Trip departure': '出発日', 'Final check before leaving for': '出発前の最終確認：', 'Reminders appear in this app, and browser notifications fire on these dates while Motteku is open. Background reminders while the browser is closed need a deployed push-notification server.': 'リマインダーはアプリに表示されます。Motteku を開いている間は設定日にブラウザー通知も届きます。ブラウザーを閉じた状態で通知するには、プッシュ通知サーバーの導入が必要です。',
  'Travel crew': '旅行メンバー', 'Add members and assign items fairly.': 'メンバーを追加して、持ち物を公平に担当分けします。', 'Member name': 'メンバー名', 'Add member': 'メンバーを追加', 'Auto-assign unassigned items': '未割り当ての持ち物を自動で担当分け', 'Load balance': '荷物の分担', 'Compare how much each person carries.': '各メンバーの荷物の重さを比べます。', 'The auto-assign tool distributes only unassigned items. You can manually change assignments to balance weight more accurately.': '自動割り当てでは未割り当ての持ち物だけを分配します。重さを均等にするには担当者を手動で変更してください。',
  'Trip budget': '旅行の予算', 'Track planned budget and purchased items.': '予算と購入済みの持ち物を管理します。', 'Group budget (¥)': 'グループ予算 (¥)', 'Total purchased items': '購入済み持ち物の合計', 'Budget remaining': '予算の残り', 'Equal share per member': '1人あたりの均等負担額', 'Purchased total counts the price of items marked “Purchased” or “Packed”. Mark an item as Purchased after buying it.': '「購入済み」または「バッグに入れた」とした持ち物の価格を合計します。購入後に状態を「購入済み」にしてください。', 'Expense log': '支出記録', 'Record who paid for shared purchases.': '共同購入の支払者を記録します。', 'Expense name': '支出項目', 'Amount (¥)': '金額 (¥)', 'Paid by…': '支払った人…', Add: '追加', 'No expenses recorded yet. Add a purchase above.': '支出はまだありません。上から購入を記録してください。', 'Equal split summary': '均等割りの概要', 'Paid by': '支払者：', 'Gets back': '受け取り：', Owes: '支払い：',
  'Destination forecast': '目的地の天気予報', 'Weather helps your group pack smarter.': '天気を確認して、必要な持ち物を準備しましょう。', 'Destination or city': '目的地または都市', 'Get 7-day forecast': '7日間の天気を確認', 'Weather is provided by Open-Meteo. Forecasts may not cover the entire trip if it is more than 7 days away.': '天気情報は Open-Meteo が提供します。出発まで7日を超える場合、旅行全期間の予報は表示されないことがあります。', 'AI packing advice': 'AI の持ち物アドバイス', 'Get suggestions based on your trip and forecast.': '旅行内容と天気予報に合わせた提案を受け取れます。', 'Your trip, thoughtfully packed': '旅行に合わせた持ち物を提案', 'Suggestions adapt to trip type, destination and forecast when available.': '旅行の種類、目的地、天気予報に合わせて提案します。', 'Generate suggestions': '提案を作成', Recommendation: 'おすすめ', 'Suggested items': 'おすすめの持ち物', 'Things to remember': '注意事項', 'If no Gemini key is configured, Motteku uses simple built-in suggestions. Add GEMINI_API_KEY in .env.local to enable Gemini.': 'Gemini キーが設定されていない場合は、Motteku の標準提案を使用します。Gemini を有効にするには .env.local に GEMINI_API_KEY を追加してください。',
  'Past trips': '過去の旅行', 'Copy a previous packing list and reuse it.': '過去の持ち物リストをコピーして再利用できます。', 'Completed trips will appear here when you finish a trip.': '旅行を終了すると、ここに表示されます。', 'Reuse list': 'リストを再利用', 'Create a new trip': '新しい旅行を作成', 'Start with a template, then customize the checklist.': 'テンプレートから始めて、チェックリストを編集しましょう。', 'Trip name': '旅行名', 'Trip type': '旅行の種類', Destination: '目的地', 'Start date': '出発日', 'End date': '帰着日', 'e.g. Summer beach trip': '例：夏のビーチ旅行', 'Create trip from template': 'テンプレートから旅行を作成', 'Made for groups who want to spend less time packing and more time exploring.': '荷造りの時間を減らして、旅をもっと楽しみたいグループのために。', 'Motteku · Prototype': 'Motteku · プロトタイプ', Loading: '読み込み中',
  'Owned': '所持', 'Need to buy': '購入が必要', Purchased: '購入済み', Packed: 'バッグに入れた', Unassigned: '未割り当て', General: '一般',
  packed: '荷造り済み', budget: '予算', rain: '雨', 'Trip details': '旅行の詳細', 'Loading Motteku…': 'Motteku を読み込み中…',
  'Keep the essentials in one place.': '旅行の大切な情報をまとめて管理しましょう。', 'Group size': 'グループ人数', 'Budget per person': '1人あたりの予算', members: '人',
  Camping: 'キャンプ', 'Overseas travel': '海外旅行', Beach: 'ビーチ', Hiking: 'ハイキング', 'School event': '学校行事',
  Clear: '快晴', 'Partly cloudy': '晴れ時々くもり', Fog: '霧', Rain: '雨', Snow: '雪', 'Rain showers': 'にわか雨', Thunderstorm: '雷雨', Mixed: '変わりやすい天気',
  'Review the plan and buy the remaining items.': '計画を確認し、必要な持ち物を購入しましょう。', 'Pack and verify the bags before departure.': '出発前に荷造りをして、バッグの中身を確認しましょう。', 'Final check before leaving for this trip.': '出発前の最終確認をしましょう。',
  'Image conversion failed': '画像を変換できませんでした', 'Could not read image': '画像を読み込めませんでした', 'Bag photo saved.': 'バッグの写真を保存しました。', 'Photo could not be saved. Check Firebase Storage rules or browser storage space.': '写真を保存できませんでした。Firebase Storage のルールまたはブラウザーの保存容量を確認してください。',
  'This browser does not support notifications.': 'このブラウザーは通知に対応していません。', 'Notifications enabled. Keep Motteku open to receive reminders.': '通知を有効にしました。リマインダーを受け取るには Motteku を開いたままにしてください。', 'Notification permission was not granted.': '通知の許可がありません。',
  'Bag photo could not sync.': 'バッグの写真を同期できませんでした。',
  'Firebase sign-in failed. Check that Anonymous Authentication is enabled.': 'Firebase にサインインできません。匿名認証が有効か確認してください。', 'Firebase access was denied. Using local demo mode; publish firestore.rules in the matching Firebase project to restore cloud sync.': 'Firebase へのアクセスが拒否されました。ローカルデモモードで動作しています。同期するには該当する Firebase プロジェクトに firestore.rules を公開してください。', 'Trip created with a starter checklist.': '旅行を作成し、持ち物チェックリストを追加しました。', 'Unassigned items were distributed across members.': '未割り当ての持ち物をメンバーに分配しました。', 'Trip copied. Item statuses reset for the new trip.': '旅行をコピーしました。新しい旅行では持ち物の状態をリセットしました。', 'Trip moved to history.': '旅行を履歴に移動しました。', 'Select trip': '旅行を選択', Language: '言語', Japanese: '日本語', English: 'English', 'Delete item': '持ち物を削除',
  'TRAVEL TOGETHER': 'みんなで旅しよう',
  'Welcome back': 'おかえりなさい',
  'Create your Motteku account': 'Motteku アカウントを作成',
  'Create an account to keep your trip plans with you.': '旅行の計画を保存するアカウントを作成しましょう。',
  'Log in to continue planning with your group.': 'ログインして、グループの旅行計画を続けましょう。',
  'Full name': '氏名',
  'Email address': 'メールアドレス',
  Password: 'パスワード',
  'At least 6 characters': '6文字以上',
  'Create account': 'アカウントを作成',
  'Please wait…': '処理中…',
  'Already have an account?': 'すでにアカウントをお持ちですか？',
  "Don't have an account?": 'アカウントをお持ちでないですか？',
  Register: '新規登録',
  'Back to Motteku': 'Motteku に戻る',
  'Your group trip data stays in your account.': 'グループ旅行のデータはアカウントに保存されます。',
  'Firebase Authentication is not configured. Check your Firebase project settings.': 'Firebase Authentication が設定されていません。Firebase プロジェクトの設定を確認してください。',
  'Enter a valid email address.': '正しいメールアドレスを入力してください。',
  'The email or password is incorrect.': 'メールアドレスまたはパスワードが正しくありません。',
  'No account was found for this email.': 'このメールアドレスのアカウントが見つかりません。',
  'An account already exists with this email.': 'このメールアドレスはすでに登録されています。',
  'Use a password with at least 6 characters.': 'パスワードは6文字以上で入力してください。',
  'Email and password sign-in is not enabled in Firebase.': 'Firebase でメールとパスワードによるログインが有効になっていません。',
  'This email already belongs to another account. Log in instead.': 'このメールアドレスは別のアカウントで使用されています。ログインしてください。',
  'Too many attempts. Please wait and try again.': '試行回数が多すぎます。しばらくしてからもう一度お試しください。',
  'Could not connect. Check your internet connection.': '接続できません。インターネット接続を確認してください。',
  'Notifications': '通知',
  'Close notifications': '通知を閉じる',
  'Mark all as read': 'すべて既読にする',
  'Item deadline': '持ち物の準備期限',
  'Overdue': '期限切れ',
  'Upcoming reminders for the next 7 days and overdue tasks.': '今後7日間の予定と、期限を過ぎた準備を表示します。',
  'No notifications. You are all caught up!': '通知はありません。すべて確認済みです。',
  'Something went wrong. Please try again.': 'エラーが発生しました。もう一度お試しください。',
};

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguageState] = useState<Language>('ja');
  useEffect(() => {
    const saved = localStorage.getItem('motteku-language');
    if (saved === 'ja' || saved === 'en') setLanguageState(saved);
  }, []);
  useEffect(() => { document.documentElement.lang = language; }, [language]);
  const setLanguage = (next: Language) => { setLanguageState(next); localStorage.setItem('motteku-language', next); };
  const t: Translator = (text) => language === 'ja' ? (ja[text] || text) : text;
  return <LanguageContext.Provider value={{ language, setLanguage, t }}>{children}</LanguageContext.Provider>;
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (!context) throw new Error('useLanguage must be used within LanguageProvider');
  return context;
}
