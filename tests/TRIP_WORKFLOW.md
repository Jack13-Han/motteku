# Draft作成・招待・確定・持ち物生成

## 画面と利用手順

- `/trips`：自分が参加している旅行一覧と招待コード入力
- `/trips/new`：旅行名、タイプ、目的地、日付、予定人数、説明を入力してDraftを作成
- `/trips/{tripId}`：招待発行、参加人数、メンバーと権限、メンバー確定、持ち物とバッグの管理
- `/join/{inviteId}`：招待に限定した旅行概要を確認し、明示的に参加

トップの「新しい旅行」と「参加している旅行」から新しいフローに進めます。従来の個人ワークスペース、チャット、履歴、デモ作成は残しています。従来の旅行を新しい共有旅行へ移行する処理は実行しません。

1. Firebase Authenticationのメール／パスワード認証を有効にし、`.env.example` に合わせて `.env.local` を設定します。更新した `firestore.rules` を対象の開発用Firebaseプロジェクトへ反映します。
2. ログインし、5人予定の旅行を作成します。状態はDraft、Ownerと参加人数1人が自動登録されます。
3. 招待を作成します。16文字のランダムコードを4文字ずつ表示し、リンクは `/join/{inviteId}` になります。期限は7日、使用上限は99回、旅行全体の参加上限は100人です。予定人数は上限ではありません。
4. 別のブラウザプロファイルで招待を開きます。未認証ならログイン画面へ進み、新規登録へ切り替えても元の招待確認画面に戻ります。匿名デモ認証では参加できません。
5. 旅行の概要を確認し「参加する」を押します。同じアカウントの重複参加は作成されません。
6. Owner側で予定人数と参加人数を確認し、「メンバーを確定する」を押します。予定人数未満でも、実人数を明示した確認後に生成できます。
7. 持ち物を個人用・共有用に分けて表示します。個人用は各ユーザー自身の行、共有用は各個の担当者が状態・バッグを変更できます。Owner/Adminは全員の状態と担当者を管理できます。
8. バッグ名を追加し、個人用・共有用の各Assignmentに選択します。
9. 確定後に新しいユーザーを招待します。参加人数だけが増え、持ち物はその場では変更されません。Owner/Adminがプレビューで数量・追加行を確認し「再計算する」を押した場合だけ更新されます。
10. 再読み込みして復元、日本語／English切り替え、スマートフォン幅でのフォーム・招待表示を確認します。

招待の再発行は以前のリンク／コードを無効にします。「招待を無効にする」や旅行の終了後も、その招待で新しいユーザーは参加できません。

## Firestore構造

```text
trips/{tripId}
  tripMembers/{uid}
tripInvitations/{inviteId}
users/{uid}/tripMemberships/{tripId}
packingTrips/{tripId}
  members/{uid}
  items/{itemId}
  itemAssignments/{assignmentId}
```

`trips` は状態コード、予定人数、Owner情報、確定済みメンバーID、持ち物生成の完了フラグを持ちます。参加人数は旅行画面では `tripMembers` の実レコード数で表示します。招待確認にはメンバー以外から旅行本体を読ませず、旅行名・目的地・期間・Owner名・人数だけのprojectionを招待に保存します。

`joinedMemberCount` と招待projectionの人数は手入力できません。新しいUIDの `tripMembers` 作成、招待使用回数、人数のサーバー側加算を同じFirestore Transactionで実行し、Rulesで `getAfter` による整合性を確認します。同じUIDはドキュメントIDが固定され、二重参加できません。

確定済みの名簿は `confirmedMemberIds` として参加者一覧から分離しています。新規参加はこの値と持ち物を変更しません。Ownerによる初回確定、またはOwner/Adminによる再計算確認後に更新します。数量とAssignmentには既存の `per_person`／`fixed`／`capacity` 計算を再利用します。

既存の `packingTrips` には任意の `managedTripId` を追加し、新フローの場合だけ `trips` のメンバー・Role・確定済み名簿を権限の基準にします。従来のデータでは既存のルールを維持します。

## 主な追加・変更ファイル

- 型・処理：`lib/trips.ts`、`lib/tripService.ts`、`lib/useTrips.ts`
- 画面：`app/trips/`、`app/join/`、`components/TripCreateForm.tsx`、`TripDirectory.tsx`、`TripJoin.tsx`、`TripWorkspace.tsx`、`TripWorkflowFrame.tsx`
- 接続：`app/page.tsx`、`components/AuthForm.tsx`、`TripPacking.tsx`、`lib/packing.ts`、`packingTemplates.ts`
- UI：`components/ui/button.tsx`、`lib/utils.ts`、`components.json`、`postcss.config.mjs`、`app/globals.css`、依存設定
- 翻訳：`lib/messages-trips.ts`、`lib/messages.ts`
- 権限：`firestore.rules`

Tailwind CSSは既存デザインを維持するためテーマとutilitiesだけを読み込み、Preflightで既存画面をリセットしません。shadcn/ui形式のButtonを新画面で使用します。

## 自動テスト

```powershell
node --experimental-strip-types --test tests/trips.test.mjs tests/packing.test.mjs tests/quantity.test.mjs
node --test tests/i18n.test.cjs
npx --yes --package firebase-tools firebase emulators:exec --only firestore --project demo-motteku --config firebase.packing-test.json "node tests/run-emulator.cjs"
npm run build
```

エミュレーターでは実際のFirebase SDKを使用し、DraftとOwnerの作成、同時参加、同一UIDの同時二重参加、私的な旅行情報へのアクセス拒否、Role変更、招待期限・上限・再発行・無効化、初回確定のOwner制限、共有用担当者とバッグ、参加追加だけでは数量が変わらないこと、確認後の状態保持、終了後の更新拒否を検証します。認証トークンはローカルテスト用で、本番プロジェクトは使用しません。

## 運用上の境界

- 本番Rulesのデプロイと、実アカウントによるブラウザ上のメール認証・招待復帰は別途確認が必要です。
- メンバー除名・脱退と既存旅行の移行は、新しい共有旅行フローには追加していません。Roleの変更はOwnerだけが実行できます。
- メンバー確定と持ち物生成は別段階です。多数のAssignmentは小さいトランザクションで保存し、途中失敗時は「生成を再開」から既存チェックを保持して再試行できます。
- 招待時に参加者が増えた場合も、確定済みの名簿と数量は確認前に変更しません。予定人数の超過は許可し、参加人数は実際の名簿で管理します。
