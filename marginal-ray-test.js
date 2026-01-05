// 絞り周辺光線テスト用スクリプト

// 光学系データ取得関数（フォールバック付き）
function getOpticalSystemRows() {
  if (typeof window !== 'undefined' && window.tableOpticalSystem && typeof window.tableOpticalSystem.getData === 'function') {
    return window.tableOpticalSystem.getData();
  }
  console.log('⚠️ tableOpticalSystemが利用できません、ダミーデータを使用');
  return createDummyOpticalSystem();
}

/**
 * 絞り周辺光線の計算テスト
 */
function testMarginalRays() {
  console.log('🎯 絞り周辺光線計算テスト開始');
  console.log('');

  // テスト用光学系（簡単な例）
  if (typeof window === 'undefined' || !window.getOpticalSystemRows) {
    console.log('❌ getOpticalSystemRows関数が利用できません - ローカル関数を使用');
    // ローカル関数を使用
  }

  const opticalSystem = (typeof window !== 'undefined' && window.getOpticalSystemRows) ? 
                       window.getOpticalSystemRows() : getOpticalSystemRows();
  if (!opticalSystem || opticalSystem.length === 0) {
    console.log('❌ 光学系データが空です');
    console.log('   光学系テーブルにデータを入力してから実行してください');
    console.log('');
    console.log('💡 テスト用ダミーデータで実行します');
    
    // テスト用ダミーデータを作成
    const dummySystem = createDummyOpticalSystem();
    console.log('🔧 テスト用光学系データを作成しました:');
    dummySystem.forEach((surface, index) => {
      console.log(`  Surface ${index + 1}: R=${surface.radius}, T=${surface.thickness}, Glass=${surface.glass}, Aperture=${surface.aperture}`);
    });
    
    return testMarginalRaysWithData(dummySystem);
  }

  return testMarginalRaysWithData(opticalSystem);
}

/**
 * 指定された光学系データでテスト実行
 */
function testMarginalRaysWithData(opticalSystem) {

  // テスト用フィールド設定
  const fieldSetting = {
    x: 0,
    y: 5,
    angleX: 0,
    angleY: 0.1,
    displayName: 'Test Field (0, 5mm)'
  };

  console.log('📊 テスト設定:');
  console.log(`  光学系面数: ${opticalSystem.length}`);
  console.log(`  フィールド: ${fieldSetting.displayName}`);
  console.log('');

  // 各方向の絞り周辺光線を計算
  const directions = ['up', 'down', 'left', 'right'];
  const results = {};

  for (const direction of directions) {
    console.log(`🔄 ${direction}方向の絞り周辺光線計算中...`);
    
    try {
      if (typeof window.calculateAdaptiveMarginalRay === 'function') {
        const result = window.calculateAdaptiveMarginalRay(opticalSystem, fieldSetting, direction, 0.5876, true);
        
        if (result) {
          results[direction] = result;
          console.log(`✅ ${direction}方向完了:`);
          console.log(`   絞り面: Surface ${result.stopSurfaceIndex + 1}`);
          console.log(`   絞り半径: ${result.stopRadius.toFixed(3)}mm`);
          if (result.actualScaleFactor) {
            console.log(`   達成スケール: ${(result.actualScaleFactor * 100).toFixed(0)}%`);
            console.log(`   実際の絞り位置: (${result.actualStopPosition.x.toFixed(4)}, ${result.actualStopPosition.y.toFixed(4)})`);
          }
          console.log(`   最終位置: (${result.finalPosition.x.toFixed(4)}, ${result.finalPosition.y.toFixed(4)}, ${result.finalPosition.z.toFixed(4)})`);
          console.log(`   光路長: ${result.opticalPathLength?.toFixed(6) || 'N/A'}mm`);
        } else {
          console.log(`❌ ${direction}方向失敗`);
        }
      } else {
        console.log('❌ calculateAdaptiveMarginalRay関数が利用できません');
        break;
      }
    } catch (error) {
      console.error(`❌ ${direction}方向でエラー:`, error);
    }
    
    console.log('');
  }

  // 結果サマリー
  const successCount = Object.keys(results).length;
  console.log('📈 テスト結果サマリー:');
  console.log(`  成功: ${successCount}/${directions.length}方向`);
  console.log(`  成功方向: [${Object.keys(results).join(', ')}]`);
  
  if (successCount === directions.length) {
    console.log('🎉 全方向の絞り周辺光線計算成功！');
    
    // 絞りでの位置の分布を表示
    console.log('');
    console.log('🎯 絞り面での光線位置:');
    Object.keys(results).forEach(dir => {
      const pos = results[dir].targetPosition;
      console.log(`  ${dir}: (${pos.x.toFixed(3)}, ${pos.y.toFixed(3)})`);
    });
  } else {
    console.log('⚠️ 一部の方向で計算に失敗しました');
  }

  console.log('');
  console.log('🎯 テスト完了！');
  
  return results;
}

/**
 * 一括計算のテスト
 */
function testAllMarginalRays() {
  console.log('🚀 絞り周辺光線一括計算テスト開始');
  console.log('');

  if (typeof window === 'undefined' || !window.getOpticalSystemRows) {
    console.log('❌ getOpticalSystemRows関数が利用できません');
    return;
  }

  const opticalSystem = window.getOpticalSystemRows();
  if (!opticalSystem || opticalSystem.length === 0) {
    console.log('❌ 光学系データが空です');
    console.log('   光学系テーブルにデータを入力してから実行してください');
    return;
  }

  const fieldSetting = {
    x: 0,
    y: 5,
    angleX: 0,
    angleY: 0.1,
    displayName: 'Test Field (0, 5mm)'
  };

  try {
    if (typeof window.calculateAllMarginalRays === 'function') {
      const result = window.calculateAllMarginalRays(opticalSystem, fieldSetting, 0.5876, true);
      
      console.log('📊 一括計算結果:');
      console.log(`  成功方向: [${result.successfulDirections.join(', ')}]`);
      console.log(`  失敗方向: [${result.failedDirections.join(', ')}]`);
      console.log(`  計算時刻: ${result.calculationDate}`);
      
      // 成功した方向の詳細情報を表示
      result.successfulDirections.forEach(direction => {
        const rayData = result.marginalRays[direction];
        if (rayData && rayData.actualScaleFactor) {
          console.log(`  📍 ${direction}: ${(rayData.actualScaleFactor * 100).toFixed(0)}%スケールで成功`);
        }
      });
      
      return result;
    } else {
      console.log('❌ calculateAllMarginalRays関数が利用できません');
    }
  } catch (error) {
    console.error('❌ 一括計算でエラー:', error);
  }

  console.log('');
  console.log('🎯 一括計算テスト完了！');
}

/**
 * 絞り検出テスト
 */
function testApertureStopDetection() {
  console.log('🔍 絞り検出テスト開始');
  console.log('');

  if (typeof window === 'undefined' || !window.getOpticalSystemRows) {
    console.log('❌ getOpticalSystemRows関数が利用できません');
    return;
  }

  const opticalSystem = window.getOpticalSystemRows();
  if (!opticalSystem || opticalSystem.length === 0) {
    console.log('❌ 光学系データが空です');
    console.log('   光学系テーブルにデータを入力してから実行してください');
    return;
  }

  console.log('📊 光学系面の解析:');
  opticalSystem.forEach((surface, index) => {
    const aperture = parseFloat(surface.aperture) || parseFloat(surface.semidia) || 'N/A';
    const type = surface.surface_type || surface.type || 'Standard';
    const isStop = (type === 'STO' || type === 'STOP');
    
    console.log(`  Surface ${index + 1}: Type=${type}${isStop ? ' [STOP]' : ''}, Aperture=${aperture}`);
  });

  console.log('');
  console.log('🎯 絞り検出テスト完了！');
}

// グローバル関数として公開
if (typeof window !== 'undefined') {
  window.testMarginalRays = testMarginalRays;
  window.testAllMarginalRays = testAllMarginalRays;
  window.testApertureStopDetection = testApertureStopDetection;
}

console.log('🎯 絞り周辺光線テスト関数が利用可能:');
console.log('  testMarginalRays() - 各方向の絞り周辺光線テスト');
console.log('  testAllMarginalRays() - 一括計算テスト');
console.log('  testApertureStopDetection() - 絞り検出テスト');

/**
 * テスト用ダミー光学系データを作成
 */
function createDummyOpticalSystem() {
  return [
    {
      surface: '1',
      radius: Infinity,
      thickness: 5.0,
      glass: 'AIR',
      aperture: 25.0,
      semidia: 12.5,
      surface_type: 'Standard',
      conic: 0,
      A4: 0, A6: 0, A8: 0, A10: 0
    },
    {
      surface: '2', 
      radius: 50.0,
      thickness: 8.0,
      glass: 'N-BK7',
      aperture: 20.0,
      semidia: 10.0,
      surface_type: 'Standard',
      conic: 0,
      A4: 0, A6: 0, A8: 0, A10: 0
    },
    {
      surface: '3',
      radius: -30.0,
      thickness: 2.0,
      glass: 'AIR',
      aperture: 15.0,
      semidia: 7.5,
      surface_type: 'Standard',
      conic: 0,
      A4: 0, A6: 0, A8: 0, A10: 0
    },
    {
      surface: '4',
      radius: Infinity,
      thickness: 0.0,
      glass: 'AIR',
      aperture: 8.0,
      semidia: 4.0,
      surface_type: 'STO',  // 絞り面
      conic: 0,
      A4: 0, A6: 0, A8: 0, A10: 0
    },
    {
      surface: '5',
      radius: 25.0,
      thickness: 6.0,
      glass: 'N-SF11',
      aperture: 12.0,
      semidia: 6.0,
      surface_type: 'Standard',
      conic: 0,
      A4: 0, A6: 0, A8: 0, A10: 0
    },
    {
      surface: '6',
      radius: -40.0,
      thickness: 15.0,
      glass: 'AIR',
      aperture: 22.0,      // 18.0から22.0に拡大
      semidia: 11.0,       // 9.0から11.0に拡大
      surface_type: 'Standard',
      conic: 0,
      A4: 0, A6: 0, A8: 0, A10: 0
    },
    {
      surface: '7',
      radius: Infinity,
      thickness: 0.0,
      glass: 'AIR',
      aperture: 35.0,      // 30.0から35.0に拡大
      semidia: 17.5,       // 15.0から17.5に拡大
      surface_type: 'Standard',  // 像面
      conic: 0,
      A4: 0, A6: 0, A8: 0, A10: 0
    }
  ];
}

// グローバル関数として公開（ESモジュール形式ではない）
window.testMarginalRays = testMarginalRays;
window.testAllMarginalRays = testAllMarginalRays;
window.testApertureStopDetection = testApertureStopDetection;
