import { useEffect } from 'react';
import { StyleSheet, Text } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

export function HelloWave() {
  const rotation = useSharedValue(0);

  useEffect(() => {
    rotation.value = withRepeat(
      withSequence(
        withTiming(25, { duration: 150 }),
        withTiming(0, { duration: 150 })
      ),
      4
    );
  }, [rotation]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.value}deg` }],
  }));

  return (
    <Animated.View style={animatedStyle}>
      <Text style={styles.text}>👋</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  text: { fontSize: 28, lineHeight: 32, marginTop: -6 },
});
