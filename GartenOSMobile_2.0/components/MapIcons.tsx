// components/MapIcons.tsx
import React from 'react';
import Svg, { G, Circle, Path } from 'react-native-svg';

export type AnnotationType = 'tree' | 'water' | string;

export function TreeIcon({ size = 16 }: { size?: number }) {
    const s = size;
    const trunkW = s * 0.2;
    const trunkH = s * 0.4;
    const canopyR = s * 0.45;
    return (
        <Svg width={s} height={s} viewBox={[-s/2, -s, s, s].join(' ')}>
            <G>
                {/* canopy */}
                <Circle cx={0} cy={-trunkH - canopyR * 0.2} r={canopyR} />
                {/* trunk (rect via path) */}
                <Path d={`M ${-trunkW/2} ${-trunkH} h ${trunkW} v ${trunkH} h ${-trunkW} Z`} />
            </G>
        </Svg>
    );
}

export function WaterIcon({ size = 16 }: { size?: number }) {
    const s = size;
    const r = s * 0.45;
    return (
        <Svg width={s} height={s} viewBox={[-s/2, -s/2, s, s].join(' ')}>
            <Path
                d={`
          M 0 ${-r}
          C ${r * 0.55} ${-r * 0.3}, ${r} ${-r * 0.05}, ${r} ${r * 0.35}
          C ${r} ${r * 0.7}, ${r * 0.55} ${r}, 0 ${r}
          C ${-r * 0.55} ${r}, ${-r} ${r * 0.7}, ${-r} ${r * 0.35}
          C ${-r} ${-r * 0.05}, ${-r * 0.55} ${-r * 0.3}, 0 ${-r}
          Z
        `}
            />
        </Svg>
    );
}

export function UnknownIcon({ size = 12 }: { size?: number }) {
    const s = size;
    return (
        <Svg width={s} height={s} viewBox={[-s/2, -s/2, s, s].join(' ')}>
            <Circle cx={0} cy={0} r={s * 0.4} />
        </Svg>
    );
}

export function getAnnotationIcon(type: AnnotationType, size = 16) {
    switch (type) {
        case 'tree':
            return <TreeIcon size={size} />;
        case 'water':
            return <WaterIcon size={size} />;
        default:
            return <UnknownIcon size={size} />;
    }
}
