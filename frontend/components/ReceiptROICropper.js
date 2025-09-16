// components/ReceiptROICropper.js
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Image, StyleSheet, PanResponder, Dimensions } from 'react-native';

const DOT = 16;     // 角落圓點大小
const HIT = 36;     // 手把可點擊/拖動範圍（隱形）
const EDGE = 14;    // 邊緣手把粗細（隱形，可拖拉）

export default function ReceiptROICropper({
  uri,
  onChange,
  minSize = 0.08,       // ROI 最小邊長（相對 0~1）
  lockRatio = null,     // 例如 1.6（寬/高），不鎖就傳 null
}) {
  const screenW = Dimensions.get('window').width;
  const [imgWH, setImgWH] = useState({ w: screenW, h: Math.round(screenW * 1.3) });

  // 依實際圖片比例計高度，避免 letterbox 導致對不準
  useEffect(() => {
    if (!uri) return;
    Image.getSize(
      uri,
      (w, h) => setImgWH({ w: screenW, h: Math.round((screenW * h) / w) }),
      () => {}
    );
  }, [uri]);

  const W = imgWH.w, H = imgWH.h;

  // 預設 ROI
  const init = useMemo(() => ({ x: 0.08, y: 0.22, w: 0.84, h: 0.56 }), []);
  const roiRef = useRef({ ...init });        // 實時 ROI
  const startRef = useRef({ ...init });      // 手勢開始的 ROI snapshot
  const [roi, setRoi] = useState({ ...init });

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  function apply(next) {
    // 邊界限制 + 最小尺寸
    const minW = Math.max(minSize, 0.02);
    const minH = Math.max(minSize, 0.02);

    let x = next.x, y = next.y, w = next.w, h = next.h;

    // 鎖定比例（可選）
    if (lockRatio && lockRatio > 0) {
      const target = lockRatio;
      const cur = w / h;
      if (Math.abs(cur - target) > 1e-3) {
        if (cur > target) { // 太寬 -> 收寬
          w = h * target;
        } else {            // 太高 -> 收高
          h = w / target;
        }
      }
    }

    w = Math.max(w, minW);
    h = Math.max(h, minH);

    x = clamp(x, 0, 1 - w);
    y = clamp(y, 0, 1 - h);

    const r = { x, y, w, h };
    roiRef.current = r;
    setRoi(r);
    onChange && onChange(r);
  }

  // 建立穩定的手勢：在 Grant 拍快照，Move 用「snapshot + dx/dy」
  function makeResponder(kind) {
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        startRef.current = { ...roiRef.current };
      },
      onPanResponderMove: (_, g) => {
        const dx = g.dx / W;
        const dy = g.dy / H;
        const s = startRef.current;

        let next = { ...s };
        if (kind === 'move') {
          next = { x: s.x + dx, y: s.y + dy, w: s.w, h: s.h };
        } else if (kind === 'tl') {
          next = { x: s.x + dx, y: s.y + dy, w: s.w - dx, h: s.h - dy };
        } else if (kind === 'tr') {
          next = { x: s.x, y: s.y + dy, w: s.w + dx, h: s.h - dy };
        } else if (kind === 'bl') {
          next = { x: s.x + dx, y: s.y, w: s.w - dx, h: s.h + dy };
        } else if (kind === 'br') {
          next = { x: s.x, y: s.y, w: s.w + dx, h: s.h + dy };
        } else if (kind === 'top') {
          next = { x: s.x, y: s.y + dy, w: s.w, h: s.h - dy };
        } else if (kind === 'bottom') {
          next = { x: s.x, y: s.y, w: s.w, h: s.h + dy };
        } else if (kind === 'left') {
          next = { x: s.x + dx, y: s.y, w: s.w - dx, h: s.h };
        } else if (kind === 'right') {
          next = { x: s.x, y: s.y, w: s.w + dx, h: s.h };
        }

        apply(next);
      },
    });
  }

  // 角落 + 邊緣 + 全框移動
  const prMove   = useMemo(() => makeResponder('move'), []);
  const prTL     = useMemo(() => makeResponder('tl'), []);
  const prTR     = useMemo(() => makeResponder('tr'), []);
  const prBL     = useMemo(() => makeResponder('bl'), []);
  const prBR     = useMemo(() => makeResponder('br'), []);
  const prTop    = useMemo(() => makeResponder('top'), []);
  const prBottom = useMemo(() => makeResponder('bottom'), []);
  const prLeft   = useMemo(() => makeResponder('left'), []);
  const prRight  = useMemo(() => makeResponder('right'), []);

  const boxPx = { left: roi.x * W, top: roi.y * H, width: roi.w * W, height: roi.h * H };
  const shade = {
    top:    { left: 0, top: 0, width: W, height: boxPx.top },
    bottom: { left: 0, top: boxPx.top + boxPx.height, width: W, height: Math.max(0, H - (boxPx.top + boxPx.height)) },
    left:   { left: 0, top: boxPx.top, width: boxPx.left, height: boxPx.height },
    right:  { left: boxPx.left + boxPx.width, top: boxPx.top, width: Math.max(0, W - (boxPx.left + boxPx.width)), height: boxPx.height },
  };

  return (
    <View style={styles.wrap}>
      <Image source={{ uri }} style={{ width: W, height: H, resizeMode: 'cover' }} />

      {/* 四面遮罩：中間 ROI 保持透明 */}
      <View style={[styles.overlay, { width: W, height: H }]} pointerEvents="box-none">
        <View style={[styles.shade, shade.top]} />
        <View style={[styles.shade, shade.bottom]} />
        <View style={[styles.shade, shade.left]} />
        <View style={[styles.shade, shade.right]} />

        {/* ROI 框（拖移整框） */}
        <View style={[styles.box, boxPx]} {...prMove.panHandlers}>
          {/* 邊緣「隱形大手把」→ 比較好抓 */}
          <View style={[styles.edge, { left: 0, top: 0, width: boxPx.width, height: EDGE }]} {...prTop.panHandlers} />
          <View style={[styles.edge, { left: 0, bottom: 0, width: boxPx.width, height: EDGE }]} {...prBottom.panHandlers} />
          <View style={[styles.edge, { left: 0, top: 0, width: EDGE, height: boxPx.height }]} {...prLeft.panHandlers} />
          <View style={[styles.edge, { right: 0, top: 0, width: EDGE, height: boxPx.height }]} {...prRight.panHandlers} />

          {/* 角落可視圓點（外層是比較大的 hit 區） */}
          <View style={[styles.hit, { left: 0, top: 0 }]} {...prTL.panHandlers}>
            <View style={[styles.dot]} />
          </View>
          <View style={[styles.hit, { right: 0, top: 0 }]} {...prTR.panHandlers}>
            <View style={[styles.dot]} />
          </View>
          <View style={[styles.hit, { left: 0, bottom: 0 }]} {...prBL.panHandlers}>
            <View style={[styles.dot]} />
          </View>
          <View style={[styles.hit, { right: 0, bottom: 0 }]} {...prBR.panHandlers}>
            <View style={[styles.dot]} />
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: '100%', backgroundColor: '#000', alignSelf: 'stretch' },
  overlay: { position: 'absolute', left: 0, top: 0 },
  shade: { position: 'absolute', backgroundColor: 'rgba(0,0,0,0.35)' },

  box: { position: 'absolute', borderWidth: 2, borderColor: '#00D1FF' },

  // 角落圓點（可見）
  dot: {
    width: DOT, height: DOT, borderRadius: DOT / 2,
    backgroundColor: '#00D1FF',
  },
  // 角落 hit 區（不可見、但更好抓）
  hit: {
    position: 'absolute',
    width: HIT, height: HIT,
    marginLeft: -HIT / 2, marginTop: -HIT / 2,
    alignItems: 'center', justifyContent: 'center',
  },
  // 邊緣手把（不可見、填滿邊緣一條）
  edge: {
    position: 'absolute',
    // 可視化除錯時打開：
    // backgroundColor: 'rgba(0,255,0,0.15)',
  },
});
