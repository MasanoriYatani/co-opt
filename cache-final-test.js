// 最終的なキャッシュ問題対応のテスト

// 問題の確認・解決手順:
console.log('🔧 キャッシュ問題対応ガイド');
console.log('');

console.log('📊 実行すべきテスト:');
console.log('1. testRealWorldPerformance() - 実際のパフォーマンステスト');
console.log('2. testCacheHitRate() - ヒット率改善テスト');
console.log('3. displayCacheStats() - キャッシュ統計確認');
console.log('');

console.log('❌ 現在の問題:');
console.log('  - キャッシュヒット率: 15.6% (789,693ミス / 145,767ヒット)');
console.log('  - 高精度キー生成によるキャッシュエントリの重複不足');
console.log('  - キャッシュオーバーヘッドが処理時間を増加させている');
console.log('');

console.log('🔧 実装済み対応:');
console.log('  - 精度を1e6から1e3に削減 (generateKey関数)');
console.log('  - キャッシュサイズを1000から5000に増加');
console.log('  - LRUアルゴリズムの効率化（一括削除）');
console.log('');

console.log('📈 期待される改善:');
console.log('  - ヒット率向上: 15.6% → 40-60%');
console.log('  - 処理時間短縮: +∞% → -50%～-80%（2-5倍高速化）');
console.log('  - キャッシュエントリの重複増加');
console.log('');

console.log('⚠️  もしキャッシュ効果がない場合:');
console.log('  - disableCache() でキャッシュを無効化');
console.log('  - 他の高速化手法（WASM、Web Workers）を検討');
console.log('');

console.log('🎯 今すぐテスト:');
console.log('  testRealWorldPerformance() を実行してください');
console.log('');

console.log('🤖 WASM診断:');
console.log('  diagnoseWASM() - WASM システム診断');
console.log('  quickDiagnosis() - キャッシュ診断');
console.log('');

console.log('🔗 代替テスト方法:');
console.log('  - simple-wasm-benchmark.html でスタンドアローンテスト');
console.log('  - メインアプリのコンソールで runWASMComparison()');
console.log('  - 🔥 Test WASM ボタンでGUIテスト');

// 簡易診断関数
window.quickDiagnosis = function() {
  console.log('⚡ クイック診断を実行中...');
  
  // キャッシュを一度クリアして再有効化
  if (window.clearCache) window.clearCache();
  if (window.enableCache) window.enableCache();
  
  // 100回の計算で基本テスト
  const testParams = { radius: 50, conic: -0.5, coef1: 1e-6 };
  
  console.log('🔍 100回計算での基本テスト');
  const start = performance.now();
  
  for (let i = 0; i < 100; i++) {
    const r = 1.0 + (i % 10) * 0.1; // 0.1刻みで10種類の値を循環
    if (window.asphericSag) {
      window.asphericSag(r, testParams, "even");
    }
  }
  
  const end = performance.now();
  console.log(`実行時間: ${(end - start).toFixed(2)}ms`);
  
  // 統計表示
  if (window.displayCacheStats) {
    window.displayCacheStats();
  }
  
  // 簡易判定
  const stats = window.sagCache ? window.sagCache.getStats() : null;
  if (stats) {
    const hitRate = (stats.hits / (stats.hits + stats.misses)) * 100;
    console.log(`\n📊 結果: ヒット率 ${hitRate.toFixed(1)}%`);
    
    if (hitRate > 50) {
      console.log('✅ キャッシュ効果は良好です');
    } else if (hitRate > 20) {
      console.log('⚠️  キャッシュ効果は限定的です');
    } else {
      console.log('❌ キャッシュ効果が低すぎます');
    }
  }
};

// WASM診断関数
window.diagnoseWASM = function() {
  console.log('🤖 WASM診断を実行中...');
  
  // Module availability check
  console.log('\n📦 WASM Module状況:');
  console.log(`   Module defined: ${typeof Module !== 'undefined'}`);
  console.log(`   Module.ready: ${typeof Module !== 'undefined' && Module.ready ? 'available' : 'not available'}`);
  console.log(`   ForceWASMSystem: ${typeof ForceWASMSystem !== 'undefined'}`);
  console.log(`   getWASMSystem function: ${typeof getWASMSystem !== 'undefined'}`);
  
  // Try to get WASM system
  if (typeof getWASMSystem === 'function') {
    try {
      const wasmSystem = getWASMSystem();
      console.log(`   WASM System: ${wasmSystem ? 'available' : 'not available'}`);
      if (wasmSystem) {
        console.log(`   WASM Ready: ${wasmSystem.isWASMReady ? 'yes' : 'no'}`);
        
        // Test calculation
        try {
          const testResult = wasmSystem.forceAsphericSag(1.0, 0.05, -0.5, 1e-6);
          console.log(`   Test calculation: ${testResult} (${typeof testResult})`);
          console.log('✅ WASM システムは正常に動作しています');
        } catch (calcError) {
          console.log(`❌ WASM計算テストでエラー: ${calcError.message}`);
        }
      }
    } catch (error) {
      console.log(`❌ WASMシステム取得でエラー: ${error.message}`);
    }
  } else {
    console.log('⚠️  getWASMSystem function not found');
  }
  
  // Alternative WASM check
  if (typeof Module !== 'undefined' && Module._aspheric_sag) {
    try {
      const directResult = Module._aspheric_sag(1.0, 0.05, -0.5, 1e-6, 0, 0, 0);
      console.log(`   Direct WASM test: ${directResult}`);
      console.log('✅ Direct WASMアクセス可能');
    } catch (directError) {
      console.log(`❌ Direct WASMアクセスでエラー: ${directError.message}`);
    }
  }
  
  // Summary and recommendation
  console.log('\n💡 推奨アクション:');
  if (typeof getWASMSystem === 'function' && getWASMSystem() && getWASMSystem().isWASMReady) {
    console.log('   ✅ WASM準備完了 - runWASMComparison() で性能テスト実行可能');
  } else if (typeof Module !== 'undefined' && Module._aspheric_sag) {
    console.log('   ⚠️  直接WASM利用可能 - simple-wasm-benchmark.html を試してください');
  } else {
    console.log('   ❌ WASM利用不可 - ray-tracing-wasm-v3.js の読み込みを確認してください');
  }
};
