import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { styled } from 'nativewind';

const StyledView = styled(View);
const StyledText = styled(Text);
const StyledTouchableOpacity = styled(TouchableOpacity);

interface HomeScreenProps {
  onStartRecording: () => void;
  isCameraReady: boolean;
}

const HomeScreen: React.FC<HomeScreenProps> = ({ onStartRecording, isCameraReady }) => {
  return (
    <StyledView className="p-5 text-center items-center">
      <StyledText className="text-xl font-bold text-gray-800 mb-2">Garden Walkthrough</StyledText>
      <StyledText className="text-gray-600 text-center">
        Record a short video walkthrough of your garden while describing the changes you made.
      </StyledText>
      <StyledTouchableOpacity
        onPress={onStartRecording}
        className="bg-green-600 px-4 py-3 rounded-lg mt-3 w-full"
        activeOpacity={0.7}
        disabled={!isCameraReady}
        style={{ opacity: isCameraReady ? 1 : 0.6 }}
      >
        <StyledText className="text-white text-base font-semibold text-center">
          Start Walkthrough Recording
        </StyledText>
      </StyledTouchableOpacity>
      {!isCameraReady && (
        <StyledText className="text-xs text-gray-500 mt-2">
          Initialising camera... you can start recording in a moment.
        </StyledText>
      )}
    </StyledView>
  );
};

export default HomeScreen;
