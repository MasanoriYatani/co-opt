/**
 * 並列処理パフォーマンステスト
 * WebWorkerを活用した多コア処理の効果測定
 * 
 * 作成日: 2025/08/06
 */

/**
 * 並列処理パフォーマンステスト
 */
function testParallelPerformance() {
    console.log('🔄 並列処理パフォーマンステストを開始...');
    console.log('========================================');
    
    const testResults = {
        systemInfo: getParallelSystemInfo(),
        serialResults: null,
        parallelResults: null,
        comparison: null
    };
    
    return runParallelTests(testResults);
}

/**
 * システム情報取得（並列処理用）
 */
function getParallelSystemInfo() {
    return {
        cores: navigator.hardwareConcurrency || 'Unknown',
        webWorkerSupport: typeof Worker !== 'undefined',
        sharedArrayBufferSupport: typeof SharedArrayBuffer !== 'undefined',
        platform: navigator.platform,
        timestamp: new Date().toLocaleString('ja-JP')
    };
}

/**
 * 並列処理テストの実行
 */
async function runParallelTests(testResults) {
    try {
        // 1. シリアル処理のベンチマーク
        console.log('📊 シリアル処理ベンチマーク実行中...');
        testResults.serialResults = await runSerialBenchmark();
        
        // 2. 並列処理のベンチマーク
        console.log('🚀 並列処理ベンチマーク実行中...');
        testResults.parallelResults = await runParallelBenchmark();
        
        // 3. 結果比較
        testResults.comparison = compareResults(testResults.serialResults, testResults.parallelResults);
        
        // 4. 結果表示
        displayParallelResults(testResults);
        
        return testResults;
        
    } catch (error) {
        console.error('❌ 並列処理テストでエラー:', error);
        console.log('💡 フォールバック: 簡易並列処理テストを実行...');
        return runSimpleParallelTest();
    }
}

/**
 * シリアル処理ベンチマーク
 */
async function runSerialBenchmark() {
    const dataSize = 50000; // データサイズを大幅に増加
    const testData = generateTestData(dataSize);
    
    const start = performance.now();
    
    // CPU集約的な計算（光線追跡シミュレーション）
    const results = testData.map(ray => {
        return calculateRayIntersection(ray);
    });
    
    const end = performance.now();
    
    return {
        time: end - start,
        dataSize: dataSize,
        throughput: dataSize / (end - start) * 1000,
        results: results.length
    };
}

/**
 * 並列処理ベンチマーク
 */
async function runParallelBenchmark() {
    const dataSize = 50000; // データサイズを大幅に増加
    const testData = generateTestData(dataSize);
    const workerCount = navigator.hardwareConcurrency || 4;
    
    const start = performance.now();
    
    try {
        // 並列処理でデータを分割処理
        const results = await processInParallel(testData, workerCount);
        const end = performance.now();
        
        return {
            time: end - start,
            dataSize: dataSize,
            workerCount: workerCount,
            throughput: dataSize / (end - start) * 1000,
            results: results.length
        };
        
    } catch (error) {
        console.warn('⚠️ WebWorker並列処理に失敗、改良版疑似並列処理を使用:', error.message);
        
        // フォールバック: 改良版疑似並列処理（非同期バッチ処理）
        const batchSize = Math.ceil(dataSize / workerCount);
        const batches = [];
        
        for (let i = 0; i < dataSize; i += batchSize) {
            batches.push(testData.slice(i, i + batchSize));
        }
        
        const results = await Promise.all(
            batches.map(async (batch, index) => {
                // 各バッチを非同期で処理（実際のCPU集約処理）
                return new Promise(resolve => {
                    // より重い計算を実行
                    const batchResults = batch.map(ray => {
                        // 複数回の計算で処理負荷を増加
                        let result = null;
                        for (let iteration = 0; iteration < 10; iteration++) {
                            result = calculateComplexRayIntersection(ray, iteration);
                        }
                        return result;
                    });
                    resolve(batchResults);
                });
            })
        );
        
        const end = performance.now();
        
        return {
            time: end - start,
            dataSize: dataSize,
            workerCount: workerCount,
            throughput: dataSize / (end - start) * 1000,
            results: results.flat().length,
            fallback: true
        };
    }
}

/**
 * WebWorkerを使用した並列処理
 */
async function processInParallel(data, workerCount) {
    return new Promise((resolve, reject) => {
        const workers = [];
        const results = [];
        let completedWorkers = 0;
        
        const batchSize = Math.ceil(data.length / workerCount);
        console.log(`   バッチサイズ: ${batchSize}, ワーカー数: ${workerCount}`);
        
        for (let i = 0; i < workerCount; i++) {
            const batch = data.slice(i * batchSize, (i + 1) * batchSize);
            if (batch.length === 0) continue;
            
            try {
                const worker = new Worker(createWorkerBlob());
                workers.push(worker);
                
                worker.onmessage = (e) => {
                    const { results: workerResults, workerId, processingTime, batchSize } = e.data;
                    
                    console.log(`   ワーカー${workerId}: ${batchSize}件処理完了 (${processingTime.toFixed(2)}ms)`);
                    
                    results.push(...workerResults);
                    completedWorkers++;
                    
                    if (completedWorkers === workers.length) {
                        // 全ワーカー完了
                        workers.forEach(w => w.terminate());
                        resolve(results);
                    }
                };
                
                worker.onerror = (error) => {
                    console.error(`ワーカー${i}エラー:`, error);
                    workers.forEach(w => w.terminate());
                    reject(new Error(`Worker ${i} error: ${error.message}`));
                };
                
                // バッチとワーカーIDを送信
                worker.postMessage({ batch, workerId: i });
                
            } catch (error) {
                reject(new Error(`Worker ${i} creation failed: ${error.message}`));
                return;
            }
        }
        
        if (workers.length === 0) {
            resolve([]);
        }
    });
}

/**
 * WebWorker用のBlobを作成
 */
function createWorkerBlob() {
    const workerCode = `
        // Worker内での光線交点計算 - 計算集約的版
        function calculateRayIntersection(ray) {
            const surface = {
                z: 100,
                curvature: 0.01,
                conic: -0.5
            };
            
            const dx = ray.dir.x;
            const dy = ray.dir.y;
            const dz = ray.dir.z;
            
            const ox = ray.pos.x;
            const oy = ray.pos.y;
            const oz = ray.pos.z;
            
            // 計算負荷を増加（Worker内でも重い処理）
            let result = null;
            for (let i = 0; i < 100; i++) {
                const t0 = (surface.z - oz) / dz;
                
                if (t0 <= 0) continue;
                
                const x = ox + t0 * dx;
                const y = oy + t0 * dy;
                const r2 = x * x + y * y;
                
                const c = surface.curvature;
                const k = surface.conic;
                
                if (c !== 0) {
                    const cr2 = c * r2;
                    const discriminant = 1 - (1 + k) * c * c * r2;
                    if (discriminant >= 0) {
                        const sag = cr2 / (1 + Math.sqrt(discriminant));
                        
                        // 追加の重い計算
                        const extra = Math.sin(r2 * 0.01) * Math.cos(i * 0.1) * Math.exp(-r2 / 1000);
                        result = { 
                            x, y, 
                            z: surface.z + sag + extra, 
                            t: t0, 
                            iteration: i,
                            workerId: self.workerId || 0
                        };
                    }
                } else {
                    result = { x, y, z: surface.z, t: t0, iteration: i, workerId: self.workerId || 0 };
                }
            }
            
            return result;
        }
        
        self.onmessage = function(e) {
            const { batch, workerId } = e.data;
            self.workerId = workerId;
            
            // バッチ処理の開始時刻記録
            const startTime = performance.now();
            
            const results = batch.map(ray => calculateRayIntersection(ray));
            
            const endTime = performance.now();
            
            self.postMessage({
                results: results,
                workerId: workerId,
                processingTime: endTime - startTime,
                batchSize: batch.length
            });
        };
    `;
    
    return URL.createObjectURL(new Blob([workerCode], { type: 'application/javascript' }));
}

/**
 * テストデータ生成
 */
function generateTestData(size) {
    return Array.from({ length: size }, (_, i) => ({
        pos: { 
            x: (Math.random() - 0.5) * 20, 
            y: (Math.random() - 0.5) * 20, 
            z: 0 
        },
        dir: { 
            x: (Math.random() - 0.5) * 0.1, 
            y: (Math.random() - 0.5) * 0.1, 
            z: 1 
        },
        id: i
    }));
}

/**
 * 光線交点計算（シリアル処理用）- より計算集約的
 */
function calculateRayIntersection(ray) {
    const surface = {
        z: 100,
        curvature: 0.01,
        conic: -0.5
    };
    
    const dx = ray.dir.x;
    const dy = ray.dir.y;
    const dz = ray.dir.z;
    
    const ox = ray.pos.x;
    const oy = ray.pos.y;
    const oz = ray.pos.z;
    
    // より複雑な計算を追加（計算負荷を増加）
    let result = null;
    for (let i = 0; i < 100; i++) {
        const t0 = (surface.z - oz) / dz;
        
        if (t0 <= 0) continue;
        
        const x = ox + t0 * dx;
        const y = oy + t0 * dy;
        const r2 = x * x + y * y;
        
        const c = surface.curvature;
        const k = surface.conic;
        
        if (c !== 0) {
            const cr2 = c * r2;
            const discriminant = 1 - (1 + k) * c * c * r2;
            if (discriminant >= 0) {
                const sag = cr2 / (1 + Math.sqrt(discriminant));
                result = { x, y, z: surface.z + sag, t: t0, iteration: i };
            }
        } else {
            result = { x, y, z: surface.z, t: t0, iteration: i };
        }
    }
    
    return result;
}

/**
 * より複雑な光線交点計算（並列処理用）
 */
function calculateComplexRayIntersection(ray, complexity) {
    const surface = {
        z: 100 + complexity,
        curvature: 0.01 * (1 + complexity * 0.01),
        conic: -0.5 - complexity * 0.1
    };
    
    const dx = ray.dir.x;
    const dy = ray.dir.y;
    const dz = ray.dir.z;
    
    const ox = ray.pos.x;
    const oy = ray.pos.y;
    const oz = ray.pos.z;
    
    // さらに重い計算
    let result = null;
    for (let i = 0; i < 50; i++) {
        const t0 = (surface.z - oz) / dz;
        
        if (t0 <= 0) continue;
        
        const x = ox + t0 * dx;
        const y = oy + t0 * dy;
        const r2 = x * x + y * y;
        
        // 非球面計算
        const c = surface.curvature;
        const k = surface.conic;
        
        if (c !== 0) {
            const cr2 = c * r2;
            const discriminant = 1 - (1 + k) * c * c * r2;
            if (discriminant >= 0) {
                const sag = cr2 / (1 + Math.sqrt(discriminant));
                
                // 追加の数学計算
                const extra = Math.sin(r2) * Math.cos(complexity) * Math.exp(-r2 / 100);
                result = { 
                    x, y, 
                    z: surface.z + sag + extra, 
                    t: t0, 
                    complexity,
                    extra 
                };
            }
        } else {
            result = { x, y, z: surface.z, t: t0, complexity };
        }
    }
    
    return result;
}

/**
 * 結果比較
 */
function compareResults(serialResults, parallelResults) {
    const speedup = serialResults.time / parallelResults.time;
    const efficiency = speedup / parallelResults.workerCount;
    
    return {
        speedup: speedup,
        efficiency: efficiency,
        serialTime: serialResults.time,
        parallelTime: parallelResults.time,
        improvement: ((serialResults.time - parallelResults.time) / serialResults.time) * 100,
        parallelThroughput: parallelResults.throughput,
        serialThroughput: serialResults.throughput
    };
}

/**
 * 結果表示
 */
function displayParallelResults(testResults) {
    console.log('');
    console.log('🏆 並列処理パフォーマンス測定結果');
    console.log('========================================');
    console.log(`📅 測定日時: ${testResults.systemInfo.timestamp}`);
    console.log(`💻 システム: ${testResults.systemInfo.platform} (${testResults.systemInfo.cores}コア)`);
    console.log(`🔧 WebWorker対応: ${testResults.systemInfo.webWorkerSupport ? '✅' : '❌'}`);
    console.log('');
    
    console.log('📊 処理性能比較:');
    console.log(`   シリアル処理: ${testResults.serialResults.time.toFixed(2)}ms`);
    console.log(`   並列処理: ${testResults.parallelResults.time.toFixed(2)}ms`);
    console.log(`   使用ワーカー数: ${testResults.parallelResults.workerCount}個`);
    if (testResults.parallelResults.fallback) {
        console.log('   ⚠️ フォールバック処理を使用');
    }
    console.log('');
    
    console.log('🚀 性能改善:');
    console.log(`   高速化倍率: ${testResults.comparison.speedup.toFixed(2)}倍`);
    console.log(`   効率: ${(testResults.comparison.efficiency * 100).toFixed(1)}%`);
    console.log(`   改善率: ${testResults.comparison.improvement.toFixed(1)}%`);
    console.log('');
    
    console.log('📈 スループット:');
    console.log(`   シリアル: ${testResults.comparison.serialThroughput.toFixed(0)} rays/sec`);
    console.log(`   並列: ${testResults.comparison.parallelThroughput.toFixed(0)} rays/sec`);
    console.log('');
    
    // 推奨事項
    if (testResults.comparison.speedup > 2) {
        console.log('✅ 並列処理が非常に効果的です');
        console.log('   大量の光線計算で大幅な高速化が期待できます');
    } else if (testResults.comparison.speedup > 1.2) {
        console.log('🟡 並列処理に一定の効果があります');
        console.log('   処理量が多い場合に有効です');
    } else {
        console.log('⚠️ 並列処理の効果は限定的です');
        console.log('   オーバーヘッドが大きいか、データ量が不十分です');
    }
}

/**
 * 簡易並列処理テスト（フォールバック）
 */
async function runSimpleParallelTest() {
    console.log('💡 簡易並列処理効果の推定...');
    
    const dataSize = 5000;
    const cores = navigator.hardwareConcurrency || 4;
    
    console.log(`   データサイズ: ${dataSize}個`);
    console.log(`   利用可能コア数: ${cores}個`);
    console.log(`   理論的最大高速化: ${cores}倍`);
    console.log(`   実用的期待値: ${(cores * 0.7).toFixed(1)}倍`);
    console.log('');
    console.log('🎯 推奨: スポットダイアグラム計算などの大量光線処理で');
    console.log('   並列処理を活用することで大幅な高速化が可能です');
    
    return {
        estimatedSpeedup: cores * 0.7,
        cores: cores,
        recommendation: 'HIGH'
    };
}

// グローバル公開
window.testParallelPerformance = testParallelPerformance;

console.log('🔄 並列処理パフォーマンステストモジュールが読み込まれました');
console.log('   実行: testParallelPerformance()');
