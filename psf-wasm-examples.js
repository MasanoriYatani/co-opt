/**
 * PSF Calculator WebAssembly Integration Examples
 * WebAssembly対応PSF計算システムの使用例
 * 
 * 作成日: 2025/08/08
 */

console.log('📚 [PSF-WASM] WebAssembly PSF Calculator Examples');

// =============================================================================
// 基本的な使用例
// =============================================================================

/**
 * 例1: 自動選択モードでのPSF計算
 */
async function example1_AutoMode() {
    console.log('\n🔬 [Example 1] Auto Mode PSF Calculation');
    
    try {
        // PSF計算器を初期化（自動的にWASM/JSを選択）
        const { PSFCalculatorAuto } = await import('./psf-wasm-wrapper.js');
        const calculator = new PSFCalculatorAuto();
        
        // テスト用OPDデータ生成
        const testOPDData = generateTestOPDData();
        
        // PSF計算実行（自動選択）
        const primaryWL = (typeof window !== 'undefined' && typeof window.getPrimaryWavelength === 'function')
            ? Number(window.getPrimaryWavelength()) || 0.5876
            : 0.5876;
        const result = await calculator.calculatePSF(testOPDData, {
            samplingSize: 128,
            wavelength: primaryWL
        });
        
        console.log('✅ PSF計算完了:', {
            method: result.metadata?.method,
            executionTime: result.metadata?.executionTime,
            strehlRatio: result.strehlRatio,
            rayCount: result.metadata?.rayCount
        });
        
        return result;
        
    } catch (error) {
        console.error('❌ Example 1 failed:', error);
    }
}

/**
 * 例2: WASM強制使用
 */
async function example2_ForceWASM() {
    console.log('\n🚀 [Example 2] Force WASM Implementation');
    
    try {
        const { PSFCalculatorAuto } = await import('./psf-wasm-wrapper.js');
        const calculator = new PSFCalculatorAuto();
        
        // WASM使用を強制
        calculator.setImplementation('wasm');
        
        const testOPDData = generateTestOPDData();
        
        const primaryWL = (typeof window !== 'undefined' && typeof window.getPrimaryWavelength === 'function')
            ? Number(window.getPrimaryWavelength()) || 0.5876
            : 0.5876;
        const result = await calculator.calculatePSF(testOPDData, {
            samplingSize: 256, // 大きなサイズでWASMの効果を確認
            wavelength: primaryWL
        });
        
        console.log('✅ WASM PSF計算完了:', {
            method: result.metadata?.method,
            executionTime: result.metadata?.executionTime,
            samplingSize: '256x256'
        });
        
        return result;
        
    } catch (error) {
        console.error('❌ Example 2 failed:', error);
    }
}

/**
 * 例3: JavaScript強制使用
 */
async function example3_ForceJavaScript() {
    console.log('\n📱 [Example 3] Force JavaScript Implementation');
    
    try {
        const { PSFCalculatorAuto } = await import('./psf-wasm-wrapper.js');
        const calculator = new PSFCalculatorAuto();
        
        // JavaScript使用を強制
        calculator.setImplementation('javascript');
        
        const testOPDData = generateTestOPDData();
        
        const primaryWL = (typeof window !== 'undefined' && typeof window.getPrimaryWavelength === 'function')
            ? Number(window.getPrimaryWavelength()) || 0.5876
            : 0.5876;
        const result = await calculator.calculatePSF(testOPDData, {
            samplingSize: 64,
            wavelength: primaryWL
        });
        
        console.log('✅ JavaScript PSF計算完了:', {
            method: result.metadata?.method,
            executionTime: result.metadata?.executionTime,
            samplingSize: '64x64'
        });
        
        return result;
        
    } catch (error) {
        console.error('❌ Example 3 failed:', error);
    }
}

/**
 * 例4: パフォーマンス比較ベンチマーク
 */
async function example4_PerformanceBenchmark() {
    console.log('\n📊 [Example 4] Performance Benchmark');
    
    try {
        const { PSFCalculatorAuto } = await import('./psf-wasm-wrapper.js');
        const calculator = new PSFCalculatorAuto();
        
        const testOPDData = generateTestOPDData();
        const testSizes = [32, 64, 128];
        const benchmarkResults = [];
        
        for (const size of testSizes) {
            console.log(`\n🔄 Testing size: ${size}x${size}`);
            
            // WASM版テスト
            let wasmTime = 0;
            try {
                const wasmStart = performance.now();
                await calculator.calculatePSF(testOPDData, {
                    samplingSize: size,
                    forceImplementation: 'wasm'
                });
                wasmTime = performance.now() - wasmStart;
                console.log(`  🚀 WASM: ${wasmTime.toFixed(2)}ms`);
            } catch (error) {
                console.warn(`  ⚠️ WASM failed: ${error.message}`);
                wasmTime = null;
            }
            
            // JavaScript版テスト
            const jsStart = performance.now();
            await calculator.calculatePSF(testOPDData, {
                samplingSize: size,
                forceImplementation: 'javascript'
            });
            const jsTime = performance.now() - jsStart;
            console.log(`  📱 JS: ${jsTime.toFixed(2)}ms`);
            
            const speedup = wasmTime ? (jsTime / wasmTime) : null;
            
            benchmarkResults.push({
                size: size,
                wasmTime: wasmTime,
                jsTime: jsTime,
                speedup: speedup
            });
            
            if (speedup) {
                console.log(`  📈 Speedup: ${speedup.toFixed(2)}x`);
            }
        }
        
        // パフォーマンス統計取得
        const performanceData = calculator.getPerformanceStats();
        console.log('\n📊 Overall Performance Statistics:');
        console.log(`  WASM calls: ${performanceData.wasmCalls}`);
        console.log(`  JS fallbacks: ${performanceData.jsFallbacks}`);
        console.log(`  Average WASM time: ${performanceData.averageWasmTime?.toFixed(2) || 'N/A'}ms`);
        console.log(`  Average JS time: ${performanceData.averageJSTime?.toFixed(2) || 'N/A'}ms`);
        console.log(`  Overall speedup: ${performanceData.speedup?.toFixed(2) || 'N/A'}x`);
        
        return benchmarkResults;
        
    } catch (error) {
        console.error('❌ Example 4 failed:', error);
    }
}

/**
 * 例5: リアルタイム光学解析シミュレーション
 */
async function example5_RealtimeAnalysis() {
    console.log('\n⚡ [Example 5] Realtime Optical Analysis Simulation');
    
    try {
        const { PSFCalculatorAuto } = await import('./psf-wasm-wrapper.js');
        const calculator = new PSFCalculatorAuto();
        
        // 自動選択モード（大きなサンプリングサイズでWASMを優先）
        calculator.setImplementation('auto');
        
        // 複数の光学条件でリアルタイム計算をシミュレート
        const primaryWL = (typeof window !== 'undefined' && typeof window.getPrimaryWavelength === 'function')
            ? Number(window.getPrimaryWavelength()) || 0.5876
            : 0.5876;
        const wavelengths = [primaryWL, 0.48, 0.65]; // 主波長+RGB
        const realtimeResults = [];
        
        console.log('🔄 Simulating realtime PSF calculations...');
        
        for (let i = 0; i < wavelengths.length; i++) {
            const wavelength = wavelengths[i];
            const testOPDData = generateTestOPDData(60, wavelength); // 波長依存OPD
            
            const start = performance.now();
            const result = await calculator.calculatePSF(testOPDData, {
                samplingSize: 128,
                wavelength: wavelength
            });
            const executionTime = performance.now() - start;
            
            realtimeResults.push({
                wavelength: wavelength,
                method: result.metadata?.method,
                executionTime: executionTime,
                strehlRatio: result.strehlRatio
            });
            
            console.log(`  λ=${wavelength}μm: ${executionTime.toFixed(2)}ms (${result.metadata?.method})`);
        }
        
        const avgTime = realtimeResults.reduce((sum, r) => sum + r.executionTime, 0) / realtimeResults.length;
        const fps = 1000 / avgTime;
        
        console.log(`✅ Realtime simulation complete:`);
        console.log(`  Average calculation time: ${avgTime.toFixed(2)}ms`);
        console.log(`  Estimated FPS: ${fps.toFixed(1)} Hz`);
        console.log(`  Realtime capability: ${fps > 10 ? '✅ Excellent' : fps > 5 ? '⚠️ Good' : '❌ Limited'}`);
        
        return realtimeResults;
        
    } catch (error) {
        console.error('❌ Example 5 failed:', error);
    }
}

// =============================================================================
// ヘルパー関数
// =============================================================================

/**
 * テスト用OPDデータ生成
 * @param {number} rayCount 光線数
 * @param {number} wavelength 波長（収差の波長依存性をシミュレート）
 * @returns {Object} OPDデータ
 */
function generateTestOPDData(rayCount = 50, wavelength = 0.55) {
    const rayData = [];
    const center = rayCount / 2;
    
    for (let i = 0; i < rayCount; i++) {
        for (let j = 0; j < rayCount; j++) {
            const x = (i - center) / center;
            const y = (j - center) / center;
            const radius = Math.sqrt(x * x + y * y);
            
            if (radius <= 1.0) { // 円形瞳内
                // 色収差と球面収差をシミュレート
                const sphericalAberration = 0.1 * Math.sin(radius * Math.PI);
                const chromaticAberration = 0.05 * (wavelength - 0.55) * radius * radius;
                const opd = sphericalAberration + chromaticAberration;
                
                rayData.push({
                    pupilX: x,
                    pupilY: y,
                    opd: opd,
                    isVignetted: false
                });
            }
        }
    }
    
    return { rayData };
}

/**
 * WASM利用状況の診断
 */
async function diagnosticWasmStatus() {
    console.log('\n🔍 [Diagnostic] WebAssembly Status Check');
    
    try {
        const { PSFCalculatorAuto } = await import('./psf-wasm-wrapper.js');
        const calculator = new PSFCalculatorAuto();
        
        // 初期化待機
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        const wasmStatus = calculator.getWasmStatus();
        
        console.log('📋 WASM Status Report:');
        console.log(`  Available: ${wasmStatus.available ? '✅' : '❌'}`);
        console.log(`  Ready: ${wasmStatus.ready ? '✅' : '❌'}`);
        console.log(`  Current Mode: ${wasmStatus.currentMode}`);
        console.log(`  Recommended for 128x128: ${wasmStatus.recommendedForSize(128) ? '✅' : '❌'}`);
        
        // ブラウザ環境チェック
        const browserSupport = {
            webassembly: typeof WebAssembly !== 'undefined',
            sharedArrayBuffer: typeof SharedArrayBuffer !== 'undefined',
            worker: typeof Worker !== 'undefined'
        };
        
        console.log('🌐 Browser Support:');
        Object.entries(browserSupport).forEach(([feature, supported]) => {
            console.log(`  ${feature}: ${supported ? '✅' : '❌'}`);
        });
        
        return { wasmStatus, browserSupport };
        
    } catch (error) {
        console.error('❌ Diagnostic failed:', error);
    }
}

// =============================================================================
// 実行例
// =============================================================================

/**
 * 全ての例を順次実行
 */
async function runAllExamples() {
    console.log('🚀 [PSF-WASM] Running All Examples');
    console.log('================================');
    
    // 診断実行
    await diagnosticWasmStatus();
    
    // 各例を実行
    await example1_AutoMode();
    await example2_ForceWASM();
    await example3_ForceJavaScript();
    await example4_PerformanceBenchmark();
    await example5_RealtimeAnalysis();
    
    console.log('\n✅ All examples completed!');
}

// 個別実行用のエクスポート
export {
    example1_AutoMode,
    example2_ForceWASM,
    example3_ForceJavaScript,
    example4_PerformanceBenchmark,
    example5_RealtimeAnalysis,
    diagnosticWasmStatus,
    runAllExamples,
    generateTestOPDData
};

// ブラウザコンソールで直接実行可能にする
if (typeof window !== 'undefined') {
    window.PSFWasmExamples = {
        runAllExamples,
        example1_AutoMode,
        example2_ForceWASM,
        example3_ForceJavaScript,
        example4_PerformanceBenchmark,
        example5_RealtimeAnalysis,
        diagnosticWasmStatus
    };
    
    console.log('💡 [PSF-WASM] Examples available in console as:');
    console.log('  PSFWasmExamples.runAllExamples()');
    console.log('  PSFWasmExamples.example1_AutoMode()');
    console.log('  PSFWasmExamples.diagnosticWasmStatus()');
}
