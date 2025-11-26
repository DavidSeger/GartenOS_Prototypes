import React from 'react';
import { Alert, StyleProp, TouchableOpacity, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

type InfoButtonProps = {
  label: string;
  message: string;
  size?: number;
  color?: string;
  style?: StyleProp<ViewStyle>;
};

const InfoButton: React.FC<InfoButtonProps> = ({
  label,
  message,
  size = 18,
  color = '#166534',
  style,
}) => {
  return (
    <TouchableOpacity
      onPress={() => Alert.alert(label, message)}
      hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
      accessibilityRole="button"
      accessibilityLabel={`${label} info`}
      accessibilityHint="Shows a brief explanation"
      style={[{ paddingHorizontal: 4, paddingVertical: 2 }, style]}
    >
      <Ionicons name="information-circle-outline" size={size} color={color} />
    </TouchableOpacity>
  );
};

export default InfoButton;
