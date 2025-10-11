import React, { useRef, useState } from 'react';
import { View, StyleSheet, Alert } from 'react-native';
import Button from '@/app/components/Button';
import * as Location from 'expo-location';

type TrackPoint = { latitude: number; longitude: number; timestamp: number };

export default function Index() {
    const [isRecording, setIsRecording] = useState(false);
    const [track, setTrack] = useState<TrackPoint[]>([]);
    const pollRef = useRef<number | null>(null);

    const startRecording = async () => {
        if (isRecording) return;

        // 1) Ask for foreground location permission
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') {
            Alert.alert('Permission needed', 'Location permission is required to record a garden.');
            return;
        }

        setIsRecording(true);
        setTrack([]);

        pollRef.current = setInterval(async () => {
            try {
                const pos = await Location.getCurrentPositionAsync({
                    accuracy: Location.Accuracy.High,
                });
                setTrack((prev) => [
                    ...prev,
                    {
                        latitude: pos.coords.latitude,
                        longitude: pos.coords.longitude,
                        timestamp: pos.timestamp ?? Date.now(),
                    },
                ]);
                console.log("position: time: " + pos.timestamp + " Lat: " + pos.coords.latitude + " Long: " + pos.coords.longitude);
            } catch (e) {
                console.warn('Location poll failed:', e);
            }
        }, 1000);
    };

    const stopRecording = () => {
        if (pollRef.current) {
            clearInterval(pollRef.current);
            pollRef.current = null;
        }
        setIsRecording(false);
        // TODO: persist `track` to file or pass to next screen
    };

    return (
        <View style={styles.container}>
            <View style={styles.footerContainer}>
                <Button theme="primary" label="Record a Garden" onPress={() => startRecording()}/>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#25292e',
        alignItems: 'center',
        verticalAlign: 'middle',
    },
    imageContainer: {
        flex: 1,
    },
    footerContainer: {
        flex: 1 / 3,
        alignItems: 'center',
    },
});
