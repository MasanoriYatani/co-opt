/**
 * Optical system renderer for 3D visualization
 */

import * as THREE from 'three';
import { calculateSurfaceOrigins } from '../ray-tracing.js';
import { drawAsphericProfile, drawPlaneProfile, drawLensSurface, drawLensSurfaceWithOrigin,
         drawLensCrossSection, drawLensCrossSectionWithSurfaceOrigins, 
         drawSemidiaRingWithOriginAndSurface, asphericSurfaceZ, addMirrorBackText } from '../surface.js';

/**
 * Draw optical system surfaces
 * @param {Object} options - Drawing options
 * @param {boolean} options.crossSectionOnly - Only draw cross-sections
 * @param {THREE.Scene} options.scene - Three.js scene
 * @param {boolean} options.showSurfaceOrigins - Show surface origins
 * @param {boolean} options.showSemidiaRing - Show semidia rings
 * @param {boolean} options.showMirrorBackText - Show mirror back text
 * @param {string} options.crossSectionDirection - Cross-section direction (YZ or XZ)
 * @param {number} options.crossSectionCenterOffset - Center offset for cross-section
 * @param {Array} options.opticalSystemData - Optical system data
 */
export function drawOpticalSystemSurfaces(options = {}) {
    const {
        crossSectionOnly = false,
        scene,
        showSurfaceOrigins = false,
        showSemidiaRing = false,
        showMirrorBackText = false,
        crossSectionDirection = 'YZ',
        viewPlane = null,
        crossSectionCenterOffset = 0,
        opticalSystemData
    } = options;

    // viewPlaneパラメータをcrossSectionDirectionに変換
    const actualCrossSectionDirection = viewPlane ? viewPlane.toUpperCase() : crossSectionDirection;

    if (!scene) {
        console.error('Scene not provided to drawOpticalSystemSurfaces');
        return;
    }

    if (!opticalSystemData || opticalSystemData.length === 0) {
        console.error('💡 光学系データが取得できません。JSONファイルをロードしてください。');
        alert('光学系データがありません。JSONファイルをロードしてください。');
        return;
    }

    console.log(`📊 Using optical system data: ${opticalSystemData.length} surfaces`);
    console.log('🔍 Optical system data preview:', opticalSystemData.slice(0, 3));
    console.log('🔍 Cross-section only mode:', crossSectionOnly);

    // Clear existing optical elements before drawing new ones
    clearExistingOpticalElements(scene);

    // Surface origins calculation - NOW with the correct parameter
    const surfaceOrigins = calculateSurfaceOrigins(opticalSystemData);
    console.log('🔍 Surface origins calculated:', surfaceOrigins ? surfaceOrigins.length : 'None');
    
    // Debug: Show all surface origins
    if (surfaceOrigins) {
        console.log('🔍 All surface origins:');
        surfaceOrigins.forEach((surfaceInfo, index) => {
            const origin = surfaceInfo?.origin;
            console.log(`  Surface ${index}: (${origin?.x?.toFixed(3) || 'undefined'}, ${origin?.y?.toFixed(3) || 'undefined'}, ${origin?.z?.toFixed(3) || 'undefined'})`);
        });
    }

    // Draw 3D surfaces (skip if crossSectionOnly is true)
    if (!crossSectionOnly) {
        console.log('🎨 Starting 3D surface drawing...');
        for (let i = 0; i < opticalSystemData.length; i++) {
            const surface = opticalSystemData[i];
            
            console.log(`🔍 Processing surface ${i}: type=${surface.type}, conic=${surface.conic}`);
            
            // Object面のスキップ判定
            const objectType = surface["object type"] || "";
            if (objectType === "Object") {
                const objectThickness = surface.thickness;
                const isInfiniteThickness = objectThickness === 'INF' || objectThickness === 'Infinity' || objectThickness === Infinity;
                
                if (isInfiniteThickness) {
                    // Objectデータを取得してangle判定も行う
                    let isAngleObject = false;
                    try {
                        const objectRows = window.getObjectRows ? window.getObjectRows() : [];
                        if (objectRows && objectRows.length > 0) {
                            const firstObject = objectRows[0];
                            const position = firstObject.position || (Array.isArray(firstObject) ? firstObject[3] : null);
                            isAngleObject = position === 'angle' || position === 'Angle';
                            console.log(`🔍 3D Surface ${i}: Object position判定 - position=${position}, isAngleObject=${isAngleObject}`);
                        }
                    } catch (error) {
                        console.warn(`⚠️ 3D Surface ${i}: Object data取得エラー:`, error);
                    }
                    
                    if (isAngleObject) {
                        console.log(`🔸 3D Surface ${i}: Object面（無限系 + angle）、3D描画スキップ`);
                        continue;
                    } else {
                        console.log(`🔸 3D Surface ${i}: Object面（無限系 but not angle）、3D描画実行`);
                    }
                } else {
                    console.log(`🔸 3D Surface ${i}: Object面（有限系、thickness=${objectThickness}）、3D描画実行`);
                }
            }
            
            try {
                if (surface.type === 'Stop' || surface['object type'] === 'Stop') {
                    // Stop面の場合は特別な処理
                    console.log(`🟢 Drawing Stop surface ${i}`);
                    if (showSemidiaRing) {
                        console.log(`⭕ Drawing Stop ring for surface ${i}, semidia: ${surface.semidia}`);
                        try {
                            drawSemidiaRingWithOriginAndSurface(
                                scene, 
                                surface.semidia || 20,   // semidia値
                                100,                     // segments
                                0x000000,               // color (黒)
                                surfaceOrigins[i]?.origin || {x: 0, y: 0, z: 0},       // origin オブジェクト
                                surfaceOrigins[i]?.rotationMatrix || null,            // rotationMatrix
                                surface                  // surf オブジェクト
                            );
                            console.log(`✅ Stop ring drawn for surface ${i}`);
                        } catch (stopRingError) {
                            console.error(`❌ Error drawing Stop ring for surface ${i}:`, stopRingError);
                        }
                    }
                } else if (surface.type === 'Mirror') {
                    // Mirror面の処理
                    console.log(`🪞 Drawing 3D Mirror surface ${i} with origin and rotation`);
                    drawLensSurfaceWithOrigin(
                        scene, 
                        surface,                     // params オブジェクト全体
                        surfaceOrigins[i].origin,    // origin から .origin プロパティを使用
                        surfaceOrigins[i].rotationMatrix, // rotation matrix
                        "even",                      // mode
                        100,                         // segments
                        0xc0c0c0,                   // color (シルバー)
                        0.8,                        // opacity
                        'Mirror'                     // surfaceType
                    );
                    
                    if (showMirrorBackText) {
                        addMirrorBackText(
                            scene, 
                            surface, 
                            surfaceOrigins[i], 
                            i
                        );
                    }
                } else {
                    // 通常のレンズ面の処理
                    console.log(`🔵 Drawing Lens surface ${i}`);
                    
                    // 3D表面を描画
                    console.log(`� Drawing 3D lens surface ${i} with origin and rotation`);
                    drawLensSurfaceWithOrigin(
                        scene, 
                        surface,                     // params オブジェクト全体
                        surfaceOrigins[i].origin,    // origin から .origin プロパティを使用
                        surfaceOrigins[i].rotationMatrix, // rotation matrix
                        "even",                      // mode
                        100,                         // segments
                        0x00ccff,                   // color (水色)
                        0.5,                        // opacity
                        surface.type                 // surfaceType
                    );
                }
                
                // Surface origins表示（デバッグ用の追加表示のみ）
                if (showSurfaceOrigins) {
                    console.log(`📍 Drawing surface origin marker for surface ${i}`);
                    // 原点マーカーとして小さな球を描画
                    const geometry = new THREE.SphereGeometry(2, 8, 8);
                    const material = new THREE.MeshBasicMaterial({ color: 0x00ff00, transparent: true, opacity: 0.8 });
                    const marker = new THREE.Mesh(geometry, material);
                    const origin = surfaceOrigins[i]?.origin || {x: 0, y: 0, z: 0};
                    marker.position.set(origin.x, origin.y, origin.z);
                    marker.userData = { type: 'surface-origin-marker', surfaceIndex: i };
                    scene.add(marker);
                }
                
                // Semidia ring表示
                if (showSemidiaRing && surface.type !== 'Stop' && surface['object type'] !== 'Stop') {
                    console.log(`⭕ Drawing semidia ring for surface ${i}, semidia: ${surface.semidia}`);
                    console.log(`⭕ Ring origin for ${i}:`, surfaceOrigins[i]);
                    console.log(`⭕ Surface type: ${surface.type}, material: ${surface.material}`);
                    
                    try {
                        drawSemidiaRingWithOriginAndSurface(
                            scene, 
                            surface.semidia || 20,   // semidia 値
                            100,                     // segments
                            0x000000,               // color (黒)
                            surfaceOrigins[i]?.origin || {x: 0, y: 0, z: 0},       // origin オブジェクト
                            surfaceOrigins[i]?.rotationMatrix || null,            // rotationMatrix
                            surface                  // surf オブジェクト
                        );
                        console.log(`✅ Semidia ring drawn for surface ${i}`);
                    } catch (ringError) {
                        console.error(`❌ Error drawing semidia ring for surface ${i}:`, ringError);
                    }
                }
            } catch (error) {
                console.error(`❌ Error drawing surface ${i}:`, error);
            }
        }
        console.log('✅ 3D surface drawing completed');
    } else {
        console.log('⏭️ Skipping 3D surface drawing (crossSectionOnly = true)');
    }

    // Draw cross-sections
    if (actualCrossSectionDirection === 'YZ') {
        drawLensCrossSectionWithSurfaceOrigins(
            scene, 
            opticalSystemData, 
            surfaceOrigins, 
            crossSectionCenterOffset
        );
    } else if (actualCrossSectionDirection === 'XZ') {
        drawLensCrossSectionWithSurfaceOrigins(
            scene, 
            opticalSystemData, 
            surfaceOrigins, 
            crossSectionCenterOffset, 
            'XZ'
        );
    }
}

/**
 * Find stop surface in optical system
 * @param {Array} opticalSystemRows - Optical system data
 * @param {Array} surfaceOrigins - Surface origins (optional)
 * @returns {Object|null} Stop surface data or null if not found
 */
export function findStopSurface(opticalSystemRows, surfaceOrigins = null) {
    if (!opticalSystemRows || opticalSystemRows.length === 0) {
        return null;
    }

    const DEBUG_STOP = !!(typeof globalThis !== 'undefined' && globalThis.__COOPT_DEBUG_STOP_SURFACE);
    if (DEBUG_STOP) {
        // 光学系データ全体をデバッグ出力
        console.log(`🔍 [findStopSurface] 光学系データ全体:`, opticalSystemRows);
        console.log(`🔍 [findStopSurface] データ数: ${opticalSystemRows.length}`);
    }
    
    for (let i = 0; i < opticalSystemRows.length; i++) {
        const surface = opticalSystemRows[i];
        // console.log(`🔍 [findStopSurface] Surface ${i}:`, surface);
        // console.log(`🔍 [findStopSurface] Surface ${i} keys:`, Object.keys(surface));
        // console.log(`🔍 [findStopSurface] Surface ${i} type:`, surface.type);
        // console.log(`🔍 [findStopSurface] Surface ${i} object type:`, surface['object type']);
        
        // 両方のフィールド名をチェック
        if (surface.type === 'Stop' || surface['object type'] === 'Stop') {
            // console.log(`🎯 [findStopSurface] Stop面発見! Surface ${i}`);
            
            // Stop面のz位置を計算
            let stopZ = 0;
            if (surfaceOrigins && surfaceOrigins[i]) {
                stopZ = surfaceOrigins[i].z;
            } else {
                // surfaceOriginsが無い場合は累積距離で計算
                for (let j = 0; j < i; j++) {
                    const thickness = opticalSystemRows[j].thickness;
                    if (thickness !== undefined && thickness !== null && thickness !== 'INF' && thickness !== 'Infinity') {
                        stopZ += parseFloat(thickness) || 0;
                    }
                }
            }
            
            // stopZが数値であることを確認
            stopZ = parseFloat(stopZ) || 0;
            
            // Stop面の半径を取得（複数のフィールド名を試す）
            let stopRadius = 10; // デフォルト値
            // console.log(`🔍 [findStopSurface] Stop面データ:`, surface);
            // console.log(`🔍 [findStopSurface] Stop面の全プロパティ:`, JSON.stringify(surface, null, 2));
            
            // より多くのフィールド名を試す
            const radiusFields = [
                'semidia',          // 実際のフィールド名！
                'semiDiameter', 'semi-diameter', 'semi_diameter',
                'radius', 'aperture', 'diameter', 'semi-dia',
                'semiDia', 'aper', 'halfDiameter', 'half-diameter',
                'Clear_Aperture', 'clearAperture', 'clear_aperture'
            ];
            
            // console.log(`🔍 [findStopSurface] 半径候補チェック:`);
            for (const field of radiusFields) {
                const value = surface[field];
                // console.log(`  ${field}: ${value} (type: ${typeof value})`);
                if (value !== undefined && value !== null && value !== '') {
                    const numValue = parseFloat(value);
                    if (!isNaN(numValue)) {
                        stopRadius = numValue;
                        // console.log(`🎯 [findStopSurface] フィールド "${field}" を使用: ${stopRadius}`);
                        break;
                    }
                }
            }
            
            // 手動で設定された半径値があるかチェック
            if (window.forceStopRadius && !isNaN(window.forceStopRadius)) {
                console.log(`🔧 [findStopSurface] 手動設定の半径を使用: ${window.forceStopRadius}`);
                stopRadius = window.forceStopRadius;
            }
            
            // NaNチェック
            if (isNaN(stopRadius)) {
                console.warn(`⚠️ [findStopSurface] 半径値が無効、デフォルト値10を使用`);
                stopRadius = 10;
            }
            
            // console.log(`🔍 [findStopSurface] 最終的な半径: ${stopRadius}`);
            
            return {
                surface: surface,
                index: i,
                center: { x: 0, y: 0, z: stopZ },  // centerプロパティを追加
                position: { x: 0, y: 0, z: stopZ },  // 互換性のために保持
                radius: stopRadius,  // 正しい半径値を使用
                origin: surfaceOrigins ? surfaceOrigins[i] : null
            };
        }
    }
    
    console.warn(`⚠️ [findStopSurface] Stop面が見つかりません`);
    return null;
}

/**
 * Clear all optical elements from scene
 * @param {THREE.Scene} scene - Three.js scene
 */
export function clearAllOpticalElements(scene) {
    if (!scene) {
        console.error('Scene not provided to clearAllOpticalElements');
        return;
    }
    
    const objectsToRemove = [];
    
    scene.traverse((child) => {
        // Surface and lens objects by name
        if (child.name && 
            (child.name.startsWith('surface') || 
             child.name.startsWith('lens') ||
             child.name.startsWith('cross-section') ||
             child.name.startsWith('semidia') ||
             child.name.startsWith('mirror') ||
             child.name.includes('Profile') ||
             child.name.includes('Ring') ||
             child.name.includes('Connection'))) {
            objectsToRemove.push(child);
        }
        
        // Semidia ring objects specifically (for thickness change bug fix)
        if (child.userData && (
            child.userData.type === 'semidiaRing' ||
            child.userData.type === 'ring' ||
            child.userData.surfaceType === 'ring' ||
            child.name.includes('semidiaRing')
        )) {
            objectsToRemove.push(child);
        }
        
        // Ray objects by userData
        if (child.userData && (
            child.userData.isRayLine || 
            child.userData.type === 'ray'
        )) {
            objectsToRemove.push(child);
        }
        
        // Objects by userData type
        if (child.userData && (
            child.userData.isLensSurface ||
            child.userData.surfaceType === '3DSurface' ||
            child.userData.type === 'ring' ||
            child.userData.type === 'pupil' ||
            child.userData.type === 'crossSection'
        )) {
            objectsToRemove.push(child);
        }
        
        // Objects by material properties (lens surfaces are often transparent)
        if (child.material && child.material.transparent && 
            child.material.opacity && child.material.opacity < 1 &&
            child.type !== 'GridHelper' && child.type !== 'AxesHelper') {
            objectsToRemove.push(child);
        }
    });
    
    // Remove duplicates
    const uniqueObjects = [...new Set(objectsToRemove)];
    
    console.log(`🧹 Clearing ${uniqueObjects.length} optical elements from scene`);
    
    uniqueObjects.forEach(obj => {
        scene.remove(obj);
        
        // Dispose of geometry and material to free memory
        if (obj.geometry) {
            obj.geometry.dispose();
        }
        if (obj.material) {
            if (Array.isArray(obj.material)) {
                obj.material.forEach(material => material.dispose());
            } else {
                obj.material.dispose();
            }
        }
    });
}

/**
 * Clear existing optical elements from the scene
 * @param {THREE.Scene} scene - The THREE.js scene
 */
function clearExistingOpticalElements(scene) {
    const elementsToRemove = [];
    
    scene.traverse((child) => {
        if (child.isMesh || child.isLine) {
            // Remove optical surfaces, rings, and markers
            if (child.userData && (
                child.userData.isLensSurface ||
                child.userData.surfaceType === '3DSurface' ||
                child.userData.type === 'ring' ||
                child.userData.type === 'semidiaRing' ||
                child.userData.type === 'pupil' ||
                child.userData.type === 'surface-origin-marker' ||
                child.name.includes('LensSurface') ||
                child.name.includes('Surface') ||
                child.name.includes('semidiaRing') ||
                child.userData.surfaceIndex !== undefined
            )) {
                elementsToRemove.push(child);
            }
        }
    });
    
    elementsToRemove.forEach(element => {
        scene.remove(element);
        if (element.geometry) element.geometry.dispose();
        if (element.material) {
            if (Array.isArray(element.material)) {
                element.material.forEach(mat => mat.dispose());
            } else {
                element.material.dispose();
            }
        }
    });
    
    console.log(`🧹 Cleared ${elementsToRemove.length} existing optical elements`);
}
