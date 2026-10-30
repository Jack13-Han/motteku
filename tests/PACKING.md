# 持ち物管理の確認

## 自動チェック

```powershell
node --experimental-strip-types --test tests/packing.test.mjs
npm run build
npx --yes --package firebase-tools firebase emulators:exec --only firestore --project demo-motteku --config firebase.packing-test.json "node tests/packing-rules.mjs"
```

RulesテストはJavaとFirebase CLIを使用します。ローカルのFirestoreエミュレーター専用で、本番データは使用しません。

## 画面での確認

1. Firebaseの設定を `.env.local` に設定し、対象プロジェクトに `firestore.rules` を反映します。Firebase未設定の場合はブラウザ内保存のデモになります。
2. 旅行のMembersに5人、Bags & photosにバッグを追加します。
3. Packing listの「メンバー・バッグ・権限の設定」で旅行のメンバー・バッグを反映します。
4. 「ハイキングシューズ」を個人用・全員・未準備で登録し、5人分の状態が表示されることを確認します。
5. 1人だけ「準備済み」に変更すると1/5人、もう1人を変更すると2/5人になり、他の人の状態は変わりません。
6. Packedが2人、準備済みが1人、未準備が2人なら、準備完了は3/5人、バッグに入れた人数は2/5人です。未準備の2人の名前が表示されます。
7. 全員を「バッグに入れた」に変更した場合だけ「全員準備完了」が表示されます。
8. 「テント」を共有用・必要数2で登録し、それぞれ別の担当者・状態・バッグを設定します。各個の状態が独立して更新されることを確認します。
9. グループチャットを作成し、別アカウントを参加させます。共有先で「共有前の持ち物をコピー」を行い、メンバーとアカウントを紐づけます。本人は自分の行だけ、作成者・管理者は全員の行を変更できることを確認します。
10. 再読み込みし、状態とバッグが復元されることを確認します。Firestoreの保存先は `packingTrips/{共有ルームID または UID_旅行ID}/items` と `itemAssignments` です。

登録時の対象メンバーは固定です。後から旅行に参加者を追加しても、登録済みアイテムの対象者は自動変更しません。
