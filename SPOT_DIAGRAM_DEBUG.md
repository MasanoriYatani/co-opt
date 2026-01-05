## スポットダイアグラム表示トラブルシューティング

### 修正内容
1. ✅ イベントハンドラーに `await` キーワードを追加（async/await 対応）
2. ✅ エラー処理を改善（エラーが画面と alert で表示されるように）
3. ✅ コンソールログを最適化（デバッグ情報を減らして処理速度向上）

### テスト手順

#### 1. ブラウザのコンソールを開く
- Chrome: F12 キー → Console タブ
- Safari: Cmd+Option+I → Console タブ

#### 2. スポットダイアグラム設定を確認
- **Ray count**: 501（デフォルト）
- **Surface**: 最後の面（Image surface）
- **Ring count**: 3 以上（1-32 で選択可能）

#### 3. "Show spot diagram" ボタンをクリック

#### 4. 以下のいずれかが起こるはずです

**成功の場合:**
```
🎯 Starting spot diagram generation...
📊 Using surface from select: ...
✅ Spot diagram generated successfully
🎨 [SPOT DIAGRAM] Drawing spot diagram...
```
→ スポットダイアグラムが画面に表示される

**エラーが発生した場合:**
```
❌ Error generating spot diagram: [エラーメッセージ]
```
→ alert ボックスにエラーメッセージが表示される
→ spot-diagram-container にエラーメッセージが表示される

### よくある問題と対処法

#### 問題1: "No valid spot data" エラー
**原因**: レイトレーシングが失敗している
**対処**:
- 光学系データが正しくロードされているか確認
- オブジェクトテーブルにデータが存在するか確認
- Ray count を 101 に減らしてみる

#### 問題2: 長時間処理が完了しない
**原因**: Ray count が大きすぎる、または複雑な光学系
**対処**:
- Ray count を 101 に減らす
- Surface 選択を変更（別の面を評価）
- ブラウザを再読み込み

#### 問題3: Plotly が見つからない
**原因**: CDN から Plotly がロードできない
**対処**:
- ネットワーク接続を確認
- コンソールで以下を実行:
  ```javascript
  console.log(typeof window.Plotly);
  ```
  "function" が表示されれば OK
  "undefined" が表示されれば Plotly がロードされていない

### コンソールコマンドでのテスト

```javascript
// 1. Plotly の確認
console.log('Plotly available:', typeof window.Plotly !== 'undefined');

// 2. コンテナの確認
console.log('Container:', document.getElementById('spot-diagram-container'));

// 3. テストプロット（手動でスポットダイアグラムを描画）
const testData = {
    spotData: [{
        objectId: 'Test',
        objectType: 'Point',
        spotPoints: [
            { x: -0.001, y: -0.001 },
            { x: 0, y: 0 },
            { x: 0.001, y: 0.001 }
        ]
    }]
};

const { drawSpotDiagram } = await import('./eva-spot-diagram.js');
await drawSpotDiagram(testData, 1, 'spot-diagram-container');
```

### ネクストステップ
1. 上記テスト手順を実行
2. コンソール出力を記録
3. エラーメッセージがあれば報告
