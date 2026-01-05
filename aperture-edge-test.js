/**
 * Aperture Edge Ray Test and Usage Examples
 * 絞り周辺光線テスト・使用例
 */

// テスト用関数
function testApertureEdgeRays() {
    console.log('🧪 絞り周辺光線計算テスト開始');
    console.log('');

    // サンプル光学系データ（簡単なレンズ系を想定）
    const sampleOpticalSystem = [
        // 物体面
        { surface: 0, radius: Infinity, thickness: 100, glass: 'AIR', semidia: 50, note: 'OBJ' },
        
        // レンズ前面
        { surface: 1, radius: 50, thickness: 5, glass: 'BK7', semidia: 25, note: 'L1-FRONT' },
        
        // レンズ後面  
        { surface: 2, radius: -50, thickness: 10, glass: 'AIR', semidia: 25, note: 'L1-BACK' },
        
        // 絞り面
        { surface: 3, radius: Infinity, thickness: 10, glass: 'AIR', semidia: 10, note: 'STOP' },
        
        // 像面
        { surface: 4, radius: Infinity, thickness: 0, glass: 'AIR', semidia: 30, note: 'IMG' }
    ];

    // サンプルフィールド設定
    const sampleFieldSetting = {
        displayName: '軸上',
        fieldType: 'height',
        value: 0,
        x: 0,
        y: 0
    };

    // 絞り周辺光線計算実行
    if (typeof calculateApertureEdgeRays === 'function') {
        const result = calculateApertureEdgeRays(
            sampleOpticalSystem, 
            sampleFieldSetting,
            1.0,  // 絞り周辺（100%）
            0.5876,  // d線波長
            true  // デバッグモード
        );
        
        if (result && result.success) {
            console.log('✅ 絞り周辺光線計算成功!');
            console.log('');
            console.log('📊 結果サマリー:');
            console.log(`   絞り面: 面${result.apertureSurfaceIndex}`);
            console.log(`   絞り半径: ${result.apertureRadius.toFixed(3)}`);
            console.log(`   波長: ${result.wavelength}μm`);
            console.log('');

            // 各方向の結果を表示
            for (const [direction, ray] of Object.entries(result.rays)) {
                if (ray) {
                    console.log(`🎯 ${direction}方向の絞り周辺光線:`);
                    console.log(`   開始位置: (${ray.startPosition.x.toFixed(3)}, ${ray.startPosition.y.toFixed(3)}, ${ray.startPosition.z.toFixed(3)})`);
                    console.log(`   開始方向: (${ray.startDirection.x.toFixed(6)}, ${ray.startDirection.y.toFixed(6)}, ${ray.startDirection.z.toFixed(6)})`);
                    console.log(`   絞り位置: (${ray.aperturePosition.x.toFixed(3)}, ${ray.aperturePosition.y.toFixed(3)}, ${ray.aperturePosition.z.toFixed(3)})`);
                    console.log(`   最終位置: (${ray.finalPosition.x.toFixed(3)}, ${ray.finalPosition.y.toFixed(3)}, ${ray.finalPosition.z.toFixed(3)})`);
                    console.log(`   光路長: ${ray.pathLength.toFixed(3)}`);
                    console.log(`   収束: ${ray.convergence.converged ? '✅' : '❌'} (${ray.convergence.iterations}回)`);
                } else {
                    console.log(`❌ ${direction}方向: 計算失敗`);
                }
                console.log('');
            }
            
            return result;
        } else {
            console.error('❌ 絞り周辺光線計算失敗');
            return null;
        }
    } else {
        console.error('❌ calculateApertureEdgeRays関数が利用できません');
        return null;
    }
}

// 波面収差計算用の応用例
function calculateWavefrontAberrationFromApertureRays() {
    console.log('🌊 絞り周辺光線による波面収差解析例');
    console.log('');
    
    // 絞り周辺光線を計算
    const apertureRays = testApertureEdgeRays();
    
    if (!apertureRays || !apertureRays.success) {
        console.error('❌ 絞り周辺光線データが取得できません');
        return;
    }
    
    // 主光線の光路長を基準として設定（仮想値）
    const chiefRayPathLength = 125.0; // 例: 主光線の光路長
    
    console.log('📐 波面収差計算:');
    console.log(`基準光路長（主光線）: ${chiefRayPathLength.toFixed(3)}`);
    console.log('');
    
    for (const [direction, ray] of Object.entries(apertureRays.rays)) {
        if (ray) {
            const pathDifference = ray.pathLength - chiefRayPathLength;
            const opd = pathDifference; // 光路差 (OPD: Optical Path Difference)
            const wavefrontError = opd / apertureRays.wavelength; // 波長単位
            
            console.log(`${direction}方向:`);
            console.log(`  光路長: ${ray.pathLength.toFixed(3)}`);
            console.log(`  光路差: ${opd.toFixed(6)}`);  
            console.log(`  波面誤差: ${wavefrontError.toFixed(3)}λ`);
            console.log('');
        }
    }
    
    console.log('💡 このデータを使用して以下の解析が可能:');
    console.log('   - ザイデル収差係数の計算');
    console.log('   - 波面収差図の作成');  
    console.log('   - MTF(変調伝達関数)の評価');
    console.log('   - スポットダイアグラムの生成');
}

// 実用的な使用例
function practicalApertureEdgeRayUsage() {
    console.log('🔧 絞り周辺光線の実用的な使用例');
    console.log('');
    
    console.log('1. 光線収差解析:');
    console.log('   - 軸上および軸外での絞り周辺光線を計算');
    console.log('   - 理想像点からの偏差を測定');
    console.log('   - コマ、非点収差、歪曲収差を定量評価');
    console.log('');
    
    console.log('2. 光学設計の最適化:');
    console.log('   - 絞り位置の最適化');
    console.log('   - レンズ形状の収差補正');
    console.log('   - 開口数(F値)の設計検討');
    console.log('');
    
    console.log('3. 製造公差解析:');
    console.log('   - レンズ偏心による影響評価'); 
    console.log('   - 面精度と収差の関係分析');
    console.log('   - 組立公差の設定');
    console.log('');
    
    console.log('4. 性能評価:');
    console.log('   - PSF(Point Spread Function)計算');
    console.log('   - エンサークルドエネルギー解析');
    console.log('   - 光学伝達関数(OTF)の算出');
}

// グローバル関数として公開
if (typeof window !== 'undefined') {
    window.testApertureEdgeRays = testApertureEdgeRays;
    window.calculateWavefrontAberrationFromApertureRays = calculateWavefrontAberrationFromApertureRays;
    window.practicalApertureEdgeRayUsage = practicalApertureEdgeRayUsage;
}

console.log('🎯 絞り周辺光線テスト関数が利用可能:');
console.log('   testApertureEdgeRays() - 基本動作テスト');
console.log('   calculateWavefrontAberrationFromApertureRays() - 波面収差解析例');
console.log('   practicalApertureEdgeRayUsage() - 実用的な使用方法の説明');
