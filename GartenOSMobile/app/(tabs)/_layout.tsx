import { Tabs } from 'expo-router';

import Ionicons from '@expo/vector-icons/Ionicons';
export default function TabLayout() {
    return (
        <Tabs
            screenOptions={{
                tabBarActiveTintColor: '#ffd33d',
                headerStyle: {
                    backgroundColor: '#25292e',
                },
                headerShadowVisible: false,
                headerTintColor: '#fff',
                tabBarStyle: {
                    backgroundColor: '#25292e',
                },
            }}
        >

            <Tabs.Screen
                name="index"
                options={{
                    title: 'Record New Garden',
                    tabBarIcon: ({ color, focused }) => (
                        <Ionicons name={focused ? 'add-circle-outline' : 'add-circle-sharp'} color={color} size={24} />
                    ),
                }}
            />
            <Tabs.Screen
                name="RecordedGardens"
                options={{
                    title: 'RecordedGardens',
                    tabBarIcon: ({ color, focused }) => (
                        <Ionicons name={focused ? 'albums-outline' : 'albums-sharp'} color={color} size={24}/>
                    ),
                }}
            />
        </Tabs>
    );
}
