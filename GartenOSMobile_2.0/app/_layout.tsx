
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import "../global.css";

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <Stack>
        <Stack.Screen name="index" options={{ headerShown: false }} />
      </Stack>
    </SafeAreaProvider>
  );
}
