// screens/ReceiptCropScreen.tsx
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Image,
  Dimensions,
  StyleSheet,
  PanResponder,
  Text,
  Alert,
  TouchableOpacity,
  StyleSheet as RNStyleSheet,
  GestureResponderEvent,
  PanResponderGestureState,
} from 'react-native';
import * as ImageManipulator from 'expo-image-manipulator';

type Rect = { x: number; y: number; w: number; h: number };
type Corner = 'tl' | 'tr' | 'bl' | 'br';
type Edge = 'l' | 'r' | 't' | 'b';

const ACTION_BAR_HEIGHT = 96;
const HANDLE_SIZE = 44;
const EDGE_THICK = 36;
const HANDLE_HITSLOP = { top: 28, left: 28, right: 28, bottom: 28 };
const MIN_SIZE = 56;

export default function ReceiptCropScreen({ route, navigation }: any) {
  const { photoUri, returnTo = 'AddTransaction' } = route.params as {
    photoUri: string;
    returnTo?: string;
  };

  const [imgW, setImgW] = useState(0);
  const [imgH, setImgH] = useState(0);
  const [vw, setVw] = useState(0);
  const [vh, setVh] = useState(0);

  const initRect = useMemo<Rect>(() => {
    const screenW = Dimensions.get('window').width;
    const w = Math.round(screenW * 0.88);
    const h = Math.round(w * 0.36);
    return { x: Math.round((screenW - w) / 2), y: 140, w, h };
  }, []);

  const rectRef = useRef<Rect>(initRect);
  const dragStartRef = useRef({ x: initRect.x, y: initRect.y });
  const resizeStartRef = useRef<Rect>(initRect);
  const [, force] = useState(0);

  useEffect(() => {
    Image.getSize(
      photoUri,
      (w, h) => {
        setImgW(w);
        setImgH(h);
      },
      () => Alert.alert('讀取影像尺寸失敗')
    );
  }, [photoUri]);

  const clampRect = (r: Rect): Rect => {
    const x = Math.max(0, Math.min(r.x, Math.max(0, vw - MIN_SIZE)));
    const y = Math.max(0, Math.min(r.y, Math.max(0, vh - MIN_SIZE)));
    const maxW = Math.max(0, vw - x);
    const maxH = Math.max(0, vh - y);
    const w = Math.max(MIN_SIZE, Math.min(r.w, maxW));
    const h = Math.max(MIN_SIZE, Math.min(r.h, maxH));
    return { x, y, w, h };
  };

  const dragPan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: () => {
          dragStartRef.current = { x: rectRef.current.x, y: rectRef.current.y };
        },
        onPanResponderMove: (_e, g) => {
          if (vw === 0 || vh === 0) return;
          if (Math.abs(g.dx) + Math.abs(g.dy) < 0.5) return;

          const start = dragStartRef.current;
          const nx = Math.max(0, Math.min(start.x + g.dx, vw - rectRef.current.w));
          const ny = Math.max(0, Math.min(start.y + g.dy, vh - rectRef.current.h));
          rectRef.current = { ...rectRef.current, x: nx, y: ny };
          force(v => v + 1);
        },
      }),
    [vw, vh]
  );

  const corners = useMemo(() => {
    const makeCornerPan = (corner: Corner) =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: () => {
          resizeStartRef.current = { ...rectRef.current };
        },
        onPanResponderMove: (_e: GestureResponderEvent, g: PanResponderGestureState) => {
          if (vw === 0 || vh === 0) return;
          if (Math.abs(g.dx) + Math.abs(g.dy) < 0.5) return;

          const s = resizeStartRef.current;
          let nx = s.x, ny = s.y, nw = s.w, nh = s.h;

          if (corner === 'tl') {
            nx = Math.min(s.x + g.dx, s.x + s.w - MIN_SIZE);
            ny = Math.min(s.y + g.dy, s.y + s.h - MIN_SIZE);
            nw = s.w - (nx - s.x);
            nh = s.h - (ny - s.y);
          } else if (corner === 'tr') {
            ny = Math.min(s.y + g.dy, s.y + s.h - MIN_SIZE);
            nw = Math.max(MIN_SIZE, s.w + g.dx);
            nh = s.h - (ny - s.y);
          } else if (corner === 'bl') {
            nx = Math.min(s.x + g.dx, s.x + s.w - MIN_SIZE);
            nw = s.w - (nx - s.x);
            nh = Math.max(MIN_SIZE, s.h + g.dy);
          } else {
            nw = Math.max(MIN_SIZE, s.w + g.dx);
            nh = Math.max(MIN_SIZE, s.h + g.dy);
          }

          rectRef.current = clampRect({ x: nx, y: ny, w: nw, h: nh });
          force(v => v + 1);
        },
      });

    return {
      tl: makeCornerPan('tl'),
      tr: makeCornerPan('tr'),
      bl: makeCornerPan('bl'),
      br: makeCornerPan('br'),
    };
  }, [vw, vh]);

  const edges = useMemo(() => {
    const makeEdgePan = (edge: Edge) =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: () => {
          resizeStartRef.current = { ...rectRef.current };
        },
        onPanResponderMove: (_e, g) => {
          if (vw === 0 || vh === 0) return;
          if (Math.abs(g.dx) + Math.abs(g.dy) < 0.5) return;

          const s = resizeStartRef.current;
          let nx = s.x, ny = s.y, nw = s.w, nh = s.h;

          if (edge === 'l') {
            nx = Math.min(s.x + g.dx, s.x + s.w - MIN_SIZE);
            nw = s.w - (nx - s.x);
          } else if (edge === 'r') {
            nw = Math.max(MIN_SIZE, s.w + g.dx);
          } else if (edge === 't') {
            ny = Math.min(s.y + g.dy, s.y + s.h - MIN_SIZE);
            nh = s.h - (ny - s.y);
          } else {
            nh = Math.max(MIN_SIZE, s.h + g.dy);
          }

          rectRef.current = clampRect({ x: nx, y: ny, w: nw, h: nh });
          force(v => v + 1);
        },
      });

    return {
      l: makeEdgePan('l'),
      r: makeEdgePan('r'),
      t: makeEdgePan('t'),
      b: makeEdgePan('b'),
    };
  }, [vw, vh]);

  const confirmCrop = async () => {
    if (!imgW || !imgH || !vw || !vh) return;

    const scale = Math.min(vw / imgW, vh / imgH);
    const displayW = imgW * scale;
    const displayH = imgH * scale;
    const offsetX = (vw - displayW) / 2;
    const offsetY = (vh - displayH) / 2;

    const rx = Math.max(0, rectRef.current.x - offsetX);
    const ry = Math.max(0, rectRef.current.y - offsetY);

    const originX = Math.round((rx / displayW) * imgW);
    const originY = Math.round((ry / displayH) * imgH);
    const width = Math.round(
      (Math.min(rectRef.current.w, Math.max(0, displayW - rx)) / displayW) * imgW
    );
    const height = Math.round(
      (Math.min(rectRef.current.h, Math.max(0, displayH - ry)) / displayH) * imgH
    );

    if (width <= 4 || height <= 4) {
      Alert.alert('選取區域太小', '請拉大一點再裁切');
      return;
    }

    const out = await ImageManipulator.manipulateAsync(
      photoUri,
      [{ crop: { originX, originY, width, height } }],
      { compress: 0.92, format: ImageManipulator.SaveFormat.JPEG }
    );

    navigation.navigate(returnTo, { croppedUri: out.uri });
  };

  return (
    <View style={styles.container}>
      <View
        style={styles.imageBox}
        onLayout={(e) => {
          const { width, height } = e.nativeEvent.layout;
          setVw(width);
          setVh(height);
        }}
      >
        <View pointerEvents="none" style={RNStyleSheet.absoluteFillObject}>
          <Image source={{ uri: photoUri }} style={styles.image} />
        </View>

        <View pointerEvents="none" style={[styles.mask, { width: vw, height: vh }]} />

        <View
          pointerEvents={vw && vh ? 'box-none' : 'none'}
          style={[
            styles.rectWrap,
            {
              left: rectRef.current.x,
              top: rectRef.current.y,
              width: rectRef.current.w,
              height: rectRef.current.h,
            },
          ]}
        >
          <View {...dragPan.panHandlers} pointerEvents="auto" style={styles.dragPad} />

          <View pointerEvents="none" style={RNStyleSheet.absoluteFillObject}>
            <View style={styles.border} />
          </View>

          <View {...edges.l.panHandlers} pointerEvents="box-only" style={[styles.edge, styles.edgeL]} />
          <View {...edges.r.panHandlers} pointerEvents="box-only" style={[styles.edge, styles.edgeR]} />
          <View {...edges.t.panHandlers} pointerEvents="box-only" style={[styles.edge, styles.edgeT]} />
          <View {...edges.b.panHandlers} pointerEvents="box-only" style={[styles.edge, styles.edgeB]} />

          <View {...corners.tl.panHandlers} pointerEvents="box-only" hitSlop={HANDLE_HITSLOP} style={[styles.handle, styles.tl]} />
          <View {...corners.tr.panHandlers} pointerEvents="box-only" hitSlop={HANDLE_HITSLOP} style={[styles.handle, styles.tr]} />
          <View {...corners.bl.panHandlers} pointerEvents="box-only" hitSlop={HANDLE_HITSLOP} style={[styles.handle, styles.bl]} />
          <View {...corners.br.panHandlers} pointerEvents="box-only" hitSlop={HANDLE_HITSLOP} style={[styles.handle, styles.br]} />
        </View>
      </View>

      {/* 提醒：放在按鈕列上方一行，字體稍大 */}
      <Text style={styles.hintText}>📌 請擷取品項及價格</Text>

      <View style={styles.actions}>
        <TouchableOpacity style={styles.btn} onPress={() => navigation.goBack()}>
          <Text style={styles.btnText}>取消</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.btn, styles.primary]} onPress={confirmCrop}>
          <Text style={styles.btnTextPrimary}>確定</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  imageBox: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  image: { width: '100%', height: '100%', resizeMode: 'contain' },
  mask: {
    position: 'absolute',
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  rectWrap: { position: 'absolute' },
  dragPad: {
    ...RNStyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,224,255,0.10)',
    zIndex: 5,
    borderRadius: 4,
  },
  border: {
    ...RNStyleSheet.absoluteFillObject,
    borderWidth: 2,
    borderColor: '#00E0FF',
    borderRadius: 4,
  },
  edge: { position: 'absolute', zIndex: 8 },
  edgeL: { left: -EDGE_THICK / 2, top: 0, bottom: 0, width: EDGE_THICK },
  edgeR: { right: -EDGE_THICK / 2, top: 0, bottom: 0, width: EDGE_THICK },
  edgeT: { top: -EDGE_THICK / 2, left: 0, right: 0, height: EDGE_THICK },
  edgeB: { bottom: -EDGE_THICK / 2, left: 0, right: 0, height: EDGE_THICK },
  handle: {
    position: 'absolute',
    width: HANDLE_SIZE,
    height: HANDLE_SIZE,
    borderRadius: HANDLE_SIZE / 2,
    backgroundColor: '#00E0FF',
    borderWidth: 2,
    borderColor: '#009CBD',
    zIndex: 10,
  },
  tl: { left: -HANDLE_SIZE / 2, top: -HANDLE_SIZE / 2 },
  tr: { right: -HANDLE_SIZE / 2, top: -HANDLE_SIZE / 2 },
  bl: { left: -HANDLE_SIZE / 2, bottom: -HANDLE_SIZE / 2 },
  br: { right: -HANDLE_SIZE / 2, bottom: -HANDLE_SIZE / 2 },

  // 提醒（位於動作列上方）
  hintText: {
    textAlign: 'center',
    backgroundColor: 'rgba(0,0,0,0.7)',
    color: '#fff',
    paddingHorizontal: 16,
    paddingVertical: 8,
    fontSize: 18,         // 字體稍大
    fontWeight: '700',
  },

  // 下方動作列
  actions: {
    height: ACTION_BAR_HEIGHT,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    backgroundColor: '#111',
  },
  btn: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: '#333',
  },
  btnText: { color: '#fff', fontSize: 16 },
  primary: { backgroundColor: '#00E0FF' },
  btnTextPrimary: { color: '#000', fontSize: 16, fontWeight: '700' },
});
