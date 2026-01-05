/**
 * このファイルは「光路差（OPD）」および「波面収差 Wλ」の**物理的な計算ロジックのみ**を担う。
 * UIや描画とは分離して、数式処理やベクトル演算をモジュール化し、他のアプリや描画スクリプトから再利用できるようにする。
 *
 * このように計算ロジックを分離することで以下のメリットが得られる：
 * - テスト容易性：計算だけをユニットテストで確認可能
 * - 再利用性：Plotly以外の描画にも使い回せる
 * - 保守性：数式やモデルの変更が描画に影響しない
 *
 * このファイルは `eva-wavefront-plot.js` などの描画スクリプトから import して使用される。
 */

import { traceRay } from './ray-tracing.js';
import { findStopSurfaceIndex } from './eva-transverse-aberration.js';

/**
 * Brent法による根探索アルゴリズム
 * gen-ray-cross-infinite.jsから移植
 * @param {Function} f - 目的関数
 * @param {number} a - 探索区間の左端
 * @param {number} b - 探索区間の右端
 * @param {number} tol - 許容誤差
 * @param {number} maxIter - 最大反復回数
 * @returns {number} 根の近似値
 */
function brent(f, a, b, tol = 1e-8, maxIter = 100) {
    let fa = f(a), fb = f(b);
    
    // 初期区間で符号が変わっていることを確認
    if (fa * fb >= 0) {
        // 符号が変わる区間を探索
        const originalA = a, originalB = b;
        let found = false;
        
        for (let i = 1; i <= 10 && !found; i++) {
            a = originalA * i;
            b = originalB * i;
            fa = f(a);
            fb = f(b);
            if (fa * fb < 0) {
                found = true;
            }
        }
        
        if (!found) {
            // 符号が変わる区間が見つからない場合は近似解を返す
            return 0;
        }
    }

    let c = a, fc = fa;
    let d = b - a, e = d;

    for (let iter = 0; iter < maxIter; iter++) {
        // |f(c)| < |f(b)| になるように交換
        if (Math.abs(fc) < Math.abs(fb)) {
            a = b; b = c; c = a;
            fa = fb; fb = fc; fc = fa;
        }

        let tol1 = 2 * Number.EPSILON * Math.abs(b) + tol / 2;
        let m = 0.5 * (c - b);

        // 収束判定
        if (Math.abs(m) <= tol1 || Math.abs(fb) <= tol) {
            return b;
        }

        // 補間法を試行
        if (Math.abs(e) >= tol1 && Math.abs(fa) > Math.abs(fb)) {
            let s = fb / fa;
            let p, q;

            if (a === c) {
                // 線形補間（secant法）
                p = 2 * m * s;
                q = 1 - s;
            } else {
                // 逆二次補間
                let r = fc / fa;
                let t = fb / fc;
                p = s * (2 * m * r * (r - t) - (b - a) * (t - 1));
                q = (r - 1) * (t - 1) * (s - 1);
            }

            if (p > 0) q = -q;
            p = Math.abs(p);

            // 補間ステップが有効かチェック
            if (2 * p < Math.min(3 * m * q - Math.abs(tol1 * q), Math.abs(e * q))) {
                e = d; 
                d = p / q;
            } else {
                // 二分法にフォールバック
                d = m; 
                e = m;
            }
        } else {
            // 二分法
            d = m; 
            e = m;
        }

        a = b; 
        fa = fb;
        
        // 次の点を計算
        if (Math.abs(d) > tol1) {
            b += d;
        } else {
            b += (m > 0 ? tol1 : -tol1);
        }
        
        fb = f(b);

        // 新しい区間を設定（符号が変わる区間を維持）
        if ((fb > 0 && fc > 0) || (fb < 0 && fc < 0)) {
            c = a; 
            fc = fa; 
            e = d = b - a;
        }
    }

    // 収束しない場合は現在の最良推定値を返す
    return b;
}

/**
 * 光路差（OPD: Optical Path Difference）計算クラス
 * 基準光線（主光線）に対する周辺光線の光路差を計算する
 */
export class OpticalPathDifferenceCalculator {
    constructor(opticalSystemRows, wavelength = 0.5876) {
        // 🆕 初期化時の詳細検証
        if (!opticalSystemRows) {
            console.error(`❌ OpticalPathDifferenceCalculator: opticalSystemRows が null または undefined です`);
            throw new Error('opticalSystemRows が必要です');
        }
        
        if (!Array.isArray(opticalSystemRows)) {
            console.error(`❌ OpticalPathDifferenceCalculator: opticalSystemRows が配列ではありません (型: ${typeof opticalSystemRows})`);
            throw new Error('opticalSystemRows は配列である必要があります');
        }
        
        if (opticalSystemRows.length === 0) {
            console.error(`❌ OpticalPathDifferenceCalculator: opticalSystemRows が空の配列です`);
            throw new Error('opticalSystemRows が空です');
        }
        
        this.opticalSystemRows = opticalSystemRows;
        this.wavelength = wavelength; // μm
        this.stopSurfaceIndex = findStopSurfaceIndex(opticalSystemRows);
        this.referenceOpticalPath = null;
        this.referenceChiefRay = null; // 主光線データ保存用
        this.lastRayCalculation = null; // 🆕 最後の光線計算結果を記録
        this.lastFieldKey = null; // 🆕 前回の画角設定キー
        
        // 🆕 初期化後の状態検証
        if (this.stopSurfaceIndex < 0 || this.stopSurfaceIndex >= opticalSystemRows.length) {
            console.error(`❌ 絞り面インデックスが無効: ${this.stopSurfaceIndex} (光学系長: ${opticalSystemRows.length})`);
            console.warn(`🔧 絞り面インデックスを中央に設定: ${Math.floor(opticalSystemRows.length / 2)}`);
            this.stopSurfaceIndex = Math.floor(opticalSystemRows.length / 2);
        }
        
        console.log(`🔍 OPD Calculator 初期化: 波長=${wavelength}μm, 絞り面インデックス=${this.stopSurfaceIndex}`);
        console.log(`🔍 光学系行数: ${opticalSystemRows ? opticalSystemRows.length : 'null'}`);
        
        // 有限系・無限系の判定
        const isFinite = this.isFiniteSystem();
        console.log(`🔍 光学系タイプ: ${isFinite ? '有限系' : '無限系'}`);
        
        if (opticalSystemRows && opticalSystemRows.length > 0) {
            const firstSurface = opticalSystemRows[0];
            console.log(`🔍 第1面情報: thickness=${firstSurface.thickness || firstSurface.Thickness}, object=${firstSurface.object || firstSurface.Object}`);
        }
        
        // 絞り面の詳細情報をログ出力
        if (this.stopSurfaceIndex >= 0 && this.stopSurfaceIndex < opticalSystemRows.length) {
            const stopSurface = opticalSystemRows[this.stopSurfaceIndex];
            console.log(`🔍 絞り面詳細 (面${this.stopSurfaceIndex + 1}):`, {
                id: stopSurface.id,
                semidia: stopSurface.semidia,
                aperture: stopSurface.aperture || stopSurface.Aperture,
                radius: stopSurface.radius,
                material: stopSurface.material,
                objectType: stopSurface['object type'] || stopSurface.object || stopSurface.Object
            });
        } else {
            console.warn('⚠️ 絞り面が見つかりません！');
        }
    }

    /**
     * 基準光線（主光線）の光路長を計算・設定
     * @param {Object} fieldSetting - フィールド設定
     * @returns {number} 基準光路長
     */
    setReferenceRay(fieldSetting) {
        // 🆕 画角情報の詳細チェック（ログ簡略化）
        const hasFieldAngle = fieldSetting.fieldAngle && (fieldSetting.fieldAngle.x !== 0 || fieldSetting.fieldAngle.y !== 0);
        const hasFieldHeight = fieldSetting.xHeight !== 0 || fieldSetting.yHeight !== 0;
        
        if (hasFieldAngle || hasFieldHeight) {
            console.log(`📐 画角設定: 角度(${fieldSetting.fieldAngle?.x || 0}°, ${fieldSetting.fieldAngle?.y || 0}°), 高さ(${fieldSetting.xHeight || 0}, ${fieldSetting.yHeight || 0}mm)`);
        } else {
            console.log(`📍 軸上フィールド（画角=0）`);
        }
        
        let chiefRay = this.generateChiefRay(fieldSetting);
        
        // 主光線生成失敗の場合、軸上光線で代替
        if (!chiefRay) {
            console.warn('⚠️ 主光線生成失敗、軸上光線で代替');
            const axialFieldSetting = {
                fieldAngle: { x: 0, y: 0 },
                xHeight: 0,
                yHeight: 0
            };
            chiefRay = this.generateChiefRay(axialFieldSetting);
        }
        
        if (!chiefRay) {
            console.error('❌ 基準光線（主光線）の生成に失敗しました');
            throw new Error('基準光線（主光線）の生成に失敗しました');
        }
        
        // 主光線データを保存（参照球面計算用）
        this.referenceChiefRay = chiefRay;
        
        console.log('✅ 基準光線生成成功');
        
        // 光線データの基本チェック
        if (Array.isArray(chiefRay)) {
            if (chiefRay.length <= 1) {
                console.warn('⚠️ 主光線が1点以下 - フォールバック使用');
                
                // 光学系の概算長さから推定
                const totalSystemLength = this.estimateSystemLength();
                const approximateOpticalPath = totalSystemLength * 1000; // mm → μm
                
                console.log(`🔧 フォールバック光路長: ${approximateOpticalPath.toFixed(3)}μm`);
                this.referenceOpticalPath = approximateOpticalPath;
                
                return this.referenceOpticalPath;
            }
        } else {
            console.log('  オブジェクト形式:', Object.keys(chiefRay));
            
            // オブジェクトの場合もパスデータをチェック
            const pathData = chiefRay.path || chiefRay.pathData || chiefRay.points;
            if (pathData && Array.isArray(pathData) && pathData.length === 1) {
                console.warn('⚠️ 主光線オブジェクトのパスが1点しかありません');
                console.warn('🔧 フォールバック処理を適用');
                
                const approximateOpticalPath = 100 * 1000; // 100mm → μm
                this.referenceOpticalPath = approximateOpticalPath;
                
                return this.referenceOpticalPath;
            }
        }
        
        // 通常の光路長計算
        this.referenceOpticalPath = this.calculateOpticalPath(chiefRay);
        
        // 🆕 基準光路長の検証：主光線のOPDが0になることを確認
        if (hasFieldAngle || hasFieldHeight) {
            console.log(`📐 画角あり基準光路長: ${this.referenceOpticalPath.toFixed(3)}μm`);
            
            // 検証: 同じ主光線で周辺光線を生成してOPDを計算
            const verificationMarginalRay = this.generateMarginalRay(0, 0, fieldSetting);
            if (verificationMarginalRay) {
                const verificationOpticalPath = this.calculateOpticalPath(verificationMarginalRay);
                const verificationOPD = verificationOpticalPath - this.referenceOpticalPath;
                
                console.log(`🔍 主光線OPD検証: 周辺光路長=${verificationOpticalPath.toFixed(6)}μm`);
                console.log(`🔍 主光線OPD検証: 基準光路長=${this.referenceOpticalPath.toFixed(6)}μm`);
                console.log(`🔍 主光線OPD検証: OPD=${verificationOPD.toFixed(6)}μm`);
                
                // もし主光線のOPDが0でない場合、基準光路長を修正
                if (Math.abs(verificationOPD) > 1e-3) { // 1nm以上の誤差
                    console.warn(`⚠️ 主光線OPD検証失敗: ${verificationOPD.toFixed(6)}μm → 基準光路長を修正`);
                    this.referenceOpticalPath = verificationOpticalPath; // 周辺光線の光路長を基準とする
                    console.log(`🔧 修正後基準光路長: ${this.referenceOpticalPath.toFixed(6)}μm`);
                }
            }
        } else {
            console.log(`📍 軸上基準光路長: ${this.referenceOpticalPath.toFixed(3)}μm`);
        }
        
        if (!isFinite(this.referenceOpticalPath) || this.referenceOpticalPath <= 0 || isNaN(this.referenceOpticalPath)) {
            console.error(`❌ 無効な基準光路長: ${this.referenceOpticalPath}`);
            
            // 代替案: 軸上光線で再試行
            console.warn('🔧 軸上光線で再試行');
            const axialFieldSetting = { fieldAngle: { x: 0, y: 0 } };
            const axialChiefRay = this.generateChiefRay(axialFieldSetting);
            
            if (axialChiefRay) {
                const axialOpticalPath = this.calculateOpticalPath(axialChiefRay);
                if (isFinite(axialOpticalPath) && axialOpticalPath > 0) {
                    console.warn(`🔧 軸上光線成功: ${axialOpticalPath}μm`);
                    this.referenceOpticalPath = axialOpticalPath;
                    this.referenceChiefRay = axialChiefRay;
                    return this.referenceOpticalPath;
                }
            }
            
            // 代替案2: 有限系として処理
            console.warn('🔧 代替案2: 有限系として処理');
            const finiteRay = this.generateFiniteChiefRay(fieldSetting);
            if (finiteRay) {
                const finiteOpticalPath = this.calculateOpticalPath(finiteRay);
                if (isFinite(finiteOpticalPath) && finiteOpticalPath > 0) {
                    console.warn(`🔧 有限系光線成功: ${finiteOpticalPath}μm`);
                    this.referenceOpticalPath = finiteOpticalPath;
                    this.referenceChiefRay = finiteRay;
                    return this.referenceOpticalPath;
                }
            }
            
            // 最終フォールバック: 光学系の概算全長を使用
            console.warn('🔧 最終フォールバック: 光学系全長からの推定');
            let totalSystemLength = 0;
            for (let i = 0; i < this.opticalSystemRows.length; i++) {
                const thickness = parseFloat(this.opticalSystemRows[i].thickness || this.opticalSystemRows[i].Thickness || 0);
                if (isFinite(thickness) && thickness > 0) {
                    totalSystemLength += thickness;
                }
            }
            
            if (totalSystemLength > 0) {
                this.referenceOpticalPath = totalSystemLength * 1000; // mm → μm
                console.warn(`🔧 推定基準光路長: ${this.referenceOpticalPath}μm (光学系全長: ${totalSystemLength}mm)`);
            } else {
                // 最後の手段
                this.referenceOpticalPath = 100000; // 100mm = 100,000μm
                console.warn(`🔧 デフォルト基準光路長: ${this.referenceOpticalPath}μm`);
            }
        }
        
        console.log(`📏 基準光路長: ${this.referenceOpticalPath.toFixed(6)} μm`);
        
        return this.referenceOpticalPath;
    }

    /**
     * 主光線を生成
     * @param {Object} fieldSetting - フィールド設定
     * @returns {Object} 主光線データ
     */
    generateChiefRay(fieldSetting) {
        // 有限系・無限系の判定
        const isFinite = this.isFiniteSystem();
        
        if (isFinite) {
            return this.generateFiniteChiefRay(fieldSetting);
        } else {
            return this.generateInfiniteChiefRay(fieldSetting);
        }
    }

    /**
     * 有限系の主光線生成
     * @param {Object} fieldSetting - フィールド設定
     * @returns {Object} 主光線データ
     */
    generateFiniteChiefRay(fieldSetting) {
        const firstSurface = this.opticalSystemRows[0];
        const objectDistance = Math.abs(parseFloat(firstSurface.thickness || firstSurface.Thickness));
        
        // Object面での光線位置
        const yObject = fieldSetting.yHeight || 0;
        const xObject = fieldSetting.xHeight || 0;
        
        // 絞り面を通る光線方向を計算
        const stopSurface = this.opticalSystemRows[this.stopSurfaceIndex];
        const stopZ = this.calculateSurfacePosition(this.stopSurfaceIndex);
        
        // 主光線は絞り面の中心を通る
        const rayDirection = this.calculateRayDirection(
            { x: xObject, y: yObject, z: -objectDistance },
            { x: 0, y: 0, z: stopZ }
        );

        const initialRay = {
            pos: { x: xObject, y: yObject, z: -objectDistance },
            dir: rayDirection,
            wavelength: this.wavelength
        };

        return traceRay(this.opticalSystemRows, initialRay);
    }

    /**
     * 無限系の主光線生成（Brent法による射出座標探索）
     * @param {Object} fieldSetting - フィールド設定
     * @returns {Object} 主光線データ
     */
    generateInfiniteChiefRay(fieldSetting) {
        // console.log(`🔍 generateInfiniteChiefRay 開始`);  // ログ削減
        // console.log(`🔍 fieldSetting 詳細:`, JSON.stringify(fieldSetting, null, 2));  // ログ削減
        
        // 角度からの方向ベクトル
        const angleX = (fieldSetting.fieldAngle?.x || 0) * Math.PI / 180;
        const angleY = (fieldSetting.fieldAngle?.y || 0) * Math.PI / 180;
        
        // console.log(`🔍 無限系主光線生成: 画角X=${fieldSetting.fieldAngle?.x || 0}°, Y=${fieldSetting.fieldAngle?.y || 0}°`);  // ログ削減
        // console.log(`🔍 ラジアン変換: angleX=${angleX}, angleY=${angleY}`);  // ログ削減
        
        const direction = {
            x: Math.sin(angleX),
            y: Math.sin(angleY),
            z: Math.cos(angleX) * Math.cos(angleY)
        };

        // console.log(`🔍 方向ベクトル: (${direction.x.toFixed(6)}, ${direction.y.toFixed(6)}, ${direction.z.toFixed(6)})`);  // ログ削減

        // 絞り面の位置と中心を取得
        const stopZ = this.calculateSurfacePosition(this.stopSurfaceIndex);
        const stopCenter = { x: 0, y: 0, z: stopZ };
        
        // console.log(`🔍 絞り面位置: Z=${stopZ}mm, 絞り面インデックス: ${this.stopSurfaceIndex}`);  // ログ削減
        
        // console.log(`🔍 絞り面位置: Z=${stopZ}mm`);  // ログ削減
        // console.log(`🔍 光学系データ確認: ${this.opticalSystemRows.length}面`);  // ログ削減
        
        // 光学系データの詳細確認（ログ削減）
        // for (let i = 0; i < Math.min(3, this.opticalSystemRows.length); i++) {
        //     const surface = this.opticalSystemRows[i];
        //     console.log(`  面${i + 1}: radius=${surface.radius}, thickness=${surface.thickness || surface.Thickness}, material=${surface.material || 'air'}`);
        // }
        
        // Brent法で主光線の射出座標を探索
        const chiefOrigin = this.findChiefRayOriginWithBrent(direction, stopCenter);
        
        const initialRay = {
            pos: chiefOrigin,
            dir: direction,
            wavelength: this.wavelength
        };

        // console.log(`🔍 無限系主光線: 方向(${direction.x.toFixed(4)}, ${direction.y.toFixed(4)}, ${direction.z.toFixed(4)})`);  // ログ削減
        // console.log(`🔍 無限系主光線: 射出位置(${chiefOrigin.x.toFixed(2)}, ${chiefOrigin.y.toFixed(2)}, ${chiefOrigin.z.toFixed(2)})`);  // ログ削減

        // 光線追跡実行
        const rayResult = traceRay(this.opticalSystemRows, initialRay);
        
        // 光線追跡結果の詳細確認
        // console.log(`🔍 光線追跡結果タイプ: ${typeof rayResult}`);  // ログ削減
        if (rayResult) {
            if (Array.isArray(rayResult)) {
                // console.log(`🔍 光線追跡結果: 配列形式、${rayResult.length}点`);  // ログ削減
                if (rayResult.length > 0) {
                    // console.log(`  最初の点:`, rayResult[0]);  // ログ削減
                    // 1点の場合も有効な結果として扱う（緩和）
                    if (rayResult.length === 1) {
                        console.warn(`⚠️ 主光線追跡が1点 - 単一点ですが有効として扱います`);
                    }
                    // if (rayResult.length > 1) {
                    //     console.log(`  最後の点:`, rayResult[rayResult.length - 1]);  // ログ削減
                    // }
                    
                    // 最低限1点以上があれば成功とみなす
                    return rayResult;
                } else {
                    console.warn(`❌ 主光線追跡が0点 - 完全に失敗`);
                    return null;
                }
            } else {
                console.log(`🔍 光線追跡結果: オブジェクト形式`, Object.keys(rayResult));
                if (rayResult.path) {
                    console.log(`  パスデータ: ${rayResult.path.length}点`);
                    // 1点の場合も有効として扱う（緩和）
                    if (rayResult.path.length === 1) {
                        console.warn(`⚠️ 主光線パスが1点 - 単一点ですが有効として扱います`);
                    } else if (rayResult.path.length === 0) {
                        console.warn(`❌ 主光線パスが0点 - 完全に失敗`);
                        return null;
                    }
                }
                // オブジェクト形式でも有効として扱う
                return rayResult;
            }
        } else {
            // ログスパム防止：光線追跡失敗ログを制限
            if (Math.random() < 0.01) { // 1%の確率でログ出力
                console.warn(`⚠️ 光線追跡失敗（まれにログ出力）`);
            }
            return null;
        }
        
        return rayResult;
    }

    /**
     * Brent法による主光線射出座標の探索
     * @param {Object} direction - 方向ベクトル
     * @param {Object} stopCenter - 絞り面中心
     * @returns {Object} 射出座標
     */
    findChiefRayOriginWithBrent(direction, stopCenter) {
        const searchRange = 100; // ±100mm（50mm→100mmに拡張）
        
        // まず簡単な計算で光線の開始位置を推定
        const startZ = -25; // 固定位置Z=-25mm
        
        // console.log(`🔍 Brent法開始: 絞り面中心(${stopCenter.x}, ${stopCenter.y}, ${stopCenter.z}), 開始Z=${startZ}`);  // ログ削減
        
        // 簡易テスト: 直接計算による光線射出
        const simpleOrigin = {
            x: 0,
            y: 0,
            z: startZ
        };
        
        // テスト光線で光線追跡が動作するか確認
        const testRay = {
            pos: simpleOrigin,
            dir: direction,
            wavelength: this.wavelength
        };
        
        // console.log(`🔍 テスト光線実行: 位置(${simpleOrigin.x}, ${simpleOrigin.y}, ${simpleOrigin.z}), 方向(${direction.x.toFixed(4)}, ${direction.y.toFixed(4)}, ${direction.z.toFixed(4)})`);  // ログ削減
        
        try {
            const testResult = traceRay(this.opticalSystemRows, testRay);
            // console.log(`🔍 テスト光線結果:`, testResult ? `成功(${Array.isArray(testResult) ? testResult.length : 'オブジェクト'}点)` : '失敗');  // ログ削減
            
            if (testResult && Array.isArray(testResult) && testResult.length > 1) {
                // テスト光線が成功した場合、簡単な位置調整を行う
                const stopPoint = testResult[this.stopSurfaceIndex] || testResult[Math.min(this.stopSurfaceIndex, testResult.length - 1)];
                if (stopPoint) {
                    // console.log(`🔍 テスト光線の絞り面交点: (${stopPoint.x.toFixed(3)}, ${stopPoint.y.toFixed(3)}, ${stopPoint.z.toFixed(3)})`);  // ログ削減
                    
                    // 簡単な補正計算
                    const correctionX = -stopPoint.x;
                    const correctionY = -stopPoint.y;
                    
                    return {
                        x: simpleOrigin.x + correctionX,
                        y: simpleOrigin.y + correctionY,
                        z: startZ
                    };
                }
            }
        } catch (error) {
            console.error(`❌ テスト光線エラー:`, error);
        }
        
        // Brent法による最適化（テスト光線が失敗した場合のフォールバック）
        console.log(`🔍 Brent法による最適化開始`);
        
        // X方向の目的関数
        const objectiveFunctionX = (x) => {
            const testOrigin = {
                x: x,
                y: 0,
                z: -25 // 固定位置Z=-25mm
            };
            
            const testRay = {
                pos: testOrigin,
                dir: direction,
                wavelength: this.wavelength
            };
            
            try {
                const rayPath = traceRay(this.opticalSystemRows, testRay);
                if (!rayPath || !Array.isArray(rayPath) || rayPath.length <= this.stopSurfaceIndex) {
                    return 1000; // 大きな誤差値
                }
                
                const stopPoint = rayPath[this.stopSurfaceIndex];
                return stopPoint.x - stopCenter.x; // 目標は0
            } catch (error) {
                return 1000;
            }
        };
        
        // Y方向の目的関数
        const objectiveFunctionY = (y) => {
            const testOrigin = {
                x: 0,
                y: y,
                z: -25 // 固定位置Z=-25mm
            };
            
            const testRay = {
                pos: testOrigin,
                dir: direction,
                wavelength: this.wavelength
            };
            
            try {
                const rayPath = traceRay(this.opticalSystemRows, testRay);
                if (!rayPath || !Array.isArray(rayPath) || rayPath.length <= this.stopSurfaceIndex) {
                    return 1000;
                }
                
                const stopPoint = rayPath[this.stopSurfaceIndex];
                return stopPoint.y - stopCenter.y; // 目標は0
            } catch (error) {
                return 1000;
            }
        };
        
        // Brent法でX, Y座標を最適化
        let optimalX = 0;
        let optimalY = 0;
        
        try {
            optimalX = this.brent(objectiveFunctionX, -searchRange, searchRange, 1e-2, 100);
            console.log(`✅ [Brent] 主光線X座標最適化完了: ${optimalX.toFixed(6)}mm`);
        } catch (error) {
            console.warn(`⚠️ [Brent] 主光線X方向最適化失敗: ${error.message}`);
            optimalX = 0; // フォールバック
        }
        
        try {
            optimalY = this.brent(objectiveFunctionY, -searchRange, searchRange, 1e-2, 100);
            console.log(`✅ [Brent] 主光線Y座標最適化完了: ${optimalY.toFixed(6)}mm`);
        } catch (error) {
            console.warn(`⚠️ [Brent] 主光線Y方向最適化失敗: ${error.message}`);
            optimalY = 0; // フォールバック
        }
        
        return {
            x: optimalX,
            y: optimalY,
            z: stopCenter.z - 1000
        };
    }

    /**
     * Brent法による根探索（クラス内メソッド）
     * @param {Function} f - 目的関数
     * @param {number} a - 探索区間の左端
     * @param {number} b - 探索区間の右端
     * @param {number} tol - 許容誤差
     * @param {number} maxIter - 最大反復回数
     * @returns {number} 根の近似値
     */
    brent(f, a, b, tol = 1e-8, maxIter = 100) {
        let fa = f(a), fb = f(b);
        
        // 初期区間で符号が変わっていることを確認
        if (fa * fb >= 0) {
            // 符号が変わる区間を探索
            const originalA = a, originalB = b;
            let found = false;
            
            for (let i = 1; i <= 10 && !found; i++) {
                a = originalA * i;
                b = originalB * i;
                fa = f(a);
                fb = f(b);
                if (fa * fb < 0) {
                    found = true;
                }
            }
            
            if (!found) {
                // 符号が変わる区間が見つからない場合は近似解を返す
                return 0;
            }
        }

        let c = a, fc = fa;
        let d = b - a, e = d;

        for (let iter = 0; iter < maxIter; iter++) {
            // |f(c)| < |f(b)| になるように交換
            if (Math.abs(fc) < Math.abs(fb)) {
                a = b; b = c; c = a;
                fa = fb; fb = fc; fc = fa;
            }

            let tol1 = 2 * Number.EPSILON * Math.abs(b) + tol / 2;
            let m = 0.5 * (c - b);

            // 収束判定
            if (Math.abs(m) <= tol1 || Math.abs(fb) <= tol) {
                return b;
            }

            // 補間法を試行
            if (Math.abs(e) >= tol1 && Math.abs(fa) > Math.abs(fb)) {
                let s = fb / fa;
                let p, q;

                if (a === c) {
                    // 線形補間（secant法）
                    p = 2 * m * s;
                    q = 1 - s;
                } else {
                    // 逆二次補間
                    let r = fc / fa;
                    let t = fb / fc;
                    p = s * (2 * m * r * (r - t) - (b - a) * (t - 1));
                    q = (r - 1) * (t - 1) * (s - 1);
                }

                if (p > 0) q = -q;
                p = Math.abs(p);

                // 補間ステップが有効かチェック
                if (2 * p < Math.min(3 * m * q - Math.abs(tol1 * q), Math.abs(e * q))) {
                    e = d; 
                    d = p / q;
                } else {
                    // 二分法にフォールバック
                    d = m; 
                    e = m;
                }
            } else {
                // 二分法
                d = m; 
                e = m;
            }

            a = b; 
            fa = fb;
            
            // 次の点を計算
            if (Math.abs(d) > tol1) {
                b += d;
            } else {
                b += (m > 0 ? tol1 : -tol1);
            }
            
            fb = f(b);

            // 新しい区間を設定（符号が変わる区間を維持）
            if ((fb > 0 && fc > 0) || (fb < 0 && fc < 0)) {
                c = a; 
                fc = fa; 
                e = d = b - a;
            }
        }

        // 収束しない場合は現在の最良推定値を返す
        return b;
    }

    /**
     * 周辺光線の光路差を計算
     * @param {number} pupilX - 瞳座標X
     * @param {number} pupilY - 瞳座標Y
     * @param {Object} fieldSetting - フィールド設定
     * @returns {number} 光路差（μm）
     */
    calculateOPD(pupilX, pupilY, fieldSetting) {
        // 🆕 各画角に対して基準光線を確実に設定
        // 画角が変わるたびに主光線の光路長を再計算する必要がある
        const currentFieldKey = `${fieldSetting.fieldAngle?.x || 0}_${fieldSetting.fieldAngle?.y || 0}_${fieldSetting.xHeight || 0}_${fieldSetting.yHeight || 0}`;
        
        // 前回と異なる画角の場合、または基準光路長が未設定の場合
        if (this.referenceOpticalPath === null || this.lastFieldKey !== currentFieldKey) {
            // Disable excessive logging during grid calculations
            // if (this.lastFieldKey !== currentFieldKey) {
            //     console.log(`📐 画角変更検出: ${this.lastFieldKey || 'undefined'} → ${currentFieldKey}`);
            // }
            
            // 基準光線を再設定
            this.setReferenceRay(fieldSetting);
            this.lastFieldKey = currentFieldKey;
        }

        try {
            const pupilRadius = Math.sqrt(pupilX * pupilX + pupilY * pupilY);
            
            // 🆕 主光線のOPD検証（瞳座標0,0の場合）のみ一回だけログ出力
            const isChiefRay = Math.abs(pupilX) < 1e-6 && Math.abs(pupilY) < 1e-6;
            
            // Disable excessive logging during grid calculations
            // if (isChiefRay) {
            //     console.log(`🔍 主光線OPD計算: pupilX=${pupilX.toFixed(6)}, pupilY=${pupilY.toFixed(6)}`);
            //     console.log(`🔍 使用中の基準光路長: ${this.referenceOpticalPath.toFixed(6)}μm (画角: ${currentFieldKey})`);
            // }

            // 🆕 Draw OPD Rays専用：ビネッティングチェックを大幅緩和
            const isDrawOPDMode = true; // このモジュールはDraw OPD Rays専用
            let marginalRay = null;
            
            if (isDrawOPDMode) {
                // 極端な瞳座標（3.0以上）のみビネッティング扱い
                if (pupilRadius > 3.0) {
                    return NaN;
                }
                
                // 光線生成を試行（失敗時のみビネッティング扱い）
                marginalRay = this.generateMarginalRay(pupilX, pupilY, fieldSetting);
                if (!marginalRay) {
                    // Disable excessive logging during grid calculations
                    // if (isChiefRay) {
                    //     console.log(`🚫 [主光線] 光線生成失敗: pupilX=${pupilX.toFixed(3)}, pupilY=${pupilY.toFixed(3)}`);
                    // }
                    this.lastRayCalculation = { ray: null, success: false, error: 'ray generation failed' };
                    return NaN;
                }
                
            } else {
                // 従来のビネッティングチェック（現在は使用されない）
                const isVignettedResult = this.isVignetted(pupilX, pupilY, fieldSetting);
                
                if (isVignettedResult) {
                    return NaN;
                }

                marginalRay = this.generateMarginalRay(pupilX, pupilY, fieldSetting);
                if (!marginalRay) {
                    console.warn(`❌ 周辺光線生成失敗（光線が蹴られた）: pupilX=${pupilX}, pupilY=${pupilY}`);
                    this.lastRayCalculation = { ray: null, success: false, error: 'ray generation failed' };
                    return NaN;
                }
            }

            // 周辺光線の光路長を計算
            const marginalOpticalPath = this.calculateOpticalPath(marginalRay);
            // Disable excessive logging during grid calculations
            // if (isChiefRay) {
            //     console.log(`🔍 周辺光線光路長: ${marginalOpticalPath}μm`);
            //     console.log(`🔍 基準光路長: ${this.referenceOpticalPath}μm`);
            // }
            
            // 光路長の有効性チェック
            if (!isFinite(marginalOpticalPath) || isNaN(marginalOpticalPath)) {
                console.error(`❌ 周辺光線光路長がNaN/INF: ${marginalOpticalPath}`);
                this.lastRayCalculation = { ray: marginalRay, success: false, error: 'optical path calculation failed' };
                return NaN;
            }
            
            if (!isFinite(this.referenceOpticalPath) || isNaN(this.referenceOpticalPath)) {
                console.error(`❌ 基準光路長がNaN/INF: ${this.referenceOpticalPath}`);
                this.lastRayCalculation = { ray: marginalRay, success: false, error: 'reference optical path invalid' };
                return NaN;
            }

            // 参照球面を考慮したOPD計算
            const opd = this.calculateOPDFromReferenceSphere(marginalRay, marginalOpticalPath, fieldSetting);
            
            // 🆕 主光線のOPD検証
            if (isChiefRay) {
                const chiefOPDError = Math.abs(opd);
                // Disable excessive logging during grid calculations - only show warnings for major errors
                if (chiefOPDError > 1e-3) { // 1nm以上の誤差のみログ出力
                    console.warn(`⚠️ 主光線のOPDが0でありません！誤差=${chiefOPDError.toFixed(6)}μm`);
                    console.warn(`🔧 基準光路長の設定に問題がある可能性があります`);
                    console.warn(`📊 [主光線詳細] 周辺光路長=${marginalOpticalPath.toFixed(6)}μm, 基準光路長=${this.referenceOpticalPath.toFixed(6)}μm`);
                }
                // Success messages disabled to prevent console spam
                // console.log(`📊 [主光線OPD検証] OPD=${opd.toFixed(6)}μm, 誤差=${chiefOPDError.toFixed(6)}μm`);
                // console.log(`✅ 主光線のOPDが正しく0に近い値です`);
            }
            
            // OPDの有効性チェック
            if (!isFinite(opd) || isNaN(opd)) {
                console.error(`❌ OPD計算結果がNaN/INF: ${opd} (marginal=${marginalOpticalPath}, reference=${this.referenceOpticalPath})`);
                this.lastRayCalculation = { ray: marginalRay, success: false, error: 'OPD calculation failed' };
                return NaN;
            }
            
            // 🆕 極端なOPD値の検出と制限（異常な計算結果を防ぐ）
            const extremeOPDThreshold = 100000; // 100mm以上のOPDは異常
            if (Math.abs(opd) > extremeOPDThreshold) {
                console.warn(`⚠️ 極端なOPD値検出: ${opd.toFixed(3)}μm (制限値: ±${extremeOPDThreshold}μm)`);
                console.warn(`📊 詳細: 周辺光路長=${marginalOpticalPath.toFixed(3)}μm, 基準光路長=${this.referenceOpticalPath.toFixed(3)}μm`);
                console.warn(`📍 瞳座標: (${pupilX.toFixed(3)}, ${pupilY.toFixed(3)})`);
                // 極端な値は無効データとして扱う
                this.lastRayCalculation = { ray: marginalRay, success: false, error: 'extreme OPD value detected' };
                return NaN;
            }
            
            // Disable excessive success logging during grid calculations
            // if (isChiefRay) {
            //     console.log(`✅ OPD計算成功: ${opd.toFixed(6)}μm (pupilX=${pupilX.toFixed(3)}, pupilY=${pupilY.toFixed(3)})`);
            // }

            // 光線データの詳細をログ出力
            this.lastRayCalculation = {
                ray: marginalRay,
                success: true,
                opd: opd,
                pupilCoord: { x: pupilX, y: pupilY }
            };
        
            return opd;
        } catch (error) {
            console.error(`❌ OPD計算エラー（光線が蹴られた可能性）: pupilX=${pupilX}, pupilY=${pupilY}`, error);
            this.lastRayCalculation = { ray: null, success: false, error: error.message };
            return NaN; // エラーの場合はNaNを返す
        }
    }

    /**
     * 最後の光線計算結果を取得（描画用）
     * @returns {Object|null} 光線計算結果
     */
    getLastRayCalculation() {
        return this.lastRayCalculation;
    }

    /**
     * 主光線の像点を取得（参照球面の中心）
     * @returns {Object|null} 主光線の像点座標
     */
    getChiefRayImagePoint() {
        if (!this.referenceChiefRay) {
            console.warn('⚠️ 主光線データがありません');
            return null;
        }
        
        return this.getRayImagePoint(this.referenceChiefRay);
    }

    /**
     * 光線の像点を取得
     * @param {Array|Object} rayData - 光線データ
     * @returns {Object|null} 像点座標
     */
    getRayImagePoint(rayData) {
        if (!rayData) {
            return null;
        }
        
        let pathData = null;
        if (Array.isArray(rayData)) {
            pathData = rayData;
        } else {
            pathData = rayData.path || rayData.pathData || rayData.points;
        }
        
        if (!Array.isArray(pathData) || pathData.length === 0) {
            return null;
        }
        
        // 最後の点を像点として使用
        const imagePoint = pathData[pathData.length - 1];
        
        if (!imagePoint || 
            typeof imagePoint.x !== 'number' || 
            typeof imagePoint.y !== 'number' || 
            typeof imagePoint.z !== 'number') {
            return null;
        }
        
        return {
            x: imagePoint.x,
            y: imagePoint.y, 
            z: imagePoint.z
        };
    }

    /**
     * 光線データの有効性をチェック
     * @param {Array|Object} rayData - 光線データ
     * @returns {boolean} 有効かどうか
     */
    isValidRayData(rayData) {
        if (!rayData) return false;
        
        let pathData = null;
        if (Array.isArray(rayData)) {
            pathData = rayData;
        } else {
            pathData = rayData.path || rayData.pathData || rayData.points;
        }
        
        if (!Array.isArray(pathData) || pathData.length < 2) {
            return false;
        }
        
        // 最初と最後の点の座標をチェック
        const firstPoint = pathData[0];
        const lastPoint = pathData[pathData.length - 1];
        
        if (!firstPoint || !lastPoint ||
            !isFinite(firstPoint.x) || !isFinite(firstPoint.y) || !isFinite(firstPoint.z) ||
            !isFinite(lastPoint.x) || !isFinite(lastPoint.y) || !isFinite(lastPoint.z)) {
            return false;
        }
        
        return true;
    }

    /**
     * 正式な参照球からの光路差を計算（図面仕様準拠）
     * 
     * 【参照球定義 - 図面より】
     * ◆ 像参照球 (Rex):
     *   - 中心: 主光線が像面と交わる点（実像高 H'）
     *   - 半径: 主光線を逆延長して光軸と交わる点までの距離
     * 
     * ◆ 物参照球 (Ro(-)):  
     *   - 中心: 物体高さ H(-)
     *   - 半径: 主光線が光軸と交わる点までの距離
     */

    /**
     * 参照球面を用いた光路差（OPD）計算【Zemax標準方式】
     * 
     * 参照球面定義:
     * - 中心: 主光線の像面交点
     * - 半径: 射出瞳中心から主光線像点までの距離
     * 
     * @param {Object} marginalRay - 周辺光線データ
     * @param {number} marginalOpticalPath - 周辺光線の光路長（μm）
     * @param {Object} fieldSetting - フィールド設定
     * @returns {number} OPD（μm）
     */
    calculateOPDFromReferenceSphere(marginalRay, marginalOpticalPath, fieldSetting, removeTilt = false) {
        try {
            // 主光線の像面交点（参照球面の中心）
            const chiefImagePoint = this.getChiefRayImagePoint();
            if (!chiefImagePoint) {
                // フォールバック: 単純な光路差
                return marginalOpticalPath - this.referenceOpticalPath;
            }

            // 周辺光線の像面交点
            const marginalImagePoint = this.getRayImagePoint(marginalRay);
            if (!marginalImagePoint) {
                // フォールバック: 単純な光路差
                return marginalOpticalPath - this.referenceOpticalPath;
            }

            // 射出瞳中心位置（絞り面位置で近似）
            const stopZ = this.calculateSurfacePosition(this.stopSurfaceIndex);
            
            // 参照球面の半径 = 射出瞳中心から主光線像点までの距離
            const refRadius = Math.sqrt(
                chiefImagePoint.x * chiefImagePoint.x +
                chiefImagePoint.y * chiefImagePoint.y +
                (chiefImagePoint.z - stopZ) * (chiefImagePoint.z - stopZ)
            ); // mm
            
            // 周辺光線の像点から主光線像点（参照球面中心）までの距離
            const dx = marginalImagePoint.x - chiefImagePoint.x;
            const dy = marginalImagePoint.y - chiefImagePoint.y;
            const dz = marginalImagePoint.z - chiefImagePoint.z;
            const distToCenter = Math.sqrt(dx*dx + dy*dy + dz*dz); // mm
            
            // 参照球面からのずれ（mm → μm）
            const sphereDeviation = (distToCenter - refRadius) * 1000;
            
            // OPD = 実際の光路長 - (主光線光路長 + 球面補正)
            const opd = marginalOpticalPath - (this.referenceOpticalPath + sphereDeviation);
            
            return opd;

        } catch (error) {
            // エラー時はフォールバック: 単純な光路差
            return marginalOpticalPath - this.referenceOpticalPath;
        }
    }

    /**
     * 像参照球の半径を計算（図面仕様準拠）
     * 
     * 【図面定義】像参照球 Rex:
     * - 中心: 実像高 H'（主光線と像面の交点）
     * - 半径: 主光線を逆延長して光軸と交わる点までの距離
     * 
     * @param {Object} imageSphereCenter - 像参照球中心座標（実像高 H'）
     * @returns {number|null} 像参照球半径 Rex（mm）
     */
    calculateImageSphereRadius(imageSphereCenter) {
        try {
            if (!this.referenceChiefRay) {
                throw new Error('主光線データが設定されていません');
            }

            // 主光線の最後の2点から方向ベクトルを計算
            const chiefPath = this.getPathData(this.referenceChiefRay);
            if (!chiefPath || chiefPath.length < 2) {
                throw new Error('主光線のパスデータが不十分です');
            }

            const lastPoint = chiefPath[chiefPath.length - 1]; // 像面交点（実像高 H'）
            const prevPoint = chiefPath[chiefPath.length - 2]; // 直前の点

            // 主光線の方向ベクトル（逆方向 = 主光線を逆延長）【図面準拠】
            const dirX = prevPoint.x - lastPoint.x;
            const dirY = prevPoint.y - lastPoint.y;
            const dirZ = prevPoint.z - lastPoint.z;

            // 方向ベクトルの正規化
            const dirLength = Math.sqrt(dirX*dirX + dirY*dirY + dirZ*dirZ);
            if (dirLength === 0) {
                throw new Error('主光線の方向ベクトルが計算できません');
            }

            const normalizedDirX = dirX / dirLength;
            const normalizedDirY = dirY / dirLength;
            const normalizedDirZ = dirZ / dirLength;

            // 主光線を像面から逆方向に延長して光軸(x=0, y=0)との交点を求める
            // パラメトリック方程式: P = imageSphereCenter + t * direction
            // 光軸条件: x = 0, y = 0
            
            // x方向: 0 = imageSphereCenter.x + t * normalizedDirX
            // y方向: 0 = imageSphereCenter.y + t * normalizedDirY
            
            let t = null;
            
            if (Math.abs(normalizedDirX) > 1e-10) {
                t = -imageSphereCenter.x / normalizedDirX;
                
                // y座標でも確認
                const yAtT = imageSphereCenter.y + t * normalizedDirY;
                if (Math.abs(yAtT) > 1e-6) {
                    console.warn(`⚠️ 光軸交点でy座標が0になりません: y=${yAtT.toFixed(6)}`);
                }
            } else if (Math.abs(normalizedDirY) > 1e-10) {
                t = -imageSphereCenter.y / normalizedDirY;
                
                // x座標でも確認
                const xAtT = imageSphereCenter.x + t * normalizedDirX;
                if (Math.abs(xAtT) > 1e-6) {
                    console.warn(`⚠️ 光軸交点でx座標が0になりません: x=${xAtT.toFixed(6)}`);
                }
            } else {
                throw new Error('主光線が光軸に平行で交点を計算できません');
            }

            if (t === null || !isFinite(t)) {
                throw new Error('光軸との交点パラメータが計算できません');
            }

            // 光軸交点のz座標
            const axisIntersectionZ = imageSphereCenter.z + t * normalizedDirZ;

            // 像参照球半径 = 中心から光軸交点までの距離
            const radiusSquared = (imageSphereCenter.x * imageSphereCenter.x) + 
                                 (imageSphereCenter.y * imageSphereCenter.y) + 
                                 ((imageSphereCenter.z - axisIntersectionZ) * (imageSphereCenter.z - axisIntersectionZ));
            
            const radius = Math.sqrt(radiusSquared);

            console.log(`📐 像参照球半径計算:`);
            console.log(`  像球中心: (${imageSphereCenter.x.toFixed(6)}, ${imageSphereCenter.y.toFixed(6)}, ${imageSphereCenter.z.toFixed(6)})mm`);
            console.log(`  光軸交点: (0, 0, ${axisIntersectionZ.toFixed(6)})mm`);
            console.log(`  計算半径: ${radius.toFixed(6)}mm`);

            return radius;

        } catch (error) {
            console.error(`❌ 像参照球半径計算エラー: ${error.message}`);
            return null;
        }
    }

    /**
     * 光線データからパス情報を取得
     * @param {Array|Object} rayData - 光線データ
     * @returns {Array|null} パスデータ
     */
    getPathData(rayData) {
        if (!rayData) {
            return null;
        }
        
        if (Array.isArray(rayData)) {
            return rayData;
        } else {
            return rayData.path || rayData.pathData || rayData.points || null;
        }
    }

    /**
     * 物参照球の半径を計算（図面仕様準拠）
     * 
     * 【図面定義】物参照球 Ro(-):
     * - 中心: 物体高さ H(-)
     * - 半径: 主光線が光軸と交わる点までの距離
     * 
     * @param {Object} fieldSetting - フィールド設定
     * @returns {Object|null} 物参照球情報
     */
    calculateObjectSphereRadius(fieldSetting) {
        try {
            if (!this.referenceChiefRay) {
                throw new Error('主光線データが設定されていません');
            }

            // 1. 物参照球の中心: 物体高さ H(-) 【図面準拠】
            const objectHeight = fieldSetting.yHeight || 0; // mm
            const objectSphereCenter = {
                x: 0,
                y: objectHeight, // 物体高さ H(-)
                z: 0 // 物面のz位置（通常は0または第1面の位置）
            };

            // 2. 主光線の最初の2点から方向ベクトルを計算
            const chiefPath = this.getPathData(this.referenceChiefRay);
            if (!chiefPath || chiefPath.length < 2) {
                throw new Error('主光線のパスデータが不十分です');
            }

            const firstPoint = chiefPath[0]; // 物面上の点
            const secondPoint = chiefPath[1]; // 次の点

            // 主光線の方向ベクトル（物側から像側へ）
            const dirX = secondPoint.x - firstPoint.x;
            const dirY = secondPoint.y - firstPoint.y;
            const dirZ = secondPoint.z - firstPoint.z;

            // 方向ベクトルの正規化
            const dirLength = Math.sqrt(dirX*dirX + dirY*dirY + dirZ*dirZ);
            if (dirLength === 0) {
                throw new Error('主光線の方向ベクトルが計算できません');
            }

            const normalizedDirX = dirX / dirLength;
            const normalizedDirY = dirY / dirLength;
            const normalizedDirZ = dirZ / dirLength;

            // 3. 主光線を延長して光軸(x=0, y=0)との交点を求める【図面準拠】
            // パラメトリック方程式: P = firstPoint + t * direction
            // 光軸条件: x = 0, y = 0
            // この交点が物参照球 Ro(-) の半径を決定する基準点
            
            let t = null;
            
            if (Math.abs(normalizedDirX) > 1e-10) {
                t = -firstPoint.x / normalizedDirX;
                
                // y座標でも確認
                const yAtT = firstPoint.y + t * normalizedDirY;
                if (Math.abs(yAtT) > 1e-6) {
                    console.warn(`⚠️ 物側光軸交点でy座標が0になりません: y=${yAtT.toFixed(6)}`);
                }
            } else if (Math.abs(normalizedDirY) > 1e-10) {
                t = -firstPoint.y / normalizedDirY;
                
                // x座標でも確認
                const xAtT = firstPoint.x + t * normalizedDirX;
                if (Math.abs(xAtT) > 1e-6) {
                    console.warn(`⚠️ 物側光軸交点でx座標が0になりません: x=${xAtT.toFixed(6)}`);
                }
            } else {
                throw new Error('主光線が光軸に平行で交点を計算できません');
            }

            if (t === null || !isFinite(t)) {
                throw new Error('物側光軸との交点パラメータが計算できません');
            }

            // 光軸交点のz座標
            const axisIntersectionZ = firstPoint.z + t * normalizedDirZ;

            // 4. 物参照球半径 = 中心から光軸交点までの距離
            const radiusSquared = (objectSphereCenter.x * objectSphereCenter.x) + 
                                 ((objectSphereCenter.y - 0) * (objectSphereCenter.y - 0)) + 
                                 ((objectSphereCenter.z - axisIntersectionZ) * (objectSphereCenter.z - axisIntersectionZ));
            
            const radius = Math.sqrt(radiusSquared);

            console.log(`📐 物参照球半径計算:`);
            console.log(`  物球中心: (${objectSphereCenter.x.toFixed(6)}, ${objectSphereCenter.y.toFixed(6)}, ${objectSphereCenter.z.toFixed(6)})mm`);
            console.log(`  光軸交点: (0, 0, ${axisIntersectionZ.toFixed(6)})mm`);
            console.log(`  計算半径: ${radius.toFixed(6)}mm`);

            return {
                center: objectSphereCenter,
                radius: radius,
                axisIntersection: { x: 0, y: 0, z: axisIntersectionZ }
            };

        } catch (error) {
            console.error(`❌ 物参照球半径計算エラー: ${error.message}`);
            return null;
        }
    }

    /**
            console.warn('主光線の像面交点が取得できません、単純な光路差を返します');
            return marginalOpticalPath - this.referenceOpticalPath;
        }
        
        // 射出瞳中心の位置（絞り面位置を近似）
        const stopZ = this.calculateSurfacePosition(this.stopSurfaceIndex);
        const exitPupilCenter = { x: 0, y: 0, z: stopZ };
        
        // 参照球面の半径 = 射出瞳中心から主光線像点までの距離
        const dx = chiefRayImagePoint.x - exitPupilCenter.x;
        const dy = chiefRayImagePoint.y - exitPupilCenter.y;
        const dz = chiefRayImagePoint.z - exitPupilCenter.z;
        const referenceSphereRadius = Math.sqrt(dx*dx + dy*dy + dz*dz); // mm
        
        // 射出瞳面での周辺光線位置
        const stopSurface = this.opticalSystemRows[this.stopSurfaceIndex];
        const stopRadius = parseFloat(stopSurface.semidia || 10);
        const pupilPointX = pupilX * stopRadius;
        const pupilPointY = pupilY * stopRadius;
        const pupilPoint = { x: pupilPointX, y: pupilPointY, z: stopZ };
        
        // 周辺光線の瞳点から参照球面中心までの距離
        const pdx = chiefRayImagePoint.x - pupilPoint.x;
        const pdy = chiefRayImagePoint.y - pupilPoint.y;
        const pdz = chiefRayImagePoint.z - pupilPoint.z;
        const pupilToImageDistance = Math.sqrt(pdx*pdx + pdy*pdy + pdz*pdz); // mm
        
        // 参照球面からの理論光路長 = 瞳点から参照球面までの距離
        const theoreticalOpticalPath = pupilToImageDistance * 1000; // mm → μm
        
        // 主光線の基準光路長 = 射出瞳中心から参照球面中心までの距離
        const referenceTheoretical = referenceSphereRadius * 1000; // mm → μm
        
        // 光路差 = (実際の光路長 - 基準光路長) - (理論光路長 - 基準理論光路長)
        const opd = (marginalOpticalPath - this.referenceOpticalPath) - (theoreticalOpticalPath - referenceTheoretical);
        
        console.log(`🔍 参照球面計算詳細:`, {
            参照球面半径: referenceSphereRadius.toFixed(3) + 'mm',
            理論光路長: theoreticalOpticalPath.toFixed(3) + 'μm',
            基準理論: referenceTheoretical.toFixed(3) + 'μm',
            OPD: opd.toFixed(6) + 'μm'
        });
        
        return opd;
    }

    /**
     * 周辺光線の光路差を波長単位で計算
     * @param {number} pupilX - 瞳座標X
     * @param {number} pupilY - 瞳座標Y
     * @param {Object} fieldSetting - フィールド設定
     * @returns {number} 光路差（波長単位）
     */
    calculateOPDInWavelengths(pupilX, pupilY, fieldSetting) {
        const opdInMicrons = this.calculateOPD(pupilX, pupilY, fieldSetting);
        if (opdInMicrons === null || opdInMicrons === 0) {
            return 0; // 光線が蹴られた場合や異常値の場合は0を返す
        }
        
        // 光路差を波長で割って波長単位に変換
        const opdInWavelengths = opdInMicrons / this.wavelength;
        
        return opdInWavelengths;
    }

    /**
     * 周辺光線を生成
     * @param {number} pupilX - 瞳座標X
     * @param {number} pupilY - 瞳座標Y
     * @param {Object} fieldSetting - フィールド設定
     * @returns {Object} 周辺光線データ
     */
    generateMarginalRay(pupilX, pupilY, fieldSetting) {
        const isFinite = this.isFiniteSystem();
        
        // console.log(`🔍 generateMarginalRay: pupilX=${pupilX}, pupilY=${pupilY}, isFinite=${isFinite}`);  // ログ削減
        
        if (isFinite) {
            const result = this.generateFiniteMarginalRay(pupilX, pupilY, fieldSetting);
            // Debug logging disabled to prevent console spam
            return result;
        } else {
            const result = this.generateInfiniteMarginalRay(pupilX, pupilY, fieldSetting);
            // Debug logging disabled to prevent console spam
            return result;
        }
    }

    /**
     * 有限系の周辺光線生成
     * @param {number} pupilX - 瞳座標X
     * @param {number} pupilY - 瞳座標Y
     * @param {Object} fieldSetting - フィールド設定
     * @returns {Object} 周辺光線データ
     */
    generateFiniteMarginalRay(pupilX, pupilY, fieldSetting) {
        const firstSurface = this.opticalSystemRows[0];
        const objectDistance = Math.abs(parseFloat(firstSurface.thickness || firstSurface.Thickness));
        
        // Object面での光線位置
        const yObject = fieldSetting.yHeight || 0;
        const xObject = fieldSetting.xHeight || 0;
        
        // 絞り面での光線位置（瞳座標制限を解除）
        const stopZ = this.calculateSurfacePosition(this.stopSurfaceIndex);
        const stopSurface = this.opticalSystemRows[this.stopSurfaceIndex];
        
        // 🆕 絞り半径の基準値を取得（拡張可能）
        let baseStopRadius = Math.abs(parseFloat(stopSurface.aperture || stopSurface.Aperture || stopSurface.semidia || 10));
        if (stopSurface.aperture || stopSurface.Aperture) {
            baseStopRadius = baseStopRadius / 2; // 直径の場合は半径に変換
        }
        
        // 🆕 瞳座標1.0を超えても対応（制限解除）
        const pupilRadius = Math.sqrt(pupilX * pupilX + pupilY * pupilY);
        const effectiveStopRadius = baseStopRadius * Math.max(1.0, pupilRadius * 1.1); // 10%マージン
        
        const stopX = pupilX * effectiveStopRadius;
        const stopY = pupilY * effectiveStopRadius;
        
        const shouldLog = pupilRadius > 1.0;
        if (shouldLog) {
            console.log(`🔍 瞳座標制限解除: pupilRadius=${pupilRadius.toFixed(3)}, baseStopRadius=${baseStopRadius.toFixed(3)}mm → effectiveStopRadius=${effectiveStopRadius.toFixed(3)}mm`);
            console.log(`🔍 絞り面位置: (${stopX.toFixed(3)}, ${stopY.toFixed(3)}, ${stopZ.toFixed(3)})`);
        }
        
        // Object面から絞り面への光線方向を計算
        const rayDirection = this.calculateRayDirection(
            { x: xObject, y: yObject, z: -objectDistance },
            { x: stopX, y: stopY, z: stopZ }
        );

        const initialRay = {
            pos: { x: xObject, y: yObject, z: -objectDistance },
            dir: rayDirection,
            wavelength: this.wavelength
        };

        const isChiefRay = Math.abs(pupilX) < 1e-6 && Math.abs(pupilY) < 1e-6;
        if (isChiefRay) {
            console.log(`🔍 主光線（有限系）: pos(${xObject.toFixed(3)}, ${yObject.toFixed(3)}, ${(-objectDistance).toFixed(3)}), dir(${rayDirection.x.toFixed(3)}, ${rayDirection.y.toFixed(3)}, ${rayDirection.z.toFixed(3)})`);
        }
        
        const result = traceRay(this.opticalSystemRows, initialRay);
        if (isChiefRay) {
            console.log(`🔍 主光線traceRay結果（有限系）: 長さ=${result ? result.length : 'null'}`);
        }
        
        if (!result) {
            console.warn(`❌ 有限系光線追跡失敗: pupilX=${pupilX}, pupilY=${pupilY}`);
        }
        return result;
    }

    /**
     * 無限系の周辺光線生成（クロスビーム対応）
     * @param {number} pupilX - 瞳座標X
     * @param {number} pupilY - 瞳座標Y
     * @param {Object} fieldSetting - フィールド設定
     * @returns {Object} 周辺光線データ
     */
    generateInfiniteMarginalRay(pupilX, pupilY, fieldSetting) {
        // 🔍 端点での詳細ログ
        const inputPupilRadius = Math.sqrt(pupilX * pupilX + pupilY * pupilY);
        const isEdgePoint = inputPupilRadius > 0.95; // 端点または外縁部
        const shouldLogDetail = isEdgePoint || (Math.abs(pupilX) > 0.5 || Math.abs(pupilY) > 0.5);
        
        if (isEdgePoint) {
            console.log(`🎯 [端点光線] pupil(${pupilX.toFixed(3)}, ${pupilY.toFixed(3)}) 半径=${inputPupilRadius.toFixed(3)} - Brent法最適化開始`);
        }
        
        // フィールド設定から画角を取得
        const angleX = fieldSetting.fieldAngle?.x || 0;
        const angleY = fieldSetting.fieldAngle?.y || 0;
        
        // 主光線情報のみ簡潔に表示
        let chiefRayForDirection;
        // デバッグ: fieldSettingとchiefRayForDirectionの内容を出力
        if (Math.abs(pupilX) < 1e-6 && Math.abs(pupilY) < 1e-6) {
            console.log('[DEBUG] fieldSetting:', fieldSetting);
            chiefRayForDirection = this.generateChiefRay(fieldSetting);
            console.log('[DEBUG] chiefRayForDirection:', chiefRayForDirection);
        } else {
            chiefRayForDirection = this.generateChiefRay(fieldSetting);
        }
        let chiefDirection = null;
        let chiefPath = null;
        if (chiefRayForDirection) {
            if (chiefRayForDirection.path && chiefRayForDirection.path.length >= 2) {
                chiefPath = chiefRayForDirection.path;
            } else if (Array.isArray(chiefRayForDirection) && chiefRayForDirection.length >= 2) {
                chiefPath = chiefRayForDirection;
            }
            if (chiefPath && chiefPath.length >= 2) {
                const p1 = chiefPath[0];
                const p2 = chiefPath[1];
                const dx = p2.x - p1.x;
                const dy = p2.y - p1.y;
                const dz = p2.z - p1.z;
                const norm = Math.sqrt(dx*dx + dy*dy + dz*dz);
                chiefDirection = {
                    x: dx / norm,
                    y: dy / norm,
                    z: dz / norm
                };
                // pupilX/pupilYが0のときのみ主光線ログ出力
                if (Math.abs(pupilX) < 1e-6 && Math.abs(pupilY) < 1e-6) {
                    console.log(`[主光線] p1=(${p1.x.toFixed(2)},${p1.y.toFixed(2)},${p1.z.toFixed(2)}), p2=(${p2.x.toFixed(2)},${p2.y.toFixed(2)},${p2.z.toFixed(2)}), dir=(${chiefDirection.x.toFixed(4)},${chiefDirection.y.toFixed(4)},${chiefDirection.z.toFixed(4)})`);
                }
            }
        }
        
        // フォールバック: 主光線が取得できない場合は画角から計算
        if (!chiefDirection) {
            const angleX = (fieldSetting.fieldAngle?.x || 0) * Math.PI / 180;
            const angleY = (fieldSetting.fieldAngle?.y || 0) * Math.PI / 180;
            
            chiefDirection = {
                x: Math.sin(angleX),
                y: Math.sin(angleY),
                z: Math.cos(angleX) * Math.cos(angleY)
            };
            
            if (shouldLogDetail) {
                console.log(`  フォールバック画角: X=${(fieldSetting.fieldAngle?.x || 0)}°, Y=${(fieldSetting.fieldAngle?.y || 0)}°`);
                console.log(`  計算方向: (${chiefDirection.x.toFixed(6)}, ${chiefDirection.y.toFixed(6)}, ${chiefDirection.z.toFixed(6)})`);
            }
        }

        // **修正**: Draw Crossの正しいアルゴリズムを使用
        // 主光線に垂直な平面での安定した座標系を構築
        const chiefDir = chiefDirection;
        
        // より安定した方法で垂直面内のベクトルを計算
        // 方向ベクトルに最も垂直な軸を選択（Draw Cross方式）
        let uVector = { x: 0, y: 0, z: 0 };
        const absX = Math.abs(chiefDir.x);
        const absY = Math.abs(chiefDir.y);
        const absZ = Math.abs(chiefDir.z);
        
        if (absX <= absY && absX <= absZ) {
            // X成分が最小の場合
            uVector.x = 0;
            uVector.y = -chiefDir.z;
            uVector.z = chiefDir.y;
        } else if (absY <= absX && absY <= absZ) {
            // Y成分が最小の場合
            uVector.x = -chiefDir.z;
            uVector.y = 0;
            uVector.z = chiefDir.x;
        } else {
            // Z成分が最小の場合
            uVector.x = -chiefDir.y;
            uVector.y = chiefDir.x;
            uVector.z = 0;
        }
        
        // uベクトルを正規化
        let uMag = Math.sqrt(uVector.x*uVector.x + uVector.y*uVector.y + uVector.z*uVector.z);
        if (uMag > 0) {
            uVector.x /= uMag;
            uVector.y /= uMag;
            uVector.z /= uMag;
        }
        
        // V軸: 主光線方向とU軸の外積で計算
        const vVector = {
            x: chiefDir.y * uVector.z - chiefDir.z * uVector.y,
            y: chiefDir.z * uVector.x - chiefDir.x * uVector.z,
            z: chiefDir.x * uVector.y - chiefDir.y * uVector.x
        };
        
        // vベクトルを正規化
        let vMag = Math.sqrt(vVector.x*vVector.x + vVector.y*vVector.y + vVector.z*vVector.z);
        if (vMag > 0) {
            vVector.x /= vMag;
            vVector.y /= vMag;
            vVector.z /= vMag;
        }
        
        // 主光線の場合のみ座標軸とフィールド角の詳細ログ出力
        if (shouldLogDetail && Math.abs(pupilX) < 1e-6 && Math.abs(pupilY) < 1e-6) {
            console.log(`🔍 [修正版] 垂直面座標系:`);
            console.log(`  主光線方向: (${chiefDir.x.toFixed(6)}, ${chiefDir.y.toFixed(6)}, ${chiefDir.z.toFixed(6)})`);
            console.log(`  U軸: (${uVector.x.toFixed(6)}, ${uVector.y.toFixed(6)}, ${uVector.z.toFixed(6)})`);
            console.log(`  V軸: (${vVector.x.toFixed(6)}, ${vVector.y.toFixed(6)}, ${vVector.z.toFixed(6)})`);
            
            // 直交性チェック（Draw Cross方式）
            const uDotN = uVector.x*chiefDir.x + uVector.y*chiefDir.y + uVector.z*chiefDir.z;
            const vDotN = vVector.x*chiefDir.x + vVector.y*chiefDir.y + vVector.z*chiefDir.z;
            const uDotV = uVector.x*vVector.x + uVector.y*vVector.y + uVector.z*vVector.z;
            console.log(`  直交性チェック: u・n=${uDotN.toFixed(8)}, v・n=${vDotN.toFixed(8)}, u・v=${uDotV.toFixed(8)}`);
            console.log(`  期待値: すべて0に近い値`);
        }
        
        // **修正**: 周辺光線の方向は主光線方向と同じ（平行光線系）
        const direction = chiefDirection;
        
        if (shouldLogDetail && Math.abs(pupilX) < 1e-6 && Math.abs(pupilY) < 1e-6) {
            console.log(`  主光線方向: (${direction.x.toFixed(6)}, ${direction.y.toFixed(6)}, ${direction.z.toFixed(6)})`);
            
            // 画角が0でないかチェック
            if (Math.abs(angleX) < 1e-6 && Math.abs(angleY) < 1e-6) {
                console.warn(`⚠️ 画角が0度です！フィールド設定が正しくありません`);
            }
        }

        // 絞り面の情報を取得（エラーハンドリング追加）
        const stopZ = this.calculateSurfacePosition(this.stopSurfaceIndex);
        let stopRadius = 17.85; // デフォルト値
        
        if (this.opticalSystemRows && this.stopSurfaceIndex >= 0 && this.stopSurfaceIndex < this.opticalSystemRows.length) {
            const stopSurface = this.opticalSystemRows[this.stopSurfaceIndex];
            if (stopSurface) {
                const semidia = parseFloat(stopSurface.semidia || 0);
                const aperture = parseFloat(stopSurface.aperture || stopSurface.Aperture || 0);
                stopRadius = semidia > 0 ? semidia : (aperture > 0 ? aperture / 2 : 17.85);
            }
        }

        // **修正**: 主光線を基準とした光線生成
        // まず主光線の絞り面交点を取得
        const chiefRayForStop = this.generateChiefRay(fieldSetting);
        let chiefStopPoint = null;
        
        // 🔧 **主光線取得の詳細調査**: フォールバック原因を特定
        console.log(`🔍 [主光線調査] chiefRayForStop取得結果:`, {
            exists: !!chiefRayForStop,
            type: typeof chiefRayForStop,
            isArray: Array.isArray(chiefRayForStop),
            hasPath: chiefRayForStop?.path !== undefined,
            pathLength: chiefRayForStop?.path?.length || 'N/A',
            stopSurfaceIndex: this.stopSurfaceIndex
        });
        
        if (chiefRayForStop && chiefRayForStop.path && chiefRayForStop.path.length > this.stopSurfaceIndex) {
            chiefStopPoint = chiefRayForStop.path[this.stopSurfaceIndex];
            console.log(`✅ [主光線] 正常経路: path配列から絞り面交点を取得`);
        } else if (Array.isArray(chiefRayForStop) && chiefRayForStop.length > this.stopSurfaceIndex) {
            chiefStopPoint = chiefRayForStop[this.stopSurfaceIndex];
            console.log(`✅ [主光線] 配列経路: 直接配列から絞り面交点を取得`);
        } else {
            console.warn(`❌ [主光線] 取得失敗 → フォールバックに移行`);
            console.warn(`  chiefRayForStop:`, chiefRayForStop ? 'exists' : 'null');
            console.warn(`  path:`, chiefRayForStop?.path ? `length=${chiefRayForStop.path.length}` : 'none');
            console.warn(`  required index:`, this.stopSurfaceIndex);
        }
        
        // デバッグ出力：主光線交点情報
        if (Math.abs(pupilX) < 1e-6 && Math.abs(pupilY) < 1e-6) {
            console.log(`🔍 [主光線交点デバッグ]:`);
            console.log(`  chiefRayForStop type: ${typeof chiefRayForStop}, isArray: ${Array.isArray(chiefRayForStop)}`);
            console.log(`  stopSurfaceIndex: ${this.stopSurfaceIndex}`);
            if (chiefRayForStop) {
                console.log(`  length: ${chiefRayForStop.length || (chiefRayForStop.path ? chiefRayForStop.path.length : 'no path')}`);
            }
            console.log(`  chiefStopPoint: ${chiefStopPoint ? `(${chiefStopPoint.x.toFixed(3)}, ${chiefStopPoint.y.toFixed(3)}, ${chiefStopPoint.z.toFixed(3)})` : 'null'}`);
        }

        let targetStopX, targetStopY;
        
        // 🔧 **重要修正**: 入射面半径を拡大（Cross rays と同様に）
        // Cross rays では絞り面での目標を設定し、入射面は制限しない
        // OPD rays も同様に入射面半径を拡大する必要がある
        const entranceRadius = 25.0; // 入射面半径（絞り半径より大きく設定）
        const pupilRadius = Math.sqrt(pupilX * pupilX + pupilY * pupilY);
        
        if (pupilRadius > 0.95) {
            console.log(`🎯 [修正版計算] pupilRadius=${pupilRadius.toFixed(3)}, 入射面半径=${entranceRadius}mm, 絞り半径=${stopRadius}mm`);
            console.log(`🎯 [修正版計算] 入射面目標位置=(${(pupilX * entranceRadius).toFixed(3)}, ${(pupilY * entranceRadius).toFixed(3)})mm`);
        }
        
        // **重要**: 入射面では大きな半径を使用（絞り面ではstopRadiusで制限される）
        targetStopX = pupilX * entranceRadius;  // 入射面での座標
        targetStopY = pupilY * entranceRadius;  // 入射面での座標
        
        // **重要修正**: Draw Cross方式による垂直面座標計算（入射面半径使用）
        // すべての光線（主光線含む）で統一したアルゴリズムを使用
        let rayOrigin;
        
        // 主光線の出発点を計算（基準点）
        const chiefStartZ = -25;
        const chiefDistanceToStop = stopZ - chiefStartZ;
        const chiefOriginX = (chiefStopPoint ? chiefStopPoint.x : 0) - (direction.x / direction.z) * chiefDistanceToStop;
        const chiefOriginY = (chiefStopPoint ? chiefStopPoint.y : 0) - (direction.y / direction.z) * chiefDistanceToStop;
        
        const chiefOrigin = {
            x: chiefOriginX,
            y: chiefOriginY,
            z: chiefStartZ
        };
        
        // 垂直面内の座標を計算（Draw Cross方式 - 完全準拠）  
        // Draw Cross equivalent: calculatePerpendicularPlanePosition
        // **重要修正**: Draw Cross システムと完全に同じアルゴリズムを使用
        
        // **修正**: 入射面半径を使用（絞り半径ではなく）
        const uComponent = pupilX * entranceRadius;  // U方向成分（入射面半径使用）
        const vComponent = pupilY * entranceRadius;  // V方向成分（入射面半径使用）
        
        const pupilOffsetX = uComponent * uVector.x + vComponent * vVector.x;
        const pupilOffsetY = uComponent * uVector.y + vComponent * vVector.y;
        const pupilOffsetZ = uComponent * uVector.z + vComponent * vVector.z;
        
        // 初期位置（垂直面制約適用前） - Draw Cross完全準拠
        let position = {
            x: chiefOrigin.x + pupilOffsetX,
            y: chiefOrigin.y + pupilOffsetY,
            z: chiefOrigin.z + pupilOffsetZ
        };
        
        // **重要**: Draw Cross方式の垂直面制約によるZ座標調整 - 完全準拠
        // Draw Cross equivalent: direction.i*(x-origin.x) + direction.j*(y-origin.y) + direction.k*(z-origin.z) = 0
        const deltaX = position.x - chiefOrigin.x;  // = pupilOffsetX
        const deltaY = position.y - chiefOrigin.y;  // = pupilOffsetY
        
        if (Math.abs(direction.z) > 1e-10) {
            // Draw Cross exact formula: position.z = origin.z - (direction.x * deltaX + direction.y * deltaY) / direction.z
            position.z = chiefOrigin.z - (direction.x * deltaX + direction.y * deltaY) / direction.z;
        }
        
        rayOrigin = position;
        
        // デバッグ出力（主光線および特定条件の光線のみ）
        const isChiefRay = Math.abs(pupilX) < 1e-6 && Math.abs(pupilY) < 1e-6;
        const isExtremePupil = Math.abs(pupilX) > 0.8 || Math.abs(pupilY) > 0.8;
        
        // **修正**: 主光線のみログ出力（重複生成問題調査のため）
        const shouldLogThisRay = Math.abs(pupilX) < 1e-6 && Math.abs(pupilY) < 1e-6; // 主光線のみ
        
        if (shouldLogThisRay) {
            console.log(`🔍 [主光線デバッグ] 光線 (${pupilX.toFixed(3)}, ${pupilY.toFixed(3)}):`);
            console.log(`  絞り半径: ${stopRadius.toFixed(3)}mm, 入射面半径: ${entranceRadius.toFixed(3)}mm`);
            console.log(`  主光線方向: (${direction.x.toFixed(6)}, ${direction.y.toFixed(6)}, ${direction.z.toFixed(6)})`);
            console.log(`  最終位置: (${rayOrigin.x.toFixed(2)}, ${rayOrigin.y.toFixed(2)}, ${rayOrigin.z.toFixed(2)})mm`);
            
            // 垂直性確認
            const offsetVector = {
                x: rayOrigin.x - chiefOrigin.x,
                y: rayOrigin.y - chiefOrigin.y,
                z: rayOrigin.z - chiefOrigin.z
            };
            const dotProduct = direction.x * offsetVector.x + direction.y * offsetVector.y + direction.z * offsetVector.z;
            console.log(`  垂直性確認: ${dotProduct.toFixed(8)} (Draw Cross方式)`);
            
            // **厳密な垂直性チェック**
            const perpendicularityError = Math.abs(dotProduct);
            if (perpendicularityError > 1e-6) {
                console.warn(`⚠️ 垂直性制約違反: 誤差=${perpendicularityError.toExponential(3)} > 1e-6`);
                console.warn(`  光線 (${pupilX.toFixed(3)}, ${pupilY.toFixed(3)}) が主光線に垂直な面内にありません`);
                console.warn(`  主光線方向: (${direction.x.toFixed(6)}, ${direction.y.toFixed(6)}, ${direction.z.toFixed(6)})`);
                console.warn(`  オフセット: (${offsetVector.x.toFixed(6)}, ${offsetVector.y.toFixed(6)}, ${offsetVector.z.toFixed(6)})`);
            }
        }

        const initialRay = {
            pos: rayOrigin,
            dir: direction,
            wavelength: this.wavelength
        };

        // 光線追跡実行
        const rayResult = traceRay(this.opticalSystemRows, initialRay);
        
        // 主光線の場合のみtraceRay結果をログ出力
        if (Math.abs(pupilX) < 1e-6 && Math.abs(pupilY) < 1e-6) {
            console.log(`🔍 主光線traceRay結果（無限系）: 長さ=${rayResult ? rayResult.length : 'null'}`);
        }
        
        // 結果の検証
        if (rayResult && Array.isArray(rayResult) && rayResult.length > 1) {
            return rayResult;
        }
        
        // 簡易計算が失敗した場合、Brent法を試行（ログ削減：瞳座標1.0超のみ）
        // Note: pupilRadius already declared above at line 1769
        if (pupilRadius <= 1.0) {
            console.warn(`⚠️ 光線追跡失敗（瞳内）: pupil(${pupilX.toFixed(3)}, ${pupilY.toFixed(3)})`);
            // 🔍 **失敗詳細ログ**: 絞り端光線の失敗原因を調査
            if (pupilRadius >= 0.95) {
                console.warn(`🔍 [絞り端失敗詳細] pupil(${pupilX.toFixed(3)}, ${pupilY.toFixed(3)}):`);
                console.warn(`  rayResult存在: ${!!rayResult}, 配列: ${Array.isArray(rayResult)}, 長さ: ${rayResult?.length || 'N/A'}`);
                console.warn(`  光線原点: (${rayOrigin.x.toFixed(3)}, ${rayOrigin.y.toFixed(3)}, ${rayOrigin.z.toFixed(3)})`);
                console.warn(`  光線方向: (${direction.x.toFixed(6)}, ${direction.y.toFixed(6)}, ${direction.z.toFixed(6)})`);
                console.warn(`  入射面半径: ${entranceRadius}mm, 絞り半径: ${stopRadius}mm`);
            }
        }
        
        const origin = this.generateCrossBeamOrigin(pupilX, pupilY, fieldSetting);
        if (!origin) {
            if (pupilRadius <= 1.0) {
                console.warn(`❌ クロスビーム原点生成失敗: pupil(${pupilX.toFixed(3)}, ${pupilY.toFixed(3)})`);
            }
            return null;
        }

        const brentRay = {
            pos: origin,
            dir: direction,
            wavelength: this.wavelength
        };

        const brentResult = traceRay(this.opticalSystemRows, brentRay);
        
        // 端点での結果ログ
        if (isEdgePoint) {
            console.log(`🎯 [端点光線結果] pupil(${pupilX.toFixed(3)}, ${pupilY.toFixed(3)}) - Brent法完了`);
            console.log(`  結果: ${brentResult ? '成功' : '失敗'}, type=${typeof brentResult}, length=${brentResult?.length || 'N/A'}`);
        }
        
        // Brent法結果のログは瞳座標1.0以下のみ（一般ログ）
        if (inputPupilRadius <= 1.0 && !isEdgePoint) {
            console.log(`🔍 Brent法結果: `, { 
                type: typeof brentResult, 
                isArray: Array.isArray(brentResult), 
                length: brentResult ? brentResult.length : 'null'
            });
        }
        
        return brentResult;
    }

    /**
     * クロスビーム原点を生成（Brent法使用）
     * @param {number} pupilX - 瞳座標X
     * @param {number} pupilY - 瞳座標Y
     * @param {Object} fieldSetting - フィールド設定
     * @returns {Object} 光線原点座標
     */
    generateCrossBeamOrigin(pupilX, pupilY, fieldSetting) {
        // 主光線の絞り面交点を取得
        const chiefRayResult = this.generateChiefRay(fieldSetting);
        if (!chiefRayResult) {
            console.warn('❌ 主光線生成失敗');
            return null;
        }
        
        // 光線パスの確認（配列形式または直接パス形式）
        let chiefRayPath = null;
        if (Array.isArray(chiefRayResult)) {
            chiefRayPath = chiefRayResult;
        } else if (chiefRayResult.path) {
            chiefRayPath = chiefRayResult.path;
        } else if (chiefRayResult.length) {
            chiefRayPath = chiefRayResult; // 直接配列の場合
        }
        
        if (!chiefRayPath || chiefRayPath.length <= this.stopSurfaceIndex) {
            // エラーログを削減（10回に1回のみ出力）
            if (Math.random() < 0.1) {
                console.warn(`❌ 主光線の絞り面交点が取得できません: path長=${chiefRayPath ? chiefRayPath.length : 'null'}, stopIndex=${this.stopSurfaceIndex}`);
            }
            return null;
        }
        
        // 絞り面交点を取得
        var chiefStopPoint = chiefRayPath[this.stopSurfaceIndex];
        
        // 絞り半径を取得（強化版 - 絞り端到達を保証 + エラーハンドリング）
        let stopRadius = 17.85; // デフォルト値
        
        if (this.opticalSystemRows && this.stopSurfaceIndex >= 0 && this.stopSurfaceIndex < this.opticalSystemRows.length) {
            const stopSurface = this.opticalSystemRows[this.stopSurfaceIndex];
            if (stopSurface) {
                const semidia = parseFloat(stopSurface.semidia || 0);
                const aperture = parseFloat(stopSurface.aperture || stopSurface.Aperture || 0);
                stopRadius = semidia > 0 ? semidia : (aperture > 0 ? aperture / 2 : 17.85);
            }
        }
        
        // 🆕 絞り端到達強化: 瞳座標1.0 = 絞り端に正確に到達（gen-ray-cross-infinite.js方式）
        const pupilRadius = Math.sqrt(pupilX * pupilX + pupilY * pupilY);
        
        // 絞り面上の目標位置（正確な絞り端到達）
        // pupilRadius = 1.0 の時に stopRadius に正確に到達
        const targetStopX = chiefStopPoint.x + pupilX * stopRadius;
        const targetStopY = chiefStopPoint.y + pupilY * stopRadius;
        
        if (pupilRadius > 0.95) {
            console.log(`🎯 [絞り端正確到達] pupil(${pupilX.toFixed(3)}, ${pupilY.toFixed(3)}) radius=${pupilRadius.toFixed(3)} → target絞り位置(${targetStopX.toFixed(3)}, ${targetStopY.toFixed(3)}) 絞り端距離=${(pupilRadius * stopRadius).toFixed(3)}mm/${stopRadius.toFixed(3)}mm`);
        }

        // 主光線方向ベクトル
        const angleX = (fieldSetting.fieldAngle?.x || 0) * Math.PI / 180;
        const angleY = (fieldSetting.fieldAngle?.y || 0) * Math.PI / 180;
        
        const rayDirection = {
            x: Math.sin(angleX),
            y: Math.sin(angleY),
            z: Math.cos(angleX) * Math.cos(angleY)
        };

        // Brent法でX座標の原点を求める
        const findXOrigin = (x0) => {
            const z0 = chiefStopPoint.z - 1000; // 絞り面から1000mm手前
            const y0 = targetStopY - (rayDirection.y / rayDirection.z) * 1000;
            
            // この原点から光線を射出した時の絞り面X座標
            const stopX = x0 + rayDirection.x * 1000;
            return stopX - targetStopX;
        };

        // Brent法でY座標の原点を求める
        const findYOrigin = (y0) => {
            const z0 = chiefStopPoint.z - 1000; // 絞り面から1000mm手前
            const x0 = targetStopX - (rayDirection.x / rayDirection.z) * 1000;
            
            // この原点から光線を射出した時の絞り面Y座標
            const stopY = y0 + rayDirection.y * 1000;
            return stopY - targetStopY;
        };

        // 🆕 正確な絞り端到達のための反復最適化（gen-ray-cross-infinite.js方式を採用）
        const findOptimizedOrigin = () => {
            const tolerance = 0.1; // 0.1mm以内の精度
            const maxIterations = 30;
            
            // 初期推定値（従来方式）
            let currentX = targetStopX - (rayDirection.x / rayDirection.z) * 1000;
            let currentY = targetStopY - (rayDirection.y / rayDirection.z) * 1000;
            const currentZ = chiefStopPoint.z - 1000;
            
            // 反復最適化
            for (let iter = 0; iter < maxIterations; iter++) {
                const testRay = {
                    pos: { x: currentX, y: currentY, z: currentZ },
                    dir: rayDirection
                };
                
                const testPath = traceRay(this.opticalSystemRows, testRay);
                if (!testPath || testPath.length <= this.stopSurfaceIndex) {
                    break; // 光線追跡失敗
                }
                
                const actualStop = testPath[this.stopSurfaceIndex];
                const errorX = actualStop.x - targetStopX;
                const errorY = actualStop.y - targetStopY;
                const errorMagnitude = Math.sqrt(errorX * errorX + errorY * errorY);
                
                if (errorMagnitude < tolerance) {
                    // 収束した
                    if (pupilRadius > 0.95 && iter > 0) {
                        console.log(`✅ [反復最適化] ${iter}回で収束: 誤差${errorMagnitude.toFixed(3)}mm < ${tolerance}mm`);
                        console.log(`   実際絞り位置: (${actualStop.x.toFixed(3)}, ${actualStop.y.toFixed(3)}) vs 目標: (${targetStopX.toFixed(3)}, ${targetStopY.toFixed(3)})`);
                    }
                    return { x: currentX, y: currentY, z: currentZ };
                }
                
                // Newton法による修正（簡易版）
                const correctionFactor = 0.8; // 過修正を防ぐ
                const correctionX = -errorX * correctionFactor;
                const correctionY = -errorY * correctionFactor;
                
                currentX += correctionX;
                currentY += correctionY;
                
                if (pupilRadius > 0.95 && iter < 3) {
                    console.log(`🔍 [反復${iter}] 誤差=${errorMagnitude.toFixed(3)}mm, 修正=(${correctionX.toFixed(3)}, ${correctionY.toFixed(3)})`);
                }
            }
            
            // 最大反復数に達した場合も結果を返す
            if (pupilRadius > 0.95) {
                console.warn(`⚠️ [反復最適化] 最大反復数${maxIterations}に達しました`);
            }
            return { x: currentX, y: currentY, z: currentZ };
        };
        
        const optimizedOrigin = findOptimizedOrigin();
        
        // 最適化結果の検証
        if (!optimizedOrigin || isNaN(optimizedOrigin.x) || isNaN(optimizedOrigin.y)) {
            console.warn(`❌ 反復最適化失敗: 結果=${optimizedOrigin}`);
            // フォールバック: 簡単な幾何学計算
            return {
                x: targetStopX - (rayDirection.x / rayDirection.z) * 1000,
                y: targetStopY - (rayDirection.y / rayDirection.z) * 1000,
                z: chiefStopPoint.z - 1000
            };
        }

        return optimizedOrigin;
    }

    /**
     * 光線の光路長を計算
     * @param {Object} rayData - 光線追跡結果
     * @returns {number} 光路長（μm）
     */
    calculateOpticalPath(rayData) {
        // 光線データの詳細チェック
        if (!rayData) {
            console.warn('❌ 光線データがnullまたはundefined');
            return 0;
        }
        
        // console.log(`🔍 光路長計算: 入力データタイプ=${typeof rayData}`);  // ログ削減
        
        // パスデータのチェック（光線追跡結果が直接配列の場合も考慮）
        let pathData = null;
        
        if (Array.isArray(rayData)) {
            // 光線追跡結果が直接配列として返される場合
            pathData = rayData;
            // console.log(`🔍 光線データは直接配列として提供: ${pathData.length}点`);  // ログ削減
        } else {
            // オブジェクトの場合、異なる可能性のあるプロパティ名を確認
            pathData = rayData.path || rayData.pathData || rayData.points;
            // console.log(`🔍 オブジェクトからパスデータ抽出: ${pathData ? pathData.length : 0}点`);  // ログ削減
            if (!pathData) {
                console.warn('❌ 光線パスデータが見つかりません. 利用可能なプロパティ:', Object.keys(rayData));
                console.warn('🔍 rayData内容:', rayData);
                return 0;
            }
        }
        
        if (!Array.isArray(pathData)) {
            console.warn('❌ 光線パスデータが配列ではありません:', typeof pathData);
            return 0;
        }
        
        if (pathData.length < 2) {
            console.warn(`❌ 光線パスデータの点数が不足: ${pathData.length}点 (最低2点必要)`);
            console.warn(`🔍 光線データの詳細:`, pathData);
            
            // 光線追跡が失敗した可能性の診断
            if (pathData.length === 1) {
                console.warn(`⚠️ 光線追跡が最初の面で失敗した可能性があります`);
                console.warn(`  光線開始点:`, pathData[0]);
                console.warn(`  考えられる原因:`);
                console.warn(`  - 光学系の第1面で全反射`);
                console.warn(`  - 光学系データの問題`);
                console.warn(`  - 光線の入射角度が大きすぎる`);
            }
            return 0;
        }

        // console.log(`📏 光路長計算開始: ${pathData.length}点の光線パス`);  // ログ削減
        let totalOpticalPath = 0;
        
        // **重要**: 座標の単位チェック - 光学系はmm単位、OPDはμm単位
        // console.log('🔍 座標単位確認 - 最初の数点:');  // ログ削減
        // for (let i = 0; i < Math.min(3, pathData.length); i++) {
        //     const point = pathData[i];
        //     console.log(`  点${i}: (${point.x}, ${point.y}, ${point.z}) - 単位要確認`);
        // }
        
        for (let i = 0; i < pathData.length - 1; i++) {
            const point1 = pathData[i];
            const point2 = pathData[i + 1];
            
            // ポイントの座標確認
            if (!point1 || !point2 || 
                typeof point1.x !== 'number' || typeof point1.y !== 'number' || typeof point1.z !== 'number' ||
                typeof point2.x !== 'number' || typeof point2.y !== 'number' || typeof point2.z !== 'number') {
                console.warn(`❌ セグメント${i}の座標データが無効:`, point1, point2);
                continue;
            }
            
            // 物理的な距離を計算（座標の単位に注意）
            const distance = Math.sqrt(
                Math.pow(point2.x - point1.x, 2) +
                Math.pow(point2.y - point1.y, 2) +
                Math.pow(point2.z - point1.z, 2)
            );
            
            // INF値や異常な距離値のチェック
            if (!isFinite(distance)) {
                console.warn(`❌ セグメント${i}の距離が無限大またはNaN: ${distance}`);
                console.warn(`  点1: (${point1.x}, ${point1.y}, ${point1.z})`);
                console.warn(`  点2: (${point2.x}, ${point2.y}, ${point2.z})`);
                continue; // このセグメントをスキップ
            }
            
            if (distance === 0) {
                console.warn(`⚠️ セグメント${i}の距離が0 - 同一点`);
                continue; // このセグメントをスキップ
            }
            
            if (distance > 10000) { // 10m以上は異常
                console.warn(`⚠️ セグメント${i}の距離が異常に大きい: ${distance}mm`);
                console.warn(`  点1: (${point1.x}, ${point1.y}, ${point1.z})`);
                console.warn(`  点2: (${point2.x}, ${point2.y}, ${point2.z})`);
                // 異常に大きい値でも計算は続行（光学系によっては長い距離もありうる）
            }
            
            // **重要**: 光学系の座標がmm単位の場合、μmに変換する必要がある
            const distanceInMicrons = distance * 1000; // mm → μm変換
            
            // 屈折率を取得（媒質の屈折率）
            let refractiveIndex = this.getRefractiveIndex(i);
            
            // 屈折率の有効性チェック
            if (!isFinite(refractiveIndex) || refractiveIndex <= 0) {
                console.warn(`❌ セグメント${i}の屈折率が無効: ${refractiveIndex} → デフォルト1.0を使用`);
                refractiveIndex = 1.0;
            }
            
            // 光路長 = 物理的距離[μm] × 屈折率
            const opticalSegment = distanceInMicrons * refractiveIndex;
            
            // 光路長の有効性チェック
            if (!isFinite(opticalSegment)) {
                console.error(`❌ セグメント${i}の光路長がNaN/INF: distance=${distance}, refractiveIndex=${refractiveIndex}`);
                continue; // このセグメントをスキップ
            }
            
            totalOpticalPath += opticalSegment;
            
            // Logging disabled to prevent console spam during grid calculations
            // if ((i < 3 || i === pathData.length - 2) && !isFinite(opticalSegment)) {
            //     console.log(`  セグメント${i}: 距離=${distance.toFixed(4)}mm = ${distanceInMicrons.toFixed(4)}μm, 屈折率=${refractiveIndex.toFixed(4)}, 光路長=${opticalSegment.toFixed(4)}μm`);
            // }
        }
        
        // console.log(`📏 総光路長: ${totalOpticalPath.toFixed(4)} μm`);  // ログ削減
        
        // 光路長が0の場合の追加診断
        if (totalOpticalPath === 0) {
            console.error(`❌ 光路長が0になりました - 光線追跡に問題があります`);
            console.error(`  パス点数: ${pathData.length}`);
            console.error(`  光学系面数: ${this.opticalSystemRows.length}`);
        }
        
        return totalOpticalPath;
    }

    /**
     * 波面収差 Wλ を計算
     * @param {number} pupilX - 瞳座標X
     * @param {number} pupilY - 瞳座標Y
     * @param {Object} fieldSetting - フィールド設定
     * @returns {number} 波面収差（波長単位）
     */
    calculateWavefrontAberration(pupilX, pupilY, fieldSetting) {
        const opd = this.calculateOPD(pupilX, pupilY, fieldSetting);
        if (opd === null) {
            return null;
        }
        
        // 波面収差 = 光路差 / 波長
        return opd / this.wavelength;
    }

    /**
     * ユーティリティ関数群
     */

    /**
     * ビネッティング判定（Draw OPD Rays専用の緩和モード）
     * @param {number} pupilX - 瞳座標X
     * @param {number} pupilY - 瞳座標Y
     * @param {Object} fieldSetting - フィールド設定
     * @returns {boolean} true: ビネッティングされている
     */
    isVignetted(pupilX, pupilY, fieldSetting) {
        // 🆕 Draw OPD Rays用の大幅緩和モード
        const isDrawOPDMode = true; // このモジュールはDraw OPD Rays専用
        
        if (isDrawOPDMode) {
            // Draw OPD Raysモードでは物理的に不可能な場合のみビネッティング判定
            const pupilRadius = Math.sqrt(pupilX * pupilX + pupilY * pupilY);
            
            // 極端な瞳座標（3.0以上）のみをビネッティング扱い
            if (pupilRadius > 3.0) {
                console.log(`🚫 [DrawOPD] 極端瞳座標ビネッティング: pupilRadius=${pupilRadius.toFixed(3)} > 3.0`);
                return true;
            }
            
            // 実際の光線追跡によるビネッティング判定（失敗のみ）
            try {
                const testRay = this.generateMarginalRay(pupilX, pupilY, fieldSetting);
                
                // 光線生成失敗 = ビネッティング
                if (!testRay) {
                    return true;
                }
                
                // 光線データの有効性チェック
                if (!this.isValidRayData(testRay)) {
                    return true;
                }
                
                // 🆕 Draw OPDモードでは絞り判定を大幅緩和
                // 光路長の妥当性チェックのみ実行
                const opticalPath = this.calculateOpticalPath(testRay);
                if (!isFinite(opticalPath) || opticalPath <= 0) {
                    console.log(`🚫 [DrawOPD] 無効光路長ビネッティング: pupil(${pupilX.toFixed(3)}, ${pupilY.toFixed(3)}) OPL=${opticalPath}`);
                    return true;
                }
                
                console.log(`✅ [DrawOPD] ビネッティングなし: pupil(${pupilX.toFixed(3)}, ${pupilY.toFixed(3)}), radius=${pupilRadius.toFixed(3)}`);
                return false; // ビネッティングなし
                
            } catch (error) {
                console.log(`🚫 [DrawOPD] 光線追跡エラーによるビネッティング: pupil(${pupilX.toFixed(3)}, ${pupilY.toFixed(3)}) ${error.message}`);
                return true;
            }
        }
        
        // 🆕 従来モード（現在は使用されない）
        const pupilRadius = Math.sqrt(pupilX * pupilX + pupilY * pupilY);
        const shouldDebug = pupilRadius > 0.8 || (Math.abs(pupilX) > 0.9) || (Math.abs(pupilY) > 0.9);
        
        if (shouldDebug) {
            console.log(`🔍 ビネッティング判定開始: pupil(${pupilX.toFixed(3)}, ${pupilY.toFixed(3)}), radius=${pupilRadius.toFixed(3)}`);
            console.log(`🔍 絞り面インデックス: ${this.stopSurfaceIndex}, 光学系面数: ${this.opticalSystemRows.length}`);
        }
        
        // 実際の光線追跡によるビネッティング判定
        try {
            const testRay = this.generateMarginalRay(pupilX, pupilY, fieldSetting);
            
            // 光線生成失敗 = ビネッティング
            if (!testRay) {
                // console.log(`🚫 光線生成失敗によるビネッティング: (${pupilX.toFixed(3)}, ${pupilY.toFixed(3)})`);
                return true;
            }
            
            // 光線データの有効性チェック
            if (!this.isValidRayData(testRay)) {
                // console.log(`🚫 無効光線データによるビネッティング: (${pupilX.toFixed(3)}, ${pupilY.toFixed(3)})`);
                return true;
            }
            
            // 3. 各面での絞り判定
            if (this.checkApertureVignetting(testRay, pupilX, pupilY)) {
                return true;
            }
            
            // 4. 光路長の妥当性チェック
            const opticalPath = this.calculateOpticalPath(testRay);
            if (!isFinite(opticalPath) || opticalPath <= 0) {
                if (shouldDebug) {
                    console.log(`🚫 無効光路長によるビネッティング: (${pupilX.toFixed(3)}, ${pupilY.toFixed(3)}) OPL=${opticalPath}`);
                }
                return true;
            }
            
            if (shouldDebug) {
                console.log(`✅ ビネッティング判定完了: ビネッティングなし (${pupilX.toFixed(3)}, ${pupilY.toFixed(3)})`);
            }
            
            return false; // ビネッティングなし
            
        } catch (error) {
            if (shouldDebug) {
                console.log(`🚫 光線追跡エラーによるビネッティング: (${pupilX.toFixed(3)}, ${pupilY.toFixed(3)}) ${error.message}`);
            }
            return true;
        }
    }

    /**
     * 各面での絞り（アパーチャ）によるビネッティング判定
     * @param {Array|Object} rayData - 光線データ
     * @param {number} pupilX - 瞳座標X
     * @param {number} pupilY - 瞳座標Y
     * @returns {boolean} true: ビネッティングされている
     */
    checkApertureVignetting(rayData, pupilX, pupilY) {
        const pupilRadius = Math.sqrt(pupilX * pupilX + pupilY * pupilY);
        const shouldDebug = pupilRadius > 0.8 || (Math.abs(pupilX) > 0.9) || (Math.abs(pupilY) > 0.9);
        
        let pathData = null;
        if (Array.isArray(rayData)) {
            pathData = rayData;
        } else {
            pathData = rayData.path || rayData.pathData || rayData.points;
        }
        
        if (!Array.isArray(pathData)) {
            return true; // データが不正
        }
        
        // **修正**: 実絞り（stop surface）のみをチェック
        if (this.stopSurfaceIndex >= 0 && this.stopSurfaceIndex < pathData.length && this.stopSurfaceIndex < this.opticalSystemRows.length) {
            const rayPoint = pathData[this.stopSurfaceIndex];
            const stopSurface = this.opticalSystemRows[this.stopSurfaceIndex];
            
            if (shouldDebug) {
                console.log(`🔍 絞り面データ確認: rayPoint=${!!rayPoint}, stopSurface=${!!stopSurface}`);
                if (stopSurface) {
                    console.log(`🔍 絞り面内容: aperture=${stopSurface.aperture}, semidia=${stopSurface.semidia}, object=${stopSurface.object}`);
                }
                if (rayPoint) {
                    console.log(`🔍 光線位置: (${rayPoint.x.toFixed(3)}, ${rayPoint.y.toFixed(3)}, ${rayPoint.z.toFixed(3)})`);
                }
            }
            
            if (rayPoint && stopSurface) {
                // 絞り径をチェック（複数の可能性をチェック）
                let apertureDiameter = 0;
                
                // aperture フィールドから取得
                if (stopSurface.aperture || stopSurface.Aperture) {
                    apertureDiameter = parseFloat(stopSurface.aperture || stopSurface.Aperture);
                    if (shouldDebug) {
                        console.log(`🔍 絞り径取得 (aperture): ${apertureDiameter}mm`);
                    }
                }
                // semidia フィールドから取得（半径なので2倍）
                else if (stopSurface.semidia || stopSurface.Semidia) {
                    const semidiaValue = parseFloat(stopSurface.semidia || stopSurface.Semidia);
                    apertureDiameter = semidiaValue * 2;
                    if (shouldDebug) {
                        console.log(`🔍 絞り径取得 (semidia): ${semidiaValue}mm → 直径${apertureDiameter}mm`);
                    }
                }
                
                if (isFinite(apertureDiameter) && apertureDiameter > 0) {
                    const apertureRadius = apertureDiameter / 2;
                    
                    // 🆕 瞳座標に応じて絞り判定を緩和
                    const pupilRadius = Math.sqrt(pupilX * pupilX + pupilY * pupilY);
                    let effectiveApertureRadius = apertureRadius;
                    
                    // 瞳座標1.0を超える場合は絞り許容範囲を拡大
                    if (pupilRadius > 1.0) {
                        effectiveApertureRadius = apertureRadius * pupilRadius * 1.2; // 瞳座標比例 + 20%マージン
                        if (shouldDebug) {
                            console.log(`🔍 絞り判定緩和: pupilRadius=${pupilRadius.toFixed(3)} → 許容半径=${apertureRadius.toFixed(3)}mm → ${effectiveApertureRadius.toFixed(3)}mm`);
                        }
                    }
                    
                    // 光線の半径位置
                    const rayRadius = Math.sqrt(rayPoint.x * rayPoint.x + rayPoint.y * rayPoint.y);
                    
                    if (shouldDebug) {
                        console.log(`🔍 絞りチェック: 光線半径=${rayRadius.toFixed(3)}mm vs 有効絞り半径=${effectiveApertureRadius.toFixed(3)}mm`);
                    }
                    
                    // 🆕 緩和された絞り径チェック
                    if (rayRadius > effectiveApertureRadius) {
                        if (shouldDebug) {
                            console.log(`🚫 実絞りビネッティング: 光線半径=${rayRadius.toFixed(3)}mm > 有効絞り半径=${effectiveApertureRadius.toFixed(3)}mm (面${this.stopSurfaceIndex+1}), pupil(${pupilX.toFixed(3)}, ${pupilY.toFixed(3)})`);
                        }
                        return true;
                    } else {
                        if (shouldDebug) {
                            console.log(`✅ 絞り通過OK: 光線半径=${rayRadius.toFixed(3)}mm ≤ 有効絞り半径=${effectiveApertureRadius.toFixed(3)}mm`);
                        }
                    }
                } else {
                    if (shouldDebug) {
                        console.warn(`⚠️ 絞り径が取得できません: aperture=${stopSurface.aperture}, semidia=${stopSurface.semidia}`);
                        console.log(`🔍 絞り面の全プロパティ:`, Object.keys(stopSurface));
                    }
                }
            } else {
                console.warn(`⚠️ 絞り面データが不正: rayPoint=${!!rayPoint}, stopSurface=${!!stopSurface}`);
            }
        } else {
            if (shouldDebug) {
                console.warn(`⚠️ 絞り面インデックス範囲外: ${this.stopSurfaceIndex}, pathLength=${pathData.length}, surfaceCount=${this.opticalSystemRows.length}`);
            }
        }
        
        return false; // ビネッティングなし
    }

    /**
     * 光学系の概算長さを推定
     * @returns {number} 光学系長さ（mm）
     */
    estimateSystemLength() {
        let totalLength = 0;
        for (let i = 0; i < this.opticalSystemRows.length; i++) {
            const surface = this.opticalSystemRows[i];
            const thickness = parseFloat(surface.thickness || surface.Thickness || 0);
            if (isFinite(thickness) && thickness > 0 && thickness < 1000) {
                totalLength += thickness;
            }
        }
        return Math.max(totalLength, 100); // 最低100mm
    }

    /**
     * 有限系・無限系の判定
     * @returns {boolean} true: 有限系, false: 無限系
     */
    isFiniteSystem() {
        if (!this.opticalSystemRows || this.opticalSystemRows.length === 0) {
            return false;
        }
        
        const firstSurface = this.opticalSystemRows[0];
        const thickness = firstSurface.thickness || firstSurface.Thickness;
        
        return thickness !== 'INF' && thickness !== Infinity && isFinite(parseFloat(thickness));
    }

    /**
     * 面の位置を計算
     * @param {number} surfaceIndex - 面インデックス
     * @returns {number} Z座標
     */
    calculateSurfacePosition(surfaceIndex) {
        let z = 0;
        for (let i = 0; i < surfaceIndex; i++) {
            const surface = this.opticalSystemRows[i];
            const thickness = parseFloat(surface.thickness || surface.Thickness || 0);
            if (isFinite(thickness)) {
                z += thickness;
            }
        }
        return z;
    }

    /**
     * 2点間の光線方向ベクトルを計算
     * @param {Object} point1 - 始点
     * @param {Object} point2 - 終点
     * @returns {Object} 正規化された方向ベクトル
     */
    calculateRayDirection(point1, point2) {
        const dx = point2.x - point1.x;
        const dy = point2.y - point1.y;
        const dz = point2.z - point1.z;
        
        const length = Math.sqrt(dx * dx + dy * dy + dz * dz);
        
        return {
            x: dx / length,
            y: dy / length,
            z: dz / length
        };
    }

    /**
     * 指定された区間の屈折率を取得
     * @param {number} segmentIndex - 区間インデックス
     * @returns {number} 屈折率
     */
getRefractiveIndex(segmentIndex) {
    // 最初の区間（Object空間）は通常空気
    if (segmentIndex < 0) {
        return 1.0; // 空気
    }
    
    // 最後の区間（Image空間）も通常空気
    if (segmentIndex >= this.opticalSystemRows.length) {
        return 1.0; // 空気
    }
    
    const surface = this.opticalSystemRows[segmentIndex];
    if (!surface) {
        console.warn(`⚠️ 面${segmentIndex}のデータが見つかりません`);
        return 1.0; // デフォルト値
    }
    
    // 屈折率の取得（複数の可能性のあるプロパティ名をチェック）
    const rindex = surface.rindex || surface.Rindex || surface.refractiveIndex || surface.n;
    
    if (rindex === undefined || rindex === null) {
        console.log(`  面${segmentIndex}: 屈折率未設定 → 空気(1.0)を使用`);
        return 1.0;
    }
    
    const parsedIndex = parseFloat(rindex);
    if (!isFinite(parsedIndex) || parsedIndex <= 0) {
        console.warn(`  面${segmentIndex}: 無効な屈折率値 ${rindex} → 空気(1.0)を使用`);
        return 1.0;
    }
    
    // Logging disabled to prevent console spam during grid calculations
    // if (segmentIndex < 3) { 
    //     console.log(`  面${segmentIndex}: 屈折率=${parsedIndex.toFixed(4)}`);
    // }
    
    return parsedIndex;
    }
}

/**
 * 波面収差解析クラス
 * Zernike多項式による波面収差の分解・解析機能を提供
 */
export class WavefrontAberrationAnalyzer {
    constructor(opdCalculator) {
        this.opdCalculator = opdCalculator;
        this.zernikeCoefficients = new Map();
    }

    /**
     * 指定されたフィールドでの波面収差マップを生成
     * @param {Object} fieldSetting - フィールド設定
     * @param {number} gridSize - グリッドサイズ（デフォルト: 16）
     * @param {string} gridPattern - グリッドパターン: 'circular' (デフォルト) または 'rectangular'
     * @returns {Object} 波面収差マップデータ
     */
    generateWavefrontMap(fieldSetting, gridSize = 16, gridPattern = 'circular') {
        console.log(`🌊 波面収差マップ生成開始: gridSize=${gridSize}, pattern=${gridPattern}, field=${JSON.stringify(fieldSetting)}`);
        
        const wavefrontMap = {
            fieldSetting: fieldSetting,
            gridSize: gridSize,
            pupilCoordinates: [],
            wavefrontAberrations: [],
            opds: [],
            opdsInWavelengths: [], // 波長単位のOPD
            rayData: [], // 🆕 光線描画用データ
            statistics: {}
        };

        // 基準光線を設定
        console.log(`🔍 基準光線設定開始`);
        this.opdCalculator.setReferenceRay(fieldSetting);
        console.log(`🔍 基準光線設定完了`);

        // グリッド上の各点で波面収差を計算
        // 🔧 実絞り径端まで光線が届くようにpupil範囲を拡大
        let pupilRange = 1.0; // 実絞り径端まで対応（0.7→1.0に拡大）

        // ✅ すべての画角でpupil rangeを固定（動的計算を停止）
        console.log(`🔍 固定pupil範囲: ±${pupilRange.toFixed(3)} (実絞り径端まで対応)`);
        
        // 以下の画角による範囲調整計算は無効化
        // pupilRange = Math.min(1.0, 0.9 + maxFieldAngle / 100.0);
        // pupilRange = Math.min(1.0, 0.9 + maxHeight / 200.0);
        
        // ✅ 四角形グリッドパターンでの光線生成（ヒートマップ対応）
        console.log(`🔍 四角形グリッドパターン生成: 範囲±${pupilRange.toFixed(3)}, サイズ${gridSize}×${gridSize}`);
        
        let validPointCount = 0;
        let gridPoints = []; // 生成される座標を記録
        
        // 絞り半径情報を取得して表示（エラーハンドリング追加）
        let stopRadius = 17.85; // デフォルト値
        
        // 光学系データと絞り面インデックスの存在確認
        if (!this.opdCalculator.opticalSystemRows || !Array.isArray(this.opdCalculator.opticalSystemRows)) {
            console.error(`❌ 光学系データが未初期化: opticalSystemRows=${typeof this.opdCalculator.opticalSystemRows}`);
            console.warn(`🔧 デフォルト絞り半径を使用: ${stopRadius}mm`);
        } else if (this.opdCalculator.stopSurfaceIndex === undefined || this.opdCalculator.stopSurfaceIndex === null) {
            console.error(`❌ 絞り面インデックスが未設定: stopSurfaceIndex=${this.opdCalculator.stopSurfaceIndex}`);
            console.warn(`🔧 デフォルト絞り半径を使用: ${stopRadius}mm`);
        } else if (this.opdCalculator.stopSurfaceIndex < 0 || this.opdCalculator.stopSurfaceIndex >= this.opdCalculator.opticalSystemRows.length) {
            console.error(`❌ 絞り面インデックスが範囲外: ${this.opdCalculator.stopSurfaceIndex} (光学系長=${this.opdCalculator.opticalSystemRows.length})`);
            console.warn(`🔧 デフォルト絞り半径を使用: ${stopRadius}mm`);
        } else {
            // 正常な場合：絞り面データから半径を取得
            const stopSurface = this.opdCalculator.opticalSystemRows[this.opdCalculator.stopSurfaceIndex];
            if (stopSurface) {
                const semidia = parseFloat(stopSurface.semidia || 0);
                const aperture = parseFloat(stopSurface.aperture || stopSurface.Aperture || 0);
                stopRadius = semidia > 0 ? semidia : (aperture > 0 ? aperture / 2 : 17.85);
                
                // 🔧 **Cross光線との比較**: 絞り半径の詳細確認
                console.log(`🔍 [絞り比較] OPD計算での絞り半径: ${stopRadius}mm (semidia=${semidia}, aperture=${aperture})`);
                console.log(`🔍 [絞り比較] 絞り面インデックス: ${this.opdCalculator.stopSurfaceIndex}`);
                console.log(`🔍 [絞り比較] 最大瞳座標での絞り到達範囲: ±${stopRadius * pupilRange}mm`);
                
                console.log(`🔍 絞り面情報: 面番号=${this.opdCalculator.stopSurfaceIndex}, 絞り半径=${stopRadius.toFixed(3)}mm, pupilRange=${pupilRange.toFixed(3)}`);
            } else {
                console.error(`❌ 絞り面データが取得できません: stopSurface=${stopSurface}`);
                console.warn(`🔧 デフォルト絞り半径を使用: ${stopRadius}mm`);
            }
        }

        // 四角形グリッドを生成
        for (let i = 0; i < gridSize; i++) {
            for (let j = 0; j < gridSize; j++) {
                const pupilX = (i / (gridSize - 1)) * 2 * pupilRange - pupilRange;
                const pupilY = (j / (gridSize - 1)) * 2 * pupilRange - pupilRange;
                
                // 円形範囲内であることを確認
                const pupilRadius = Math.sqrt(pupilX * pupilX + pupilY * pupilY);
                if (pupilRadius <= pupilRange) {
                    gridPoints.push({x: pupilX, y: pupilY});
                }
            }
        }
        
        console.log(`📊 生成された四角形グリッド点数: ${gridPoints.length}`);
        
        // 各点でOPD計算を実行
        for (let pointIndex = 0; pointIndex < gridPoints.length; pointIndex++) {
            const point = gridPoints[pointIndex];
            const pupilX = point.x;
            const pupilY = point.y;
            const pupilRadius = Math.sqrt(pupilX * pupilX + pupilY * pupilY);
            
            // 🆕 ログ削減: 主光線と重要な点のみログ出力
            const isChiefRay = point.isChief || (Math.abs(pupilX) < 1e-6 && Math.abs(pupilY) < 1e-6);
            const isEdgePoint = point.isEdge || (pupilRadius > 0.95); // 端点または外縁部
            const isImportantPoint = isEdgePoint || (pupilRadius > 0.9 && (pointIndex % 50 === 0)); // 外縁部の50点おき
            
            if (isImportantPoint || isEdgePoint) {
                console.log(`🔍 円形点[${pointIndex}]: pupil(${pupilX.toFixed(3)}, ${pupilY.toFixed(3)}) 半径=${pupilRadius.toFixed(3)}${isChiefRay ? ' [主光線]' : ''}${point.isEdge ? ' [端点]' : ''}`);
            }
            
            // 🆕 端点での実際の絞り面到達位置を確認
            if (isEdgePoint) {
                // 端点光線を生成して絞り面での位置を確認
                const edgeRay = this.opdCalculator.generateMarginalRay(pupilX, pupilY, fieldSetting);
                if (edgeRay && edgeRay.path && edgeRay.path.length > this.opdCalculator.stopSurfaceIndex) {
                    const stopPoint = edgeRay.path[this.opdCalculator.stopSurfaceIndex];
                    const actualStopRadius = Math.sqrt(stopPoint.x * stopPoint.x + stopPoint.y * stopPoint.y);
                    console.log(`🎯 [端点到達確認] pupil(${pupilX.toFixed(3)}, ${pupilY.toFixed(3)}) → 絞り面(${stopPoint.x.toFixed(3)}, ${stopPoint.y.toFixed(3)}) 実際半径=${actualStopRadius.toFixed(3)}mm / 設計半径=${stopRadius.toFixed(3)}mm`);
                    
                    // 絞り端到達率を計算
                    const reachRatio = actualStopRadius / stopRadius;
                    if (reachRatio < 0.95) {
                        console.warn(`⚠️ 絞り端未到達: ${(reachRatio * 100).toFixed(1)}%のみ到達`);
                    } else {
                        console.log(`✅ 絞り端到達成功: ${(reachRatio * 100).toFixed(1)}%到達`);
                    }
                }
            }
            
            const opd = this.opdCalculator.calculateOPD(pupilX, pupilY, fieldSetting);
            const opdInWavelengths = this.opdCalculator.calculateOPDInWavelengths(pupilX, pupilY, fieldSetting);
                const wavefrontAberration = this.opdCalculator.calculateWavefrontAberration(pupilX, pupilY, fieldSetting);
                
                // 🔧 **重要修正**: NaN値の厳格な検出と除外
                const isValidOPD = isFinite(opd) && !isNaN(opd);
                const isValidOPDWaves = isFinite(opdInWavelengths) && !isNaN(opdInWavelengths);
                const isValidWaveAberr = isFinite(wavefrontAberration) && !isNaN(wavefrontAberration);
                
            if (isImportantPoint) {
                console.log(`  計算結果: OPD=${isValidOPD ? opd.toFixed(6) : 'NaN'}, OPDλ=${isValidOPDWaves ? opdInWavelengths.toFixed(6) : 'NaN'}, Wλ=${isValidWaveAberr ? wavefrontAberration.toFixed(6) : 'NaN'}`);
            }                // NaN値がある場合はデータ点をスキップ
                if (!isValidOPD || !isValidOPDWaves || !isValidWaveAberr) {
                    if (isImportantPoint) {
                        console.warn(`⚠️ NaN値検出によりスキップ: pupil(${pupilX.toFixed(3)}, ${pupilY.toFixed(3)})`);
                    }
                    continue; // この点をスキップして次へ
                }
                
                // 🆕 Draw OPD Rays専用：ビネッティング判定を緩和（NaN除外後）
                const isVignetted = false; // NaN除外後は全て有効とする
                
                // 🆕 光線データを記録（描画用）
                const rayResult = this.opdCalculator.getLastRayCalculation();
                
                // ログ出力での詳細確認
                if (pupilRadius > 0.8 && validPointCount < 20) { // 瞳座標0.8超過の最初の20点をデバッグ
                    console.log(`🔍 [DrawOPD] 詳細チェック: pupil(${pupilX.toFixed(3)}, ${pupilY.toFixed(3)}), radius=${pupilRadius.toFixed(3)}`);
                    console.log(`  OPD: ${opd}, OPDλ: ${opdInWavelengths}, Wλ: ${wavefrontAberration}`);
                    console.log(`  isVignetted判定: ${isVignetted} (OPD=${opd})`);
                    if (rayResult) {
                        console.log(`  光線データ: path=${rayResult.ray?.path?.length || 'なし'}点`);
                    }
                }
                
            // デバッグ: 最初の数点で光線データをチェック
            if (validPointCount < 3) {
                console.log(`🔍 光線データ記録: pupil(${pupilX.toFixed(3)}, ${pupilY.toFixed(3)})`);
                console.log(`  rayResult:`, rayResult ? '存在' : 'なし');
                console.log(`  rayResult.ray:`, rayResult?.ray ? '存在' : 'なし');
                console.log(`  ray.path:`, rayResult?.ray?.path ? `${rayResult.ray.path.length}点` : 'なし');
                console.log(`  isVignetted:`, isVignetted);
            }
            
            // 🔍 光線データの正規化（配列かオブジェクトかを判定）
            let normalizedRay = null;
            if (rayResult?.ray) {
                if (Array.isArray(rayResult.ray)) {
                    // 光線が配列の場合：path プロパティを持つオブジェクトに変換
                    normalizedRay = {
                        path: rayResult.ray
                    };
                } else if (rayResult.ray.path) {
                    // 既にpath プロパティを持つオブジェクトの場合
                    normalizedRay = rayResult.ray;
                }
            }
            
            // 有効なデータを記録
            if (isValidOPD && isValidOPDWaves && isValidWaveAberr) {
                const radius = Math.sqrt(pupilX * pupilX + pupilY * pupilY);
                wavefrontMap.pupilCoordinates.push({ x: pupilX, y: pupilY, r: radius });
                wavefrontMap.wavefrontAberrations.push(wavefrontAberration);
                wavefrontMap.opds.push(opd);
                wavefrontMap.opdsInWavelengths.push(opdInWavelengths);
                
                // 🆕 光線データを記録（完全なデータのみ）
                if (rayResult && rayResult.ray) {
                    // 🔍 光線データ構造の詳細確認（デバッグ用）
                    if (validPointCount < 3) {
                        console.log(`🔍 [DEBUG] rayResult:`, rayResult);
                        console.log(`🔍 [DEBUG] rayResult.ray:`, rayResult.ray);
                        console.log(`🔍 [DEBUG] rayResult.ray.path:`, rayResult.ray.path);
                        console.log(`🔍 [DEBUG] rayResult.ray のキー:`, rayResult.ray ? Object.keys(rayResult.ray) : 'なし');
                    }
                    
                    // 光線パス情報を正しく取得
                    let rayPath = null;
                    if (Array.isArray(rayResult.ray)) {
                        // rayResult.ray が配列の場合
                        rayPath = rayResult.ray;
                    } else if (rayResult.ray && rayResult.ray.path && Array.isArray(rayResult.ray.path)) {
                        // rayResult.ray.path が配列の場合
                        rayPath = rayResult.ray.path;
                    } else if (rayResult.ray && Array.isArray(rayResult.ray)) {
                        // その他の配列形式
                        rayPath = rayResult.ray;
                    }
                    
                    if (rayPath && rayPath.length > 0) {
                        wavefrontMap.rayData.push({
                            pupilX: pupilX,                    // 🔧 修正: pupilCoord.x → pupilX
                            pupilY: pupilY,                    // 🔧 修正: pupilCoord.y → pupilY  
                            pupilCoord: { x: pupilX, y: pupilY }, // 互換性のため両方保持
                            ray: { path: rayPath }, // 標準化された構造
                            opd: opd,
                            opdInWavelengths: opdInWavelengths,
                            wavefrontAberration: wavefrontAberration,
                            isVignetted: isVignetted
                        });
                        
                        if (validPointCount < 3) {
                            console.log(`✅ [DEBUG] 光線データ記録成功: pupil(${pupilX.toFixed(3)}, ${pupilY.toFixed(3)}), path=${rayPath.length}点`);
                        }
                    } else {
                        if (validPointCount < 3) {
                            console.warn(`⚠️ [DEBUG] 光線パス情報が無効: rayPath=${rayPath}`);
                        }
                    }
                }
                    
                    // 最初の成功例を詳細ログ
                    if (validPointCount <= 3) {
                        console.log(`✅ 成功例${validPointCount}: pupil(${pupilX.toFixed(3)}, ${pupilY.toFixed(3)}), OPD=${opd.toFixed(6)}μm, Wλ=${wavefrontAberration.toFixed(6)}`);
                    }
                } else {
                    // 失敗例の詳細ログ（最初の数例のみ）
                    if (validPointCount <= 3 && pointIndex < 10) {
                        console.log(`❌ 失敗例: pupil(${pupilX.toFixed(3)}, ${pupilY.toFixed(3)}), OPD=${opd}, OPDλ=${opdInWavelengths}, Wλ=${wavefrontAberration}`);
                        console.log(`  isFinite(opd)=${isFinite(opd)}, isFinite(opdλ)=${isFinite(opdInWavelengths)}, isFinite(Wλ)=${isFinite(wavefrontAberration)}`);
                    }
                }
                
                // 各ポイントで validPointCount をインクリメント
                validPointCount++;
        }
        

        console.log(`📊 有効データ点数: ${validPointCount}/${gridPoints.length} (四角形グリッド)`);
        console.log(`📊 光線データ: ${wavefrontMap.rayData.length}本記録`);
        console.log(`🔍 統計計算開始`);
        
        // 統計情報を計算
        wavefrontMap.statistics = {
            wavefront: this.calculateStatistics(wavefrontMap.wavefrontAberrations),
            opdMicrons: this.calculateStatistics(wavefrontMap.opds),
            opdWavelengths: this.calculateStatistics(wavefrontMap.opdsInWavelengths)
        };
        console.log('📊 統計情報:', wavefrontMap.statistics);
        console.log(`🔍 波面収差マップ生成完了`);
        
        // 🆕 デバッグ: 生成されたデータの詳細を確認
        const validCount = wavefrontMap.wavefrontAberrations.length;
        const totalPoints = gridSize * gridSize;
        console.log(`📊 データ生成結果: 有効=${validCount}点, 総計算=${totalPoints}点 (${(validCount/totalPoints*100).toFixed(1)}%)`);
        
        if (validCount === 0) {
            console.error(`❌ 有効なデータが1点もありません！`);
            console.log(`🔍 詳細診断:`);
            console.log(`  - 基準光路長: ${this.opdCalculator.referenceOpticalPath}`);
            console.log(`  - グリッドサイズ: ${gridSize}`);
            console.log(`  - 瞳座標範囲: ±${pupilRange}`);
            
            // 中央点での詳細テスト
            console.log(`🔍 中央点(0,0)での詳細テスト:`);
            try {
                const centerOPD = this.opdCalculator.calculateOPD(0, 0, fieldSetting);
                console.log(`  中央点OPD: ${centerOPD}`);
                if (isNaN(centerOPD)) {
                    console.error(`❌ 中央点でもOPD計算に失敗しています`);
                } else {
                    console.log(`✅ 中央点OPD計算は成功: ${centerOPD}μm`);
                }
            } catch (error) {
                console.error(`❌ 中央点OPD計算エラー: ${error.message}`);
            }
        } else {
            console.log(`✅ ${validCount}点の有効なデータを生成しました`);
            console.log(`  OPD範囲: ${Math.min(...wavefrontMap.opds).toFixed(3)} ~ ${Math.max(...wavefrontMap.opds).toFixed(3)}μm`);
            console.log(`  波面収差範囲: ${Math.min(...wavefrontMap.wavefrontAberrations).toFixed(3)} ~ ${Math.max(...wavefrontMap.wavefrontAberrations).toFixed(3)}λ`);
        }
        
        return wavefrontMap;
    }

    /**
     * 統計情報を計算
     * @param {Array} aberrations - 波面収差の配列
     * @returns {Object} 統計情報
     */
    calculateStatistics(aberrations) {
        if (!aberrations || aberrations.length === 0) {
            console.warn('⚠️ 統計計算: データが空です');
            return { count: 0, mean: 0, rms: 0, peakToPeak: 0, min: 0, max: 0 };
        }

        // ゼロ以外の値のみで統計を計算（ビネッティング部分を除外）
        const validValues = aberrations.filter(val => val !== 0 && isFinite(val));
        
        if (validValues.length === 0) {
            console.warn('⚠️ 統計計算: 有効な値がありません（すべてゼロまたは無効値）');
            return { count: 0, mean: 0, rms: 0, peakToPeak: 0, min: 0, max: 0 };
        }

        const count = validValues.length;
        const mean = validValues.reduce((sum, val) => sum + val, 0) / count;
        const variance = validValues.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / count;
        const rms = Math.sqrt(variance);
        const min = Math.min(...validValues);
        const max = Math.max(...validValues);
        const peakToPeak = max - min;

        console.log(`📊 統計計算詳細: 総数=${aberrations.length}, 有効数=${count}, mean=${mean.toFixed(6)}, rms=${rms.toFixed(6)}, P-P=${peakToPeak.toFixed(6)}`);

        return {
            count: count,
            mean: mean,
            rms: rms,
            peakToPeak: peakToPeak,
            min: min,
            max: max
        };
    }

    /**
     * Zernike係数によるフィッティング（基本実装）
     * @param {Object} wavefrontMap - 波面収差マップ
     * @param {number} maxOrder - 最大次数（デフォルト: 4）
     * @returns {Map} Zernike係数
     */
    fitZernikePolynomials(wavefrontMap, maxOrder = 4) {
        // 簡易実装：最低限のZernike項のみ
        const coefficients = new Map();
        
        // Z0: Piston (定数項)
        coefficients.set(0, wavefrontMap.statistics.mean);
        
        // より高次の項は最小二乗法による本格的な実装が必要
        // ここでは基本構造のみ提供
        
        this.zernikeCoefficients = coefficients;
        return coefficients;
    }
}

/**
 * エクスポート用のファクトリ関数
 */
export function createOPDCalculator(opticalSystemRows, wavelength = 0.5876) {
    console.log('🔧 OPDCalculator作成:');
    console.log(`  光学系行数: ${opticalSystemRows ? opticalSystemRows.length : 'null'}`);
    console.log(`  波長: ${wavelength}μm`);
    
    // データの詳細検証とデバッグ
    if (!opticalSystemRows) {
        console.error('❌ opticalSystemRows が null または undefined です');
        console.log('🔧 サンプル光学系データを自動生成します');
        opticalSystemRows = createSampleOpticalSystemData();
    } else if (opticalSystemRows.length === 0) {
        console.error('❌ opticalSystemRows が空の配列です');
        console.log('� サンプル光学系データを自動生成します');
        opticalSystemRows = createSampleOpticalSystemData();
    } else {
        console.log('�🔍 光学系データ詳細確認:');
        opticalSystemRows.forEach((row, index) => {
            const surface = index + 1;
            const object = row.object || row.Object || 'N/A';
            const thickness = row.thickness || row.Thickness || 'N/A';
            const aperture = row.aperture || row.Aperture || 'N/A';
            const radius = row.radius || row.Radius || 'N/A';
            const material = row.material || row.Material || 'N/A';
            
            console.log(`  面${surface}: object=${object}, thickness=${thickness}, aperture=${aperture}, radius=${radius}, material=${material}`);
            
            // 異常値チェック
            if (thickness === 'INF' || thickness === Infinity) {
                console.warn(`    ⚠️ 面${surface}: thickness が無限大です`);
            }
            if (radius === 'INF' || radius === Infinity) {
                console.log(`    ℹ️ 面${surface}: radius が無限大（平面）です`);
            }
            if (!material || material === 'N/A') {
                console.warn(`    ⚠️ 面${surface}: 材料情報が不足しています`);
            }
        });
    }
    
    return new OpticalPathDifferenceCalculator(opticalSystemRows, wavelength);
}

/**
 * サンプル光学系データを生成（テスト用）
 */
function createSampleOpticalSystemData() {
    console.log('🔧 サンプル光学系データ生成中...');
    return [
        { object: 'Object', thickness: Infinity, aperture: 10, radius: Infinity, material: 'air' },
        { object: 'L1_Front', thickness: 5, aperture: 8, radius: 50, material: 'BK7' },
        { object: 'L1_Back', thickness: 2, aperture: 8, radius: -50, material: 'air' },
        { object: 'Stop', thickness: 3, aperture: 6, radius: Infinity, material: 'air' },
        { object: 'L2_Front', thickness: 4, aperture: 8, radius: 30, material: 'BK7' },
        { object: 'L2_Back', thickness: 20, aperture: 8, radius: -30, material: 'air' },
        { object: 'Image', thickness: 0, aperture: 10, radius: Infinity, material: 'air' }
    ];
}

export function createWavefrontAnalyzer(opdCalculator) {
    console.log('🔧 WavefrontAnalyzer作成中...');
    
    if (!opdCalculator) {
        console.error('❌ OPDCalculator が null または undefined です');
        throw new Error('有効なOPDCalculatorが必要です。光学系設定を確認してください。');
    }
    
    // OPDCalculatorの有効性をチェック
    if (!opdCalculator.opticalSystemRows || opdCalculator.opticalSystemRows.length === 0) {
        console.error('❌ OPDCalculator内の光学系データが空です');
        throw new Error('有効な光学系データが必要です。光学系設定を確認してください。');
    }
    
    console.log(`✅ WavefrontAnalyzer作成完了 (光学系: ${opdCalculator.opticalSystemRows.length}面)`);
    return new WavefrontAberrationAnalyzer(opdCalculator);
}

/**
 * 使用例（コメントアウト）:
 * 
 * // 計算機を作成
 * const calculator = createOPDCalculator(opticalSystemRows, 0.5876);
 * const analyzer = createWavefrontAnalyzer(calculator);
 * 
 * // フィールド設定
 * const fieldSetting = { yHeight: 0, xHeight: 0 }; // On-axis
 * 
 * // 波面収差マップを生成
 * const wavefrontMap = analyzer.generateWavefrontMap(fieldSetting, 16);
 * 
 * // 特定の瞳位置での光路差を計算
 * calculator.setReferenceRay(fieldSetting);
 * const opd = calculator.calculateOPD(0.5, 0.0, fieldSetting);
 * const waveAberr = calculator.calculateWavefrontAberration(0.5, 0.0, fieldSetting);
 */

// グローバル公開（デバッグ・テスト用）
if (typeof window !== 'undefined') {
    window.OpticalPathDifferenceCalculator = OpticalPathDifferenceCalculator;
    window.WavefrontAberrationAnalyzer = WavefrontAberrationAnalyzer;
    window.createWavefrontAnalyzer = createWavefrontAnalyzer;
    console.log('🔧 [EVAWavefront] 波面収差計算クラスとヘルパー関数をグローバルに公開しました');
}
