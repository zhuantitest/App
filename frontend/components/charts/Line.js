// components/charts/Line.js
import React from 'react';
import { View } from 'react-native';
import {
  VictoryChart,
  VictoryLine,
  VictoryTheme,
  VictoryAxis,
  VictoryScatter,
  VictoryTooltip,
} from 'victory-native';

/**
 * 用法（對齊 chart-kit 常見資料）：
 * <Line labels={['1/1','1/2']} datasets={[{ data:[10,20] }]} />
 * 或傳 points：[{ x:'1/1', y:10 }, ...]
 */
export default function Line({
  labels = [],
  datasets = [],
  points = null,
  height = 220,
  ySuffix = '',
}) {
  const data =
    points ??
    (labels.length && datasets[0]?.data?.length
      ? labels.map((x, i) => ({ x, y: Number(datasets[0].data[i] ?? 0) }))
      : []);

  return (
    <View>
      <VictoryChart height={height} theme={VictoryTheme.material}>
        <VictoryAxis
          tickFormat={(t) => `${t}`}
          style={{ tickLabels: { fontSize: 10 } }}
        />
        <VictoryAxis
          dependentAxis
          tickFormat={(t) => `${t}${ySuffix}`}
          style={{ tickLabels: { fontSize: 10 } }}
        />
        <VictoryLine data={data} />
        <VictoryScatter
          data={data}
          size={3}
          labels={({ datum }) => `${datum.x}\n${datum.y}${ySuffix}`}
          labelComponent={<VictoryTooltip dy={-10} />}
        />
      </VictoryChart>
    </View>
  );
}
