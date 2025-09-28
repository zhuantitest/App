// components/charts/Pie.js
import React from 'react';
import { View } from 'react-native';
import { VictoryPie } from 'victory-native';

/**
 * 通用圓餅圖（Victory 版）
 * 支援兩種資料格式：
 * 1) [{ name:'餐飲', amount:1200, color:'#FCD34D' }, ...]
 * 2) [{ x:'餐飲', y:1200, color:'#FCD34D' }, ...]
 */
export default function Pie({
  data = [],
  donut = true,
  innerRadius = 60,
  showLabels = true,
  height = 220,
  labelFormatter,
}) {
  // 正規化
  const normalized = data.map((d) => {
    if (typeof d?.y === 'number' || typeof d?.x === 'string') return d;
    return {
      x: d.name ?? d.label ?? '',
      y: Number(d.amount ?? d.value ?? d.population ?? 0),
      color: d.color,
    };
  });

  return (
    <View style={{ alignItems: 'center' }}>
      <VictoryPie
        height={height}
        data={normalized}
        colorScale={normalized.map((d) => d.color).filter(Boolean)}
        innerRadius={donut ? innerRadius : 0}
        padAngle={2}
        labels={
          showLabels
            ? ({ datum }) =>
                labelFormatter ? labelFormatter(datum) : `${datum.x}\n${datum.y}`
            : () => ''
        }
        style={{ labels: { fontSize: 12 } }}
      />
    </View>
  );
}
