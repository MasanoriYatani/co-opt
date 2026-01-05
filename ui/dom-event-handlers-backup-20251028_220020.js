/**
 * DOM Event Handlers Module
 * ドキュメントのDOMContentLoadedイベントとその他のUIイベントハンドラーを管理
 */

import { getOpticalSystemRows, getObjectRows, getSourceRows, outputParaxialDataToDebug, displayCoordinateTransformMatrix } from '../utils/data-utils.js';
import { showSpotDiagram, showTransverseAberrationDiagram, createFieldSettingFromObject } from '../analysis/optical-analysis.js';
import { updateSurfaceNumberSelect } from './ui-updates.js';
import { setupViewButtons, setupRayPatternButtons, setupRayColorButtons, setupOpticalSystemChangeListeners } from './event-handlers.js';
import { generateSurfaceOptions } from '../eva-spot-diagram.js';
import { saveTableData as saveSourceTableData } from '../table-source.js';
import { saveTableData as saveObjectTableData } from '../table-object.js';
import { saveTableData as saveLensTableData } from '../table-optical-system.js';
import { debugWASMSystem, quickWASMComparison } from '../debug/debug-utils.js';

/**
 * セーブボタンのイベントハンドラーを設定
 */
function setupSaveButton() {
    const saveBtn = document.getElementById('save-all-btn');
    if (saveBtn) {
        saveBtn.addEventListener('click', function() {
            if (document.activeElement) document.activeElement.blur();

            const allData = {
                source: window.tableSource ? window.tableSource.getData() : [],
                object: window.tableObject ? window.tableObject.getData() : [],
                opticalSystem: window.tableOpticalSystem ? window.tableOpticalSystem.getData() : []
            };

            let filename = prompt("保存するファイル名を入力してください（拡張子 .json は自動で付きます）", "optical_system_data");
            if (!filename) return;
            if (!filename.endsWith('.json')) filename += '.json';

            const blob = new Blob([JSON.stringify(allData, null, 2)], {type: "application/json"});
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            a.click();
            URL.revokeObjectURL(url);
            console.log('✅ データが保存されました:', filename);
        });
    }
}

/**
 * ロードボタンのイベントハンドラーを設定
 */
function setupLoadButton() {
    const loadBtn = document.getElementById('load-all-btn');
    if (loadBtn) {
        loadBtn.addEventListener('click', function() {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = '.json,application/json';
            input.onchange = e => {
                const file = e.target.files[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = evt => {
                    try {
                        const allData = JSON.parse(evt.target.result);
                        saveSourceTableData(allData.source || []);
                        saveObjectTableData(allData.object || []);
                        saveLensTableData(allData.opticalSystem || []);
                        console.log('✅ データが読み込まれました:', file.name);
                        location.reload();
                    } catch (err) {
                        console.error('❌ JSONの解析エラー:', err);
                        alert("ファイルの読み込みに失敗しました。");
                    }
                };
                reader.readAsText(file);
            };
            input.click();
        });
    }
}

/**
 * ストレージクリアボタンのイベントハンドラーを設定
 */
function setupClearStorageButton() {
    const clearStorageBtn = document.getElementById('clear-storage-btn');
    if (clearStorageBtn) {
        clearStorageBtn.addEventListener('click', function() {
            const confirmed = confirm('すべての保存データを削除してもよろしいですか？この操作は元に戻せません。');
            if (confirmed) {
                try {
                    localStorage.removeItem('sourceTableData');
                    localStorage.removeItem('objectTableData');
                    localStorage.removeItem('OpticalSystemTableData');
                    localStorage.removeItem('opticalSystemTableData');
                    
                    alert('ローカルストレージがクリアされました。ページをリロードします。');
                    console.log('✅ ローカルストレージがクリアされました');
                    location.reload();
                } catch (error) {
                    console.error('❌ ローカルストレージクリアエラー:', error);
                    alert('ローカルストレージのクリアに失敗しました。');
                }
            }
        });
    }
}

/**
 * 近軸計算ボタンのイベントハンドラーを設定
 */
function setupParaxialButton() {
    const paraxialBtn = document.getElementById('calculate-paraxial-btn');
    if (paraxialBtn) {
        console.log('✅ 近軸計算ボタンが見つかりました');
        paraxialBtn.addEventListener('click', function() {
            console.log('📐 近軸計算ボタンがクリックされました');
            try {
                if (typeof window.outputParaxialDataToDebug === 'function') {
                    // テーブルインスタンスを取得して渡す
                    const tableOpticalSystem = window.tableOpticalSystem;
                    window.outputParaxialDataToDebug(tableOpticalSystem);
                    console.log('✅ 近軸計算が完了しました');
                } else {
                    console.error('❌ outputParaxialDataToDebug関数が見つかりません');
                }
            } catch (error) {
                console.error('❌ 近軸計算ボタンエラー:', error);
            }
        });
    } else {
        console.error('❌ 近軸計算ボタンが見つかりません');
    }
}

/**
 * 座標変換ボタンのイベントハンドラーを設定
 */
function setupCoordinateTransformButton() {
    const coordBtn = document.getElementById('coord-transform-btn');
    if (coordBtn) {
        console.log('✅ 座標変換ボタンが見つかりました');
        coordBtn.addEventListener('click', function() {
            console.log('🔄 座標変換ボタンがクリックされました');
            try {
                if (typeof window.displayCoordinateTransformMatrix === 'function') {
                    window.displayCoordinateTransformMatrix();
                    console.log('✅ 座標変換表示が完了しました');
                } else {
                    console.error('❌ displayCoordinateTransformMatrix関数が見つかりません');
                }
            } catch (error) {
                console.error('❌ 座標変換ボタンエラー:', error);
            }
        });
    } else {
        console.error('❌ 座標変換ボタンが見つかりません');
    }
}

/**
 * スポットダイアグラムボタンのイベントハンドラーを設定
 */
function setupSpotDiagramButton() {
    const spotDiagramBtn = document.getElementById('show-spot-diagram-btn');
    if (spotDiagramBtn) {
        spotDiagramBtn.addEventListener('click', async function() {
            try {
                await showSpotDiagram();
            } catch (error) {
                console.error('❌ スポットダイアグラムエラー:', error);
                alert(`スポットダイアグラムエラー: ${error.message}`);
            }
        });
    }
}

/**
 * 横収差図ボタンのイベントハンドラーを設定
 */
function setupTransverseAberrationButton() {
    const transverseAberrationBtn = document.getElementById('show-transverse-aberration-diagram-btn');
    if (transverseAberrationBtn) {
        transverseAberrationBtn.addEventListener('click', async function() {
            try {
                await showTransverseAberrationDiagram();
            } catch (error) {
                console.error('❌ 横収差図エラー:', error);
                alert(`横収差図エラー: ${error.message}`);
            }
        });
    }
}

/**
 * 波面収差図のObject選択オプションを更新
 */
function updateWavefrontObjectOptions() {
    const objectSelect = document.getElementById('wavefront-object-select');
    if (!objectSelect) return;
    
    try {
        // Objectテーブルからデータを取得
        const objectTable = window.objectTable;
        if (!objectTable) {
            console.warn('⚠️ Object テーブルが見つかりません');
            return;
        }
        
        const objectData = objectTable.getData();
        
        // 有効なObjectデータのみをフィルタリング
        const validObjectData = objectData.filter((obj, index) => {
            // 空行やundefinedを除外
            if (!obj || obj.id === undefined || obj.id === null) {
                console.log(`🚫 無効なObject[${index}]をスキップ:`, obj);
                return false;
            }
            return true;
        });
        
        // デバッグ: 実際のObjectデータを確認
        console.log('🔍 全Objectデータ:', objectData);
        console.log('� 有効Objectデータ:', validObjectData);
        console.log('�📊 全Objectデータ数:', objectData.length);
        console.log('📊 有効Objectデータ数:', validObjectData.length);
        
        // ローカルストレージのデータが多すぎる場合の警告
        if (objectData.length > 6) {
            console.warn('⚠️ Objectデータが多すぎます。Clear Storageボタンでリセットしてください。');
        }
        
        // 既存のオプションをクリア
        objectSelect.innerHTML = '';
        
        // Objectが存在しない場合
        if (!validObjectData || validObjectData.length === 0) {
            const option = document.createElement('option');
            option.value = '0';
            option.textContent = 'No Objects';
            option.disabled = true;
            objectSelect.appendChild(option);
            return;
        }
        
        // 各Objectのオプションを追加
        validObjectData.forEach((obj, index) => {
            console.log(`🔍 有効Object[${index}]:`, obj);
            
            const option = document.createElement('option');
            option.value = index.toString();
            
            // Object表示名を生成（座標情報含む）
            const xValue = obj.x || obj.xHeightAngle || 0;
            const yValue = obj.y || obj.yHeightAngle || 0;
            const objectName = `Object ${index + 1} (${xValue.toFixed(2)}, ${yValue.toFixed(2)})`;
            
            option.textContent = objectName;
            objectSelect.appendChild(option);
        });
        
        console.log(`📊 波面収差図Object選択更新: ${validObjectData.length}個の有効Object`);
        
    } catch (error) {
        console.error('❌ Object選択オプション更新エラー:', error);
        
        // エラー時のフォールバック
        objectSelect.innerHTML = '';
        const option = document.createElement('option');
        option.value = '0';
        option.textContent = 'Object 1';
        objectSelect.appendChild(option);
    }
}

/**
 * 波面収差図ボタンのイベントハンドラーを設定
 */
function setupWavefrontAberrationButton() {
    const wavefrontBtn = document.getElementById('show-wavefront-diagram-btn');
    if (wavefrontBtn) {
        wavefrontBtn.addEventListener('click', async function() {
            try {
                // UIから設定を取得
                const objectSelect = document.getElementById('wavefront-object-select');
                const plotTypeSelect = document.getElementById('wavefront-plot-type-select');
                const gridSizeSelect = document.getElementById('wavefront-grid-size-select');
                
                const selectedObjectIndex = objectSelect ? parseInt(objectSelect.value) : 0;
                const plotType = plotTypeSelect ? plotTypeSelect.value : 'surface';
                const dataType = 'opd'; // Optical Path Difference固定
                const gridSize = gridSizeSelect ? parseInt(gridSizeSelect.value) : 64;
                
                console.log(`🌊 光路差表示: Object${selectedObjectIndex + 1}, ${plotType}, ${dataType}, gridSize=${gridSize}`);
                await showWavefrontDiagram(plotType, dataType, gridSize, selectedObjectIndex);
            } catch (error) {
                console.error('❌ 波面収差図エラー:', error);
                alert(`波面収差図エラー: ${error.message}`);
            }
        });
    }

    // PSF計算ボタンのイベントハンドラー（新しいPSF計算システムを使用）
    const psfBtn = document.getElementById('show-psf-btn');
    if (psfBtn) {
        psfBtn.addEventListener('click', async function() {
            try {
                console.log('🔬 [PSF] Show PSF button clicked - using advanced PSF calculation system');
                
                // 新しいPSF計算システムを使用（オブジェクト選択を正しく反映）
                await handlePSFCalculation(false); // 通常モード
            } catch (error) {
                console.error('❌ PSF計算エラー:', error);
                alert(`PSF計算エラー: ${error.message}`);
            }
        });
    }

    // PSFベンチマークボタンのイベントハンドラー
    const psfBenchmarkBtn = document.getElementById('psf-benchmark-btn');
    if (psfBenchmarkBtn) {
        psfBenchmarkBtn.addEventListener('click', async function() {
            try {
                console.log('🏃‍♂️ [PSF] Benchmark button clicked - comparing JS vs WASM performance');
                await handlePSFBenchmark();
            } catch (error) {
                console.error('❌ PSFベンチマークエラー:', error);
                alert(`PSFベンチマークエラー: ${error.message}`);
            }
        });
    }
}

/**
 * 面番号選択の更新（旧関数の互換性のため）
 */
function updateSurfaceNumberSelectLegacy() {
    const surfaceSelect = document.getElementById('surface-number-select');
    
    if (!surfaceSelect) return;
    
    // 既存のオプションをクリア
    surfaceSelect.innerHTML = '<option value="">面を選択...</option>';
    
    try {
        const opticalSystemRows = getOpticalSystemRows();
        if (opticalSystemRows && opticalSystemRows.length > 0) {
            const surfaceOptions = generateSurfaceOptions(opticalSystemRows);
            let imageSurfaceValue = null;
            let lastSurfaceValue = null;
            
            surfaceOptions.forEach(option => {
                // スポットダイアグラム用のセレクト
                const optionElement = document.createElement('option');
                optionElement.value = option.value;
                optionElement.textContent = option.label;
                surfaceSelect.appendChild(optionElement);
                
                // Image面を探す
                if (option.label.includes('(Image)')) {
                    imageSurfaceValue = option.value;
                }
                
                // 最後の面を記録（Image面がない場合の代替）
                lastSurfaceValue = option.value;
            });
            
            // Image面が見つかった場合、それを初期選択値として設定
            const defaultValue = imageSurfaceValue !== null ? imageSurfaceValue : lastSurfaceValue;
            
            if (defaultValue !== null) {
                surfaceSelect.value = defaultValue;
            }
            
            console.log(`✅ 面選択が${surfaceOptions.length}個のオプションで更新されました`);
        }
    } catch (error) {
        console.error('❌ 面選択更新エラー:', error);
    }
}

/**
 * PSF計算ボタンのイベントハンドラーを設定
 */
function setupPSFCalculationButton() {
    const calculatePsfBtn = document.getElementById('calculate-psf-btn');
    console.log('🔍 [PSF] setupPSFCalculationButton called, button found:', !!calculatePsfBtn);
    if (calculatePsfBtn) {
        calculatePsfBtn.addEventListener('click', async function() {
            await handlePSFCalculation(false); // 通常モード
        });
    }
}

/**
 * デバッグPSF計算ボタンのイベントハンドラーを設定
 */
function setupDebugPSFCalculationButton() {
    const debugPsfBtn = document.getElementById('debug-psf-btn');
    console.log('🔧 [DEBUG] setupDebugPSFCalculationButton called, button found:', !!debugPsfBtn);
    if (debugPsfBtn) {
        debugPsfBtn.addEventListener('click', async function() {
            await handlePSFCalculation(true); // デバッグモード
        });
    }
}

/**
 * PSF計算処理の共通関数
 * @param {boolean} debugMode - デバッグモードかどうか
 */
async function handlePSFCalculation(debugMode = false) {
    console.log(`🔬 [PSF] PSF計算ボタンがクリックされました (デバッグモード: ${debugMode})`);
    
    // 選択されたオブジェクトを取得
    const psfObjectSelect = document.getElementById('psf-object-select');
    console.log('🔍 [PSF] PSF object select:', {
        element: !!psfObjectSelect,
        value: psfObjectSelect?.value,
        options: psfObjectSelect?.options ? Array.from(psfObjectSelect.options).map(o => ({text: o.text, value: o.value})) : 'none'
    });
    
    if (!psfObjectSelect || !psfObjectSelect.value) {
        console.warn('⚠️ [PSF] PSF object not selected');
        alert('PSF計算のためのオブジェクトを選択してください');
        return;
    }
    
    const selectedObjectIndex = parseInt(psfObjectSelect.value);
    const objectRows = getObjectRows();
    if (!objectRows || selectedObjectIndex >= objectRows.length) {
        alert('選択されたオブジェクトが無効です');
        return;
    }
    
    const selectedObject = objectRows[selectedObjectIndex];
    
    // PSF UIからパラメータを取得
    const wavelengthSelect = document.getElementById('psf-wavelength-select'); // 現在存在しない
    const gridSizeSelect = document.getElementById('psf-grid-size-select'); // 現在存在しない
    const samplingSelect = document.getElementById('psf-sampling-select'); // PSF UIのサンプリングサイズ
    
    // デバッグモードの場合は設定を上書き
    let wavelength, gridSize;
    if (debugMode) {
        wavelength = '0.5876'; // d線固定
        gridSize = 16; // 16×16グリッド固定（高速）
        console.log('🔧 [DEBUG] デバッグモード: wavelength=0.5876μm, gridSize=16×16に固定');
    } else {
        // 光源データから波長を取得
        const sources = window.getSourceRows ? window.getSourceRows() : (window.sources || []);
        // Sourceテーブルの主波長を優先
        if (typeof window !== 'undefined' && typeof window.getPrimaryWavelength === 'function') {
            wavelength = Number(window.getPrimaryWavelength()) || 0.5876;
        } else {
            wavelength = (sources && sources.length > 0) ? (sources[0].wavelength || 0.5876) : 0.5876;
        }
        
        // PSF UIのサンプリング設定を使用
        gridSize = samplingSelect ? parseInt(samplingSelect.value) : 128;
        console.log(`📊 [NORMAL] 通常モード: wavelength=${wavelength}μm (source), gridSize=${gridSize}×${gridSize} (PSF UI)`);
    }
    
    console.log(`🔬 PSFパラメータ: wavelength=${wavelength}, gridSize=${gridSize}, debugMode=${debugMode}`);
    
    // 光学系データを取得
    const opticalSystemRows = getOpticalSystemRows();
    if (!opticalSystemRows || opticalSystemRows.length === 0) {
        alert('光学系データが見つかりません。まず光学系を設定してください。');
        return;
    }
    
    try {
        // 選択されたオブジェクトからフィールド設定を作成
        console.log('🔧 オブジェクトからフィールド設定を作成中:', selectedObject);
        
        // 必要な関数を動的インポート
        const { createFieldSettingFromObject } = await import('../analysis/optical-analysis.js');
        
        const fieldSetting = createFieldSettingFromObject(selectedObject);
        if (!fieldSetting) {
            alert('選択されたオブジェクトからフィールド設定の作成に失敗しました');
            return;
        }
        console.log('✅ フィールド設定が作成されました:', fieldSetting);
        
        // ローディングオーバーレイを表示
        showPSFLoadingOverlay(gridSize, wavelength, debugMode);
        
        // PSFを計算
        console.log('🔬 PSF計算を開始...');
        
        let psfResult;
        
    // PSF計算タイムアウト設定（要求により無効化可能）
    const DISABLE_PSF_TIMEOUT = true; // タイムアウトを完全に無効化
    const PSF_TIMEOUT = debugMode ? 10000 : 60000; // 無効化時は未使用
        const psfCalculationPromise = (async () => {
            // PSFCalculatorを使用した単色PSF計算
            const modeText = debugMode ? 'デバッグモード' : '通常モード';
            console.log(`🔬 λ=${wavelength}μmの単色PSFを計算中... (${modeText})`);
            console.log('🔍 PSF計算パラメータ:', {
                opticalSystemRows: opticalSystemRows?.length || 0,
                fieldSetting: fieldSetting,
                wavelength: wavelength,
                gridSize: gridSize,
                debugMode: debugMode
            });
            
            // 必要なモジュールを動的インポート
            const { PSFCalculator } = await import('../eva-psf.js');
            const { createOPDCalculator } = await import('../eva-wavefront.js');
            
            // OPDデータを計算
            console.log('� [PSF] OPDデータ計算中...');
            const opdCalculator = createOPDCalculator(opticalSystemRows, wavelength);
            
            const pupilRadius = 1.0; // 正規化瞳半径
            const opdData = {
                rayData: [],
                gridSize: gridSize,
                wavelength: wavelength
            };
            
            // グリッド上の各点でOPD計算
            for (let i = 0; i < gridSize; i++) {
                for (let j = 0; j < gridSize; j++) {
                    const x = (i - gridSize/2) / (gridSize/2) * pupilRadius;
                    const y = (j - gridSize/2) / (gridSize/2) * pupilRadius;
                    
                    if (x*x + y*y <= pupilRadius*pupilRadius) {
                        try {
                            const opd = opdCalculator.calculateWavefrontAberration(x, y, fieldSetting);
                            opdData.rayData.push({
                                pupilX: x,
                                pupilY: y,
                                opd: opd
                            });
                        } catch (error) {
                            // 瞳外の点はスキップ
                        }
                    }
                }
            }
            
            if (opdData.rayData.length === 0) {
                throw new Error('OPDデータの計算に失敗しました。光学系の設定を確認してください。');
            }
            
            // PSF計算器を初期化（WASM統合版）
            const psfCalculator = new PSFCalculator();
            
            // パフォーマンス設定を取得
            const performanceSelect = document.getElementById('psf-performance-select');
            const performanceMode = performanceSelect ? performanceSelect.value : 'auto';
            
            // PSFを計算
            console.log(`🔬 [PSF] PSF計算中... (${gridSize}x${gridSize}, mode: ${performanceMode})`);
            const result = await psfCalculator.calculatePSF(opdData, {
                samplingSize: gridSize,
                pupilDiameter: 10.0, // mm（適切な値に調整）
                focalLength: 100.0,   // mm（適切な値に調整）
                forceImplementation: performanceMode === 'auto' ? null : performanceMode
            });
            
            // WASM使用状況をログ
            const wasmStatus = psfCalculator.getWasmStatus();
            console.log('🔍 PSF計算完了、結果:', {
                hasResult: !!result,
                resultType: typeof result,
                resultKeys: result ? Object.keys(result) : 'none',
                wasmStatus: wasmStatus,
                calculator: result?.metadata?.method || 'unknown',
                executionTime: result?.metadata?.executionTime || 'unknown',
                debugMode: debugMode
            });
            
            return result;
        })();
        
        if (DISABLE_PSF_TIMEOUT) {
            // タイムアウトを無効化して計算完了まで待機
            psfResult = await psfCalculationPromise;
        } else {
            // タイムアウト処理
            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => {
                    reject(new Error(`PSF計算がタイムアウトしました (${PSF_TIMEOUT/1000}秒)`));
                }, PSF_TIMEOUT);
            });

            try {
                psfResult = await Promise.race([psfCalculationPromise, timeoutPromise]);
            } catch (timeoutError) {
                console.error('❌ PSF計算タイムアウト:', timeoutError);

                // ローディングオーバーレイを非表示
                hidePSFLoadingOverlay();

                const psfContainer = document.getElementById('psf-container');
                if (psfContainer) {
                    psfContainer.innerHTML = `
                        <div style="padding: 20px; text-align: center; color: #d32f2f; border: 1px solid #d32f2f; border-radius: 5px; background-color: #ffebee;">
                            <h3>PSF計算タイムアウト</h3>
                            <p>PSF計算が${PSF_TIMEOUT/1000}秒以内に完了しませんでした。</p>
                            <p>以下を試してください：</p>
                            <ul style="text-align: left; margin: 10px 0;">
                                <li>グリッドサイズを小さくする（64×64など）</li>
                                <li>光学系の設定を確認する</li>
                                <li>ブラウザを再読み込みする</li>
                            </ul>
                        </div>
                    `;
                }
                return;
            }
        }
        
        if (!psfResult) {
            console.error('❌ PSF計算がnull結果を返しました');
            
            // ローディングオーバーレイを非表示
            hidePSFLoadingOverlay();
            
            const psfContainer = document.getElementById('psf-container');
            if (psfContainer) {
                psfContainer.innerHTML = `
                    <div style="padding: 20px; text-align: center; color: #d32f2f; border: 1px solid #d32f2f; border-radius: 5px; background-color: #ffebee;">
                        <h3>PSF計算エラー</h3>
                        <p>PSF計算に失敗しました。以下を確認してください:</p>
                        </ul>
                        <p>詳細なエラーはコンソールを確認してください。</p>
                    </div>
                `;
            }
            alert('PSF計算に失敗しました。光学系とオブジェクトの設定を確認してください。');
            return;
        }
        
            console.log('✅ PSF計算が正常に完了しました');
        
        // ローディングオーバーレイを非表示
        hidePSFLoadingOverlay();
        
        // PSF結果の構造を修正（PSFCalculatorの結果フォーマットに合わせる）
        if (psfResult && psfResult.psfData && !psfResult.psf) {
            psfResult.psf = psfResult.psfData;
        }
        
        console.log('📊 PSF結果の構造:', {
            hasResult: !!psfResult,
            keys: psfResult ? Object.keys(psfResult) : 'none',
            hasPSFData: psfResult ? !!psfResult.psfData : false,
            hasPSF: psfResult ? !!psfResult.psf : false,
            samplingSize: psfResult ? psfResult.samplingSize : 'none',
            psfType: psfResult?.psf ? (Array.isArray(psfResult.psf) ? 'array' : typeof psfResult.psf) : 'none',
            dimensions: psfResult?.psf && Array.isArray(psfResult.psf) ? `${psfResult.psf.length}x${psfResult.psf[0]?.length || 0}` : 'none',
            sampleValue: psfResult?.psf && Array.isArray(psfResult.psf) && psfResult.psf[0] ? psfResult.psf[0][0] : 'none',
            hasMetrics: psfResult ? !!psfResult.metrics : false,
            wavelength: psfResult ? psfResult.wavelength : 'none',
            debugMode: debugMode
        });        // PSF結果をグローバル変数に保存（チェックボックス機能用）
        window.lastPsfResult = psfResult;
        window.lastPsfResult.title = debugMode ? `Debug PSF - ${wavelength}nm (16×16)` : `PSF - ${wavelength}nm`;
        window.lastPsfObjectData = selectedObject;
        window.lastPsfWavelength = wavelength;
        window.lastPsfGridSize = gridSize;
        window.lastPsfDebugMode = debugMode;
        
        // PSFプロット表示を呼び出し
        try {
            // チェックボックスの状態を取得
            const logScaleCheckbox = document.getElementById('psf-log-scale-checkbox') || 
                                    document.getElementById('psf-log-scale-cb');
            const logScaleEnabled = logScaleCheckbox?.checked || false;
            
            // eva-psf-plot.jsの表示関数を動的インポートして使用
            if (typeof window.displayPSFResult === 'function') {
                await window.displayPSFResult(psfResult, 'psf-container', {
                    plotType: '2D',
                    logScale: logScaleEnabled,
                    colorscale: 'BGR',
                    showMetrics: true
                });
            } else if (typeof window.displaySimplePSFResult === 'function') {
                window.displaySimplePSFResult(psfResult, 'psf-container');
            } else {
                // fallback: 従来の簡単表示
                const psfContainer = document.getElementById('psf-container');
                if (psfContainer) {
                    psfContainer.innerHTML = `
                        <div style="padding: 20px; text-align: center; color: #2e7d32; border: 1px solid #4caf50; border-radius: 5px; background-color: #e8f5e8;">
                            <h3>PSF計算完了</h3>
                            <p>オブジェクト${selectedObjectIndex + 1}のPSF計算が完了しました</p>
                            <p>波長: ${wavelength}μm</p>
                            <p>グリッドサイズ: ${gridSize}×${gridSize}</p>
                            <p>PSF配列サイズ: ${psfResult.psf ? psfResult.psf.length : 'unknown'}×${psfResult.psf && psfResult.psf[0] ? psfResult.psf[0].length : 'unknown'}</p>
                            <p>計算時間: ${psfResult.calculationTime || 'unknown'}ms</p>
                            <p style="color: #d32f2f;">⚠️ PSFプロット機能が読み込まれていません</p>
                        </div>
                    `;
                }
            }
        } catch (plotError) {
            console.error('❌ [PSF] プロット表示エラー:', plotError);
            
            // エラー時は従来の表示
            const psfContainer = document.getElementById('psf-container');
            if (psfContainer) {
                psfContainer.innerHTML = `
                    <div style="padding: 20px; text-align: center; color: #2e7d32; border: 1px solid #4caf50; border-radius: 5px; background-color: #e8f5e8;">
                        <h3>PSF計算完了</h3>
                        <p>オブジェクト${selectedObjectIndex + 1}のPSF計算が完了しました</p>
                        <p>波長: ${wavelength}μm</p>
                        <p>グリッドサイズ: ${gridSize}×${gridSize}</p>
                        <p>PSF配列サイズ: ${psfResult.psf ? psfResult.psf.length : 'unknown'}×${psfResult.psf && psfResult.psf[0] ? psfResult.psf[0].length : 'unknown'}</p>
                        <p>計算時間: ${psfResult.calculationTime || 'unknown'}ms</p>
                        <p style="color: #d32f2f;">プロット表示エラー: ${plotError.message}</p>
                    </div>
                `;
            }
        }
        
        console.log('✅ [PSF] PSF計算・表示完了');
    } catch (error) {
        console.error('❌ [PSF] PSF計算処理エラー:', error);
        
        // ローディングオーバーレイを非表示
        hidePSFLoadingOverlay();
        
        const psfContainer = document.getElementById('psf-container');
        if (psfContainer) {
            psfContainer.innerHTML = `
                <div style="padding: 20px; text-align: center; color: #d32f2f; border: 1px solid #d32f2f; border-radius: 5px; background-color: #ffebee;">
                    <h3>PSF計算エラー</h3>
                    <p>PSF計算処理中にエラーが発生しました: ${error.message}</p>
                    <p>光学系とオブジェクトの設定を確認してください。</p>
                    <p>詳細なエラーはコンソールを確認してください。</p>
                </div>
            `;
        }
        
        alert(`PSF計算エラー: ${error.message}`);
    }
}

/**
 * PSFベンチマーク機能 - JavaScriptとWASMの性能比較
 */
async function handlePSFBenchmark() {
    console.log('🏃‍♂️ [PSF] Starting JavaScript vs WASM benchmark');
    
    const statusElement = document.getElementById('psf-benchmark-status');
    const resultsContainer = document.getElementById('psf-benchmark-results');
    const detailsElement = document.getElementById('psf-benchmark-details');
    
    try {
        // ベンチマーク開始
        if (statusElement) {
            statusElement.textContent = 'Benchmark running...';
            statusElement.style.color = 'orange';
        }
        
        if (resultsContainer) {
            resultsContainer.style.display = 'none';
        }
        
        // OPDデータの生成（ベンチマーク用固定設定）
        const testSizes = [64, 128, 256]; // ベンチマーク用サンプリングサイズ
        const results = [];
        
        // PSFCalculatorを初期化
        const { PSFCalculator } = await import('../eva-psf.js');
        const psfCalculator = new PSFCalculator();
        
        // テスト用OPDデータを生成（簡単な球面収差モデル）
        function generateTestOPDData(gridSize) {
            const opdData = {
                rayData: [],
                gridSize: gridSize,
                wavelength: 0.5876
            };
            
            const pupilRadius = 1.0;
            for (let i = 0; i < gridSize; i++) {
                for (let j = 0; j < gridSize; j++) {
                    const x = (i - gridSize/2) / (gridSize/2) * pupilRadius;
                    const y = (j - gridSize/2) / (gridSize/2) * pupilRadius;
                    
                    const r = Math.sqrt(x*x + y*y);
                    if (r <= pupilRadius) {
                        // 簡単な球面収差モデル（r^4項）
                        const opd = 0.1 * Math.pow(r, 4);
                        opdData.rayData.push({
                            pupilX: x,
                            pupilY: y,
                            opd: opd
                        });
                    }
                }
            }
            
            return opdData;
        }
        
        // 各サンプリングサイズでベンチマークを実行
        for (const samplingSize of testSizes) {
            console.log(`🧪 [PSF] Benchmarking ${samplingSize}x${samplingSize}`);
            
            const testOPD = generateTestOPDData(samplingSize);
            
            // JavaScript版の詳細計測
            console.time(`JS-${samplingSize}x`);
            const jsStartTime = performance.now();
            let jsResult = null;
            let jsError = null;
            let jsBreakdown = {};
            
            try {
                jsResult = await psfCalculator.calculatePSF(testOPD, {
                    samplingSize,
                    forceImplementation: 'javascript'
                });
                
                // 内部処理時間の詳細を取得
                if (jsResult.metadata) {
                    jsBreakdown = {
                        total: jsResult.calculationTime || 0,
                        fft: jsResult.metadata.fftTime || 0,
                        interpolation: jsResult.metadata.interpolationTime || 0,
                        complexAmplitude: jsResult.metadata.complexAmplitudeTime || 0
                    };
                }
            } catch (error) {
                jsError = error.message;
                console.warn(`⚠️ [PSF] JavaScript calculation failed for ${samplingSize}x:`, error);
            }
            
            const jsTime = performance.now() - jsStartTime;
            console.timeEnd(`JS-${samplingSize}x`);
            
            // WASM版の詳細計測
            console.time(`WASM-${samplingSize}x`);
            const wasmStartTime = performance.now();
            let wasmResult = null;
            let wasmError = null;
            let wasmBreakdown = {};
            
            try {
                wasmResult = await psfCalculator.calculatePSF(testOPD, {
                    samplingSize,
                    forceImplementation: 'wasm'
                });
                
                // 内部処理時間の詳細を取得
                if (wasmResult.metadata) {
                    // 安全に各タイミング値を取得（異なるキー名にもフォールバック）
                    const md = wasmResult.metadata || {};
                    const pickNum = (...candidates) => {
                        for (const c of candidates) {
                            const v = c;
                            if (typeof v === 'number' && isFinite(v)) return v;
                        }
                        return 0;
                    };
                    let memoryTransferTime = pickNum(
                        md.memoryTransferTime,
                        md.memoryTransfer,
                        md.memTransferTime,
                        md.memTransfer,
                        md.transferTime
                    );
                    let computationTime = pickNum(
                        md.computationTime,
                        md.computeTime,
                        md.calcTime,
                        md.executionTimeDetailed // まれに詳細実行時間として格納される場合
                    );
                    let dataConversionTime = pickNum(
                        md.dataConversionTime,
                        md.conversionTime,
                        md.copyOutTime
                    );

                    // ステージ別時間（C/内部計測）から合成（ログにある: interpolationTime, complexAmplitudeTime, fftTime, metricsTime, totalTime）
                    const interpolationTime = pickNum(md.interpolationTime);
                    const complexAmplitudeTime = pickNum(md.complexAmplitudeTime);
                    const fftTime = pickNum(md.fftTime);
                    const metricsTime = pickNum(md.metricsTime);
                    const totalTime = pickNum(md.totalTime, wasmResult.calculationTime, md.executionTime);

                    // 主要３区分が0で、ステージ時間が存在する場合は合成してcomputationTimeに反映
                    const stagesSum = interpolationTime + complexAmplitudeTime + fftTime + metricsTime;
                    if ((memoryTransferTime + computationTime + dataConversionTime) === 0 && stagesSum > 0) {
                        computationTime = stagesSum;
                        // memoryTransferTime と dataConversionTime は未計測のため 0 のまま
                    }

                    wasmBreakdown = {
                        total: totalTime,
                        memoryTransferTime,
                        computationTime,
                        dataConversionTime,
                        // デバッグ用にステージ別も保持
                        interpolationTime,
                        complexAmplitudeTime,
                        fftTime,
                        metricsTime
                    };
                    
                    // デバッグ情報を詳細出力
                    console.log(`🔍 [WASM-${samplingSize}] Debug metadata:`, {
                        calculationTime: wasmResult.calculationTime,
                        metadata: wasmResult.metadata,
                        wasmBreakdown
                    });
                    
                    // WASMBreakdownの中身を詳細確認
                    console.log(`🔍 [WASM-${samplingSize}] wasmBreakdown details:`, {
                        'wasmBreakdown keys': Object.keys(wasmBreakdown),
                        'wasmBreakdown values': Object.values(wasmBreakdown),
                        'wasmBreakdown': wasmBreakdown,
                        'memoryTransferTime in breakdown': wasmBreakdown.memoryTransferTime,
                        'computationTime in breakdown': wasmBreakdown.computationTime,
                        'dataConversionTime in breakdown': wasmBreakdown.dataConversionTime
                    });
                } else {
                    console.warn(`⚠️ [WASM-${samplingSize}] No metadata found in result:`, wasmResult);
                }
            } catch (error) {
                wasmError = error.message;
                console.warn(`⚠️ [PSF] WASM calculation failed for ${samplingSize}x:`, error);
            }
            
            const wasmTime = performance.now() - wasmStartTime;
            console.timeEnd(`WASM-${samplingSize}x`);
            
            // 結果を記録
            const benchmarkResult = {
                samplingSize,
                jsTime: jsTime,
                wasmTime: wasmTime,
                jsSuccess: jsResult !== null,
                wasmSuccess: wasmResult !== null,
                speedup: jsResult && wasmResult ? (jsTime / wasmTime).toFixed(2) : 'N/A',
                jsError,
                wasmError,
                jsBreakdown,
                wasmBreakdown
            };
            
            results.push(benchmarkResult);
            
            console.log(`📊 [PSF] ${samplingSize}x benchmark:`, {
                'JS Time': `${jsTime.toFixed(1)}ms`,
                'WASM Time': `${wasmTime.toFixed(1)}ms`,
                'Speedup': benchmarkResult.speedup + 'x',
                'JS Success': benchmarkResult.jsSuccess,
                'WASM Success': benchmarkResult.wasmSuccess,
                'JS Breakdown': jsBreakdown,
                'WASM Breakdown': wasmBreakdown
            });
        }
        
        // 結果を表示
        if (detailsElement && resultsContainer) {
            let html = '<table style="width: 100%; border-collapse: collapse;">';
            html += '<tr style="background-color: #f5f5f5;">';
            html += '<th style="border: 1px solid #ddd; padding: 8px;">Sampling Size</th>';
            html += '<th style="border: 1px solid #ddd; padding: 8px;">JavaScript (ms)</th>';
            html += '<th style="border: 1px solid #ddd; padding: 8px;">WASM (ms)</th>';
            html += '<th style="border: 1px solid #ddd; padding: 8px;">Speedup</th>';
            html += '<th style="border: 1px solid #ddd; padding: 8px;">Status</th>';
            html += '<th style="border: 1px solid #ddd; padding: 8px;">Bottleneck Analysis</th>';
            html += '</tr>';
            
            results.forEach(result => {
                const jsTimeStr = result.jsSuccess ? result.jsTime.toFixed(1) : 'Error';
                const wasmTimeStr = result.wasmSuccess ? result.wasmTime.toFixed(1) : 'Error';
                const speedupStr = result.speedup !== 'N/A' ? result.speedup + 'x' : 'N/A';
                
                let statusStr = '';
                if (result.jsSuccess && result.wasmSuccess) {
                    statusStr = '✅ Both OK';
                } else if (result.jsSuccess && !result.wasmSuccess) {
                    statusStr = '⚠️ JS Only';
                } else if (!result.jsSuccess && result.wasmSuccess) {
                    statusStr = '⚠️ WASM Only';
                } else {
                    statusStr = '❌ Both Failed';
                }
                
                // ボトルネック分析
                let bottleneckStr = 'N/A';
                
                // より詳細なデバッグログを追加
                console.log(`🔍 [DEBUG-${result.samplingSize}] Full result object:`, {
                    wasmSuccess: result.wasmSuccess,
                    wasmBreakdown: result.wasmBreakdown,
                    wasmTime: result.wasmTime
                });
                
                if (result.wasmSuccess && result.wasmBreakdown) {
                    const breakdown = result.wasmBreakdown;
                    
                    // WASMの場合はメタデータから詳細時間を取得（フォールバック対応）
                    const getNum = v => (typeof v === 'number' && isFinite(v) ? v : 0);
                    let memoryTime = getNum(breakdown.memoryTransferTime || breakdown.memoryTransfer || breakdown.memTransferTime || breakdown.transferTime);
                    let computeTime = getNum(breakdown.computationTime || breakdown.computeTime || breakdown.calcTime);
                    let conversionTime = getNum(breakdown.dataConversionTime || breakdown.conversionTime || breakdown.copyOutTime);
                    const totalDetailedTime = memoryTime + computeTime + conversionTime;
                    
                    // 総時間はWASMの実測時間を使用
                    const actualTotalTime = result.wasmTime || totalDetailedTime;

                    // UI側フォールバック: 詳細合計が0で総時間がある場合は計算時間に全振り
                    if (totalDetailedTime === 0 && actualTotalTime > 0) {
                        computeTime = actualTotalTime;
                        memoryTime = 0;
                        conversionTime = 0;
                    }
                    
                    // より詳細なデバッグログ
                    console.log(`🔍 [BREAKDOWN-${result.samplingSize}] Raw values:`, {
                        'breakdown object': breakdown,
                        'memoryTransferTime': breakdown.memoryTransferTime,
                        'computationTime': breakdown.computationTime,
                        'dataConversionTime': breakdown.dataConversionTime,
                        'extracted values': {
                            memoryTime,
                            computeTime,
                            conversionTime,
                            totalDetailedTime,
                            actualTotalTime
                        }
                    });
                    
                    if (actualTotalTime > 0) {
                        const memoryPct = Math.round((memoryTime / actualTotalTime) * 100);
                        const computePct = Math.round((computeTime / actualTotalTime) * 100);
                        const conversionPct = Math.round((conversionTime / actualTotalTime) * 100);
                        
                        // デバッグ情報をログ出力
                        console.log(`🔍 [WASM-${result.samplingSize}] Breakdown:`, {
                            memoryTime: memoryTime.toFixed(2),
                            computeTime: computeTime.toFixed(2),
                            conversionTime: conversionTime.toFixed(2),
                            totalDetailedTime: totalDetailedTime.toFixed(2),
                            actualTotalTime: actualTotalTime.toFixed(2),
                            memoryPct, computePct, conversionPct,
                            originalBreakdown: breakdown
                        });
                        
                        bottleneckStr = `Mem:${memoryPct}% Comp:${computePct}% Conv:${conversionPct}%`;

                        // ステージ別（interpolation/complexAmplitude/fft/metrics）があれば上位2つを併記
                        const stagePairs = [];
                        if (typeof breakdown.interpolationTime === 'number') stagePairs.push(['Interp', breakdown.interpolationTime]);
                        if (typeof breakdown.complexAmplitudeTime === 'number') stagePairs.push(['Amp', breakdown.complexAmplitudeTime]);
                        if (typeof breakdown.fftTime === 'number') stagePairs.push(['FFT', breakdown.fftTime]);
                        if (typeof breakdown.metricsTime === 'number') stagePairs.push(['Metrics', breakdown.metricsTime]);
                        const stageTotal = stagePairs.reduce((s, [,v]) => s + (isFinite(v)? v : 0), 0);
                        if (stageTotal > 0 && actualTotalTime > 0) {
                            // 割合を計算して大きい順で上位2件
                            const ranked = stagePairs
                                .map(([k,v]) => [k, v / actualTotalTime * 100])
                                .sort((a,b) => b[1] - a[1])
                                .slice(0, 2)
                                .filter(([,p]) => p >= 0.5); // 0.5%未満は省略
                            if (ranked.length) {
                                const stageNote = ranked.map(([k,p]) => `${k}:${Math.round(p)}%`).join(' ');
                                bottleneckStr += ` [${stageNote}]`;
                            }
                        }
                    } else {
                        console.warn(`🚨 [WASM-${result.samplingSize}] Zero total time:`, { actualTotalTime, breakdown });
                    }
                } else {
                    console.warn(`🚨 [WASM-${result.samplingSize}] Missing breakdown:`, { wasmSuccess: result.wasmSuccess, wasmBreakdown: result.wasmBreakdown });
                }
                
                html += '<tr>';
                html += `<td style="border: 1px solid #ddd; padding: 8px; text-align: center;">${result.samplingSize}x${result.samplingSize}</td>`;
                html += `<td style="border: 1px solid #ddd; padding: 8px; text-align: center;">${jsTimeStr}</td>`;
                html += `<td style="border: 1px solid #ddd; padding: 8px; text-align: center;">${wasmTimeStr}</td>`;
                html += `<td style="border: 1px solid #ddd; padding: 8px; text-align: center; font-weight: bold;">${speedupStr}</td>`;
                html += `<td style="border: 1px solid #ddd; padding: 8px; text-align: center;">${statusStr}</td>`;
                html += `<td style="border: 1px solid #ddd; padding: 8px; text-align: center; font-size: 11px;">${bottleneckStr}</td>`;
                html += '</tr>';
            });
            
            html += '</table>';
            
            // WASM状態情報を追加
            const wasmStatus = psfCalculator.getWasmStatus();
            html += '<div style="margin-top: 15px; padding: 10px; background-color: #f8f9fa; border-radius: 5px;">';
            html += '<h5>WASM Status Information:</h5>';
            html += `<p><strong>WASM Available:</strong> ${wasmStatus.available ? '✅ Yes' : '❌ No'}</p>`;
            html += `<p><strong>WASM Ready:</strong> ${wasmStatus.ready ? '✅ Yes' : '❌ No'}</p>`;
            if (wasmStatus.error) {
                html += `<p><strong>WASM Error:</strong> ${wasmStatus.error}</p>`;
            }
            html += '</div>';
            
            detailsElement.innerHTML = html;
            resultsContainer.style.display = 'block';
        }
        
        // ステータス更新
        if (statusElement) {
            statusElement.textContent = 'Benchmark completed ✅';
            statusElement.style.color = 'green';
        }
        
        console.log('✅ [PSF] Benchmark completed successfully');
        
    } catch (error) {
        console.error('❌ [PSF] Benchmark error:', error);
        
        if (statusElement) {
            statusElement.textContent = 'Benchmark failed ❌';
            statusElement.style.color = 'red';
        }
        
        if (detailsElement) {
            detailsElement.innerHTML = `<div style="color: red;">Benchmark failed: ${error.message}</div>`;
        }
        
        if (resultsContainer) {
            resultsContainer.style.display = 'block';
        }
        
        alert(`ベンチマークエラー: ${error.message}`);
    }
}

/**
 * PSF表示設定のイベントリスナーを設定
 */
function setupPSFDisplaySettings() {
    // チェックボックスの要素を取得（IDを統一）
    const psfLogScaleCb = document.getElementById('psf-log-scale-checkbox') || 
                         document.getElementById('psf-log-scale-cb');
    const psfContoursCb = document.getElementById('psf-contours-cb');
    const psfCharacteristicsCb = document.getElementById('psf-characteristics-cb');
    
    function updatePSFDisplay() {
        console.log('🔄 [PSF] Updating PSF display with new settings');
        
        // ローディングオーバーレイを非表示（念のため）
        hidePSFLoadingOverlay();
        
        if (window.lastPsfResult) {
            // チェックボックスの状態を取得（IDを統一）
            const logScaleCheckbox = document.getElementById('psf-log-scale-checkbox') || 
                                    document.getElementById('psf-log-scale-cb');
            const logScaleEnabled = logScaleCheckbox?.checked || false;
            
            console.log('🔄 [PSF] ログスケール設定:', logScaleEnabled);
            
            // 新しいPSF表示システムを使用
            if (typeof window.displayPSFResult === 'function') {
                window.displayPSFResult(window.lastPsfResult, 'psf-container', {
                    plotType: '2D',
                    logScale: logScaleEnabled,
                    colorscale: 'BGR',
                    showMetrics: true
                }).catch(error => {
                    console.error('❌ [PSF] 表示更新エラー:', error);
                });
            } else {
                console.warn('⚠️ [PSF] displayPSFResult関数が利用できません');
            }
            const contoursEnabled = psfContoursCb?.checked || false;
            const characteristicsEnabled = psfCharacteristicsCb?.checked || true;
            
            console.log('🎛️ [PSF] Display settings:', {
                logScale: logScaleEnabled,
                contours: contoursEnabled,
                characteristics: characteristicsEnabled
            });
            
            // 現在のアクティブな表示モードを判定
            const activeButton = document.querySelector('.psf-display-btn.active');
            const plotlyContainer = document.getElementById('psf-plotly-container');
            const isPlotlyMode = plotlyContainer && plotlyContainer.style.display !== 'none';
            
            if (isPlotlyMode && activeButton) {
                // Plot.lyモードの場合は対応する関数を呼び出し
                const psfData = {
                    data: window.lastPsfResult.psf,
                    gridSize: window.lastPsfResult.gridSize,
                    characteristics: window.lastPsfResult.characteristics,
                    imageScale: window.lastPsfResult.imageScale  // 重要：imageScaleを追加
                };
                
                const options = {
                    logScale: logScaleEnabled,
                    contours: contoursEnabled,
                    characteristics: characteristicsEnabled
                };
                
                const buttonId = activeButton.id;
                switch (buttonId) {
                    case 'psf-2d-btn':
                        createPSFHeatmap(psfData, options, 'psf-plotly-container');
                        break;
                    case 'psf-3d-btn':
                        createPSF3DSurface(psfData, options, 'psf-plotly-container');
                        break;
                    case 'psf-profile-btn':
                        createPSFProfile(psfData, options, 'psf-plotly-container');
                        break;
                    case 'psf-energy-btn':
                        createEncircledEnergyPlot(psfData, options, 'psf-plotly-container');
                        break;
                    case 'wavefront-btn':
                        // 波面収差モードの場合は、設定変更では再計算しない
                        console.log('🌊 [Wavefront] Settings changed, but wavefront display requires recalculation');
                        break;
                    default:
                        break;
                }
            } else {
                // 従来のcanvas描画モード
                if (canvas) {
                    const ctx = canvas.getContext('2d');
                    ctx.clearRect(0, 0, canvas.width, canvas.height);
                    
                    // 最適化された高速描画を使用
                    plotPSF2DFast('psf-canvas', window.lastPsfResult, {
                        logScale: logScaleEnabled,
                        showContours: contoursEnabled,
                        showCrosshair: false,
                        showCharacteristics: characteristicsEnabled,
                        title: window.lastPsfResult.title || 'PSF',
                        showColorBar: true
                    });
                }
            }
            
            // 計算時間とその他の情報を更新 - disabled to hide PSF characteristics
            // updatePSFInfo(window.lastPsfResult, window.lastPsfObjectData, window.lastPsfWavelength, window.lastPsfGridSize);
        } else {
            console.warn('⚠️ [PSF] No PSF result available for display update');
        }
    }
    
    if (psfLogScaleCb) {
        psfLogScaleCb.addEventListener('change', updatePSFDisplay);
        console.log('✅ [PSF] Log scale checkbox listener added');
    }
    if (psfContoursCb) {
        psfContoursCb.addEventListener('change', updatePSFDisplay);
        console.log('✅ [PSF] Contours checkbox listener added');
    }
    if (psfCharacteristicsCb) {
        psfCharacteristicsCb.addEventListener('change', updatePSFDisplay);
        console.log('✅ [PSF] Characteristics checkbox listener added');
    }
}

/**
 * PSF情報パネルを更新
 */
export function updatePSFInfo(psfResult, objectData, wavelength, gridSize) {
    console.log('📊 [PSF] PSF info panel is disabled - not displaying characteristics');
    
    // PSF info panel is disabled - hide it
    const psfInfoPanel = document.getElementById('psf-info');
    if (psfInfoPanel) {
        psfInfoPanel.style.display = 'none';
    }
}

/**
 * テーブル変更イベントリスナーを設定
 */
function setupTableChangeListeners() {
    // 面選択の初期更新
    setTimeout(updateSurfaceNumberSelectLegacy, 1500);
    
    // 光学系テーブル変更時に面選択を更新
    if (window.opticalSystemTabulator && typeof window.opticalSystemTabulator.on === 'function') {
        window.opticalSystemTabulator.on('dataChanged', updateSurfaceNumberSelectLegacy);
        window.opticalSystemTabulator.on('rowAdded', updateSurfaceNumberSelectLegacy);
        window.opticalSystemTabulator.on('rowDeleted', updateSurfaceNumberSelectLegacy);
    } else {
        console.warn('⚠️ opticalSystemTabulator is not initialized or does not have .on method');
    }
    
    // PSF関連の機能は削除されました
    if (window.objectTabulator && typeof window.objectTabulator.on === 'function') {
        console.log('✅ Object table listeners ready');
    } else {
        console.warn('⚠️ objectTabulator is not initialized or does not have .on method');
    }
    
    // tableObjectが利用可能な場合の確認
    if (window.tableObject && typeof window.tableObject.on === 'function') {
        console.log('✅ tableObject listeners ready');
    }
}

/**
 * テーブルの初期化を待つ関数
 */
function waitForTableInitialization() {
    return new Promise((resolve) => {
        const checkInterval = setInterval(() => {
            if (window.tableOpticalSystem && 
                typeof window.tableOpticalSystem.on === 'function' &&
                window.tableObject && 
                typeof window.tableObject.on === 'function') {
                clearInterval(checkInterval);
                console.log('✅ All tables are initialized');
                resolve();
            }
        }, 100); // 100ms間隔でチェック
        
        // 5秒後にタイムアウト
        setTimeout(() => {
            clearInterval(checkInterval);
            console.warn('⚠️ Table initialization timeout');
            resolve();
        }, 5000);
    });
}

/**
 * PSFの初期化を試行
 */
function tryInitializePSF() {
    let initAttempts = 0;
    const maxAttempts = 10;
    
    function attemptInitialization() {
        initAttempts++;
        console.log(`🕒 PSF初期化試行 ${initAttempts}/${maxAttempts}`);
        
        const objectRows = getObjectRows();
        if (objectRows && objectRows.length > 0) {
            console.log('✅ オブジェクトデータが見つかりました');
            // PSF機能は削除されました
        } else if (initAttempts < maxAttempts) {
            console.log('⏳ オブジェクトデータの準備ができていません、200ms後に再試行...');
            setTimeout(attemptInitialization, 200);
        } else {
            console.warn('⚠️ 最大試行回数後に初期化が完了しませんでした');
            // PSF機能は削除されました
        }
    }
    
    // 初期化試行を開始
    setTimeout(attemptInitialization, 100);
    
    // PSF機能は削除されました
}

/**
 * PSF表示モード切り替えボタンのイベントハンドラーを設定
 */
function setupPSFDisplayModeButtons() {
    const psf2DBtn = document.getElementById('psf-2d-btn');
    const psf3DBtn = document.getElementById('psf-3d-btn');
    const psfProfileBtn = document.getElementById('psf-profile-btn');
    const psfEnergyBtn = document.getElementById('psf-energy-btn');
    const wavefrontBtn = document.getElementById('wavefront-btn');
    
    const canvas = document.getElementById('psf-canvas');
    
    // Plot.lyコンテナの存在確認と作成
    function ensurePlotlyContainer() {
        let plotlyContainer = document.getElementById('psf-plotly-container');
        if (!plotlyContainer) {
            console.log('⚠️ [PSF] Creating missing Plot.ly container');
            const psfContainer = document.getElementById('psf-container');
            if (psfContainer) {
                plotlyContainer = document.createElement('div');
                plotlyContainer.id = 'psf-plotly-container';
                plotlyContainer.style.cssText = `
                    width: 600px;
                    height: 600px;
                    border: 1px solid #ddd;
                    background-color: #f8f9fa;
                    border-radius: 4px;
                    margin: 10px auto;
                `;
                psfContainer.appendChild(plotlyContainer);
            }
        }
        return plotlyContainer;
    }
    
    // 現在のアクティブボタンを管理
    let currentActiveBtn = psf2DBtn;
    
    function setActiveButton(btn) {
        // 全ボタンからactiveクラスを削除
        [psf2DBtn, psf3DBtn, psfProfileBtn, psfEnergyBtn, wavefrontBtn].forEach(b => {
            if (b) b.classList.remove('active');
        });
        
        // 選択されたボタンにactiveクラスを追加
        if (btn) {
            btn.classList.add('active');
            currentActiveBtn = btn;
        }
    }
    
    function getPSFDisplayOptions() {
        const logScaleCb = document.getElementById('psf-log-scale-cb');
        const contoursCb = document.getElementById('psf-contours-cb');
        const characteristicsCb = document.getElementById('psf-characteristics-cb');
        
        return {
            logScale: logScaleCb?.checked || false,
            contours: contoursCb?.checked || false,
            characteristics: characteristicsCb?.checked || false
        };
    }
    
    // 2D Heatmapボタン
    if (psf2DBtn) {
        psf2DBtn.addEventListener('click', () => {
            console.log('📊 2D Heatmap button clicked');
            
            // ローディングオーバーレイを非表示（念のため）
            hidePSFLoadingOverlay();
            
            if (window.lastPsfResult) {
                setActiveButton(psf2DBtn);
                
                // Ensure Plot.ly container exists
                const plotlyContainer = ensurePlotlyContainer();
                
                // Hide canvas, show Plot.ly
                if (canvas) canvas.style.display = 'none';
                if (plotlyContainer) plotlyContainer.style.display = 'block';
                
                // Convert data format
                const psfData = {
                    data: window.lastPsfResult.psf,
                    gridSize: window.lastPsfResult.gridSize,
                    characteristics: window.lastPsfResult.characteristics,
                    imageScale: window.lastPsfResult.imageScale  // 重要：imageScaleを追加
                };
                
                const options = getPSFDisplayOptions();
                createPSFHeatmap(psfData, options, 'psf-plotly-container');
            } else {
                alert('PSFを計算してください。');
            }
        });
    }
    
    // 3D Surface button
    if (psf3DBtn) {
        psf3DBtn.addEventListener('click', () => {
            console.log('📊 3D Surface button clicked');
            
            // ローディングオーバーレイを非表示（念のため）
            hidePSFLoadingOverlay();
            
            if (window.lastPsfResult) {
                setActiveButton(psf3DBtn);
                
                // Ensure Plot.ly container exists
                const plotlyContainer = ensurePlotlyContainer();
                
                // Hide canvas, show Plot.ly
                if (canvas) canvas.style.display = 'none';
                if (plotlyContainer) plotlyContainer.style.display = 'block';
                
                // Convert data format
                const psfData = {
                    data: window.lastPsfResult.psf,
                    gridSize: window.lastPsfResult.gridSize,
                    characteristics: window.lastPsfResult.characteristics,
                    imageScale: window.lastPsfResult.imageScale  // 重要：imageScaleを追加
                };
                
                const options = getPSFDisplayOptions();
                createPSF3DSurface(psfData, options, 'psf-plotly-container');
            } else {
                alert('PSFを計算してください。');
            }
        });
    }
    
    // Profile button
    if (psfProfileBtn) {
        psfProfileBtn.addEventListener('click', () => {
            console.log('📊 Profile button clicked');
            
            // ローディングオーバーレイを非表示（念のため）
            hidePSFLoadingOverlay();
            
            if (window.lastPsfResult) {
                setActiveButton(psfProfileBtn);
                
                // Ensure Plot.ly container exists
                const plotlyContainer = ensurePlotlyContainer();
                
                // Hide canvas, show Plot.ly
                if (canvas) canvas.style.display = 'none';
                if (plotlyContainer) plotlyContainer.style.display = 'block';
                
                // Convert data format
                const psfData = {
                    data: window.lastPsfResult.psf,
                    gridSize: window.lastPsfResult.gridSize,
                    characteristics: window.lastPsfResult.characteristics,
                    imageScale: window.lastPsfResult.imageScale  // 重要：imageScaleを追加
                };
                
                const options = getPSFDisplayOptions();
                createPSFProfile(psfData, options, 'psf-plotly-container');
            } else {
                alert('PSFを計算してください。');
            }
        });
    }
    
    // Encircled Energy button
    if (psfEnergyBtn) {
        psfEnergyBtn.addEventListener('click', () => {
            console.log('📊 Encircled Energy button clicked');
            
            // ローディングオーバーレイを非表示（念のため）
            hidePSFLoadingOverlay();
            
            if (window.lastPsfResult) {
                setActiveButton(psfEnergyBtn);
                
                // Ensure Plot.ly container exists
                const plotlyContainer = ensurePlotlyContainer();
                
                // Hide canvas, show Plot.ly
                if (canvas) canvas.style.display = 'none';
                if (plotlyContainer) plotlyContainer.style.display = 'block';
                
                // Convert data format
                const psfData = {
                    data: window.lastPsfResult.psf,
                    gridSize: window.lastPsfResult.gridSize,
                    characteristics: window.lastPsfResult.characteristics,
                    imageScale: window.lastPsfResult.imageScale  // 重要：imageScaleを追加
                };
                
                const options = getPSFDisplayOptions();
                createEncircledEnergyPlot(psfData, options, 'psf-plotly-container');
            } else {
                alert('PSFを計算してください。');
            }
        });
    }
    
    // Wavefront button
    if (wavefrontBtn) {
        wavefrontBtn.addEventListener('click', async () => {
            console.log('🌊 Wavefront button clicked');
            
            // ローディングオーバーレイを非表示（念のため）
            hidePSFLoadingOverlay();
            
            // PSF結果の代わりに、オブジェクトデータから直接波面収差を計算
            const psfObjectSelect = document.getElementById('psf-object-select');
            if (!psfObjectSelect || !psfObjectSelect.value) {
                alert('波面収差表示のためのオブジェクトを選択してください');
                return;
            }
            
            const selectedObjectIndex = parseInt(psfObjectSelect.value);
            const objectRows = getObjectRows();
            const opticalSystemRows = getOpticalSystemRows();
            
            if (!objectRows || selectedObjectIndex >= objectRows.length) {
                alert('選択されたオブジェクトが無効です');
                return;
            }
            
            if (!opticalSystemRows || opticalSystemRows.length === 0) {
                alert('光学系データが見つかりません');
                return;
            }
            
            const selectedObject = objectRows[selectedObjectIndex];
            const wavelengthSelect = document.getElementById('psf-wavelength-select');
            const gridSizeSelect = document.getElementById('psf-grid-size-select');
            const wavelength = wavelengthSelect ? parseFloat(wavelengthSelect.value) : 0.5876;
            const gridSize = gridSizeSelect ? parseInt(gridSizeSelect.value) : 64;
            
            try {
                setActiveButton(wavefrontBtn);
                
                // Show loading overlay
                showPSFLoadingOverlay(gridSize, wavelength.toString(), false);
                
                // Create field setting from object
                const fieldSetting = createFieldSettingFromObject(selectedObject);
                if (!fieldSetting) {
                    alert('選択されたオブジェクトからフィールド設定の作成に失敗しました');
                    return;
                }
                
                // Calculate wavefront aberration
                console.log('🌊 [Wavefront] Calculating wavefront aberration...');
                const wavefrontData = await calculateWavefrontAberration(opticalSystemRows, fieldSetting, wavelength, {
                    gridSize: gridSize,
                    debugMode: false
                });
                
                // Hide loading overlay
                hidePSFLoadingOverlay();
                
                // Ensure Plot.ly container exists
                const plotlyContainer = ensurePlotlyContainer();
                
                // Hide canvas, show Plot.ly
                if (canvas) canvas.style.display = 'none';
                if (plotlyContainer) plotlyContainer.style.display = 'block';
                
                // Get display options
                const options = {
                    showStatistics: document.getElementById('psf-characteristics-cb')?.checked || true,
                    contours: document.getElementById('psf-contours-cb')?.checked || false
                };
                
                // Create wavefront heatmap
                await createWavefrontHeatmap(wavefrontData, options, 'psf-plotly-container');
                
                console.log('✅ [Wavefront] Wavefront visualization completed');
                
            } catch (error) {
                console.error('❌ [Wavefront] Error displaying wavefront:', error);
                hidePSFLoadingOverlay();
                alert(`波面収差表示エラー: ${error.message}`);
            }
        });
    }
}

/**
 * PSF計算用のローディングオーバーレイを表示
 */
function showPSFLoadingOverlay(gridSize, wavelength, debugMode = false) {
    const psfContainer = document.getElementById('psf-container');
    let loadingOverlay = document.getElementById('psf-loading-overlay');
    
    if (loadingOverlay) {
        loadingOverlay.remove();
    }
    
    loadingOverlay = document.createElement('div');
    loadingOverlay.id = 'psf-loading-overlay';
    loadingOverlay.style.cssText = `
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background-color: rgba(255, 255, 255, 0.9);
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        z-index: 1000;
        border-radius: 5px;
    `;
    
    const modeText = debugMode ? '🔧 デバッグモードでPSFを計算中...' : '🔬 WASM高速化でPSFを計算中...';
    const additionalInfo = debugMode ? '<p>🔍 最大16本の光線追跡詳細ログを出力中...</p>' : '';
    
    loadingOverlay.innerHTML = `
        <div class="psf-spinner" style="width: 40px; height: 40px; border: 4px solid #f3f3f3; border-top: 4px solid #3498db; border-radius: 50%; animation: spin 1s linear infinite; margin-bottom: 20px;"></div>
        <p>${modeText}</p>
        <p>グリッドサイズ: ${gridSize}×${gridSize}</p>
        <p>波長: ${wavelength} ${wavelength === 'polychromatic' ? '' : 'μm'}</p>
        ${additionalInfo}
        <style>
            @keyframes spin {
                0% { transform: rotate(0deg); }
                100% { transform: rotate(360deg); }
            }
        </style>
    `;
    
    if (psfContainer) {
        psfContainer.style.position = 'relative';
        psfContainer.appendChild(loadingOverlay);
    }
    
    console.log('✅ PSF loading overlay shown');
}

/**
 * PSF計算用のローディングオーバーレイを非表示
 */
function hidePSFLoadingOverlay() {
    const loadingOverlay = document.getElementById('psf-loading-overlay');
    if (loadingOverlay) {
        loadingOverlay.remove();
        console.log('✅ PSF loading overlay hidden');
    }
}

/**
 * すべてのDOMイベントハンドラーを設定（メイン関数）
 */
export function setupDOMEventHandlers() {
    console.log('🎯 DOM Content Loaded - イベントリスナーを設定中...');
    
    // WASMテストボタンのハンドラーを設定
    const wasmTestBtn = document.getElementById('debug-wasm-system');
    if (wasmTestBtn) {
        wasmTestBtn.addEventListener('click', function() {
            console.log('🔥 WASM System Test initiated...');
            debugWASMSystem();
            setTimeout(() => quickWASMComparison(), 1000);
        });
        console.log('✅ WASM test button handler set up');
    } else {
        console.warn('⚠️ WASM test button not found');
    }
    
    // グローバルアクセス用にテーブルオブジェクトを設定
    window.tableSource = window.tableSource;
    window.tableObject = window.tableObject;
    window.objectTabulator = window.tableObject; // 互換性のため
    window.tableOpticalSystem = window.tableOpticalSystem;
    window.opticalSystemTabulator = window.tableOpticalSystem; // 互換性のため
    console.log('✅ テーブルがwindowオブジェクトに設定されました');
    
    // テーブルの初期化状況を確認
    console.log('🔍 テーブル初期化状況:');
    console.log('- window.tableOpticalSystem:', !!window.tableOpticalSystem);
    console.log('- window.opticalSystemTabulator:', !!window.opticalSystemTabulator);
    console.log('- window.tableObject:', !!window.tableObject);
    console.log('- window.objectTabulator:', !!window.objectTabulator);
    
    if (window.opticalSystemTabulator && typeof window.opticalSystemTabulator.on === 'function') {
        console.log('✅ opticalSystemTabulator.on method is available');
    } else {
        console.warn('⚠️ opticalSystemTabulator.on method is not available');
        console.log('   - opticalSystemTabulator type:', typeof window.opticalSystemTabulator);
        console.log('   - opticalSystemTabulator.on type:', typeof window.opticalSystemTabulator?.on);
    }
    
    // 関数が利用可能かどうかを確認
    console.log('🔍 関数の利用可能性をチェック:');
    console.log('- outputParaxialDataToDebug:', typeof outputParaxialDataToDebug);
    console.log('- displayCoordinateTransformMatrix:', typeof displayCoordinateTransformMatrix);
    console.log('- window.outputParaxialDataToDebug:', typeof window.outputParaxialDataToDebug);
    console.log('- window.displayCoordinateTransformMatrix:', typeof window.displayCoordinateTransformMatrix);
    
    try {
        // UIイベントハンドラーを設定
        setupSaveButton();
        setupLoadButton();
        setupClearStorageButton();
        setupParaxialButton();
        setupCoordinateTransformButton();
        setupSpotDiagramButton();
        setupTransverseAberrationButton();
        setupWavefrontAberrationButton();
        setupPSFCalculationButton();
        setupDebugPSFCalculationButton();
        setupPSFDisplaySettings();
        setupPSFDisplayModeButtons();
        
        // 初期化後にObject選択オプションを更新
        updateWavefrontObjectOptions();
        setupPSFObjectSelect();
        
        // PSFオブジェクト選択肢の定期更新（テーブルデータ変更を検知）
        setInterval(() => {
            if (typeof updatePSFObjectOptions === 'function') {
                updatePSFObjectOptions();
            }
        }, 10000); // 10秒ごとに更新（頻度を下げてユーザーの選択を保護）
        
        // テーブルの初期化を待ってからリスナーを設定
        waitForTableInitialization().then(() => {
            setupTableChangeListeners();
        });
        setupPSFDisplayModeButtons(); // PSF表示モード切り替えボタンのセットアップ
        
        console.log('✅ UIイベントハンドラーが正常に設定されました');
    } catch (error) {
        console.error('❌ UIイベントハンドラー設定エラー:', error);
    }
    
    // PSF初期化を試行
    tryInitializePSF();
    
    // テーブル初期化待機
    waitForTableInitialization().then(() => {
        console.log('✅ テーブル初期化完了');
        
        // PSF設定のイベントリスナーを遅延設定（DOM要素が確実に存在するように）
        setTimeout(() => {
            setupPSFDisplaySettings();
            setupPSFObjectSelect(); // PSFオブジェクト選択も遅延初期化
        }, 1000);
        
        // さらに遅延してPSFオブジェクト選択を再設定（テーブルデータが確実に読み込まれた後）
        setTimeout(() => {
            console.log('🔄 [PSF] 遅延PSFオブジェクト選択設定');
            setupPSFObjectSelect();
        }, 2000);
    }).catch(err => {
        console.error('❌ テーブル初期化エラー:', err);
    });
    
    // プロットパフォーマンステストUIを初期化 (disabled)
    // setTimeout(() => {
    //     createPlotPerformanceTestButton();
    // }, 500);
}

/**
 * PSF図表示メイン関数
 * @param {string} plotType - プロットタイプ ('2d', '3d', 'encircled')
 * @param {number} samplingSize - サンプリングサイズ (32, 64, 128, 256)
 * @param {boolean} logScale - ログスケール
 * @param {number} objectIndex - オブジェクトインデックス
 */
async function showPSFDiagram(plotType, samplingSize, logScale, objectIndex) {
    try {
        console.log('🔬 [PSF] PSF計算・表示開始');
        
        // 必要なモジュールを動的インポート
        const { PSFCalculator } = await import('../eva-psf.js');
        const { PSFPlotter } = await import('../eva-psf-plot.js');
        const { createOPDCalculator } = await import('../eva-wavefront.js');
        
        // 光学システムデータを取得
        const opticalSystemRows = window.getOpticalSystemRows ? window.getOpticalSystemRows() : [];
        if (!opticalSystemRows || opticalSystemRows.length === 0) {
            throw new Error('光学システムデータがありません。まず光学システムを設定してください。');
        }
        
        // Objectデータを取得
        const objects = window.getObjectRows ? window.getObjectRows() : (window.tableObject ? window.tableObject.getData() : []);
        if (!objects || objects.length === 0) {
            throw new Error('オブジェクトデータがありません。まずオブジェクトを設定してください。');
        }
        
        if (objectIndex >= objects.length) {
            throw new Error('指定されたオブジェクトが見つかりません。');
        }
        
        console.log(`🔍 [PSF] showPSFDiagram - objectIndex: ${objectIndex}, objects.length: ${objects.length}`);
        console.log(`🔍 [PSF] Available objects:`, objects.map((obj, idx) => ({ 
            index: idx, 
            x: obj.x || obj.xHeightAngle || 0, 
            y: obj.y || obj.yHeightAngle || 0 
        })));
        
        const selectedObject = objects[objectIndex];
        console.log(`🔍 [PSF] Selected object:`, {
            index: objectIndex,
            object: selectedObject,
            x: selectedObject.x || selectedObject.xHeightAngle || 0,
            y: selectedObject.y || selectedObject.yHeightAngle || 0
        });
        
        // 光源データから波長を取得
        const sources = window.getSourceRows ? window.getSourceRows() : (window.sources || []);
        // Sourceテーブルの主波長を優先
        const wavelength = (typeof window !== 'undefined' && typeof window.getPrimaryWavelength === 'function')
            ? (Number(window.getPrimaryWavelength()) || 0.5876)
            : ((sources && sources.length > 0) ? (sources[0].wavelength || 0.5876) : 0.5876);
        
        // OPDデータを計算
        console.log('📊 [PSF] OPDデータ計算中...');
        const opdCalculator = createOPDCalculator(opticalSystemRows, wavelength);
        
        // フィールド設定（選択されたオブジェクトの座標を使用）
        // Object tableのデータ形式に応じて角度または高さを設定
        const objectX = selectedObject.x || selectedObject.xHeightAngle || 0;
        const objectY = selectedObject.y || selectedObject.yHeightAngle || 0;
        
        // Object typeを確認（Angle or Height）
        const objectType = selectedObject.object || selectedObject.Object || selectedObject.objectType || 'Angle';
        
        const fieldSetting = {
            objectIndex: objectIndex,
            fieldAngle: objectType.toLowerCase().includes('angle') ? 
                { x: objectX, y: objectY } : 
                { x: 0, y: 0 },
            xHeight: objectType.toLowerCase().includes('angle') ? 0 : objectX,
            yHeight: objectType.toLowerCase().includes('angle') ? 0 : objectY,
            wavelength: wavelength
        };
        
        console.log(`🔍 [PSF] Field setting created:`, fieldSetting);
        console.log(`🔍 [PSF] Object type: ${objectType}, coordinates: (${objectX}, ${objectY})`);
        
        // グリッド生成してOPDデータを計算
        const gridSize = 64; // PSF計算用の固定グリッドサイズ
        const pupilRadius = 1.0; // 正規化瞳半径
        const opdData = {
            rayData: [],
            gridSize: gridSize,
            wavelength: wavelength
        };
        
        // グリッド上の各点でOPD計算
        for (let i = 0; i < gridSize; i++) {
            for (let j = 0; j < gridSize; j++) {
                const x = (i - gridSize/2) / (gridSize/2) * pupilRadius;
                const y = (j - gridSize/2) / (gridSize/2) * pupilRadius;
                
                if (x*x + y*y <= pupilRadius*pupilRadius) {
                    try {
                        const opd = opdCalculator.calculateWavefrontAberration(x, y, fieldSetting);
                        opdData.rayData.push({
                            pupilX: x,
                            pupilY: y,
                            opd: opd
                        });
                    } catch (error) {
                        // 瞳外の点はスキップ
                    }
                }
            }
        }
        
        if (opdData.rayData.length === 0) {
            throw new Error('OPDデータの計算に失敗しました。光学系の設定を確認してください。');
        }
        
        // PSF計算器を初期化
        const psfCalculator = new PSFCalculator();
        
        // PSFを計算
        console.log(`🔬 [PSF] PSF計算中... (${samplingSize}x${samplingSize})`);
        const psfResult = await psfCalculator.calculatePSF(opdData, {
            samplingSize: samplingSize,
            pupilDiameter: 10.0, // mm（適切な値に調整）
            focalLength: 100.0   // mm（適切な値に調整）
        });
        
        // プロッターを初期化
        const plotter = new PSFPlotter('psf-container');
        
        // プロットタイプに応じて表示
        const plotOptions = {
            logScale: logScale,
            showMetrics: true,
            pixelSize: psfResult.options?.pixelSize || 1.0
        };
        
        switch (plotType) {
            case '2d':
                await plotter.plot2DPSF(psfResult, plotOptions);
                break;
            case '3d':
                await plotter.plot3DPSF(psfResult, plotOptions);
                break;
            case 'encircled':
                await plotter.plotEncircledEnergy(psfResult, plotOptions);
                break;
            default:
                await plotter.plot3DPSF(psfResult, plotOptions);
        }
        
        // 統計情報を表示
        plotter.displayStatistics(psfResult, 'psf-container-stats');
        
        console.log('✅ [PSF] PSF表示完了');
        
    } catch (error) {
        console.error('❌ [PSF] PSF表示エラー:', error);
        
        // エラーメッセージを表示
        const container = document.getElementById('psf-container');
        if (container) {
            container.innerHTML = `
                <div style="color: red; text-align: center; padding: 20px;">
                    <strong>PSF計算エラー</strong><br>
                    ${error.message}<br><br>
                    <small>まずOptical Path DifferenceセクションでOPDデータを生成してください。</small>
                </div>
            `;
        }
        
        throw error;
    }
}

/**
 * PSF Object選択肢のセットアップ
 */
function setupPSFObjectSelect() {
    console.log('🔄 [PSF] Object選択肢のセットアップ開始');
    
    // Object selectの初期化
    const objectSelect = document.getElementById('psf-object-select');
    if (!objectSelect) {
        console.warn('❌ [PSF] psf-object-select要素が見つかりません');
        return;
    }
    
    // 複数のソースからObjectデータを取得を試行
    let objects = [];
    
    // 方法1: window.getObjectRows
    if (typeof window.getObjectRows === 'function') {
        try {
            objects = window.getObjectRows();
            console.log('📊 [PSF] getObjectRows()からデータ取得:', objects.length, '個');
        } catch (error) {
            console.warn('⚠️ [PSF] getObjectRows()でエラー:', error);
        }
    }
    
    // 方法2: window.tableObject
    if ((!objects || objects.length === 0) && window.tableObject) {
        try {
            objects = window.tableObject.getData();
            console.log('📊 [PSF] tableObject.getData()からデータ取得:', objects.length, '個');
        } catch (error) {
            console.warn('⚠️ [PSF] tableObject.getData()でエラー:', error);
        }
    }
    
    // 方法3: window.objectTabulator
    if ((!objects || objects.length === 0) && window.objectTabulator) {
        try {
            objects = window.objectTabulator.getData();
            console.log('📊 [PSF] objectTabulator.getData()からデータ取得:', objects.length, '個');
        } catch (error) {
            console.warn('⚠️ [PSF] objectTabulator.getData()でエラー:', error);
        }
    }
    
    // 有効なObjectデータのみをフィルタリング
    const validObjects = objects.filter((obj, index) => {
        // 空行やundefinedを除外
        if (!obj || obj.id === undefined || obj.id === null) {
            return false;
        }
        return true;
    });
    
    // 現在の選択を保存
    const currentSelectedValue = objectSelect.value;
    const currentSelectedIndex = objectSelect.selectedIndex;
    console.log('🔍 [PSF] 現在の選択を保存:', { value: currentSelectedValue, index: currentSelectedIndex });
    
    // 選択肢を更新
    objectSelect.innerHTML = '';
    
    if (validObjects && validObjects.length > 0) {
        validObjects.forEach((obj, index) => {
            const option = document.createElement('option');
            option.value = index;
            
            // Object表示名を生成（座標情報含む）
            const xValue = obj.x || obj.xHeightAngle || 0;
            const yValue = obj.y || obj.yHeightAngle || 0;
            option.textContent = `Object ${index + 1} (${xValue.toFixed(2)}, ${yValue.toFixed(2)})`;
            
            objectSelect.appendChild(option);
        });
        
        // 以前の選択を復元
        if (currentSelectedValue !== null && currentSelectedValue !== '' && parseInt(currentSelectedValue) < validObjects.length) {
            objectSelect.value = currentSelectedValue;
            console.log('✅ [PSF] 以前の選択を復元:', currentSelectedValue);
        } else if (currentSelectedIndex >= 0 && currentSelectedIndex < validObjects.length) {
            objectSelect.selectedIndex = currentSelectedIndex;
            console.log('✅ [PSF] 以前の選択インデックスを復元:', currentSelectedIndex);
        }
        
        console.log('✅ [PSF] Object選択肢を更新:', validObjects.length, '個');
    } else {
        // デフォルトオプションを追加
        const defaultOption = document.createElement('option');
        defaultOption.value = 0;
        defaultOption.textContent = 'Object 1 (データ未設定)';
        objectSelect.appendChild(defaultOption);
        console.log('⚠️ [PSF] Objectデータなし、デフォルト選択肢を設定');
    }
}

/**
 * PSF Object選択肢を強制更新（テーブル変更時に呼び出し）
 */
function updatePSFObjectOptions() {
    console.log('🔄 [PSF] Object選択肢の強制更新');
    
    // 現在の選択状態を確認
    const objectSelect = document.getElementById('psf-object-select');
    if (objectSelect) {
        const currentValue = objectSelect.value;
        const currentText = objectSelect.options[objectSelect.selectedIndex]?.text;
        console.log('🔍 [PSF] 更新前の選択状態:', { value: currentValue, text: currentText });
        
        // オプション数が変わった場合のみ更新
        const objects = window.getObjectRows ? window.getObjectRows() : (window.tableObject ? window.tableObject.getData() : []);
        const validObjects = objects.filter(obj => obj && obj.id !== undefined && obj.id !== null);
        
        // 現在のオプション数と新しいオプション数を比較
        const currentOptionCount = objectSelect.options.length;
        const newOptionCount = validObjects.length || 1; // デフォルトオプション含む
        
        if (currentOptionCount === newOptionCount) {
            console.log('🔍 [PSF] オプション数が同じのため更新をスキップ');
            return;
        }
        
        console.log('🔄 [PSF] オプション数が変化したため更新:', { 現在: currentOptionCount, 新規: newOptionCount });
    }
    
    setupPSFObjectSelect();
}

// PSF関数をグローバルに公開
if (typeof window !== 'undefined') {
    window.showPSFDiagram = showPSFDiagram;
    window.setupPSFObjectSelect = setupPSFObjectSelect;
    window.updatePSFObjectOptions = updatePSFObjectOptions;
}
