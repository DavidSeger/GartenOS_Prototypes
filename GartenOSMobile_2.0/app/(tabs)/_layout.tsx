import { Tabs } from 'expo-router';

import Ionicons from '@expo/vector-icons/Ionicons';

export default function TabLayout() {
    return (
        <Tabs
            screenOptions={{
                tabBarActiveTintColor: '#22c55e',
                tabBarInactiveTintColor: '#cbd5c5',
                headerStyle: {
                    backgroundColor: '#0f2f1f',
                },
                headerShadowVisible: false,
                headerTintColor: '#e9f5ec',
                headerTitleStyle: {
                    fontWeight: '700',
                    letterSpacing: 0.4,
                },
                tabBarStyle: {
                    backgroundColor: '#0f2f1f',
                    borderTopColor: '#1f4f33',
                },
                tabBarLabelStyle: {
                    fontWeight: '700',
                    fontSize: 12,
                    letterSpacing: 0.2,
                },
            }}
        >

            <Tabs.Screen
                name="index"
                options={{
                    title: 'Record Garden',
                    tabBarIcon: ({ color, focused }) => (
                        <Ionicons name={focused ? 'leaf' : 'leaf-outline'} color={color} size={24}/>
                    ),
                }}
            />
            <Tabs.Screen
                name="RecordedGardens"
                options={{
                    title: 'Recorded Gardens',
                    tabBarIcon: ({ color, focused }) => (
                        <Ionicons name={focused ? 'albums' : 'albums-outline'} color={color} size={24}/>
                    ),
                }}
            />
        </Tabs>
    );
}
