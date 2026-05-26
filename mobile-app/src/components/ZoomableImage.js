import React, { useRef, useState, useEffect } from 'react';
import { View, Image, PanResponder, Animated, Dimensions, StyleSheet, Pressable } from 'react-native';

const { width: screenWidth, height: screenHeight } = Dimensions.get('window');

export default function ZoomableImage({ source, onTap, onZoomStateChange, style }) {
  const scale = useRef(new Animated.Value(1)).current;
  const translate = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  
  // Track raw values for boundary checking and gestures
  const scaleVal = useRef(1);
  const translateVal = useRef({ x: 0, y: 0 });
  
  useEffect(() => {
    const scaleId = scale.addListener((v) => { scaleVal.current = v.value; });
    const translateId = translate.addListener((v) => { translateVal.current = v; });
    return () => {
      scale.removeListener(scaleId);
      translate.removeListener(translateId);
    };
  }, []);

  // Double tap and single tap timers
  const lastTap = useRef(0);
  const singleTapTimeout = useRef(null);

  // Touch tracking
  const initialDistance = useRef(null);
  const initialScale = useRef(1);
  const initialTranslate = useRef({ x: 0, y: 0 });
  const isZoomed = useRef(false);

  const updateZoomState = (zoomed) => {
    if (isZoomed.current !== zoomed) {
      isZoomed.current = zoomed;
      if (onZoomStateChange) {
        onZoomStateChange(zoomed);
      }
    }
  };

  const reset = (animated = true) => {
    updateZoomState(false);
    if (animated) {
      Animated.parallel([
        Animated.timing(scale, { toValue: 1, duration: 250, useNativeDriver: true }),
        Animated.timing(translate, { toValue: { x: 0, y: 0 }, duration: 250, useNativeDriver: true })
      ]).start();
    } else {
      scale.setValue(1);
      translate.setValue({ x: 0, y: 0 });
    }
  };

  // Reset scale and translation when source URI changes (user swipes to next image)
  const sourceUri = source?.uri;
  useEffect(() => {
    reset(false);
  }, [sourceUri]);

  const handleDoubleTap = () => {
    if (scaleVal.current > 1.1) {
      reset(true);
    } else {
      updateZoomState(true);
      Animated.parallel([
        Animated.timing(scale, { toValue: 2.5, duration: 250, useNativeDriver: true }),
        Animated.timing(translate, { toValue: { x: 0, y: 0 }, duration: 250, useNativeDriver: true })
      ]).start();
    }
  };

  const handlePress = () => {
    const now = Date.now();
    if (now - lastTap.current < 300) {
      // Double Tap detected
      if (singleTapTimeout.current) {
        clearTimeout(singleTapTimeout.current);
        singleTapTimeout.current = null;
      }
      handleDoubleTap();
      lastTap.current = 0; // Prevent rapid-tap loops
    } else {
      // Schedule Single Tap
      lastTap.current = now;
      singleTapTimeout.current = setTimeout(() => {
        if (onTap) onTap();
        singleTapTimeout.current = null;
      }, 250);
    }
  };

  const getDistance = (touches) => {
    if (touches.length < 2) return 0;
    const dx = touches[0].pageX - touches[1].pageX;
    const dy = touches[0].pageY - touches[1].pageY;
    return Math.sqrt(dx * dx + dy * dy);
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false, // Allow taps to bubble up to Pressable on start
      onMoveShouldSetPanResponder: (evt, gestureState) => {
        // Claim responder on move if pinching or already zoomed in
        const isPinch = gestureState.numberActiveTouches >= 2;
        const isPanning = scaleVal.current > 1.1;
        return isPinch || isPanning;
      },
      onPanResponderGrant: (evt, gestureState) => {
        const touches = evt.nativeEvent.touches;
        if (touches && touches.length >= 2) {
          initialDistance.current = getDistance(touches);
          initialScale.current = scaleVal.current;
        } else {
          initialDistance.current = null;
        }
        
        initialTranslate.current = { x: translateVal.current.x, y: translateVal.current.y };
        translate.setOffset({ x: translateVal.current.x, y: translateVal.current.y });
        translate.setValue({ x: 0, y: 0 });
      },
      onPanResponderMove: (evt, gestureState) => {
        const touches = evt.nativeEvent.touches;
        if (gestureState.numberActiveTouches >= 2 && touches && touches.length >= 2) {
          // Initialize distance dynamically if it wasn't captured on Grant
          if (!initialDistance.current) {
            initialDistance.current = getDistance(touches);
            initialScale.current = scaleVal.current;
          } else {
            const currentDist = getDistance(touches);
            if (currentDist > 0) {
              let newScale = initialScale.current * (currentDist / initialDistance.current);
              newScale = Math.max(1, Math.min(newScale, 4));
              scale.setValue(newScale);
              // Note: We do NOT call updateZoomState(true) here mid-gesture to prevent Android ScrollView cancel resets.
            }
          }
        } else {
          initialDistance.current = null;
          
          if (gestureState.numberActiveTouches === 1 && scaleVal.current > 1.1) {
            const currentScale = scaleVal.current;
            const maxTx = (screenWidth * (currentScale - 1)) / 2;
            const maxTy = (screenHeight * (currentScale - 1)) / 2;
            
            let nextX = initialTranslate.current.x + gestureState.dx;
            let nextY = initialTranslate.current.y + gestureState.dy;

            nextX = Math.max(-maxTx, Math.min(nextX, maxTx));
            nextY = Math.max(-maxTy, Math.min(nextY, maxTy));
            
            translate.setValue({
              x: nextX - initialTranslate.current.x,
              y: nextY - initialTranslate.current.y
            });
          }
        }
      },
      onPanResponderRelease: (evt, gestureState) => {
        translate.flattenOffset();
        
        // Defer updating isZoomed state to release phase, preventing Android touch cancels
        updateZoomState(scaleVal.current > 1.1);

        if (scaleVal.current < 1.1) {
          reset(true);
        } else {
          const currentScale = scaleVal.current;
          const maxTx = (screenWidth * (currentScale - 1)) / 2;
          const maxTy = (screenHeight * (currentScale - 1)) / 2;
          
          let targetX = translateVal.current.x;
          let targetY = translateVal.current.y;
          
          let needAdjust = false;
          if (targetX < -maxTx) { targetX = -maxTx; needAdjust = true; }
          if (targetX > maxTx) { targetX = maxTx; needAdjust = true; }
          if (targetY < -maxTy) { targetY = -maxTy; needAdjust = true; }
          if (targetY > maxTy) { targetY = maxTy; needAdjust = true; }
          
          if (needAdjust) {
            Animated.timing(translate, {
              toValue: { x: targetX, y: targetY },
              duration: 150,
              useNativeDriver: true
            }).start();
          }
        }
      },
      onPanResponderTerminate: () => {
        translate.flattenOffset();
        if (scaleVal.current < 1.1) {
          reset(true);
        }
      }
    })
  ).current;

  return (
    <Pressable style={styles.container} onPress={handlePress}>
      <View style={styles.container} {...panResponder.panHandlers}>
        <Animated.Image
          source={source}
          style={[
            style,
            {
              transform: [
                { scale: scale },
                { translateX: translate.x },
                { translateY: translate.y }
              ]
            }
          ]}
          resizeMode="contain"
        />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    width: screenWidth,
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  }
});
