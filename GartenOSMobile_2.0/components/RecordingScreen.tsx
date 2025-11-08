import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';

interface RecordingScreenProps {
  elapsedSeconds: number;
  isPauseSupported: boolean;
  isPaused: boolean;
  onPause: () => void;
  onStop: () => void;
  isStoppingDisabled?: boolean;
  onMarkCorner: () => void;
  isMarkingCorner: boolean;
  cornerCount: number;
  onClosePolygon: () => void;
  canClosePolygon: boolean;
}

const formatTime = (totalSeconds: number) => {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = String(totalSeconds % 60).padStart(2, '0');
  return `${minutes}:${seconds}`;
};

const RecordingScreen: React.FC<RecordingScreenProps> = ({
                                                           elapsedSeconds,
                                                           isPauseSupported,
                                                           isPaused,
                                                           onPause,
                                                           onStop,
                                                           isStoppingDisabled = false,
                                                           onMarkCorner,
                                                           isMarkingCorner,
                                                           cornerCount,
                                                           onClosePolygon,
                                                           canClosePolygon,
                                                         }) => {
  const [cornerCountdown, setCornerCountdown] = useState(15);

  useEffect(() => {
    let timer: NodeJS.Timeout | null = null;

    if (isMarkingCorner) {
      setCornerCountdown(15);
      timer = setInterval(() => {
        setCornerCountdown((prev) => {
          if (prev <= 1) {
            if (timer) clearInterval(timer);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    } else {
      setCornerCountdown(15);
    }

    return () => {
      if (timer) clearInterval(timer);
    };
  }, [isMarkingCorner]);

  return (
      <View style={styles.overlay} pointerEvents="box-none">
        <View style={styles.header} pointerEvents="none">
          <Text style={styles.recordingLabel}>Recording...</Text>
          <Text style={styles.subLabel}>Capture your walkthrough while you narrate.</Text>
        </View>

        <View style={styles.bottomPanel} pointerEvents="box-none">
          <View style={styles.metaRow} pointerEvents="none">
            <View style={styles.metaCard}>
              <Text style={styles.metaLabel}>Elapsed</Text>
              <Text style={styles.metaValue}>{formatTime(elapsedSeconds)}</Text>
            </View>
          </View>

          <View style={styles.actionsRow} pointerEvents="box-none">
            <TouchableOpacity
                onPress={onPause}
                style={[
                  styles.primaryButton,
                  (!isPauseSupported || isStoppingDisabled) && styles.disabledButton,
                ]}
                activeOpacity={0.85}
                disabled={!isPauseSupported || isStoppingDisabled}
            >
              <View style={styles.buttonHeader}>
                <View style={[styles.pauseBadge, isPaused && styles.pauseBadgePaused]}>
                  <View style={[styles.pauseGlyph, isPaused && styles.pauseGlyphPaused]} />
                </View>
                <Text style={styles.primaryText}>{isPaused ? 'Resume' : 'Pause'}</Text>
              </View>
              <Text style={styles.primarySubText}>
                {isPaused ? 'Tap to continue recording' : 'Take a breather'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
                onPress={() => {
                  if (canClosePolygon) {
                    onClosePolygon();
                  }
                  onStop();
                }}
                style={[styles.stopButton, isStoppingDisabled && styles.disabledButton]}
                activeOpacity={0.85}
                disabled={isStoppingDisabled}
            >
              <View style={styles.buttonHeader}>
                <View style={styles.stopBadge}>
                  <View style={styles.stopGlyph} />
                </View>
                <Text style={styles.stopText}>Stop</Text>
              </View>
              <Text style={styles.stopSubText}>
                {canClosePolygon
                    ? 'Close area and save this take'
                    : 'Save this take and review'}
              </Text>
            </TouchableOpacity>
          </View>

          <View style={styles.cornerRow} pointerEvents="box-none">
            <TouchableOpacity
                onPress={onMarkCorner}
                style={[
                  styles.cornerButton,
                  (isMarkingCorner || isStoppingDisabled) && styles.disabledButton,
                ]}
                activeOpacity={0.85}
                disabled={isMarkingCorner || isStoppingDisabled}
            >
              <Text style={styles.cornerTitle}>
                {isMarkingCorner
                    ? `Averaging corner… ${cornerCountdown}s`
                    : 'Mark corner (15s)'}
              </Text>
              <Text style={styles.cornerSubtitle}>
                {isMarkingCorner
                    ? 'Hold steady while we capture GPS'
                    : 'Stand still at each corner and tap to sample'}
              </Text>
            </TouchableOpacity>
          </View>

          {!isPauseSupported && (
              <Text style={styles.helperText}>
                Pause isn't available on this device. Stop when you're ready to review.
              </Text>
          )}
          <Text style={[styles.helperText, { marginTop: 6 }]}>
            Corners captured: {cornerCount}
            {canClosePolygon ? ' • Press stop to close Area' : ''}
          </Text>
        </View>
      </View>
  );
};

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    padding: 20,
    justifyContent: 'space-between',
    backgroundColor: 'transparent',
  },
  header: {
    alignItems: 'center',
    marginTop: 12,
  },
  recordingLabel: {
    fontSize: 24,
    fontWeight: '700',
    color: '#ffffff',
    textShadowColor: 'rgba(0,0,0,0.75)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 6,
  },
  subLabel: {
    marginTop: 6,
    fontSize: 14,
    color: 'rgba(255,255,255,0.85)',
  },
  bottomPanel: {
    width: '100%',
    // faint bg so text/buttons stand out on camera
    backgroundColor: 'rgba(15, 23, 42, 0.35)',
    borderRadius: 18,
    padding: 12,
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    columnGap: 12,
    marginBottom: 18,
  },
  metaCard: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.9)',
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(148, 163, 184, 0.35)',
  },
  metaLabel: {
    fontSize: 11,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: 'rgba(226, 232, 240, 0.7)',
  },
  metaValue: {
    marginTop: 4,
    fontSize: 16,
    fontWeight: '700',
    color: '#ffffff',
  },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    columnGap: 12,
  },
  primaryButton: {
    flex: 1,
    backgroundColor: '#0f766e', // solid teal
    borderRadius: 18,
    paddingVertical: 18,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: 'rgba(13, 148, 136, 0.55)',
  },
  buttonHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: 14,
  },
  pauseBadge: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#22c55e',
    justifyContent: 'center',
    alignItems: 'center',
  },
  pauseBadgePaused: {
    backgroundColor: '#f97316',
  },
  pauseGlyph: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: '#bbf7d0',
  },
  pauseGlyphPaused: {
    borderColor: '#ffedd5',
    transform: [{ rotate: '45deg' }],
  },
  primaryText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 17,
  },
  primarySubText: {
    marginTop: 10,
    color: 'rgba(241, 245, 249, 0.85)',
    fontSize: 13,
  },
  stopButton: {
    flex: 1,
    backgroundColor: '#ef4444',
    borderRadius: 18,
    paddingVertical: 18,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: 'rgba(248, 113, 113, 0.6)',
  },
  stopBadge: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(254, 226, 226, 0.25)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  stopGlyph: {
    width: 14,
    height: 14,
    borderRadius: 4,
    backgroundColor: '#fee2e2',
  },
  stopText: {
    color: '#ffffff',
    fontSize: 17,
    fontWeight: '700',
  },
  stopSubText: {
    marginTop: 10,
    fontSize: 12,
    color: 'rgba(255,255,255,0.85)',
  },
  helperText: {
    marginTop: 12,
    textAlign: 'center',
    fontSize: 12,
    color: 'rgba(255,255,255,0.9)',
  },
  disabledButton: {
    opacity: 0.55,
  },
  cornerRow: {
    marginTop: 18,
    flexDirection: 'column',
    rowGap: 12,
  },
  cornerButton: {
    backgroundColor: '#d1fae5',
    borderRadius: 16,
    paddingVertical: 16,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: '#6ee7b7',
  },
  cornerTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#064e3b',
  },
  cornerSubtitle: {
    marginTop: 6,
    fontSize: 12,
    color: '#047857',
  },
});

export default RecordingScreen;
