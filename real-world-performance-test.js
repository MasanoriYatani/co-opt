/**
 * 実用的パフォーマンステスト
 * キャッシュを除く、実際の光線追跡処理での最適化効果測定
 * 
 * 作成日: 2025/08/06
 */

/**
 * 実用的光線追跡パフォーマンステスト
 */
function runRealWorldPerformanceTest() {
    console.log('🌟 実用的光線追跡パフォーマンステストを開始...');
    console.log('===============================================');
    
    const testResults = {
        systemInfo: getSystemInfo(),
        baseline: null,
        optimized: null,
        improvements: {},
        recommendations: []
    };
    
    // 1. ベースライン測定（最適化無効）
    console.log('📊 ベースライン性能測定中...');
    testResults.baseline = measureBaselinePerformance();
    
    // 2. 最適化有効後の測定
    console.log('🚀 最適化後の性能測定中...');
    testResults.optimized = measureOptimizedPerformance();
    
    // 3. 改善効果計算
    testResults.improvements = calculateImprovements(testResults.baseline, testResults.optimized);
    
    // 4. 推奨事項生成
    testResults.recommendations = generateRealWorldRecommendations(testResults);
    
    // 5. 結果表示
    displayRealWorldResults(testResults);
    
    return testResults;
}

/**
 * システム情報取得
 */
function getSystemInfo() {
    return {
        cores: navigator.hardwareConcurrency || 'Unknown',
        memory: navigator.deviceMemory ? `${navigator.deviceMemory}GB` : 'Unknown',
        userAgent: navigator.userAgent.split(' ')[0],
        platform: navigator.platform,
        timestamp: new Date().toLocaleString('ja-JP')
    };
}

/**
 * ベースライン性能測定
 */
function measureBaselinePerformance() {
    const testCases = {
        vectorOperations: measureVectorOperations(),
        asphericCalculations: measureAsphericCalculations(),
        rayIntersections: measureRayIntersections(),
        massiveCalculations: measureMassiveCalculations()
    };
    
    return testCases;
}

/**
 * 最適化後性能測定
 */
function measureOptimizedPerformance() {
    // 最適化を一時的に有効化
    const originalFunctions = {
        dotProduct: window.dotProduct,
        normalize: window.normalize,
        asphericSag: window.asphericSag
    };
    
    // 代替最適化を適用
    if (typeof window.TypedArrayVectorMath !== 'undefined') {
        window.dotProduct = window.TypedArrayVectorMath.dotProduct3;
        window.normalize = window.TypedArrayVectorMath.normalize3Fast;
    }
    
    const testCases = {
        vectorOperations: measureVectorOperations(),
        asphericCalculations: measureAsphericCalculations(),
        rayIntersections: measureRayIntersections(),
        massiveCalculations: measureMassiveCalculations()
    };
    
    // 元の関数に戻す
    Object.assign(window, originalFunctions);
    
    return testCases;
}

/**
 * ベクトル演算テスト
 */
function measureVectorOperations() {
    const iterations = 50000;
    const vectors = generateRandomVectors(iterations);
    
    const start = performance.now();
    
    for (let i = 0; i < iterations - 1; i++) {
        const dot = window.dotProduct ? 
                   window.dotProduct(vectors[i], vectors[i + 1]) :
                   vectors[i].x * vectors[i + 1].x + vectors[i].y * vectors[i + 1].y + vectors[i].z * vectors[i + 1].z;
        
        const normalized = window.normalize ? 
                          window.normalize(vectors[i]) :
                          normalizeVector(vectors[i]);
    }
    
    const end = performance.now();
    return {
        time: end - start,
        iterations: iterations,
        averageTime: (end - start) / iterations
    };
}

/**
 * 非球面計算テスト
 */
function measureAsphericCalculations() {
    const iterations = 10000;
    const rValues = generateRadialValues(iterations);
    const curvature = 0.02;
    const conic = -0.8;
    const asphericCoeffs = [1e-6, -2e-9, 1e-12, 5e-16];
    
    const start = performance.now();
    
    for (let i = 0; i < iterations; i++) {
        const r = rValues[i];
        if (window.asphericSag) {
            const sag = window.asphericSag(r, curvature, conic, asphericCoeffs);
        } else {
            // フォールバック計算
            const r2 = r * r;
            const denominator = 1 + Math.sqrt(1 - (1 + conic) * curvature * curvature * r2);
            let sag = curvature * r2 / denominator;
            
            let r_power = r2 * r2;
            for (const coeff of asphericCoeffs) {
                sag += coeff * r_power;
                r_power *= r2;
            }
        }
    }
    
    const end = performance.now();
    return {
        time: end - start,
        iterations: iterations,
        averageTime: (end - start) / iterations
    };
}

/**
 * 光線交点計算テスト
 */
function measureRayIntersections() {
    const iterations = 5000;
    const rays = generateTestRays(iterations);
    const surface = {
        z: 100,
        curvature: 0.01,
        conic: -0.5,
        aperture: 25
    };
    
    const start = performance.now();
    
    for (let i = 0; i < iterations; i++) {
        if (window.intersectAsphericSurface) {
            const intersection = window.intersectAsphericSurface(rays[i], surface);
        } else {
            // 簡易計算
            const t = (surface.z - rays[i].pos.z) / rays[i].dir.z;
            if (t > 0) {
                const x = rays[i].pos.x + t * rays[i].dir.x;
                const y = rays[i].pos.y + t * rays[i].dir.y;
                const r = Math.sqrt(x * x + y * y);
            }
        }
    }
    
    const end = performance.now();
    return {
        time: end - start,
        iterations: iterations,
        averageTime: (end - start) / iterations
    };
}

/**
 * 大量計算テスト（実用的なケース）
 */
function measureMassiveCalculations() {
    const rayCount = 1000;
    const surfaceCount = 10;
    
    const rays = generateTestRays(rayCount);
    const surfaces = generateTestSurfaces(surfaceCount);
    
    const start = performance.now();
    
    // スポットダイアグラム相当の計算
    for (const ray of rays) {
        for (const surface of surfaces) {
            if (window.intersectAsphericSurface) {
                const intersection = window.intersectAsphericSurface(ray, surface);
                if (intersection) {
                    // 法線計算
                    if (window.surfaceNormal) {
                        const normal = window.surfaceNormal(intersection.x, intersection.y, surface);
                    }
                }
            }
        }
    }
    
    const end = performance.now();
    return {
        time: end - start,
        rays: rayCount,
        surfaces: surfaceCount,
        totalOperations: rayCount * surfaceCount
    };
}

/**
 * 改善効果計算
 */
function calculateImprovements(baseline, optimized) {
    const improvements = {};
    
    for (const [testName, baseResult] of Object.entries(baseline)) {
        const optResult = optimized[testName];
        if (baseResult && optResult && baseResult.time && optResult.time) {
            improvements[testName] = {
                baselineTime: baseResult.time,
                optimizedTime: optResult.time,
                speedup: baseResult.time / optResult.time,
                improvement: ((baseResult.time - optResult.time) / baseResult.time) * 100
            };
        }
    }
    
    return improvements;
}

/**
 * 実用的推奨事項生成
 */
function generateRealWorldRecommendations(results) {
    const recommendations = [];
    const improvements = results.improvements;
    
    // 最も効果的な最適化を特定
    let bestImprovement = { name: '', speedup: 1.0 };
    for (const [testName, result] of Object.entries(improvements)) {
        if (result.speedup > bestImprovement.speedup) {
            bestImprovement = { name: testName, speedup: result.speedup };
        }
    }
    
    if (bestImprovement.speedup > 1.2) {
        recommendations.push({
            type: '🎯 最も効果的',
            priority: 'HIGH',
            testCase: bestImprovement.name,
            speedup: `${bestImprovement.speedup.toFixed(2)}倍`,
            description: `${bestImprovement.name}で最大の効果が確認されました`
        });
    }
    
    // 並列処理の推奨
    if (results.systemInfo.cores > 4) {
        recommendations.push({
            type: '🔄 並列処理推奨',
            priority: 'HIGH',
            speedup: `最大${results.systemInfo.cores}倍`,
            description: `${results.systemInfo.cores}コアCPUで大幅な高速化が期待できます`
        });
    }
    
    // メモリ最適化
    if (results.systemInfo.memory !== 'Unknown') {
        const memGB = parseFloat(results.systemInfo.memory);
        if (memGB >= 8) {
            recommendations.push({
                type: '💾 メモリプール最適化',
                priority: 'MEDIUM',
                speedup: 'GC削減',
                description: '十分なメモリがあるため、メモリプールが効果的です'
            });
        }
    }
    
    return recommendations;
}

/**
 * 結果表示
 */
function displayRealWorldResults(results) {
    console.log('');
    console.log('🏆 実用的光線追跡パフォーマンス測定結果');
    console.log('===============================================');
    console.log(`📅 測定日時: ${results.systemInfo.timestamp}`);
    console.log(`💻 システム: ${results.systemInfo.platform} (${results.systemInfo.cores}コア)`);
    console.log('');
    
    console.log('📊 性能改善結果:');
    for (const [testName, result] of Object.entries(results.improvements)) {
        const speedup = result.speedup;
        const improvement = result.improvement;
        
        if (speedup > 1.05) {
            console.log(`   ✅ ${testName}: ${speedup.toFixed(2)}倍高速化 (+${improvement.toFixed(1)}%)`);
            console.log(`      ${result.baselineTime.toFixed(2)}ms → ${result.optimizedTime.toFixed(2)}ms`);
        } else if (speedup < 0.95) {
            console.log(`   ❌ ${testName}: ${(1/speedup).toFixed(2)}倍低速化 (${improvement.toFixed(1)}%)`);
        } else {
            console.log(`   ⚪ ${testName}: 大きな変化なし (${speedup.toFixed(2)}倍)`);
        }
    }
    
    console.log('');
    console.log('🎯 推奨事項:');
    if (results.recommendations.length === 0) {
        console.log('   現在の設定で最適です');
    } else {
        results.recommendations.forEach((rec, index) => {
            console.log(`   ${index + 1}. ${rec.type} [${rec.priority}]`);
            console.log(`      速度向上: ${rec.speedup}`);
            if (rec.testCase) {
                console.log(`      最効果テスト: ${rec.testCase}`);
            }
            console.log(`      説明: ${rec.description}`);
            console.log('');
        });
    }
    
    // 総合評価
    const avgSpeedup = Object.values(results.improvements)
        .map(r => r.speedup)
        .reduce((sum, s) => sum + s, 0) / Object.keys(results.improvements).length;
    
    console.log('📈 総合評価:');
    console.log(`   平均速度向上: ${avgSpeedup.toFixed(2)}倍`);
    
    if (avgSpeedup >= 1.5) {
        console.log('   評価: 🚀 大幅な性能向上');
    } else if (avgSpeedup >= 1.2) {
        console.log('   評価: ✅ 中程度の性能向上');
    } else if (avgSpeedup >= 1.05) {
        console.log('   評価: 💡 軽微な性能向上');
    } else {
        console.log('   評価: ⚠️ 効果は限定的');
    }
}

// ヘルパー関数
function generateRandomVectors(count) {
    return Array.from({ length: count }, () => ({
        x: Math.random() - 0.5,
        y: Math.random() - 0.5,
        z: Math.random() - 0.5
    }));
}

function generateRadialValues(count) {
    return Array.from({ length: count }, (_, i) => (i + 1) * 25 / count);
}

function generateTestRays(count) {
    return Array.from({ length: count }, () => ({
        pos: { x: Math.random() * 20 - 10, y: Math.random() * 20 - 10, z: 0 },
        dir: { x: (Math.random() - 0.5) * 0.2, y: (Math.random() - 0.5) * 0.2, z: 1 }
    }));
}

function generateTestSurfaces(count) {
    return Array.from({ length: count }, (_, i) => ({
        z: (i + 1) * 20,
        curvature: 0.01 + Math.random() * 0.02,
        conic: -Math.random(),
        aperture: 15 + Math.random() * 20
    }));
}

function normalizeVector(v) {
    const len = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
    return len === 0 ? { x: 0, y: 0, z: 0 } : { x: v.x/len, y: v.y/len, z: v.z/len };
}

// グローバル公開
window.runRealWorldPerformanceTest = runRealWorldPerformanceTest;

console.log('🌟 実用的パフォーマンステストモジュールが読み込まれました');
console.log('   実行: runRealWorldPerformanceTest()');
