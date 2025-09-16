// components/SimpleReceiptCropper.js
// Expo Go 相容的簡化版收據裁切組件

import React, { useState, useRef } from 'react';
import {
  View,
  Image,
  StyleSheet,
  TouchableOpacity,
  Text,
  Alert,
  Dimensions,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

const { width: screenWidth } = Dimensions.get('window');

export default function SimpleReceiptCropper({ uri, onCrop, onCancel }) {
  const [cropArea, setCropArea] = useState({
    x: screenWidth * 0.1,
    y: screenWidth * 0.3,
    width: screenWidth * 0.8,
    height: screenWidth * 0.4,
  });
  const [imageSize, setImageSize] = useState({ width: screenWidth, height: screenWidth * 1.3 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

  // 計算相對座標 (0-1)
  const getRelativeCrop = () => {
    return {
      x: cropArea.x / imageSize.width,
      y: cropArea.y / imageSize.height,
      w: cropArea.width / imageSize.width,
      h: cropArea.height / imageSize.height,
    };
  };

  const handleImageLoad = (event) => {
    const { width, height } = event.nativeEvent;
    const aspectRatio = width / height;
    const displayHeight = screenWidth / aspectRatio;
    
    setImageSize({ width: screenWidth, height: displayHeight });
    
    // 重新計算裁切區域
    setCropArea({
      x: screenWidth * 0.1,
      y: displayHeight * 0.2,
      width: screenWidth * 0.8,
      height: displayHeight * 0.5,
    });
  };

  const handleTouchStart = (event) => {
    const { locationX, locationY } = event.nativeEvent;
    setIsDragging(true);
    setDragStart({ x: locationX, y: locationY });
  };

  const handleTouchMove = (event) => {
    if (!isDragging) return;
    
    const { locationX, locationY } = event.nativeEvent;
    const deltaX = locationX - dragStart.x;
    const deltaY = locationY - dragStart.y;
    
    setCropArea(prev => ({
      ...prev,
      x: Math.max(0, Math.min(imageSize.width - prev.width, prev.x + deltaX)),
      y: Math.max(0, Math.min(imageSize.height - prev.height, prev.y + deltaY)),
    }));
    
    setDragStart({ x: locationX, y: locationY });
  };

  const handleTouchEnd = () => {
    setIsDragging(false);
  };

  const handleConfirm = () => {
    const relativeCrop = getRelativeCrop();
    onCrop(relativeCrop);
  };

  const handleCancel = () => {
    Alert.alert(
      '取消裁切',
      '確定要取消裁切嗎？',
      [
        { text: '繼續裁切', style: 'cancel' },
        { text: '確定取消', onPress: onCancel },
      ]
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>調整裁切區域</Text>
        <Text style={styles.subtitle}>拖曳框選明細區域，提升辨識準確度</Text>
      </View>

      <View style={styles.imageContainer}>
        <Image
          source={{ uri }}
          style={[styles.image, { height: imageSize.height }]}
          resizeMode="contain"
          onLoad={handleImageLoad}
        />
        
        {/* 裁切框 */}
        <View
          style={[
            styles.cropBox,
            {
              left: cropArea.x,
              top: cropArea.y,
              width: cropArea.width,
              height: cropArea.height,
            },
          ]}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          {/* 角落指示器 */}
          <View style={[styles.corner, styles.topLeft]} />
          <View style={[styles.corner, styles.topRight]} />
          <View style={[styles.corner, styles.bottomLeft]} />
          <View style={[styles.corner, styles.bottomRight]} />
        </View>

        {/* 遮罩 */}
        <View style={[styles.overlay, { height: imageSize.height }]}>
          <View style={[styles.mask, { height: cropArea.y }]} />
          <View style={styles.maskRow}>
            <View style={[styles.mask, { width: cropArea.x }]} />
            <View style={[styles.mask, { width: imageSize.width - cropArea.x - cropArea.width }]} />
          </View>
          <View style={[styles.mask, { height: imageSize.height - cropArea.y - cropArea.height }]} />
        </View>
      </View>

      <View style={styles.controls}>
        <TouchableOpacity style={styles.button} onPress={handleCancel}>
          <MaterialCommunityIcons name="close" size={20} color="#fff" />
          <Text style={styles.buttonText}>取消</Text>
        </TouchableOpacity>
        
        <TouchableOpacity style={[styles.button, styles.confirmButton]} onPress={handleConfirm}>
          <MaterialCommunityIcons name="check" size={20} color="#fff" />
          <Text style={styles.buttonText}>確認裁切</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  header: {
    padding: 20,
    paddingTop: 40,
  },
  title: {
    color: '#fff',
    fontSize: 20,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  subtitle: {
    color: '#ccc',
    fontSize: 14,
    textAlign: 'center',
    marginTop: 8,
  },
  imageContainer: {
    flex: 1,
    position: 'relative',
  },
  image: {
    width: screenWidth,
  },
  cropBox: {
    position: 'absolute',
    borderWidth: 2,
    borderColor: '#00ff00',
    backgroundColor: 'transparent',
  },
  corner: {
    position: 'absolute',
    width: 20,
    height: 20,
    borderColor: '#00ff00',
    borderWidth: 3,
  },
  topLeft: {
    top: -2,
    left: -2,
    borderRightWidth: 0,
    borderBottomWidth: 0,
  },
  topRight: {
    top: -2,
    right: -2,
    borderLeftWidth: 0,
    borderBottomWidth: 0,
  },
  bottomLeft: {
    bottom: -2,
    left: -2,
    borderRightWidth: 0,
    borderTopWidth: 0,
  },
  bottomRight: {
    bottom: -2,
    right: -2,
    borderLeftWidth: 0,
    borderTopWidth: 0,
  },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    pointerEvents: 'none',
  },
  mask: {
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  maskRow: {
    flexDirection: 'row',
    height: '100%',
  },
  controls: {
    flexDirection: 'row',
    padding: 20,
    gap: 15,
  },
  button: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 15,
    borderRadius: 8,
    backgroundColor: '#666',
    gap: 8,
  },
  confirmButton: {
    backgroundColor: '#00aa00',
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
