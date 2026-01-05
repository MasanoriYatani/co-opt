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
        spotDiagramBtn.addEventListener('click', function() {
            try {
                showSpotDiagram();
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
        transverseAberrationBtn.addEventListener('click', function() {
            try {
                showTransverseAberrationDiagram();
            } catch (error) {
                console.error('❌ 横収差図エラー:', error);
                alert(`横収差図エラー: ${error.message}`);
            }
        });
    }
}

/**
 * 面番号選択の更新（旧関数の互換性のため）
 */
function updateSurfaceNumberSelectLegacy() {
    const surfaceSelect = document.getElementById('surface-number-select');
    const transverseSurfaceSelect = document.getElementById('transverse-surface-select');
    
    if (!surfaceSelect && !transverseSurfaceSelect) return;
    
    // 既存のオプションをクリア
    if (surfaceSelect) {
        surfaceSelect.innerHTML = '<option value="">面を選択...</option>';
    }
    if (transverseSurfaceSelect) {
        transverseSurfaceSelect.innerHTML = '<option value="">面を選択...</option>';
    }
    
    try {
        const opticalSystemRows = getOpticalSystemRows();
        if (opticalSystemRows && opticalSystemRows.length > 0) {
            const surfaceOptions = generateSurfaceOptions(opticalSystemRows);
            let imageSurfaceValue = null;
            let lastSurfaceValue = null;
            
            surfaceOptions.forEach(option => {
                // スポットダイアグラム用のセレクト
                if (surfaceSelect) {
                    const optionElement = document.createElement('option');
                    optionElement.value = option.value;
                    optionElement.textContent = option.label;
                    surfaceSelect.appendChild(optionElement);
                }
                
                // 横収差図用のセレクト
                if (transverseSurfaceSelect) {
                    const transverseOptionElement = document.createElement('option');
                    transverseOptionElement.value = option.value;
                    transverseOptionElement.textContent = option.label;
                    transverseSurfaceSelect.appendChild(transverseOptionElement);
                }
                
                // Image面を探す
                if (option.label.includes('(Image)')) {
                    imageSurfaceValue = option.value;
                }
                
                // 最後の面を記録（Image面がない場合の代替）
                lastSurfaceValue = option.value;
            });
            
            // Image面が見つかった場合、それを初期選択値として設定
            const defaultValue = imageSurfaceValue !== null ? imageSurfaceValue : lastSurfaceValue;
            
            if (surfaceSelect && defaultValue !== null) {
                surfaceSelect.value = defaultValue;
            }
            if (transverseSurfaceSelect && defaultValue !== null) {
                transverseSurfaceSelect.value = defaultValue;
            }
            
            console.log(`✅ 両方の面選択が${surfaceOptions.length}個のオプションで更新されました`);
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
    
    // その他のPSFパラメータを取得
    const wavelengthSelect = document.getElementById('psf-wavelength-select');
    const gridSizeSelect = document.getElementById('psf-grid-size-select');
    
    // デバッグモードの場合は設定を上書き
    let wavelength, gridSize;
    if (debugMode) {
        wavelength = '0.5876'; // d線固定
        gridSize = 16; // 16×16グリッド固定（高速）
        console.log('🔧 [DEBUG] デバッグモード: wavelength=0.5876μm, gridSize=16×16に固定');
    } else {
        wavelength = wavelengthSelect ? wavelengthSelect.value : '0.5876';
        gridSize = gridSizeSelect ? parseInt(gridSizeSelect.value) : 64; // デフォルトを64×64に戻す
        console.log(`📊 [NORMAL] 通常モード: wavelength=${wavelength}, gridSize=${gridSize}×${gridSize}`);
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
        
        // PSF計算にタイムアウトを設定（デバッグモード: 10秒, 通常モード: 60秒）
        const PSF_TIMEOUT = debugMode ? 10000 : 60000;
        const psfCalculationPromise = (async () => {
            if (wavelength === 'polychromatic' && !debugMode) {
                // 多色PSF計算（デバッグモードでは使用しない）
                console.log('🌈 多色PSFを計算中...');
                return calculatePolychromaticPSF(opticalSystemRows, fieldSetting, [0.4861, 0.5876, 0.6563], {
                    gridSize: gridSize,
                    includeAberrations: true,
                    normalizeIntensity: 'max',
                    debugMode: debugMode
                });
            } else {
                // 単色PSF計算（WASM高速化）
                const modeText = debugMode ? 'デバッグモード' : '通常モード';
                console.log(`🔬 λ=${wavelength}μmの単色PSFを計算中... (${modeText})`);
                console.log('🔍 PSF計算パラメータ:', {
                    opticalSystemRows: opticalSystemRows?.length || 0,
                    fieldSetting: fieldSetting,
                    wavelength: wavelength,
                    gridSize: gridSize,
                    debugMode: debugMode
                });
                
                const wavelengthValue = parseFloat(wavelength);
                const result = await calculatePointSpreadFunction(opticalSystemRows, fieldSetting, wavelengthValue, {
                    gridSize: gridSize,
                    includeAberrations: true,
                    normalizeIntensity: 'max',
                    debugMode: debugMode,
                    useIdealPSF: debugMode // デバッグモードでは理想PSF計算を使用
                });
                
                console.log('🔍 PSF計算完了、結果:', {
                    hasResult: !!result,
                    resultType: typeof result,
                    resultKeys: result ? Object.keys(result) : 'none',
                    debugMode: debugMode
                });
                
                return result;
            }
        })();
        
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
        
        console.log('📊 PSF結果の構造:', {
            hasResult: !!psfResult,
            keys: psfResult ? Object.keys(psfResult) : 'none',
            hasPSF: psfResult ? !!psfResult.psf : false,
            gridSize: psfResult ? psfResult.gridSize : 'none',
            psfType: psfResult?.psf ? (Array.isArray(psfResult.psf) ? 'array' : typeof psfResult.psf) : 'none',
            dimensions: psfResult?.psf && Array.isArray(psfResult.psf) ? `${psfResult.psf.length}x${psfResult.psf[0]?.length || 0}` : 'none',
            sampleValue: psfResult?.psf && Array.isArray(psfResult.psf) && psfResult.psf[0] ? psfResult.psf[0][0] : 'none',
            hasCharacteristics: psfResult ? !!psfResult.characteristics : false,
            calculationTime: psfResult ? psfResult.calculationTime : 'none',
            debugMode: debugMode
        });
        
        // PSF結果をグローバル変数に保存（チェックボックス機能用）
        window.lastPsfResult = psfResult;
        window.lastPsfResult.title = debugMode ? `Debug PSF - ${wavelength}nm (16×16)` : `PSF - ${wavelength}nm`;
        window.lastPsfObjectData = selectedObject;
        window.lastPsfWavelength = wavelength;
        window.lastPsfGridSize = gridSize;
        window.lastPsfDebugMode = debugMode;
        
        // PSF結果を表示
        displayPSFResult(psfResult, selectedObject, wavelength, gridSize);
        
        // デフォルトでPlot.lyの2D Heatmapを表示
        const canvas = document.getElementById('psf-canvas');
        let plotlyContainer = document.getElementById('psf-plotly-container');
        
        // Plot.lyコンテナが存在しない場合は作成
        if (!plotlyContainer) {
            console.log('⚠️ [PSF] Plot.ly container not found, creating...');
            const psfContainer = document.getElementById('psf-container');
            if (psfContainer) {
                plotlyContainer = document.createElement('div');
                plotlyContainer.id = 'psf-plotly-container';
                plotlyContainer.style.cssText = `
                    display: block;
                    width: 600px;
                    height: 600px;
                    border: 1px solid #ddd;
                    background-color: #f8f9fa;
                    border-radius: 4px;
                    margin: 10px auto;
                `;
                psfContainer.appendChild(plotlyContainer);
                console.log('✅ [PSF] Plot.ly container created');
            }
        } else {
            plotlyContainer.style.display = 'block';
        }
        
        if (canvas) canvas.style.display = 'none';
        
        // Plot.lyでPSFを描画
        const psfData = {
            data: psfResult.psf,
            gridSize: psfResult.gridSize,
            characteristics: psfResult.characteristics,
            pixelScale: psfResult.pixelScale,  // 重要：pixelScaleを追加
            imageScale: psfResult.imageScale   // 重要：imageScaleを追加
        };
        
        // デバッグ用: PSFデータの詳細を出力
        console.log('🔍 [PSF] PSF data structure for Plot.ly:', {
            hasData: !!psfData.data,
            dataType: Array.isArray(psfData.data) ? 'array' : typeof psfData.data,
            dataLength: psfData.data ? psfData.data.length : 'none',
            firstRowLength: psfData.data && psfData.data[0] ? psfData.data[0].length : 'none',
            gridSize: psfData.gridSize,
            hasCharacteristics: !!psfData.characteristics,
            characteristicsKeys: psfData.characteristics ? Object.keys(psfData.characteristics) : 'none',
            sampleValues: psfData.data && psfData.data[0] ? psfData.data[0].slice(0, 3) : 'none',
            pixelScale: psfData.pixelScale,    // デバッグ用にpixelScaleも追加
            imageScale: psfData.imageScale,    // デバッグ用にimageScaleも追加
            debugMode: debugMode
        });
        
        const options = {
            logScale: document.getElementById('psf-log-scale-cb')?.checked || false,
            contours: document.getElementById('psf-contours-cb')?.checked || false,
            characteristics: document.getElementById('psf-characteristics-cb')?.checked || true
        };
        
        console.log('🔍 [PSF] Plot.ly options:', options);
        
        // Plot.lyコンテナの状態も確認
        console.log('🔍 [PSF] Plot.ly container:', {
            exists: !!plotlyContainer,
            display: plotlyContainer?.style.display,
            dimensions: plotlyContainer ? `${plotlyContainer.offsetWidth}x${plotlyContainer.offsetHeight}` : 'none'
        });
        
        // PSFを可視化（Plot.ly 2D Heatmap）
        try {
            await createPSFHeatmap(psfData, options, plotlyContainer.id);
            console.log('✅ [PSF] Plot.ly 2D Heatmap rendering completed');
            
            // デバッグモードの場合は追加情報を表示
            if (debugMode) {
                const title = plotlyContainer.querySelector('.g-gtitle');
                if (title) {
                    title.textContent = `Debug PSF (16×16 grid) - λ=${wavelength}μm`;
                }
                
                // デバッグ情報を表示
                setTimeout(() => {
                    console.log('🔧 [DEBUG] PSF計算完了 - デバッグ情報が表示されています');
                    console.log('🔧 コンソールログで光線追跡の詳細を確認してください');
                }, 1000);
            }
            
        } catch (plotError) {
            console.error('❌ [PSF] Plot.ly rendering error:', plotError);
            
            // フォールバック: エラー表示
            if (plotlyContainer) {
                plotlyContainer.innerHTML = `
                    <div style="padding: 20px; text-align: center; color: #d32f2f; border: 1px solid #d32f2f; border-radius: 5px; background-color: #ffebee;">
                        <h3>PSF表示エラー</h3>
                        <p>PSFの可視化に失敗しました: ${plotError.message}</p>
                        <p>PSF計算は完了していますが、表示でエラーが発生しました。</p>
                    </div>
                `;
            }
        }
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
 * PSF表示設定のイベントリスナーを設定
 */
function setupPSFDisplaySettings() {
    const psfLogScaleCb = document.getElementById('psf-log-scale-cb');
    const psfContoursCb = document.getElementById('psf-contours-cb');
    const psfCharacteristicsCb = document.getElementById('psf-characteristics-cb');
    
    function updatePSFDisplay() {
        console.log('🔄 [PSF] Updating PSF display with new settings');
        
        // ローディングオーバーレイを非表示（念のため）
        hidePSFLoadingOverlay();
        
        if (window.lastPsfResult) {
            const canvas = document.getElementById('psf-canvas');
            const plotlyContainer = document.getElementById('psf-plotly-container');
            
            // UI設定を読み取り
            const logScaleEnabled = psfLogScaleCb?.checked || false;
            const contoursEnabled = psfContoursCb?.checked || false;
            const characteristicsEnabled = psfCharacteristicsCb?.checked || true;
            
            console.log('🎛️ [PSF] Display settings:', {
                logScale: logScaleEnabled,
                contours: contoursEnabled,
                characteristics: characteristicsEnabled
            });
            
            // 現在のアクティブな表示モードを判定
            const activeButton = document.querySelector('.psf-display-btn.active');
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
    
    // オブジェクトテーブル変更時にPSFオブジェクト選択を更新
    if (window.objectTabulator && typeof window.objectTabulator.on === 'function') {
        window.objectTabulator.on('dataChanged', updatePSFObjectSelect);
        window.objectTabulator.on('rowAdded', updatePSFObjectSelect);
        window.objectTabulator.on('rowDeleted', updatePSFObjectSelect);
    } else {
        console.warn('⚠️ objectTabulator is not initialized or does not have .on method');
    }
    
    // tableObjectが利用可能な場合もリスナーを追加
    if (window.tableObject && typeof window.tableObject.on === 'function') {
        window.tableObject.on('dataChanged', updatePSFObjectSelect);
        window.tableObject.on('rowAdded', updatePSFObjectSelect);
        window.tableObject.on('rowDeleted', updatePSFObjectSelect);
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
            console.log('✅ オブジェクトデータが見つかりました、PSF選択を初期化します');
            updatePSFObjectSelect();
        } else if (initAttempts < maxAttempts) {
            console.log('⏳ オブジェクトデータの準備ができていません、200ms後に再試行...');
            setTimeout(attemptInitialization, 200);
        } else {
            console.warn('⚠️ 最大試行回数後にPSF選択の初期化に失敗しました');
            updatePSFObjectSelect(); // 最後に一度試行
        }
    }
    
    // 初期化試行を開始
    setTimeout(attemptInitialization, 100);
    
    // 即座に初期化も試行
    updatePSFObjectSelect();
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
        setupPSFCalculationButton();
        setupDebugPSFCalculationButton();
        setupPSFDisplaySettings();
        setupPSFDisplayModeButtons();
        
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
        }, 1000);
    }).catch(err => {
        console.error('❌ テーブル初期化エラー:', err);
    });
    
    // プロットパフォーマンステストUIを初期化 (disabled)
    // setTimeout(() => {
    //     createPlotPerformanceTestButton();
    // }, 500);
}
