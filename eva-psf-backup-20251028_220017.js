/**
 * Point Spread Function Calculator from Optical Path Difference
 * OPDからPSF計算システム（WebAssembly対応版）
 * 
 * 機能:
 * - OPDデータからフーリエ変換によるPSF計算
 * - 複数サンプリング数対応（32x, 64x, 128x, 256x, 512x, 1024x, 2048x）
 * - Strehl比、エンサークルドエネルギー、FWHM計算
 * - 2D/3Dヒートマップ対応
 * - WebAssembly高速化サポート
 * 
 * 作成日: 2025/08/07
 * WASM対応: 2025/08/08
 */

// WebAssembly版PSF計算器のインポート（動的）
let PSFCalculatorWasm = null;
let PSFCalculatorAuto = null;

// WASM版PSF計算器のインポート
let WasmCalculatorClass = null;

// WASM版PSF計算器の直接ロード
async function loadWasmCalculatorDirect() {
    if (!WasmCalculatorClass) {
        try {
            const wasmModule = await import('./psf-wasm-wrapper.js');
            WasmCalculatorClass = wasmModule.PSFCalculatorWasm;
            console.log('📦 [PSF] WASM calculator module loaded directly');
            return WasmCalculatorClass;
        } catch (error) {
            console.warn('⚠️ [PSF] Failed to load WASM calculator:', error);
            return null;
        }
    }
    return WasmCalculatorClass;
}

/**
 * 簡易FFT実装（Cooley-Tukey アルゴリズム）
 */
class SimpleFFT {
    static fft2D(real, imag) {
        const N = real.length;
        const M = real[0].length;
        
        // 行方向のFFT
        for (let i = 0; i < N; i++) {
            const result = this.fft1D(real[i], imag[i]);
            real[i] = result.real;
            imag[i] = result.imag;
        }
        
        // 列方向のFFT
        for (let j = 0; j < M; j++) {
            const realCol = [];
            const imagCol = [];
            for (let i = 0; i < N; i++) {
                realCol[i] = real[i][j];
                imagCol[i] = imag[i][j];
            }
            
            const result = this.fft1D(realCol, imagCol);
            for (let i = 0; i < N; i++) {
                real[i][j] = result.real[i];
                imag[i][j] = result.imag[i];
            }
        }
        
        return { real, imag };
    }
    
    static fft1D(real, imag) {
        const N = real.length;
        if (N <= 1) return { real: [...real], imag: [...imag] };
        
        // ビット逆順並べ替え
        const realOut = new Array(N);
        const imagOut = new Array(N);
        for (let i = 0; i < N; i++) {
            const j = this.reverseBits(i, Math.log2(N));
            realOut[j] = real[i];
            imagOut[j] = imag[i];
        }
        
        // バタフライ演算
        for (let s = 1; s <= Math.log2(N); s++) {
            const m = 1 << s;
            const wm = { real: Math.cos(-2 * Math.PI / m), imag: Math.sin(-2 * Math.PI / m) };
            
            for (let k = 0; k < N; k += m) {
                let w = { real: 1, imag: 0 };
                
                for (let j = 0; j < m / 2; j++) {
                    const t = {
                        real: w.real * realOut[k + j + m / 2] - w.imag * imagOut[k + j + m / 2],
                        imag: w.real * imagOut[k + j + m / 2] + w.imag * realOut[k + j + m / 2]
                    };
                    const u = { real: realOut[k + j], imag: imagOut[k + j] };
                    
                    realOut[k + j] = u.real + t.real;
                    imagOut[k + j] = u.imag + t.imag;
                    realOut[k + j + m / 2] = u.real - t.real;
                    imagOut[k + j + m / 2] = u.imag - t.imag;
                    
                    const wNext = {
                        real: w.real * wm.real - w.imag * wm.imag,
                        imag: w.real * wm.imag + w.imag * wm.real
                    };
                    w = wNext;
                }
            }
        }
        
        return { real: realOut, imag: imagOut };
    }
    
    static reverseBits(num, numBits) {
        let result = 0;
        for (let i = 0; i < numBits; i++) {
            result = (result << 1) | (num & 1);
            num >>= 1;
        }
        return result;
    }
}

/**
 * OPDからPSFを計算するメインクラス（WASM対応）
 */
export class PSFCalculator {
    constructor() {
        this.lastCalculationData = null;
                this.supportedSamplings = [32, 64, 128, 256, 512, 1024, 2048];
        this.wasmCalculator = null;
        this.useWasm = true; // WASM使用フラグ
        this.performanceMode = 'auto'; // 'auto', 'wasm', 'javascript'
    this.spatialBinsOverride = null; // 補間用の空間インデックス分割数（nullで自動）
        
        // WASM計算器の初期化（非同期）
        this.initializeWasmCalculator();
    }

    /**
     * 補間用の空間インデックス分割数を設定（nullで自動計算に戻す）
     * @param {number|null} bins
     */
    setSpatialBins(bins) {
        if (bins == null) {
            this.spatialBinsOverride = null;
            return;
        }
        const n = Math.max(4, Math.min(256, Math.floor(bins)));
        this.spatialBinsOverride = n;
    }

    /**
     * WASM計算器の初期化
     */
    async initializeWasmCalculator() {
        try {
            const WasmCalculatorClass = await loadWasmCalculatorDirect();
            if (WasmCalculatorClass) {
                this.wasmCalculator = new WasmCalculatorClass();
                console.log('🚀 [PSF] WASM calculator initialized');
                
                // WASM初期化を待機
                if (this.wasmCalculator.initializeWasm) {
                    await this.wasmCalculator.initializeWasm();
                }
                
                // 初期化状態を確認
                if (this.wasmCalculator.isReady) {
                    console.log('✅ [PSF] WASM calculator ready for use');
                } else if (this.wasmCalculator.initializationFailed) {
                    console.warn('⚠️ [PSF] WASM initialization failed, JavaScript fallback will be used');
                    this.wasmCalculator = null;
                }
            }
        } catch (error) {
            console.warn('⚠️ [PSF] WASM calculator initialization failed:', error);
            this.wasmCalculator = null;
        }
    }

    /**
     * Sourceから主波長を取得
     * @returns {number} 波長（μm）
     */
    getSourceWavelength() {
        try {
            if (typeof window !== 'undefined') {
                // 第一候補: Sourceテーブルの主波長
                if (typeof window.getPrimaryWavelength === 'function') {
                    const wl = Number(window.getPrimaryWavelength());
                    if (isFinite(wl) && wl > 0) {
                        console.log(`🌈 [PSF] 主波長（Source）を使用: ${wl}μm`);
                        return wl;
                    }
                }

                // フォールバック: tableSource から直接取得
                if (window.tableSource && typeof window.tableSource.getData === 'function') {
                    const data = window.tableSource.getData();
                    const primary = Array.isArray(data) ? data.find(r => r.primary === 'Primary Wavelength') : null;
                    const wl = primary ? Number(primary.wavelength) : NaN;
                    if (isFinite(wl) && wl > 0) {
                        console.log(`🌈 [PSF] 主波長（tableSource）を使用: ${wl}μm`);
                        return wl;
                    }
                }
            }

            // デフォルト値（d線近傍）
            console.log('⚠️ [PSF] 主波長が未設定のため既定値を使用: 0.5876μm');
            return 0.5876;
        } catch (error) {
            console.warn('⚠️ [PSF] 主波長取得エラー:', error);
            return 0.5876;
        }
    }

    /**
     * OPDデータからPSFを計算（WASM対応）
     * @param {Object} opdData - OPD計算結果
     * @param {Object} options - 計算オプション
     * @returns {Object} PSF計算結果
     */
    async calculatePSF(opdData, options = {}) {
        const {
            samplingSize = 128,
            wavelength = null,
            pupilDiameter = 10.0, // mm
            focalLength = 100.0,   // mm
            pixelSize = null,
            forceImplementation = null // 'wasm', 'javascript', または null（自動選択）
        } = options;

        console.log('🔬 [PSF] PSF計算開始');

        // 実装方法を決定
        const useWasm = this.shouldUseWasm(samplingSize, forceImplementation);
        
        console.log('🎯 [PSF] Implementation selection:', {
            samplingSize: `${samplingSize}x${samplingSize}`,
            forceImplementation,
            wasmAvailable: !!this.wasmCalculator,
            wasmReady: this.wasmCalculator ? this.wasmCalculator.isReady : false,
            shouldUseWasm: useWasm,
            finalImplementation: useWasm && this.wasmCalculator && this.wasmCalculator.isReady ? 'WASM' : 'JavaScript'
        });
        
        if (useWasm && this.wasmCalculator && this.wasmCalculator.isReady) {
            try {
                console.log('🚀 [PSF] Using WebAssembly implementation');
                const wasmStartTime = performance.now();
                
                // WASM計算器のメソッドを直接呼び出し
                const wasmResult = await this.wasmCalculator.calculatePSFWasm(opdData, {
                    samplingSize,
                    wavelength: wavelength || this.getSourceWavelength(),
                    pupilDiameter,
                    focalLength,
                    ...options
                });
                
                const wasmEndTime = performance.now();
                console.log(`✅ [PSF] WASM calculation completed in ${(wasmEndTime - wasmStartTime).toFixed(1)}ms`);
                
                // WASM結果をPSFCalculator形式に変換
                const result = this.convertWasmResultToStandardFormat(wasmResult, samplingSize, wavelength || this.getSourceWavelength());
                result.calculationTime = wasmEndTime - wasmStartTime;
                result.implementationUsed = 'WASM';
                return result;
                
            } catch (error) {
                console.warn('⚠️ [PSF] WASM calculation failed, falling back to JavaScript:', error);
                // JavaScript版にフォールバック
            }
        }

        console.log('📱 [PSF] Using JavaScript implementation');
        const jsStartTime = performance.now();
        const result = await this.calculatePSFJavaScript(opdData, options);
        const jsEndTime = performance.now();
        
        console.log(`✅ [PSF] JavaScript calculation completed in ${(jsEndTime - jsStartTime).toFixed(1)}ms`);
        result.calculationTime = jsEndTime - jsStartTime;
        result.implementationUsed = 'JavaScript';
        return result;
    }

    /**
     * WASM使用判定
     * @param {number} samplingSize サンプリングサイズ
     * @param {string} forceImplementation 強制実装指定
     * @returns {boolean} WASM使用するかどうか
     */
    shouldUseWasm(samplingSize, forceImplementation) {
        if (forceImplementation === 'javascript') return false;
        if (forceImplementation === 'wasm') return true;
        
        // 自動判定：大きなサンプリングサイズではWASMを優先
        if (!this.wasmCalculator) return false;
        if (this.performanceMode === 'javascript') return false;
        if (this.performanceMode === 'wasm') return true;
        
        // auto mode: サンプリングサイズが64以上でWASMを使用
        return samplingSize >= 64;
    }

    /**
     * WASM計算結果を標準PSFCalculator形式に変換
     * @param {Object} wasmResult WASM計算結果
     * @param {number} samplingSize サンプリングサイズ
     * @param {number} wavelength 波長
     * @returns {Object} 標準形式のPSF結果
     */
    convertWasmResultToStandardFormat(wasmResult, samplingSize, wavelength) {
        if (!wasmResult) {
            throw new Error('Invalid WASM result');
        }

        return {
            psf: wasmResult.psf || wasmResult.intensity,
            strehlRatio: wasmResult.strehlRatio,
            fwhm: wasmResult.fwhm || { x: 0, y: 0 },
            encircledEnergy: wasmResult.encircledEnergy || { radii: [], values: [] },
            wavelength,
            metadata: {
                ...wasmResult.metadata,
                samplingSize,
                wavelength,
                calculator: 'wasm-integrated',
                pixelSize: this.calculatePixelSize(wavelength, 100.0, samplingSize),
                method: 'wasm'
            },
            // PSFCalculator互換フィールド
            rayCount: wasmResult.metadata?.rayCount || 0,
            executionTime: wasmResult.metadata?.executionTime || 0
        };
    }

    /**
     * JavaScript版PSF計算（詳細計測付き）
     * @param {Object} opdData - OPD計算結果
     * @param {Object} options - 計算オプション
     * @returns {Object} PSF計算結果
     */
    async calculatePSFJavaScript(opdData, options = {}) {
        const {
            samplingSize = 128,
            wavelength = null,
            pupilDiameter = 10.0, // mm
            focalLength = 100.0,   // mm
            pixelSize = null
        } = options;

        console.log('🔬 [PSF] JavaScript PSF計算開始');
        console.log(`📊 [PSF] サンプリングサイズ: ${samplingSize}x${samplingSize}`);

        // 詳細計測開始
        const totalStartTime = performance.now();
        const breakdown = {};

        // 入力データ検証
        if (!opdData || !opdData.rayData) {
            throw new Error('有効なOPDデータが必要です');
        }

        if (!this.supportedSamplings.includes(samplingSize)) {
            throw new Error(`サポートされていないサンプリングサイズ: ${samplingSize}`);
        }

        // 波長を取得
        const effectiveWavelength = wavelength || this.getSourceWavelength();
        console.log(`🌈 [PSF] 使用波長: ${effectiveWavelength}μm`);

        // 1. OPDデータを格子データに変換（計測）
        const gridStartTime = performance.now();
        const gridData = this.convertOPDToGrid(opdData, samplingSize);
        breakdown.interpolationTime = performance.now() - gridStartTime;
        
        // 2. 複素振幅を計算（計測）
        const complexStartTime = performance.now();
        const complexAmplitude = this.calculateComplexAmplitude(gridData, effectiveWavelength);
        breakdown.complexAmplitudeTime = performance.now() - complexStartTime;
        
        // 3. フーリエ変換でPSFを計算（計測）
        const fftStartTime = performance.now();
        const psfData = this.performFFT(complexAmplitude);
        breakdown.fftTime = performance.now() - fftStartTime;
        
        // 4. PSF評価指標を計算（計測）
        const metricsStartTime = performance.now();
        const metrics = this.calculatePSFMetrics(psfData, {
            wavelength: effectiveWavelength,
            pupilDiameter,
            focalLength,
            pixelSize: pixelSize || this.calculatePixelSize(effectiveWavelength, focalLength, samplingSize)
        });
        breakdown.metricsTime = performance.now() - metricsStartTime;
        
        const totalTime = performance.now() - totalStartTime;

        const result = {
            psfData,
            metrics,
            samplingSize,
            wavelength: effectiveWavelength,
            gridData,
            options: { pupilDiameter, focalLength },
            timestamp: new Date().toISOString(),
            metadata: {
                ...breakdown,
                totalTime,
                method: 'javascript',
                samplingSize,
                wavelength: effectiveWavelength
            }
        };

        this.lastCalculationData = result;
        
        console.log(`✅ [PSF] JavaScript PSF計算完了 (${totalTime.toFixed(1)}ms)`, {
            'Interpolation': `${breakdown.interpolationTime.toFixed(1)}ms`,
            'Complex Amplitude': `${breakdown.complexAmplitudeTime.toFixed(1)}ms`,
            'FFT': `${breakdown.fftTime.toFixed(1)}ms`,
            'Metrics': `${breakdown.metricsTime.toFixed(1)}ms`
        });
        
        return result;
    }

    /**
     * OPDデータを規則的な格子に変換
     * @param {Object} opdData - OPD計算結果
     * @param {number} samplingSize - サンプリングサイズ
     * @returns {Object} 格子データ
     */
    convertOPDToGrid(opdData, samplingSize) {
        console.log('📐 [PSF] OPDデータを格子に変換中...');
        // 内部配列に TypedArray を使用して数値アクセスを高速化（外側は通常配列で互換性維持）
        const grid = {
            opd: Array.from({ length: samplingSize }, () => new Float32Array(samplingSize)),
            amplitude: Array.from({ length: samplingSize }, () => new Float32Array(samplingSize)),
            pupilMask: Array.from({ length: samplingSize }, () => Array(samplingSize).fill(false))
        };

        // 有効な光線データを取得
        const validRays = opdData.rayData.filter(ray => !ray.isVignetted && !isNaN(ray.opd));
        console.log(`📊 [PSF] 有効光線数: ${validRays.length}/${opdData.rayData.length}`);

        if (validRays.length === 0) {
            console.warn('⚠️ [PSF] 有効な光線がありません');
            return grid;
        }

        // 瞳座標の範囲を取得
        const pupilCoords = validRays.map(ray => ({ x: ray.pupilX, y: ray.pupilY }));
        const bounds = this.calculateBounds(pupilCoords);

        // 空間インデックスを構築（等間隔バケツ分割）
        const index = this.buildRaySpatialIndex(validRays, bounds, samplingSize);

        // グリッド座標を前計算（X/Y それぞれ一次元配列）
        const gridXs = new Float32Array(samplingSize);
        const gridYs = new Float32Array(samplingSize);
        const dx = (bounds.maxX - bounds.minX) / (samplingSize - 1 || 1);
        const dy = (bounds.maxY - bounds.minY) / (samplingSize - 1 || 1);
        for (let i = 0, x = bounds.minX; i < samplingSize; i++, x += dx) gridXs[i] = x;
        for (let j = 0, y = bounds.minY; j < samplingSize; j++, y += dy) gridYs[j] = y;

        const maxRadius = Math.max(Math.abs(bounds.maxX), Math.abs(bounds.maxY));

        // 格子点への補間（空間インデックス利用）
        for (let i = 0; i < samplingSize; i++) {
            const gx = gridXs[i];
            for (let j = 0; j < samplingSize; j++) {
                const gy = gridYs[j];

                // 円形瞳の範囲内かチェック
                const r2 = gx * gx + gy * gy;
                if (r2 <= maxRadius * maxRadius) {
                    grid.pupilMask[i][j] = true;

                    // 空間インデックスから近傍最近傍（概ね最短）を取得
                    const interpolatedOPD = this.interpolateOPDUsingIndex(gx, gy, index);
                    grid.opd[i][j] = interpolatedOPD;
                    grid.amplitude[i][j] = 1.0; // 均一振幅
                }
            }
        }

        console.log('✅ [PSF] 格子変換完了');
        return grid;
    }

    /**
     * 光線の空間インデックス（等間隔バケツ）を構築
     * @param {Array} rays - 有効光線データ（pupilX, pupilY, opd）
     * @param {Object} bounds - {minX, maxX, minY, maxY}
     * @param {number} samplingSize - グリッドサイズ（バケツ数の目安）
     * @returns {Object} インデックス情報
     */
    buildRaySpatialIndex(rays, bounds, samplingSize) {
        // バケツ数：明示指定があれば優先、なければグリッドの半分程度を上限64にクリップ
        const autoBins = Math.min(64, Math.max(8, Math.floor(samplingSize / 2)));
        const bins = this.spatialBinsOverride ?? autoBins;
        const buckets = Array.from({ length: bins * bins }, () => []);

        // 連続配列でプロパティアクセスを削減
        const n = rays.length;
        const rx = new Float32Array(n);
        const ry = new Float32Array(n);
        const ropd = new Float32Array(n);

        const rangeX = (bounds.maxX - bounds.minX) || 1e-9;
        const rangeY = (bounds.maxY - bounds.minY) || 1e-9;
        const invX = 1.0 / rangeX;
        const invY = 1.0 / rangeY;

        for (let k = 0; k < n; k++) {
            const r = rays[k];
            const x = r.pupilX;
            const y = r.pupilY;
            rx[k] = x;
            ry[k] = y;
            ropd[k] = r.opd;

            let ix = Math.floor((x - bounds.minX) * invX * bins);
            let iy = Math.floor((y - bounds.minY) * invY * bins);
            if (ix < 0) ix = 0; else if (ix >= bins) ix = bins - 1;
            if (iy < 0) iy = 0; else if (iy >= bins) iy = bins - 1;
            buckets[iy * bins + ix].push(k);
        }

        return { bins, buckets, rx, ry, ropd, bounds, invX, invY };
    }

    /**
     * 空間インデックスを使った最近傍に近い OPD 補間
     * 近傍リングを拡張し、最初に光線が見つかった近傍から最近距離を選ぶ（高精度より速度優先）
     * @param {number} x - グリッドX
     * @param {number} y - グリッドY
     * @param {Object} index - buildRaySpatialIndex の返り値
     * @returns {number} 推定OPD
     */
    interpolateOPDUsingIndex(x, y, index) {
        const { bins, buckets, rx, ry, ropd, bounds, invX, invY } = index;

        let ix = Math.floor((x - bounds.minX) * invX * bins);
        let iy = Math.floor((y - bounds.minY) * invY * bins);
        if (ix < 0) ix = 0; else if (ix >= bins) ix = bins - 1;
        if (iy < 0) iy = 0; else if (iy >= bins) iy = bins - 1;

        // 近傍リングを 0,1,2,... と拡張して探索
        let bestIdx = -1;
        let bestD2 = Infinity;

        for (let r = 0; r < bins; r++) {
            let foundInThisRing = false;
            const minX = Math.max(0, ix - r);
            const maxX = Math.min(bins - 1, ix + r);
            const minY = Math.max(0, iy - r);
            const maxY = Math.min(bins - 1, iy + r);

            for (let cy = minY; cy <= maxY; cy++) {
                for (let cx = minX; cx <= maxX; cx++) {
                    // r==0 のとき中心セルのみ、r>0 のとき正方近傍を走査
                    const cell = buckets[cy * bins + cx];
                    if (cell.length === 0) continue;
                    foundInThisRing = true;
                    for (let t = 0; t < cell.length; t++) {
                        const k = cell[t];
                        const dx = rx[k] - x;
                        const dy = ry[k] - y;
                        const d2 = dx * dx + dy * dy;
                        if (d2 < bestD2) {
                            bestD2 = d2;
                            bestIdx = k;
                        }
                    }
                }
            }

            // 何か候補が見つかったら、現リングのベストを採用して終了（速度優先）
            if (foundInThisRing && bestIdx >= 0) break;
        }

        return bestIdx >= 0 ? ropd[bestIdx] : 0;
    }

    /**
     * 座標の境界を計算
     * @param {Array} coords - 座標配列
     * @returns {Object} 境界情報
     */
    calculateBounds(coords) {
        const xs = coords.map(c => c.x);
        const ys = coords.map(c => c.y);
        
        return {
            minX: Math.min(...xs),
            maxX: Math.max(...xs),
            minY: Math.min(...ys),
            maxY: Math.max(...ys)
        };
    }

    /**
     * OPD値を補間
     * @param {number} x - X座標
     * @param {number} y - Y座標
     * @param {Array} rays - 光線データ
     * @returns {number} 補間されたOPD値
     */
    interpolateOPD(x, y, rays) {
        // 最近傍法（簡易実装）
        let minDistance = Infinity;
        let nearestOPD = 0;
        
        for (const ray of rays) {
            const distance = Math.sqrt((ray.pupilX - x) ** 2 + (ray.pupilY - y) ** 2);
            if (distance < minDistance) {
                minDistance = distance;
                nearestOPD = ray.opd;
            }
        }
        
        return nearestOPD;
    }

    /**
     * 複素振幅を計算
     * @param {Object} gridData - 格子データ
     * @param {number} wavelength - 波長
     * @returns {Object} 複素振幅
     */
    calculateComplexAmplitude(gridData, wavelength) {
        console.log('🌊 [PSF] 複素振幅計算中...');
        
        const size = gridData.opd.length;
        const real = Array(size).fill().map(() => Array(size).fill(0));
        const imag = Array(size).fill().map(() => Array(size).fill(0));
        
        // ピストン除去（OPDの平均値を引く）- Zemaxの標準処理
        let opdSum = 0;
        let validCount = 0;
        for (let i = 0; i < size; i++) {
            for (let j = 0; j < size; j++) {
                if (gridData.pupilMask[i][j]) {
                    opdSum += gridData.opd[i][j];
                    validCount++;
                }
            }
        }
        const opdMean = validCount > 0 ? opdSum / validCount : 0;
        console.log(`📊 [PSF] OPD平均値（ピストン）: ${opdMean.toFixed(6)} μm`);
        
        for (let i = 0; i < size; i++) {
            for (let j = 0; j < size; j++) {
                if (gridData.pupilMask[i][j]) {
                    // OPDは光路差（遅延）なので、位相は負の符号
                    // ピストン除去後のOPDを使用
                    const phase = -2 * Math.PI * (gridData.opd[i][j] - opdMean) / wavelength;
                    const amplitude = gridData.amplitude[i][j];
                    
                    real[i][j] = amplitude * Math.cos(phase);
                    imag[i][j] = amplitude * Math.sin(phase);
                }
            }
        }
        
        console.log('✅ [PSF] 複素振幅計算完了');
        return { real, imag };
    }

    /**
     * フーリエ変換を実行してPSFを計算
     * @param {Object} complexAmplitude - 複素振幅
     * @returns {Array} PSF強度分布
     */
    performFFT(complexAmplitude) {
        console.log('🔄 [PSF] FFT実行中...');
        
        // FFTを実行
        const fftResult = SimpleFFT.fft2D(complexAmplitude.real, complexAmplitude.imag);
        
        // 強度を計算（|複素数|^2）
        const size = fftResult.real.length;
        const intensity = Array(size).fill().map(() => Array(size).fill(0));
        
        let maxIntensity = 0;
        for (let i = 0; i < size; i++) {
            for (let j = 0; j < size; j++) {
                intensity[i][j] = fftResult.real[i][j] ** 2 + fftResult.imag[i][j] ** 2;
                if (intensity[i][j] > maxIntensity) {
                    maxIntensity = intensity[i][j];
                }
            }
        }
        
        // 正規化（ピーク値を1にする）- Zemaxの標準処理
        if (maxIntensity > 0) {
            for (let i = 0; i < size; i++) {
                for (let j = 0; j < size; j++) {
                    intensity[i][j] /= maxIntensity;
                }
            }
        }
        console.log(`📊 [PSF] 最大強度: ${maxIntensity.toExponential(3)}`);
        
        // 中心にシフト（FFTshift）
        const shifted = this.fftShift(intensity);
        
        console.log('✅ [PSF] FFT完了');
        return shifted;
    }

    /**
     * FFTshift（中心に配置）
     * @param {Array} data - 2D配列
     * @returns {Array} シフトされた2D配列
     */
    fftShift(data) {
        const size = data.length;
        const shifted = Array(size).fill().map(() => Array(size).fill(0));
        const half = Math.floor(size / 2);
        
        // 正しいFFTシフト実装
        for (let i = 0; i < size; i++) {
            for (let j = 0; j < size; j++) {
                const srcI = (i < half) ? (i + half) : (i - half);
                const srcJ = (j < half) ? (j + half) : (j - half);
                shifted[i][j] = data[srcI][srcJ];
            }
        }
        
        return shifted;
    }

    /**
     * PSF評価指標を計算
     * @param {Array} psfData - PSF強度分布
     * @param {Object} params - パラメータ
     * @returns {Object} 評価指標
     */
    calculatePSFMetrics(psfData, params) {
        console.log('📊 [PSF] 評価指標計算中...');
        
        const size = psfData.length;
        const center = Math.floor(size / 2);
        
        // 総エネルギー
        const totalEnergy = this.calculateTotalEnergy(psfData);
        
        // ピーク強度
        const peakIntensity = this.findPeakIntensity(psfData);
        
        // Strehl比
        const strehlRatio = this.calculateStrehlRatio(psfData, params);
        
        // FWHM
        const fwhm = this.calculateFWHM(psfData, params.pixelSize);
        
        // エンサークルドエネルギー
        const encircledEnergy = this.calculateEncircledEnergy(psfData, params.pixelSize);
        
        console.log('✅ [PSF] 評価指標計算完了');
        
        return {
            totalEnergy,
            peakIntensity,
            strehlRatio,
            fwhm,
            encircledEnergy,
            centerPosition: { x: center, y: center }
        };
    }

    /**
     * 総エネルギーを計算
     * @param {Array} psfData - PSF強度分布
     * @returns {number} 総エネルギー
     */
    calculateTotalEnergy(psfData) {
        let total = 0;
        for (let i = 0; i < psfData.length; i++) {
            for (let j = 0; j < psfData[i].length; j++) {
                total += psfData[i][j];
            }
        }
        return total;
    }

    /**
     * ピーク強度を取得
     * @param {Array} psfData - PSF強度分布
     * @returns {number} ピーク強度
     */
    findPeakIntensity(psfData) {
        let peak = 0;
        for (let i = 0; i < psfData.length; i++) {
            for (let j = 0; j < psfData[i].length; j++) {
                peak = Math.max(peak, psfData[i][j]);
            }
        }
        return peak;
    }

    /**
     * Strehl比を計算
     * @param {Array} psfData - PSF強度分布
     * @param {Object} params - パラメータ
     * @returns {number} Strehl比
     */
    calculateStrehlRatio(psfData, params) {
        const peakIntensity = this.findPeakIntensity(psfData);
        
        // 理想的なPSF（エアリーディスク）のピーク強度を計算
        const diffraction_limited_peak = 1.0; // 正規化された理想値
        
        return peakIntensity / diffraction_limited_peak;
    }

    /**
     * FWHM（半値全幅）を計算
     * @param {Array} psfData - PSF強度分布
     * @param {number} pixelSize - ピクセルサイズ
     * @returns {Object} X, Y方向のFWHM
     */
    calculateFWHM(psfData, pixelSize) {
        const size = psfData.length;
        const center = Math.floor(size / 2);
        const peakIntensity = this.findPeakIntensity(psfData);
        const halfMax = peakIntensity / 2;
        
        // X方向のFWHM
        const xProfile = psfData[center];
        const fwhmX = this.findFWHMFromProfile(xProfile, center, halfMax) * pixelSize;
        
        // Y方向のFWHM
        const yProfile = psfData.map(row => row[center]);
        const fwhmY = this.findFWHMFromProfile(yProfile, center, halfMax) * pixelSize;
        
        return {
            x: fwhmX,
            y: fwhmY,
            average: (fwhmX + fwhmY) / 2
        };
    }

    /**
     * プロファイルからFWHMを計算
     * @param {Array} profile - 強度プロファイル
     * @param {number} center - 中心位置
     * @param {number} halfMax - 半値
     * @returns {number} FWHM（ピクセル単位）
     */
    findFWHMFromProfile(profile, center, halfMax) {
        let leftEdge = center;
        let rightEdge = center;
        
        // 左端を探索
        for (let i = center; i >= 0; i--) {
            if (profile[i] < halfMax) {
                leftEdge = i;
                break;
            }
        }
        
        // 右端を探索
        for (let i = center; i < profile.length; i++) {
            if (profile[i] < halfMax) {
                rightEdge = i;
                break;
            }
        }
        
        return rightEdge - leftEdge;
    }

    /**
     * エンサークルドエネルギーを計算
     * @param {Array} psfData - PSF強度分布
     * @param {number} pixelSize - ピクセルサイズ
     * @returns {Array} 半径とエネルギーの配列
     */
    calculateEncircledEnergy(psfData, pixelSize) {
        const size = psfData.length;
        const center = Math.floor(size / 2);
        const maxRadius = Math.floor(size / 2);

        // 半径ごとのバケットに強度を集計（O(N^2)）
        const bins = new Float64Array(maxRadius + 1);
        let totalEnergy = 0;

        for (let i = 0; i < size; i++) {
            const di = i - center;
            for (let j = 0; j < size; j++) {
                const dj = j - center;
                const rIdx = Math.floor(Math.sqrt(di * di + dj * dj));
                if (rIdx <= maxRadius) {
                    const val = psfData[i][j];
                    bins[rIdx] += val;
                    totalEnergy += val;
                }
            }
        }

        // 累積和でエンサークルドエネルギーを作成
        const encircledEnergy = new Array(maxRadius);
        let cumulative = 0;
        for (let r = 1; r <= maxRadius; r++) {
            cumulative += bins[r];
            encircledEnergy[r - 1] = {
                radius: r * pixelSize,
                energy: totalEnergy > 0 ? (cumulative / totalEnergy * 100) : 0
            };
        }

        return encircledEnergy;
    }

    /**
     * ピクセルサイズを計算
     * @param {number} wavelength - 波長
     * @param {number} focalLength - 焦点距離
     * @param {number} samplingSize - サンプリングサイズ
     * @returns {number} ピクセルサイズ（μm）
     */
    calculatePixelSize(wavelength, focalLength, samplingSize) {
        // 回折限界スポットサイズから推定
        const airy_radius = 1.22 * wavelength * focalLength / 10.0; // 瞳径10mmと仮定
        return airy_radius / (samplingSize / 8); // 適当なスケーリング
    }

    /**
     * パフォーマンスモード設定
     * @param {string} mode 'auto', 'wasm', 'javascript'
     */
    setPerformanceMode(mode) {
        if (['auto', 'wasm', 'javascript'].includes(mode)) {
            this.performanceMode = mode;
            console.log(`🔄 [PSF] Performance mode set to: ${mode}`);
        } else {
            console.warn(`⚠️ [PSF] Invalid performance mode: ${mode}`);
        }
    }

    /**
     * パフォーマンス統計取得
     * @returns {Object} 統計情報
     */
    getPerformanceStats() {
        if (this.wasmCalculator && typeof this.wasmCalculator.getPerformanceStats === 'function') {
            return this.wasmCalculator.getPerformanceStats();
        }
        return { message: 'Performance stats not available' };
    }

    /**
     * WASM利用状況チェック
     * @returns {Object} WASM状況
     */
    getWasmStatus() {
        return {
            available: !!this.wasmCalculator,
            ready: this.wasmCalculator ? this.wasmCalculator.isReady : false,
            currentMode: this.performanceMode,
            recommendedForSize: (size) => size >= 64
        };
    }

    /**
     * 最後の計算結果を取得
     * @returns {Object} 計算結果
     */
    getLastCalculation() {
        return this.lastCalculationData;
    }
}

// グローバル公開
if (typeof window !== 'undefined') {
    window.PSFCalculator = PSFCalculator;
    console.log('✅ [PSF] PSF計算モジュール読み込み完了（WASM対応）');
}

export default PSFCalculator;
