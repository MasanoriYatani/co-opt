/**
 * SIMD最適化パフォーマンステスト
 * 光線追跡における SIMD 最適化の効果を測定
 * 
 * 作成日: 2025/08/06
 */

/**
 * 総合SIMD最適化パフォーマンステスト
 */
function runSIMDPerformanceTest() {
    console.log('🧪 SIMD最適化パフォーマンステストを開始...');
    console.log('=====================================');
    
    const testResults = {
        systemInfo: getSIMDSystemInfo(),
        vectorTests: testVectorOperations(),
        rayTracingTests: testRayTracingPerformance(),
        asphericTests: testAsphericCalculations(),
        summary: {}
    };
    
    // 総合評価
    const totalSpeedup = calculateOverallSpeedup(testResults);
    testResults.summary = {
        overallSpeedup: totalSpeedup,
        recommendation: getOptimizationRecommendation(totalSpeedup),
        estimatedPerformanceGain: `${((totalSpeedup - 1) * 100).toFixed(1)}%`
    };
    
    displaySIMDTestResults(testResults);
    return testResults;
}

/**
 * システム情報取得
 */
function getSIMDSystemInfo() {
    return {
        simdSupported: typeof SIMD !== 'undefined' && typeof SIMD.Float32x4 !== 'undefined',
        userAgent: navigator.userAgent,
        platform: navigator.platform,
        cpuCores: navigator.hardwareConcurrency || 'Unknown',
        memory: navigator.deviceMemory ? `${navigator.deviceMemory}GB` : 'Unknown',
        timestamp: new Date().toISOString()
    };
}

/**
 * ベクトル演算パフォーマンステスト
 */
function testVectorOperations() {
    console.log('📊 ベクトル演算テスト中...');
    
    const testSize = 10000;
    const vectorsA = generateTestVectors(testSize);
    const vectorsB = generateTestVectors(testSize);
    
    const results = {
        dotProduct: benchmarkOperation('内積計算', () => {
            const nonSimdTime = measureTime(() => {
                for (let i = 0; i < testSize; i++) {
                    const a = vectorsA[i], b = vectorsB[i];
                    const result = a.x * b.x + a.y * b.y + a.z * b.z;
                }
            });
            
            const simdTime = measureTime(() => {
                for (let i = 0; i < testSize; i++) {
                    const result = window.SIMDVectorMath.dotProduct3(vectorsA[i], vectorsB[i]);
                }
            });
            
            return { nonSimdTime, simdTime, speedup: nonSimdTime / simdTime };
        }),
        
        crossProduct: benchmarkOperation('外積計算', () => {
            const nonSimdTime = measureTime(() => {
                for (let i = 0; i < testSize; i++) {
                    const a = vectorsA[i], b = vectorsB[i];
                    const result = {
                        x: a.y * b.z - a.z * b.y,
                        y: a.z * b.x - a.x * b.z,
                        z: a.x * b.y - a.y * b.x
                    };
                }
            });
            
            const simdTime = measureTime(() => {
                for (let i = 0; i < testSize; i++) {
                    const result = window.SIMDVectorMath.crossProduct3(vectorsA[i], vectorsB[i]);
                }
            });
            
            return { nonSimdTime, simdTime, speedup: nonSimdTime / simdTime };
        }),
        
        normalize: benchmarkOperation('正規化', () => {
            const nonSimdTime = measureTime(() => {
                for (let i = 0; i < testSize; i++) {
                    const v = vectorsA[i];
                    const len = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
                    const result = len === 0 ? {x:0, y:0, z:0} : {x:v.x/len, y:v.y/len, z:v.z/len};
                }
            });
            
            const simdTime = measureTime(() => {
                for (let i = 0; i < testSize; i++) {
                    const result = window.SIMDVectorMath.normalize3(vectorsA[i]);
                }
            });
            
            return { nonSimdTime, simdTime, speedup: nonSimdTime / simdTime };
        })
    };
    
    console.log(`✅ ベクトル演算テスト完了 (${testSize}回処理)`);
    return results;
}

/**
 * 光線追跡パフォーマンステスト
 */
function testRayTracingPerformance() {
    console.log('📊 光線追跡パフォーマンステスト中...');
    
    const testRayCount = 1000;
    const testRays = generateTestRays(testRayCount);
    const testPlane = { normal: { x: 0, y: 0, z: 1 }, d: 0 };
    
    const results = {
        rayPlaneIntersection: benchmarkOperation('光線-平面交点', () => {
            const nonSimdTime = measureTime(() => {
                testRays.forEach(ray => {
                    const dotProduct = ray.dir.x * testPlane.normal.x + 
                                     ray.dir.y * testPlane.normal.y + 
                                     ray.dir.z * testPlane.normal.z;
                    if (Math.abs(dotProduct) < 1e-10) return null;
                    
                    const t = -((ray.start.x * testPlane.normal.x + 
                                ray.start.y * testPlane.normal.y + 
                                ray.start.z * testPlane.normal.z) + testPlane.d) / dotProduct;
                    if (t < 0) return null;
                    
                    const result = {
                        x: ray.start.x + t * ray.dir.x,
                        y: ray.start.y + t * ray.dir.y,
                        z: ray.start.z + t * ray.dir.z,
                        t: t
                    };
                });
            });
            
            const simdTime = measureTime(() => {
                const results = window.SIMDRayMath.batchRayPlaneIntersection(testRays, testPlane);
            });
            
            return { nonSimdTime, simdTime, speedup: nonSimdTime / simdTime };
        }),
        
        rayNormalization: benchmarkOperation('光線正規化', () => {
            const nonSimdTime = measureTime(() => {
                testRays.forEach(ray => {
                    const len = Math.sqrt(ray.dir.x ** 2 + ray.dir.y ** 2 + ray.dir.z ** 2);
                    ray.dir = len === 0 ? {x:0, y:0, z:0} : {x:ray.dir.x/len, y:ray.dir.y/len, z:ray.dir.z/len};
                });
            });
            
            const simdTime = measureTime(() => {
                const results = window.SIMDRayMath.batchNormalizeRays(testRays);
            });
            
            return { nonSimdTime, simdTime, speedup: nonSimdTime / simdTime };
        })
    };
    
    console.log(`✅ 光線追跡テスト完了 (${testRayCount}本の光線)`);
    return results;
}

/**
 * 非球面計算パフォーマンステスト
 */
function testAsphericCalculations() {
    console.log('📊 非球面計算テスト中...');
    
    const testPoints = 5000;
    const rValues = Array.from({ length: testPoints }, (_, i) => (i + 1) * 0.01);
    const curvature = 0.02;
    const conic = -0.5;
    const aspheric = [1e-6, -2e-9, 1e-12];
    
    const results = {
        asphericSag: benchmarkOperation('非球面SAG計算', () => {
            const nonSimdTime = measureTime(() => {
                rValues.forEach(r => {
                    const r2 = r * r;
                    const denominator = 1 + Math.sqrt(1 - (1 + conic) * curvature * curvature * r2);
                    let sag = curvature * r2 / denominator;
                    
                    let r_power = r2 * r2;
                    aspheric.forEach(coeff => {
                        sag += coeff * r_power;
                        r_power *= r2;
                    });
                });
            });
            
            const simdTime = measureTime(() => {
                const results = window.SIMDAsphericMath.batchAsphericSag(rValues, curvature, conic, aspheric);
            });
            
            return { nonSimdTime, simdTime, speedup: nonSimdTime / simdTime };
        })
    };
    
    console.log(`✅ 非球面計算テスト完了 (${testPoints}点)`);
    return results;
}

/**
 * テストベクトル生成
 */
function generateTestVectors(count) {
    return Array.from({ length: count }, (_, i) => ({
        x: Math.sin(i * 0.1),
        y: Math.cos(i * 0.1),  
        z: Math.sin(i * 0.05) * Math.cos(i * 0.05)
    }));
}

/**
 * テスト光線生成
 */
function generateTestRays(count) {
    return Array.from({ length: count }, (_, i) => ({
        start: { x: Math.random() - 0.5, y: Math.random() - 0.5, z: -1 },
        dir: { x: (Math.random() - 0.5) * 0.2, y: (Math.random() - 0.5) * 0.2, z: 1 }
    }));
}

/**
 * 処理時間測定（改善版）
 */
function measureTime(func) {
    // ウォームアップ実行
    func();
    
    // 複数回実行して平均を取る
    const iterations = 5;
    const times = [];
    
    for (let i = 0; i < iterations; i++) {
        const start = performance.now();
        func();
        const end = performance.now();
        times.push(end - start);
    }
    
    // 最初と最後を除く中央値を計算（外れ値除去）
    times.sort((a, b) => a - b);
    const middle = Math.floor(times.length / 2);
    return times.length % 2 === 0 ? 
           (times[middle - 1] + times[middle]) / 2 : 
           times[middle];
}

/**
 * ベンチマーク実行（改善版）
 */
function benchmarkOperation(name, testFunc) {
    const result = testFunc();
    
    // 異常値の処理
    let speedup = result.speedup;
    if (!isFinite(speedup) || speedup <= 0) {
        speedup = 1.0; // 効果なしとして扱う
    }
    
    // 結果の正規化
    const normalizedResult = {
        ...result,
        speedup: Math.max(0.1, Math.min(10.0, speedup)) // 0.1倍〜10倍の範囲に制限
    };
    
    console.log(`   ${name}: ${normalizedResult.speedup.toFixed(2)}倍高速化 (${result.nonSimdTime.toFixed(2)}ms → ${result.simdTime.toFixed(2)}ms)`);
    return normalizedResult;
}

/**
 * 総合速度向上計算（改善版）
 */
function calculateOverallSpeedup(testResults) {
    const allSpeedups = [];
    
    Object.values(testResults.vectorTests).forEach(test => {
        if (isFinite(test.speedup) && test.speedup > 0) {
            allSpeedups.push(test.speedup);
        }
    });
    Object.values(testResults.rayTracingTests).forEach(test => {
        if (isFinite(test.speedup) && test.speedup > 0) {
            allSpeedups.push(test.speedup);
        }
    });
    Object.values(testResults.asphericTests).forEach(test => {
        if (isFinite(test.speedup) && test.speedup > 0) {
            allSpeedups.push(test.speedup);
        }
    });
    
    if (allSpeedups.length === 0) return 1.0;
    
    return allSpeedups.reduce((sum, speedup) => sum + speedup, 0) / allSpeedups.length;
}

/**
 * 最適化推奨事項取得
 */
function getOptimizationRecommendation(speedup) {
    if (speedup >= 1.5) {
        return '🚀 SIMD最適化を強く推奨します。大幅な性能向上が期待できます。';
    } else if (speedup >= 1.2) {
        return '✅ SIMD最適化は有効です。中程度の性能向上があります。';
    } else if (speedup >= 1.05) {
        return '💡 SIMD最適化は軽微な効果があります。他の最適化も検討してください。';
    } else {
        return '⚠️ SIMD最適化の効果は限定的です。他の最適化手法を優先してください。';
    }
}

/**
 * テスト結果表示
 */
function displaySIMDTestResults(results) {
    console.log('');
    console.log('🏆 SIMD最適化パフォーマンステスト結果');
    console.log('=====================================');
    console.log(`📱 システム情報:`);
    console.log(`   SIMD対応: ${results.systemInfo.simdSupported ? '✅' : '❌'}`);
    console.log(`   CPUコア数: ${results.systemInfo.cpuCores}`);
    console.log(`   メモリ: ${results.systemInfo.memory}`);
    console.log('');
    console.log(`📊 総合評価:`);
    console.log(`   平均速度向上: ${results.summary.overallSpeedup.toFixed(2)}倍`);
    console.log(`   性能向上: ${results.summary.estimatedPerformanceGain}`);
    console.log(`   推奨事項: ${results.summary.recommendation}`);
    console.log('');
    console.log('🔧 SIMD最適化を有効にするには enableSIMDOptimization() を実行してください');
}

// グローバル公開
window.runSIMDPerformanceTest = runSIMDPerformanceTest;
window.getSIMDSystemInfo = getSIMDSystemInfo;

console.log('🧪 SIMDパフォーマンステストモジュールが読み込まれました');
console.log('   テスト実行: runSIMDPerformanceTest()');
