import React from 'react';
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
          {/* <View style={styles.metaCard}>
            <Text style={styles.metaLabel}>GPS</Text>
            <Text style={styles.metaValue}>Synced</Text>
          </View>
          <View style={styles.metaCard}>
            <Text style={styles.metaLabel}>Audio</Text>
            <Text style={styles.metaValue}>Live</Text>
          </View> */}
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
            onPress={onStop}
            style={[styles.stopButton, isStoppingDisabled && styles.disabledButton]}
            activeOpacity={0.85}
            disabled={isStoppingDisabled}
          >
            <View style={styles.buttonHeader}>
              <View style={styles.stopBadge}>
                <View style={styles.stopGlyph} />
              </View>
              <Text style={styles.stopText}>Stop & Continue</Text>
            </View>
            <Text style={styles.stopSubText}>Save this take and review</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.cornerRow} pointerEvents="box-none">
          <TouchableOpacity
            onPress={onMarkCorner}
            style={[styles.cornerButton, (isMarkingCorner || isStoppingDisabled) && styles.disabledButton]}
            activeOpacity={0.85}
            disabled={isMarkingCorner || isStoppingDisabled}
          >
            <Text style={styles.cornerTitle}>{isMarkingCorner ? 'Averaging corner…' : 'Mark corner (10s)'}</Text>
            <Text style={styles.cornerSubtitle}>
              {isMarkingCorner ? 'Hold steady while we capture GPS' : 'Stand still at each corner and tap to sample'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={onClosePolygon}
            style={[
              styles.cornerButton,
              !canClosePolygon && styles.disabledButton,
              { backgroundColor: 'rgba(37, 99, 235, 0.1)', borderColor: 'rgba(59, 130, 246, 0.4)' },
            ]}
            activeOpacity={0.85}
            disabled={!canClosePolygon}
          >
            <Text style={styles.cornerTitle}>Close area</Text>
            <Text style={styles.cornerSubtitle}>Connect first and last corner to calculate area</Text>
          </TouchableOpacity>
        </View>

        {!isPauseSupported && (
          <Text style={styles.helperText}>
            Pause isn't available on this device. Stop when you're ready to review.
          </Text>
        )}
        <Text style={[styles.helperText, { marginTop: 6 }]}>
          Corners captured: {cornerCount}
          {canClosePolygon ? ' • Ready to close' : ''}
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
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    columnGap: 12,
    marginBottom: 18,
  },
  metaCard: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.55)',
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
  bottomPanel: {
    width: '100%',
  },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    columnGap: 16,
  },
  primaryButton: {
    flex: 1,
    backgroundColor: 'rgba(15, 118, 110, 0.12)',
    borderRadius: 18,
    paddingVertical: 20,
    paddingHorizontal: 18,
    borderWidth: 1,
    borderColor: 'rgba(13, 148, 136, 0.45)',
  },
  buttonHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: 14,
  },
  pauseBadge: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#22c55e',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: 'rgba(34, 197, 94, 0.45)',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 10,
    elevation: 3,
  },
  pauseBadgePaused: {
    backgroundColor: '#f97316',
    shadowColor: 'rgba(249, 115, 22, 0.45)',
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
    color: '#0f172a',
    fontWeight: '700',
    fontSize: 17,
  },
  primarySubText: {
    marginTop: 10,
    color: '#037971',
    fontSize: 13,
  },
  stopButton: {
    flex: 1,
    backgroundColor: 'rgba(248, 113, 113, 0.12)',
    borderRadius: 18,
    paddingVertical: 20,
    paddingHorizontal: 18,
    borderWidth: 1,
    borderColor: 'rgba(248, 113, 113, 0.5)',
  },
  stopBadge: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#ef4444',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: 'rgba(239, 68, 68, 0.45)',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 10,
    elevation: 3,
  },
  stopGlyph: {
    width: 18,
    height: 18,
    borderRadius: 6,
    backgroundColor: '#fee2e2',
  },
  stopText: {
    color: '#7f1d1d',
    fontSize: 17,
    fontWeight: '700',
  },
  stopSubText: {
    marginTop: 10,
    fontSize: 12,
    color: '#be123c',
  },
  helperText: {
    marginTop: 12,
    textAlign: 'center',
    fontSize: 12,
    color: 'rgba(255,255,255,0.9)',
  },
  disabledButton: {
    opacity: 0.6,
  },
  cornerRow: {
    marginTop: 18,
    flexDirection: 'column',
    rowGap: 12,
  },
  cornerButton: {
    backgroundColor: 'rgba(15, 118, 110, 0.12)',
    borderRadius: 18,
    paddingVertical: 16,
    paddingHorizontal: 18,
    borderWidth: 1,
    borderColor: 'rgba(13, 148, 136, 0.45)',
  },
  cornerTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0f172a',
  },
  cornerSubtitle: {
    marginTop: 6,
    fontSize: 12,
    color: '#0f766e',
  },
});

export default RecordingScreen;
