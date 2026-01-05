/**
 * Debug Utilities Module
 * JS_lensDraw v3 - Debugging and Scene Analysis Functions
 */

import * as THREE from 'three';
import { getWASMSystem } from '../main.js';

/**
 * Debug scene contents
 * @param {THREE.Scene} scene - The THREE.js scene
 * @param {THREE.Camera} camera - The camera
 * @param {OrbitControls} controls - The orbit controls
 */
export function debugSceneContents(scene, camera, controls) {
  console.log('🔍 === Scene Debug Info ===');
  console.log(`Total children: ${scene.children.length}`);
  console.log(`Camera position: (${camera.position.x.toFixed(2)}, ${camera.position.y.toFixed(2)}, ${camera.position.z.toFixed(2)})`);
  console.log(`Camera target: (${controls.target.x.toFixed(2)}, ${controls.target.y.toFixed(2)}, ${controls.target.z.toFixed(2)})`);
  
  // Calculate scene bounding box
  const box = new THREE.Box3().setFromObject(scene);
  if (!box.isEmpty()) {
    console.log(`Scene bounding box:`);
    console.log(`  Min: (${box.min.x.toFixed(2)}, ${box.min.y.toFixed(2)}, ${box.min.z.toFixed(2)})`);
    console.log(`  Max: (${box.max.x.toFixed(2)}, ${box.max.y.toFixed(2)}, ${box.max.z.toFixed(2)})`);
    console.log(`  Size: (${(box.max.x - box.min.x).toFixed(2)}, ${(box.max.y - box.min.y).toFixed(2)}, ${(box.max.z - box.min.z).toFixed(2)})`);
  }
  
  let meshCount = 0;
  let lineCount = 0;
  let lightCount = 0;
  let otherCount = 0;
  
  scene.children.forEach((child, i) => {
    if (child.isMesh) {
      meshCount++;
      // Log mesh position and scale
      console.log(`  Mesh ${meshCount}: pos(${child.position.x.toFixed(2)}, ${child.position.y.toFixed(2)}, ${child.position.z.toFixed(2)}), scale(${child.scale.x.toFixed(2)}, ${child.scale.y.toFixed(2)}, ${child.scale.z.toFixed(2)})`);
    } else if (child.isLine) {
      lineCount++;
    } else if (child.isLight) {
      lightCount++;
    } else {
      otherCount++;
    }
  });
  
  console.log(`Mesh objects: ${meshCount}`);
  console.log(`Line objects: ${lineCount}`);
  console.log(`Light objects: ${lightCount}`);
  console.log(`Other objects: ${otherCount}`);
  console.log('=================');
}

/**
 * 描画問題をデバッグする関数
 * @param {THREE.Scene} scene - The THREE.js scene
 * @param {THREE.Camera} camera - The camera
 * @param {OrbitControls} controls - The orbit controls
 */
export function debugDrawingIssues(scene, camera, controls) {
  console.log('🔍 Debugging drawing issues...');
  
  // シーンの内容を確認
  if (scene) {
    console.log('📊 Scene objects:', scene.children.length);
    scene.children.forEach((child, index) => {
      console.log(`   Object ${index}: ${child.type}, visible: ${child.visible}`);
      if (child.name) console.log(`     Name: ${child.name}`);
      if (child.position) console.log(`     Position: (${child.position.x.toFixed(2)}, ${child.position.y.toFixed(2)}, ${child.position.z.toFixed(2)})`);
      if (child.scale) console.log(`     Scale: (${child.scale.x.toFixed(2)}, ${child.scale.y.toFixed(2)}, ${child.scale.z.toFixed(2)})`);
    });
  }
  
  // カメラの位置を確認
  if (camera) {
    console.log('📷 Camera position:', camera.position);
    console.log('📷 Camera target:', controls?.target);
  }
}

/**
 * カメラビューを調整する関数
 * @param {THREE.Scene} scene - The THREE.js scene
 * @param {THREE.Camera} camera - The camera
 * @param {OrbitControls} controls - The orbit controls
 * @param {THREE.WebGLRenderer} renderer - The renderer
 */
export function adjustCameraView(scene, camera, controls, renderer) {
  console.log('📷 Adjusting camera view...');
  
  if (!camera || !controls) {
    console.warn('⚠️ Camera or controls not found');
    return;
  }
  
  // シーンの境界を計算
  const box = new THREE.Box3();
  const objectsInScene = [];
  
  scene.children.forEach(child => {
    if (child.isMesh || child.isLine || child.isGroup) {
      if (child.type !== 'DirectionalLight' && child.type !== 'AmbientLight') {
        objectsInScene.push(child);
        box.expandByObject(child);
      }
    }
  });
  
  if (objectsInScene.length === 0) {
    console.warn('⚠️ No objects found in scene');
    return;
  }
  
  // バウンディングボックスの中心とサイズを計算
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  
  // 光学系に適した境界計算
  // X, Y方向のサイズが小さすぎる場合は、光学系のレンズ径を考慮して拡張
  const minOpticalSize = 100; // 最小光学サイズ（mm）
  const expandedSize = new THREE.Vector3(
    Math.max(size.x, minOpticalSize),
    Math.max(size.y, minOpticalSize),
    size.z
  );
  
  const maxDimension = Math.max(expandedSize.x, expandedSize.y, expandedSize.z);
  
  console.log(`📊 Scene bounds: center(${center.x.toFixed(2)}, ${center.y.toFixed(2)}, ${center.z.toFixed(2)})`);
  console.log(`📊 Original size: (${size.x.toFixed(2)}, ${size.y.toFixed(2)}, ${size.z.toFixed(2)})`);
  console.log(`📊 Expanded size: (${expandedSize.x.toFixed(2)}, ${expandedSize.y.toFixed(2)}, ${expandedSize.z.toFixed(2)})`);
  console.log(`📊 Max dimension: ${maxDimension.toFixed(2)}`);
  
  // カメラの位置を調整 - 光学系に適した距離
  const distance = maxDimension * 1.5; // 適切な距離（少し近づける）
  const cameraPosition = new THREE.Vector3(
    center.x,
    center.y,
    center.z + distance
  );
  
  // カメラとコントロールを更新
  camera.position.copy(cameraPosition);
  controls.target.copy(center);
  controls.update();
  
  // カメラの視野サイズも調整（OrthographicCameraの場合）
  if (camera.isOrthographicCamera) {
    const aspect = camera.right / camera.top;
    const viewSize = maxDimension * 0.6; // 適切なビューサイズ
    
    camera.left = -viewSize * aspect / 2;
    camera.right = viewSize * aspect / 2;
    camera.top = viewSize / 2;
    camera.bottom = -viewSize / 2;
    camera.updateProjectionMatrix();
    
    console.log(`📷 Updated orthographic camera view size: ${viewSize.toFixed(2)}`);
  }
  
  console.log(`📷 Camera moved to: (${cameraPosition.x.toFixed(2)}, ${cameraPosition.y.toFixed(2)}, ${cameraPosition.z.toFixed(2)})`);
  console.log(`📷 Camera target: (${center.x.toFixed(2)}, ${center.y.toFixed(2)}, ${center.z.toFixed(2)})`);
  
  // レンダリング更新
  if (renderer) {
    renderer.render(scene, camera);
  }
}

/**
 * デバッグ用のシーンバウンディングボックスを表示
 * @param {THREE.Scene} scene - The THREE.js scene
 * @param {THREE.WebGLRenderer} renderer - The renderer
 * @param {THREE.Camera} camera - The camera
 */
export function showSceneBoundingBox(scene, renderer, camera) {
  console.log('📦 Showing scene bounding box...');
  
  if (!scene) return;
  
  // 既存のバウンディングボックスを削除
  const existingBox = scene.getObjectByName('debug-bounding-box');
  if (existingBox) {
    scene.remove(existingBox);
  }
  
  const existingCenter = scene.getObjectByName('debug-center-point');
  if (existingCenter) {
    scene.remove(existingCenter);
  }
  
  // シーンの境界を計算
  const box = new THREE.Box3();
  const objectsInScene = [];
  
  scene.children.forEach(child => {
    if (child.isMesh || child.isLine || child.isGroup) {
      if (child.type !== 'DirectionalLight' && child.type !== 'AmbientLight') {
        objectsInScene.push(child);
        box.expandByObject(child);
      }
    }
  });
  
  if (objectsInScene.length === 0) {
    console.warn('⚠️ No objects found for bounding box');
    return;
  }
  
  // バウンディングボックスを可視化
  const helper = new THREE.Box3Helper(box, 0xff0000);
  helper.name = 'debug-bounding-box';
  scene.add(helper);
  
  // 中心点を表示
  const center = box.getCenter(new THREE.Vector3());
  const centerGeometry = new THREE.SphereGeometry(1, 8, 8);
  const centerMaterial = new THREE.MeshBasicMaterial({ color: 0x00ff00 });
  const centerMesh = new THREE.Mesh(centerGeometry, centerMaterial);
  centerMesh.position.copy(center);
  centerMesh.name = 'debug-center-point';
  scene.add(centerMesh);
  
  console.log(`📦 Bounding box created at center: (${center.x.toFixed(2)}, ${center.y.toFixed(2)}, ${center.z.toFixed(2)})`);
  
  // レンダリング更新
  if (renderer) {
    renderer.render(scene, camera);
  }
}

/**
 * デバッグ用: シーンのバウンディングボックスを計算
 * @param {THREE.Scene} scene - The THREE.js scene
 * @returns {Object|null} Bounding box information or null if empty
 */
export function calculateSceneBounds(scene) {
  const box = new THREE.Box3();
  
  scene.children.forEach(child => {
    if (child.isMesh || child.isLine) {
      const childBox = new THREE.Box3().setFromObject(child);
      box.union(childBox);
    }
  });
  
  if (box.isEmpty()) {
    console.log('📦 Scene bounds: Empty scene');
    return null;
  }
  
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  
  console.log('📦 Scene bounds:');
  console.log(`  Min: (${box.min.x.toFixed(2)}, ${box.min.y.toFixed(2)}, ${box.min.z.toFixed(2)})`);
  console.log(`  Max: (${box.max.x.toFixed(2)}, ${box.max.y.toFixed(2)}, ${box.max.z.toFixed(2)})`);
  console.log(`  Size: (${size.x.toFixed(2)}, ${size.y.toFixed(2)}, ${size.z.toFixed(2)})`);
  console.log(`  Center: (${center.x.toFixed(2)}, ${center.y.toFixed(2)}, ${center.z.toFixed(2)})`);
  
  return { min: box.min, max: box.max, size, center };
}

/**
 * デバッグ用: カメラを全体が見える位置に調整
 * @param {THREE.Scene} scene - The THREE.js scene
 * @param {THREE.Camera} camera - The camera
 * @param {OrbitControls} controls - The orbit controls
 */
export function fitCameraToScene(scene, camera, controls) {
  const bounds = calculateSceneBounds(scene);
  if (!bounds) {
    console.log('🎥 No objects to fit camera to');
    return;
  }
  
  const { center, size } = bounds;
  const maxSize = Math.max(size.x, size.y, size.z);
  
  // カメラを少し遠くに配置
  const distance = maxSize * 2;
  camera.position.set(center.x, center.y, center.z + distance);
  camera.lookAt(center.x, center.y, center.z);
  controls.target.copy(center);
  controls.update();
  
  // OrthographicCameraの場合、適切なサイズに調整
  if (camera.isOrthographicCamera) {
    const aspect = camera.right / camera.top;
    const frustumSize = maxSize * 1.5; // Add 50% padding
    
    camera.left = -frustumSize * aspect / 2;
    camera.right = frustumSize * aspect / 2;
    camera.top = frustumSize / 2;
    camera.bottom = -frustumSize / 2;
    camera.updateProjectionMatrix();
  }
  
  console.log(`🎥 Camera fitted to scene, distance: ${distance.toFixed(2)}`);
  console.log(`🎥 Camera position: (${camera.position.x.toFixed(2)}, ${camera.position.y.toFixed(2)}, ${camera.position.z.toFixed(2)})`);
}

/**
 * Debug WASM System Status
 */
export function debugWASMSystem() {
  console.log('🔬 === WASM System Debug ===');
  
  try {
    const wasmSystem = getWASMSystem();
    if (!wasmSystem) {
      console.log('❌ WASM system not initialized');
      // Try to create and initialize a new system
      console.log('🔧 Attempting to create new WASM system...');
      
      return import('../force-wasm-system.js').then(module => {
        const { ForceWASMSystem } = module;
        const newSystem = new ForceWASMSystem();
        return newSystem.forceInitializeWASM().then(() => {
          console.log('✅ New WASM system created and initialized');
          const status = newSystem.getSystemStatus();
          console.log('📊 New WASM Status:', status);
          return newSystem;
        });
      }).catch(error => {
        console.error('❌ Failed to create new WASM system:', error);
        return null;
      });
    }

    const status = wasmSystem.getSystemStatus();
    console.log('📊 WASM Status:', status);

    if (wasmSystem.isWASMReady) {
      console.log('✅ WASM is ready and functional');
      
      // Test basic calculation
      const testR = 2.5;
      const testC = 0.05;
      const testK = -0.5;
      const testA4 = 1e-6;
      
      try {
        const result = wasmSystem.forceAsphericSag(testR, testC, testK, testA4);
        console.log(`🧪 Test calculation: r=${testR}, result=${result.toExponential(6)}`);
        
        // Performance mini-test
        const iterations = 10000;
        const start = performance.now();
        for (let i = 0; i < iterations; i++) {
          wasmSystem.forceAsphericSag(Math.random() * 5, testC, testK, testA4);
        }
        const duration = performance.now() - start;
        console.log(`⚡ Performance: ${iterations} calculations in ${duration.toFixed(2)}ms (${(iterations/duration).toFixed(0)} ops/ms)`);
        
      } catch (calcError) {
        console.error('❌ WASM calculation error:', calcError);
      }
      
    } else {
      console.log('⚠️ WASM not ready - using JavaScript fallback');
      
      // Try to reinitialize
      console.log('🔧 Attempting to reinitialize WASM...');
      return wasmSystem.forceInitializeWASM().then(() => {
        console.log('✅ WASM reinitialized successfully');
        return debugWASMSystem(); // Recursive call to test again
      }).catch(error => {
        console.error('❌ WASM reinitialization failed:', error);
      });
    }
    
  } catch (error) {
    console.error('❌ WASM debug error:', error);
  }
}

/**
 * Quick WASM vs JavaScript comparison
 */
export function quickWASMComparison() {
  console.log('🏁 === Quick WASM vs JavaScript Comparison ===');
  
  const iterations = 50000;
  const testParams = {
    r: 2.5,
    c: 0.05, 
    k: -0.5,
    a4: 1e-6
  };
  
  // JavaScript baseline
  const jsAspheric = (r, c, k, a4) => {
    if (r === 0) return 0;
    const r2 = r * r;
    const discriminant = 1 - (1 + k) * c * c * r2;
    if (discriminant <= 0) return 0;
    const basicSag = c * r2 / (1 + Math.sqrt(discriminant));
    return basicSag + a4 * Math.pow(r, 4);
  };
  
  console.log(`🔢 Running ${iterations.toLocaleString()} calculations...`);
  
  // JavaScript test
  const jsStart = performance.now();
  for (let i = 0; i < iterations; i++) {
    jsAspheric(testParams.r, testParams.c, testParams.k, testParams.a4);
  }
  const jsTime = performance.now() - jsStart;
  
  // WASM test
  const wasmSystem = getWASMSystem();
  let wasmTime = 0;
  let wasmResult = 'N/A';
  
  if (wasmSystem && wasmSystem.isWASMReady) {
    const wasmStart = performance.now();
    for (let i = 0; i < iterations; i++) {
      wasmSystem.forceAsphericSag(testParams.r, testParams.c, testParams.k, testParams.a4);
    }
    wasmTime = performance.now() - wasmStart;
    wasmResult = `${wasmTime.toFixed(2)}ms`;
  } else {
    wasmResult = 'Not Available';
  }
  
  console.log(`📈 Results:`);
  console.log(`   JavaScript: ${jsTime.toFixed(2)}ms (${(iterations/jsTime).toFixed(0)} ops/ms)`);
  console.log(`   WASM: ${wasmResult}${wasmTime > 0 ? ` (${(iterations/wasmTime).toFixed(0)} ops/ms)` : ''}`);
  
  if (wasmTime > 0) {
    const speedup = jsTime / wasmTime;
    console.log(`   Speedup: ${speedup.toFixed(2)}x ${speedup > 1 ? '✅ (WASM faster)' : '❌ (JavaScript faster)'}`);
  }
}
