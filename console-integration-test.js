// 🎯 OptimalAsphericCalculator 統合テスト用コンソールコマンド集

/**
 * 基本統合確認 - コンソールで実行
 */
async function quickIntegrationTest() {
  console.log('🚀 クイック統合テスト開始');
  
  try {
    // メインアプリケーションの統合確認
    if (typeof verifyIntegration === 'function') {
      const result = verifyIntegration();
      console.log('✅ verifyIntegration()結果:', result);
    } else {
      console.log('⚠️ verifyIntegration関数が見つかりません');
    }
    
    // testOptimalCalculator確認
    if (typeof testOptimalCalculator === 'function') {
      console.log('🎯 testOptimalCalculator実行中...');
      const result = await testOptimalCalculator();
      console.log('✅ testOptimalCalculator結果:', result);
    } else {
      console.log('⚠️ testOptimalCalculator関数が見つかりません');
    }
    
    // OptimalAsphericCalculator直接テスト
    if (typeof OptimalAsphericCalculator !== 'undefined') {
      console.log('🔧 OptimalAsphericCalculator直接テスト');
      const calc = new OptimalAsphericCalculator();
      await calc.initialize();
      
      const result = await calc.calculateAsphericSag([1, 2, 3], -0.5, [0.01, 0.02]);
      console.log('✅ 直接計算結果:', result);
      console.log('📊 統計:', calc.getPerformanceStats());
    }
    
    console.log('🎉 クイック統合テスト完了');
    
  } catch (error) {
    console.error('❌ エラー:', error.message);
    console.error(error);
  }
}

/**
 * パフォーマンステスト - コンソールで実行
 */
async function performanceIntegrationTest() {
  console.log('🚀 パフォーマンス統合テスト開始');
  
  try {
    if (typeof OptimalAsphericCalculator === 'undefined') {
      console.log('❌ OptimalAsphericCalculatorが利用できません');
      return;
    }
    
    const calc = new OptimalAsphericCalculator();
    await calc.initialize();
    
    console.log(`戦略: ${calc.getActiveStrategy()}`);
    
    const testSizes = [10, 100, 1000, 10000];
    const results = [];
    
    for (const size of testSizes) {
      console.log(`📊 ${size}要素テスト中...`);
      const testData = Array.from({length: size}, (_, i) => i * 0.001);
      
      const result = await calc.calculateAsphericSag(testData, -0.5, [0.01, 0.02, 0.03, 0.04]);
      const throughput = size / result.time * 1000;
      
      results.push({
        size,
        strategy: result.strategy,
        time: result.time,
        throughput: Math.round(throughput)
      });
      
      console.log(`   ${result.strategy}: ${result.time}ms (${Math.round(throughput)} calc/sec)`);
    }
    
    console.table(results);
    console.log('📊 最終統計:', calc.getPerformanceStats());
    console.log('🎉 パフォーマンステスト完了');
    
    return results;
    
  } catch (error) {
    console.error('❌ エラー:', error.message);
    console.error(error);
  }
}

/**
 * 統合状態診断 - コンソールで実行
 */
function diagnosticIntegrationStatus() {
  console.log('🔍 OptimalAsphericCalculator 統合状態診断');
  
  const status = {
    OptimalAsphericCalculator: typeof OptimalAsphericCalculator !== 'undefined',
    ForceWASMSystem: typeof ForceWASMSystem !== 'undefined',
    verifyIntegration: typeof verifyIntegration === 'function',
    testOptimalCalculator: typeof testOptimalCalculator === 'function',
    asphericSag: typeof asphericSag === 'function',
    optimalCalculator: typeof optimalCalculator !== 'undefined'
  };
  
  console.log('📋 利用可能な機能:');
  Object.entries(status).forEach(([key, available]) => {
    console.log(`   ${key}: ${available ? '✅' : '❌'}`);
  });
  
  if (typeof optimalCalculator !== 'undefined' && optimalCalculator) {
    console.log('📊 現在の統計:');
    try {
      const stats = optimalCalculator.getPerformanceStats();
      console.table(stats);
    } catch (error) {
      console.log('   統計取得エラー:', error.message);
    }
  }
  
  // 推奨コマンド表示
  console.log('\n💡 推奨テストコマンド:');
  console.log('   quickIntegrationTest()     - 基本統合テスト');
  console.log('   performanceIntegrationTest() - パフォーマンステスト');
  console.log('   diagnosticIntegrationStatus() - 状態診断');
  
  if (status.verifyIntegration) {
    console.log('   verifyIntegration()        - 統合確認');
  }
  if (status.testOptimalCalculator) {
    console.log('   testOptimalCalculator()    - 最適化テスト');
  }
  
  return status;
}

// グローバルに公開
if (typeof window !== 'undefined') {
  window.quickIntegrationTest = quickIntegrationTest;
  window.performanceIntegrationTest = performanceIntegrationTest;
  window.diagnosticIntegrationStatus = diagnosticIntegrationStatus;
}

console.log('🎯 統合テスト用コンソールコマンドが読み込まれました');
console.log('💡 コンソールで以下を実行してください:');
console.log('   diagnosticIntegrationStatus()  - 統合状態診断');
console.log('   quickIntegrationTest()         - 基本テスト');
console.log('   performanceIntegrationTest()   - パフォーマンステスト');
