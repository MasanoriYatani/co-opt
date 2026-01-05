// 高速化ヒット率テスト

window.testCacheHitRate = async function() {
  console.log('🎯 キャッシュヒット率改善テスト');
  
  // キャッシュをクリアして再有効化
  if (window.clearCache) window.clearCache();
  if (window.enableCache) window.enableCache();
  
  const testParams = { radius: 50, conic: -0.5, coef1: 1e-6 };
  
  console.log('📊 テスト1: 精度を下げたキー生成によるヒット率向上');
  
  // 似たような値での計算テスト
  const testValues = [];
  for (let i = 0; i < 100; i++) {
    // 小さな変動を含む値
    testValues.push(1.0 + (Math.random() - 0.5) * 0.01); // ±0.005の範囲
  }
  
  console.log('🔍 100個の似た値でのテスト（精度下げによるヒット期待）');
  const start = performance.now();
  
  for (const r of testValues) {
    if (window.asphericSag) {
      window.asphericSag(r, testParams, "even");
    }
  }
  
  const end = performance.now();
  console.log(`実行時間: ${(end - start).toFixed(2)}ms`);
  
  // キャッシュ統計確認
  if (window.displayCacheStats) {
    window.displayCacheStats();
  }
  
  console.log('📊 テスト2: 完全に同じ値での重複計算テスト');
  const sameValue = 1.5;
  const duplicateStart = performance.now();
  
  for (let i = 0; i < 1000; i++) {
    if (window.asphericSag) {
      window.asphericSag(sameValue, testParams, "even");
    }
  }
  
  const duplicateEnd = performance.now();
  console.log(`重複計算時間: ${(duplicateEnd - duplicateStart).toFixed(2)}ms`);
  
  // 最終キャッシュ統計
  if (window.displayCacheStats) {
    console.log('\n📊 最終キャッシュ統計:');
    window.displayCacheStats();
  }
};

// 光線描画の実際の負荷テスト
window.testRealWorldPerformance = async function() {
  console.log('🌍 実際の光線描画パフォーマンステスト');
  
  // キャッシュ無効化テスト
  console.log('\n📊 テスト1: キャッシュ無効化');
  if (window.disableCache) window.disableCache();
  
  const testStart1 = performance.now();
  // 実際の光線描画相当の計算を模擬
  for (let i = 0; i < 1000; i++) {
    const r = Math.random() * 10; // 0-10の範囲
    const params = {
      radius: 50 + Math.random() * 10, // 面ごとに異なるパラメータ
      conic: -0.5 + Math.random() * 0.1,
      coef1: 1e-6,
      semidia: 10
    };
    if (window.asphericSag) {
      window.asphericSag(r, params, "even");
    }
  }
  const testEnd1 = performance.now();
  const noCacheTime = testEnd1 - testStart1;
  
  console.log(`キャッシュなし: ${noCacheTime.toFixed(2)}ms`);
  
  // キャッシュ有効化テスト
  console.log('\n📊 テスト2: キャッシュ有効化（改善版）');
  if (window.enableCache) window.enableCache();
  
  const testStart2 = performance.now();
  // 同じ計算を実行
  for (let i = 0; i < 1000; i++) {
    const r = Math.random() * 10;
    const params = {
      radius: 50 + Math.random() * 10,
      conic: -0.5 + Math.random() * 0.1,
      coef1: 1e-6,
      semidia: 10
    };
    if (window.asphericSag) {
      window.asphericSag(r, params, "even");
    }
  }
  const testEnd2 = performance.now();
  const cacheTime = testEnd2 - testStart2;
  
  console.log(`キャッシュあり: ${cacheTime.toFixed(2)}ms`);
  
  // 結果分析
  const speedup = noCacheTime / cacheTime;
  console.log(`\n📈 結果分析:`);
  console.log(`高速化倍率: ${speedup.toFixed(2)}x`);
  
  if (speedup > 1.2) {
    console.log('✅ キャッシュが効果的です');
  } else if (speedup < 0.9) {
    console.log('❌ キャッシュがオーバーヘッドになっています');
  } else {
    console.log('⚠️  キャッシュの効果は限定的です');
  }
  
  // キャッシュ統計
  if (window.displayCacheStats) {
    console.log('\n📊 最終キャッシュ統計:');
    window.displayCacheStats();
  }
};

console.log('🎯 新しいテスト関数が利用可能です:');
console.log('  testCacheHitRate() - ヒット率改善テスト');
console.log('  testRealWorldPerformance() - 実際の負荷テスト');
