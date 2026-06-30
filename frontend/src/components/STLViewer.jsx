import { Suspense, useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, useGLTF, Center, Grid } from '@react-three/drei';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { useLoader } from '@react-three/fiber';
import * as THREE from 'three';

function STLModel({ url }) {
  const geometry = useLoader(STLLoader, url);
  return (
    <Center>
      <mesh geometry={geometry} castShadow receiveShadow>
        <meshStandardMaterial color="#a5b4fc" roughness={0.4} metalness={0.2} />
      </mesh>
    </Center>
  );
}

export default function STLViewer({ url, height = '360px' }) {
  return (
    <div style={{ height, background: '#0d1020', borderRadius: 'var(--radius)', overflow: 'hidden', position: 'relative' }}>
      <Canvas
        shadows
        camera={{ position: [80, 60, 80], fov: 45 }}
        gl={{ antialias: true }}
      >
        <ambientLight intensity={0.5} />
        <directionalLight position={[10, 20, 10]} intensity={1.5} castShadow />
        <directionalLight position={[-10, -10, -5]} intensity={0.3} />
        <Suspense fallback={null}>
          <STLModel url={url} />
        </Suspense>
        <Grid
          args={[200, 200]}
          cellSize={5}
          cellThickness={0.5}
          cellColor="#2d3148"
          sectionSize={20}
          sectionColor="#3d4168"
          fadeDistance={150}
          position={[0, -30, 0]}
        />
        <OrbitControls enableDamping dampingFactor={0.05} />
      </Canvas>
      <div style={{ position: 'absolute', bottom: 8, right: 8, fontSize: 11, color: 'var(--text-dim)' }}>
        Drag to rotate · Scroll to zoom
      </div>
    </div>
  );
}
