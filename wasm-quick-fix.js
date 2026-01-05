// 🔧 WASM System Quick Fix Console Commands

// ForceWASMSystem の確実な初期化と利用
window.ensureWASMAvailable = function() {
    console.log('🔍 WASM システム確認中...');
    
    if (typeof ForceWASMSystem === 'undefined') {
        console.log('⚠️ ForceWASMSystem がグローバルスコープに見つかりません');
        console.log('💡 解決策を試行中...');
        
        // スクリプト再読み込みの試行
        const script = document.createElement('script');
        script.src = 'force-wasm-system.js';
        script.onload = () => {
            console.log('✅ force-wasm-system.js 再読み込み完了');
            
            setTimeout(() => {
                if (typeof ForceWASMSystem !== 'undefined') {
                    console.log('✅ ForceWASMSystem 利用可能になりました');
                    window.testWASMAfterLoad();
                } else {
                    console.log('❌ 再読み込み後もForceWASMSystem が利用できません');
                }
            }, 500);
        };
        document.head.appendChild(script);
        
        return false;
    } else {
        console.log('✅ ForceWASMSystem 利用可能');
        return true;
    }
};

// WASM システム再読み込み後のテスト
window.testWASMAfterLoad = async function() {
    console.log('🧪 WASM システム確認テスト開始...');
    
    try {
        const wasmSystem = new ForceWASMSystem();
        await wasmSystem.forceInitializeWASM();
        
        const testResult = wasmSystem.forceAsphericSag(2.5, 0.1, -0.8, 0.01, 0.02, 0.03, 0.04);
        console.log('✅ WASM システム正常動作確認:', testResult);
        
        // グローバルに保存
        window.globalWASMSystem = wasmSystem;
        
        // 統合テスト再実行
        if (typeof diagnosticIntegrationStatus === 'function') {
            console.log('🔄 統合診断を再実行中...');
            setTimeout(() => {
                diagnosticIntegrationStatus();
            }, 1000);
        }
        
        return wasmSystem;
    } catch (error) {
        console.error('❌ WASM システムテスト失敗:', error);
        return null;
    }
};

// 即座に利用可能なWASMテスト
window.quickWASMTest = async function() {
    console.log('⚡ クイック WASM テスト開始...');
    
    if (!ensureWASMAvailable()) {
        console.log('🔄 WASM システム読み込み中... 数秒後に再実行してください');
        return;
    }
    
    return await testWASMAfterLoad();
};

// OptimalAsphericCalculator の WASM 統合テスト
window.testOptimalWithWASM = async function() {
    console.log('🎯 OptimalAsphericCalculator + WASM 統合テスト...');
    
    if (!window.optimalCalculator) {
        console.log('❌ OptimalAsphericCalculator が初期化されていません');
        return;
    }
    
    // WASM システムを確実に利用可能にする
    if (!ensureWASMAvailable()) {
        console.log('⚠️ WASM システム読み込み中...');
        return;
    }
    
    try {
        // 大規模データでテスト（WASM が選択されるはず）
        const largeInput = Array.from({length: 50000}, (_, i) => i * 0.01);
        const result = await window.optimalCalculator.calculateAsphericSag(largeInput, -0.8, [0.01, 0.02, 0.03]);
        
        console.log('📊 大規模計算結果:');
        console.log(`   戦略: ${result.strategy}`);
        console.log(`   時間: ${result.time}ms`);
        console.log(`   スループット: ${(largeInput.length / result.time * 1000).toFixed(0)} calc/sec`);
        
        const stats = window.optimalCalculator.getPerformanceStats();
        console.log('📈 統計:', stats);
        
        return result;
    } catch (error) {
        console.error('❌ OptimalAsphericCalculator + WASM テスト失敗:', error);
        return null;
    }
};

console.log('🔧 WASM Quick Fix コマンドが読み込まれました:');
console.log('   ensureWASMAvailable() - WASM システム確認・修復');
console.log('   quickWASMTest() - クイック WASM テスト');
console.log('   testOptimalWithWASM() - OptimalAsphericCalculator + WASM テスト');
console.log('   testWASMAfterLoad() - 読み込み後テスト');
console.log('');
console.log('💡 推奨: quickWASMTest() を最初に実行してください');
