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
