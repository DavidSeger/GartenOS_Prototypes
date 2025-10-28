import React from 'react';
import { View, Text, TouchableOpacity, ScrollView } from 'react-native';
import { Svg, Rect, Circle, Text as SvgText } from 'react-native-svg';
import { styled } from 'nativewind';
import { Screen } from '../types';

const StyledView = styled(View);
const StyledText = styled(Text);
const StyledTouchableOpacity = styled(TouchableOpacity);

interface MeasurementScreenProps {
  onNavigate: (screen: Screen) => void;
}

const KeyValue: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <StyledView className="flex-row justify-between border-b border-dashed border-green-200 py-1.5 last:border-b-0">
    <StyledText>{label}</StyledText>
    <StyledText className="font-semibold text-gray-700">{value}</StyledText>
  </StyledView>
);

const InfoGroup: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <StyledView className="bg-white border border-green-200 rounded-lg p-3 flex-1">
    <StyledText className="text-xs text-indigo-900 opacity-80 mb-1 font-semibold">{title}</StyledText>
    {children}
  </StyledView>
);

const MeasurementScreen: React.FC<MeasurementScreenProps> = ({ onNavigate }) => {
  return (
    <ScrollView>
      <StyledView className="p-5 items-center">
        <StyledText className="text-xl font-bold text-gray-800 mb-2">Measurements & Map</StyledText>
        <StyledView className="bg-green-50/70 border border-green-200 rounded-xl p-3 w-full mt-2 space-y-3">
          <StyledView>
            <StyledText className="text-xs text-indigo-900 opacity-80 mb-1 font-semibold">
              Garden Dimensions
            </StyledText>
            <KeyValue label="Total Area" value="92.4 m^2" />
            <KeyValue label="Perimeter" value="41.0 m" />
            <KeyValue label="Approx. Span" value="12.0 m x 7.5 m" />
          </StyledView>
          <StyledView>
            <StyledText className="text-xs text-indigo-900 opacity-80 mb-1 font-semibold">Layout</StyledText>
            <StyledView className="w-full h-[220px] rounded-lg border border-green-200 bg-[#eaf6ea] overflow-hidden mt-1">
              <Svg viewBox="0 0 360 220" width="100%" height="220">
                <Rect x="14" y="12" width="332" height="196" rx="10" ry="10" fill="#eaf7ea" stroke="#bfe6c6" />
                <Rect x="26" y="26" width="160" height="70" fill="#d7f1d7" stroke="#a9d9b0" />
                <SvgText x="34" y="44" fontSize="12" fill="#2e6a3b">
                  Wildflower bed
                </SvgText>
                <Circle cx="270" cy="140" r="24" fill="#c5ebff" stroke="#7dc7e8" />
                <SvgText x="258" y="144" fontSize="12" fill="#2e6a3b">
                  Pond
                </SvgText>
                <SvgText x="70" y="110" fontSize="16">
                  Trees
                </SvgText>
                <SvgText x="180" y="90" fontSize="16">
                  Seating
                </SvgText>
                <SvgText x="300" y="60" fontSize="16">
                  Shed
                </SvgText>
                <SvgText x="20" y="200" fontSize="12" fill="#2e6a3b">
                  Legend
                </SvgText>
                <Circle cx="60" cy="195" r="4" fill="#2e6a3b" />
                <SvgText x="68" y="198" fontSize="10" fill="#2e6a3b">
                  Greenery
                </SvgText>
                <Circle cx="120" cy="195" r="4" fill="#7dc7e8" />
                <SvgText x="128" y="198" fontSize="10" fill="#2e6a3b">
                  Water
                </SvgText>
              </Svg>
            </StyledView>
            <StyledView className="flex-row gap-2.5 mt-2.5">
              <InfoGroup title="Features">
                <KeyValue label="Oak trees" value="2" />
                <KeyValue label="Wildflower bed" value="3 m^2" />
                <KeyValue label="Pond depth" value="~0.5 m" />
                <KeyValue label="Insect hotel" value="1 (shed wall)" />
              </InfoGroup>
              <InfoGroup title="Derived from">
                <KeyValue label="GPS trace" value="Yes" />
                <KeyValue label="Walkthrough video" value="Yes" />
                <KeyValue label="User transcript" value="Yes" />
              </InfoGroup>
            </StyledView>
          </StyledView>
        </StyledView>
        <StyledView className="flex-row gap-2 justify-center mt-4 px-5">
          <StyledTouchableOpacity
            onPress={() => onNavigate(Screen.Preview)}
            className="bg-green-100 border border-green-200 px-4 py-3 rounded-lg flex-1"
            activeOpacity={0.7}
          >
            <StyledText className="text-green-800 text-base font-semibold text-center">Back</StyledText>
          </StyledTouchableOpacity>
          <StyledTouchableOpacity
            onPress={() => onNavigate(Screen.Certification)}
            className="bg-green-600 px-4 py-3 rounded-lg flex-1"
            activeOpacity={0.7}
          >
            <StyledText className="text-white text-base font-semibold text-center">
              Next: Certifications
            </StyledText>
          </StyledTouchableOpacity>
        </StyledView>
      </StyledView>
    </ScrollView>
  );
};

export default MeasurementScreen;
