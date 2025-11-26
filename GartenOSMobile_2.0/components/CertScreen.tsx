import React, { useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, Alert } from 'react-native';
import { styled } from 'nativewind';
import { Screen } from '../types';
import InfoButton from './InfoButton';

const StyledView = styled(View);
const StyledText = styled(Text);
const StyledTouchableOpacity = styled(TouchableOpacity);
const StyledScrollView = styled(ScrollView);

interface CertScreenProps {
  transcript: string;
  onNavigate: (screen: Screen) => void;
  onSubmit: () => void;
}

const KeyValue: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <StyledView className="flex-row justify-between border-b border-dashed border-green-200 py-1.5 last:border-b-0">
    <StyledText className="text-sm">{label}</StyledText>
    <StyledText className="font-semibold text-green-700">{value}</StyledText>
  </StyledView>
);

const CertScreen: React.FC<CertScreenProps> = ({ transcript, onNavigate, onSubmit }) => {
  const [proofFrames, setProofFrames] = useState<number[]>([]);
  const confirmSubmit = () => {
    Alert.alert('Submit certification?', 'Send your walkthrough, transcript, and proof for pro review now.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Submit', onPress: onSubmit },
    ]);
  };

  const captureProof = () => {
    setProofFrames((prev) => {
      const nextIndex = prev.length;
      const newFrames = Array.from({ length: 3 }, (_, idx) => nextIndex + idx + 1);
      return [...prev, ...newFrames];
    });
  };

  return (
    <StyledScrollView>
      <StyledView className="p-5 items-center">
        <StyledView className="flex-row items-center mb-2">
          <StyledText className="text-xl font-bold text-gray-800 mr-2">Certifications</StyledText>
          <InfoButton
            label="Certifications"
            message="Review your criteria, proofs, and submit for pro review."
            color="#166534"
          />
        </StyledView>
        <StyledView className="space-y-3 w-full">
          <StyledView className="bg-green-50/70 border border-green-200 rounded-xl p-3">
            <StyledText className="text-xs text-indigo-900 opacity-80 mb-1 font-semibold">
              Criteria Snapshot
            </StyledText>
            <KeyValue label="Native species (min 3)" value="Met" />
            <KeyValue label="Water source available" value="Met" />
            <KeyValue label="Shelter or habitat feature" value="Met" />
            <KeyValue label="Evidence attached" value="Video + Transcript" />
          </StyledView>
          <StyledView className="bg-green-50/70 border border-green-200 rounded-xl p-3">
            <StyledText className="text-xs text-indigo-900 opacity-80 mb-1 font-semibold">
              Transcript Used for Proof
            </StyledText>
            <StyledView className="bg-gray-100 p-3 rounded-lg my-2 max-h-28">
              <ScrollView nestedScrollEnabled>
                <StyledText className="text-sm">{transcript}</StyledText>
              </ScrollView>
            </StyledView>
            <StyledView className="items-center">
              <StyledTouchableOpacity
                onPress={captureProof}
                className="bg-white border border-green-200 px-4 py-2 rounded-lg"
                activeOpacity={0.7}
              >
                <StyledView className="flex-row items-center">
                  <StyledText className="text-green-800 text-sm font-semibold">
                    Capture proof screenshot
                  </StyledText>
                  <InfoButton
                    label="Capture proof screenshot"
                    message="Grab a few frames to attach as visual proof for your submission."
                    color="#166534"
                    style={{ marginLeft: 6 }}
                  />
                </StyledView>
              </StyledTouchableOpacity>
            </StyledView>
            {proofFrames.length > 0 && (
              <StyledView className="flex-row gap-2 flex-wrap mt-2.5">
                {proofFrames.map((frame) => (
                  <StyledView
                    key={frame}
                    className="w-28 h-16 bg-green-100 border border-green-200 rounded-lg items-center justify-center"
                  >
                    <StyledText className="text-xs text-green-800">Frame {frame}</StyledText>
                  </StyledView>
                ))}
              </StyledView>
            )}
          </StyledView>
          <StyledView className="bg-green-50/70 border border-green-200 rounded-xl p-3">
            <StyledView className="bg-green-800 rounded-lg px-2 py-0.5 self-start">
              <StyledText className="text-white text-xs font-semibold">Bronze tier ready</StyledText>
            </StyledView>
            <StyledText className="text-sm mt-2">
              All minimum criteria are met. Submit to pro review to issue the certificate.
            </StyledText>
          </StyledView>
        </StyledView>
        <StyledView className="flex-row gap-2 justify-center mt-4">
          <StyledTouchableOpacity
            onPress={() => onNavigate(Screen.Measurement)}
            className="bg-green-100 border border-green-200 px-4 py-3 rounded-lg flex-1"
            activeOpacity={0.7}
          >
            <StyledText className="text-green-800 text-base font-semibold text-center">Back</StyledText>
          </StyledTouchableOpacity>
          <StyledTouchableOpacity
            onPress={confirmSubmit}
            className="bg-green-600 px-4 py-3 rounded-lg flex-1"
            activeOpacity={0.7}
          >
            <StyledView className="flex-row items-center justify-center">
              <StyledText className="text-white text-base font-semibold text-center">
                Submit
              </StyledText>
              <InfoButton
                label="Submit"
                message="Send your walkthrough, transcript, and proof for pro review and certification."
                color="#ecfdf3"
                style={{ marginLeft: 6 }}
              />
            </StyledView>
          </StyledTouchableOpacity>
        </StyledView>
      </StyledView>
    </StyledScrollView>
  );
};

export default CertScreen;
