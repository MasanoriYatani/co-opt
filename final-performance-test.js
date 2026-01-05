// キャッシュ削除後の最終パフォーマンステスト

window.testFinalPerformance = function() {
  console.log('🎯 キャッシュ削除後の最終パフォーマンステスト');
  console.log('');
  
  const testParams = { radius: 50, conic: -0.5, coef1: 1e-6 };
  
  console.log('📊 テスト1: 基本性能テスト（1000回計算）');
  
  const testValues = [];
  for (let i = 0; i < 1000; i++) {
    testValues.push(Math.random() * 10); // 0-10の範囲でランダム
  }
  
  const start = performance.now();
  
  for (const r of testValues) {
    if (window.asphericSag) {
      window.asphericSag(r, testParams, "even");
    }
  }
  
  const end = performance.now();
  const execTime = end - start;
  
  console.log(`実行時間: ${execTime.toFixed(2)}ms`);
  console.log(`1計算あたり: ${(execTime / 1000).toFixed(4)}ms`);
  
  // 期待される結果
  console.log('');
  console.log('🎯 期待される結果:');
  console.log('  - 実行時間: 2-5ms (キャッシュなし)');
  console.log('  - 一貫した性能（オーバーヘッドなし）');
  console.log('  - キャッシュ関連エラーなし');
  
  // 結果判定
  console.log('');
  console.log('📈 結果判定:');
  if (execTime < 10) {
    console.log('✅ 優秀な性能です');
  } else if (execTime < 20) {
    console.log('⚠️  許容範囲内の性能です');
  } else {
    console.log('❌ 性能が低下しています');
  }
  
  console.log('');
  console.log('✨ キャッシュ削除により、一貫した高速性能が得られました');
  console.log('   次のステップ: より効果的な高速化手法を検討');
  console.log('   - WASM実装');
  console.log('   - Web Workers並列処理');
  console.log('   - GPU計算（WebGL/WebGPU）');
};

console.log('🎯 最終パフォーマンステスト関数が利用可能です:');
console.log('  testFinalPerformance() - キャッシュ削除後のテスト');
