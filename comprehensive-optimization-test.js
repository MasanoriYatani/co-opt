/**
 * 総合最適化テストと推奨事項
 * SIMD、代替最適化、既存最適化の総合評価
 * 
 * 作成日: 2025/08/06
 */

/**
 * 総合最適化パフォーマンステスト
 */
function runComprehensiveOptimizationTest() {
    console.log('🏁 総合最適化パフォーマンステストを開始...');
    console.log('================================================');
    
    const results = {
        system: getSystemCapabilities(),
        simd: null,
        alternative: null,
        existing: null,
        recommendations: []
    };
    
    // 1. SIMDテスト
    if (typeof window.runSIMDPerformanceTest === 'function') {
        console.log('📊 SIMD最適化テスト実行中...');
        results.simd = window.runSIMDPerformanceTest();
    }
    
    // 2. 代替最適化テスト
    if (typeof window.testAlternativeOptimization === 'function') {
        console.log('⚡ 代替最適化テスト実行中...');
        results.alternative = window.testAlternativeOptimization();
    }
    
    // 3. 既存最適化テスト
    if (typeof window.getPerformanceReport === 'function') {
        console.log('🔧 既存最適化テスト実行中...');
        results.existing = window.getPerformanceReport();
    }
    
    // 4. 推奨事項生成
    results.recommendations = generateOptimizationRecommendations(results);
    
    // 5. 結果表示
    displayComprehensiveResults(results);
    
    return results;
}

/**
 * システム能力評価
 */
function getSystemCapabilities() {
    return {
        cores: navigator.hardwareConcurrency || 'Unknown',
        memory: navigator.deviceMemory ? `${navigator.deviceMemory}GB` : 'Unknown',
        userAgent: navigator.userAgent,
        platform: navigator.platform,
        simdSupport: typeof SIMD !== 'undefined' && typeof SIMD.Float32x4 !== 'undefined',
        webWorkerSupport: typeof Worker !== 'undefined',
        typedArraySupport: typeof Float32Array !== 'undefined',
        performanceApiSupport: typeof performance !== 'undefined' && typeof performance.now === 'function'
    };
}

/**
 * 最適化推奨事項生成
 */
function generateOptimizationRecommendations(results) {
    const recommendations = [];
    const system = results.system;
    
    // SIMD評価
    if (system.simdSupport && results.simd) {
        const avgSpeedup = results.simd.summary?.overallSpeedup || 1.0;
        if (avgSpeedup > 1.2) {
            recommendations.push({
                type: '🚀 SIMD最適化',
                priority: 'HIGH',
                speedup: `${avgSpeedup.toFixed(2)}倍`,
                action: 'enableSIMDOptimization()',
                description: 'SIMD対応で大幅な性能向上が期待できます'
            });
        }
    } else if (!system.simdSupport) {
        recommendations.push({
            type: '⚠️ SIMD非対応',
            priority: 'INFO',
            speedup: 'N/A',
            action: 'enableAlternativeOptimization()',
            description: '代替最適化を使用することを推奨します'
        });
    }
    
    // 代替最適化評価
    if (results.alternative && results.alternative.speedup > 1.1) {
        recommendations.push({
            type: '⚡ 代替最適化',
            priority: 'MEDIUM',
            speedup: `${results.alternative.speedup.toFixed(2)}倍`,
            action: 'enableAlternativeOptimization()',
            description: '型付き配列による中程度の性能向上'
        });
    }
    
    // WebWorker並列処理評価
    if (system.webWorkerSupport && system.cores > 2) {
        recommendations.push({
            type: '🔄 並列処理',
            priority: 'MEDIUM',
            speedup: `最大${system.cores}倍`,
            action: 'parallelProcessor.processParallel()',
            description: `${system.cores}コアCPUでの並列処理が有効`
        });
    }
    
    // メモリ最適化評価
    if (system.memory !== 'Unknown') {
        const memoryGB = parseFloat(system.memory);
        if (memoryGB < 4) {
            recommendations.push({
                type: '💾 メモリ最適化',
                priority: 'HIGH',
                speedup: 'GC削減',
                action: 'vector3Pool.reset()',
                description: '少ないメモリではプール利用が重要'
            });
        }
    }
    
    // 既存最適化評価
    if (results.existing) {
        // キャッシュは効果が限定的なため除外
        
        if (typeof window.enablePerformanceOptimization === 'function') {
            recommendations.push({
                type: '🔧 既存最適化',
                priority: 'LOW',
                speedup: 'Horner法等',
                action: 'enablePerformanceOptimization()',
                description: '数値計算アルゴリズム最適化（Horner法、解析的微分）'
            });
        }
    }
    
    // 優先順位でソート
    const priorityOrder = { 'HIGH': 3, 'MEDIUM': 2, 'LOW': 1, 'INFO': 0 };
    recommendations.sort((a, b) => priorityOrder[b.priority] - priorityOrder[a.priority]);
    
    return recommendations;
}

/**
 * 総合結果表示
 */
function displayComprehensiveResults(results) {
    console.log('');
    console.log('🏆 総合最適化テスト結果');
    console.log('================================================');
    
    // システム情報
    console.log('💻 システム情報:');
    console.log(`   CPUコア: ${results.system.cores}`);
    console.log(`   メモリ: ${results.system.memory}`);
    console.log(`   SIMD対応: ${results.system.simdSupport ? '✅' : '❌'}`);
    console.log(`   WebWorker対応: ${results.system.webWorkerSupport ? '✅' : '❌'}`);
    console.log('');
    
    // 推奨事項
    console.log('🎯 最適化推奨事項（優先順）:');
    if (results.recommendations.length === 0) {
        console.log('   特に推奨する最適化はありません');
    } else {
        results.recommendations.forEach((rec, index) => {
            console.log(`   ${index + 1}. ${rec.type} [${rec.priority}]`);
            console.log(`      速度向上: ${rec.speedup}`);
            console.log(`      実行方法: ${rec.action}`);
            console.log(`      説明: ${rec.description}`);
            console.log('');
        });
    }
    
    // 実行推奨順序
    console.log('🚀 推奨実行順序:');
    const highPriorityRecs = results.recommendations.filter(r => r.priority === 'HIGH');
    const mediumPriorityRecs = results.recommendations.filter(r => r.priority === 'MEDIUM');
    
    if (highPriorityRecs.length > 0) {
        console.log('   1. 高優先度最適化を実行:');
        highPriorityRecs.forEach(rec => {
            console.log(`      ${rec.action}`);
        });
    }
    
    if (mediumPriorityRecs.length > 0) {
        console.log('   2. 中優先度最適化を実行:');
        mediumPriorityRecs.forEach(rec => {
            console.log(`      ${rec.action}`);
        });
    }
    
    console.log('   3. 性能測定: runPerformanceDiagnosis()');
    console.log('');
    console.log('💡 すべての最適化を一括実行: enableAllOptimizations()');
}

/**
 * すべての最適化を一括有効化
 */
function enableAllOptimizations() {
    console.log('🚀 すべての最適化を有効化...');
    
    let enabledOptimizations = [];
    
    // SIMD最適化
    if (typeof window.enableSIMDOptimization === 'function') {
        try {
            window.enableSIMDOptimization();
            enabledOptimizations.push('✅ SIMD最適化');
        } catch (error) {
            console.warn('⚠️ SIMD最適化の有効化に失敗:', error);
        }
    }
    
    // 代替最適化
    if (typeof window.enableAlternativeOptimization === 'function') {
        try {
            window.enableAlternativeOptimization();
            enabledOptimizations.push('✅ 代替最適化');
        } catch (error) {
            console.warn('⚠️ 代替最適化の有効化に失敗:', error);
        }
    }
    
    // キャッシュ最適化は効果が限定的なため除外
    
    // 既存最適化
    if (typeof window.enablePerformanceOptimization === 'function') {
        try {
            window.enablePerformanceOptimization();
            enabledOptimizations.push('✅ 既存パフォーマンス最適化（Horner法、解析的微分）');
        } catch (error) {
            console.warn('⚠️ 既存最適化の有効化に失敗:', error);
        }
    }
    
    console.log('📊 有効化された最適化:');
    enabledOptimizations.forEach(opt => console.log(`   ${opt}`));
    
    if (enabledOptimizations.length === 0) {
        console.log('   最適化関数が見つかりませんでした');
    } else {
        console.log('');
        console.log('✅ すべての最適化が有効になりました');
        console.log('   パフォーマンステストで効果を確認: runPerformanceDiagnosis()');
    }
}

/**
 * 最適化状況確認
 */
function checkOptimizationStatus() {
    console.log('🔍 現在の最適化状況:');
    
    const status = {
        simd: typeof window.SIMDVectorMath !== 'undefined' && window.dotProduct === window.SIMDVectorMath.dotProduct3,
        alternative: typeof window.TypedArrayVectorMath !== 'undefined' && window.dotProduct === window.TypedArrayVectorMath.dotProduct3,
        existing: typeof window.getPerformanceReport === 'function'
    };
    
    console.log(`   SIMD最適化: ${status.simd ? '🟢 有効' : '⚪ 無効'}`);
    console.log(`   代替最適化: ${status.alternative ? '🟢 有効' : '⚪ 無効'}`);
    console.log(`   既存最適化: ${status.existing ? '🟢 利用可能' : '⚪ 無効'}`);
    console.log(`   並列処理: ${typeof window.parallelProcessor !== 'undefined' ? '🟢 利用可能' : '⚪ 無効'}`);
    console.log('   💡 キャッシュ最適化は効果が限定的なため無効化済み');
    
    return status;
}

// グローバル公開
window.runComprehensiveOptimizationTest = runComprehensiveOptimizationTest;
window.enableAllOptimizations = enableAllOptimizations;
window.checkOptimizationStatus = checkOptimizationStatus;

console.log('🎯 総合最適化テストモジュールが読み込まれました');
console.log('   総合テスト: runComprehensiveOptimizationTest()');
console.log('   一括有効化: enableAllOptimizations()');
console.log('   状況確認: checkOptimizationStatus()');
