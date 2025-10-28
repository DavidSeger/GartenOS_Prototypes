import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { styled } from 'nativewind';

const StyledView = styled(View);
const StyledText = styled(Text);
const StyledTouchableOpacity = styled(TouchableOpacity);

interface SubmittedScreenProps {
  onStartOver: () => void;
}

const SubmittedScreen: React.FC<SubmittedScreenProps> = ({ onStartOver }) => {
  return (
    <StyledView className="p-5 items-center">
      <StyledText className="text-xl font-bold text-gray-800 mb-2">Submission Complete</StyledText>
      <StyledText className="text-lg text-green-600 font-semibold my-4">
        Great! Your walkthrough has been sent for review.
      </StyledText>
      <StyledText className="bg-green-100 border border-green-200 text-green-800 rounded-full px-3 py-1 text-sm">
        Ref: DEMO-#A21F
      </StyledText>
      <StyledView className="mt-4">
        <StyledTouchableOpacity
          onPress={onStartOver}
          className="bg-green-100 border border-green-200 px-4 py-3 rounded-lg"
          activeOpacity={0.7}
        >
          <StyledText className="text-green-800 text-base font-semibold">Start Over</StyledText>
        </StyledTouchableOpacity>
      </StyledView>
    </StyledView>
  );
};

export default SubmittedScreen;
