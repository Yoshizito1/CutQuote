'use client';

import { OrbitControls, Environment, Grid } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import type { BufferGeometry } from 'three';

import type { FoldedModel } from '@/lib/geometry/fold';
import { buildFoldMesh, disposeMesh, type FoldMeshResult } from './fold-mesh';

/**
 * Cena 3D da peça dobrada.
 *
 * Só é carregada sob demanda (ver `fold-viewer`): Three.js pesa mais que todo o
 * resto da aplicação somado, e quem quer apenas o preço não deve pagar esse
 * download.
 */
export function FoldScene({
  model,
  kFactor,
  showGrid = true,
}: {
  model: FoldedModel;
  kFactor: number;
  showGrid?: boolean;
}) {
  const mesh = useMemo(() => buildFoldMesh(model, kFactor), [model, kFactor]);

  // WebGL não coleta buffers sozinho: sem isto, cada mudança de ângulo vaza
  // memória de GPU até o contexto cair.
  const previous = useRef<FoldMeshResult | null>(null);
  useEffect(() => {
    if (previous.current && previous.current !== mesh) disposeMesh(previous.current);
    previous.current = mesh;
    return () => {
      disposeMesh(previous.current);
      previous.current = null;
    };
  }, [mesh]);

  const distance = mesh.span * 2.1;

  return (
    <Canvas
      dpr={[1, 2]}
      camera={{ position: [distance, -distance, distance * 0.8], fov: 40, near: 1, far: distance * 20 }}
      gl={{ antialias: true }}
      // A peça é modelada em milímetros com Z para cima (convenção CAD).
      onCreated={({ camera }) => camera.up.set(0, 0, 1)}
    >
      <color attach="background" args={['#0f1419']} />
      <ambientLight intensity={0.55} />
      <directionalLight position={[1, -1, 2]} intensity={1.6} />
      <directionalLight position={[-2, 1, 1]} intensity={0.5} />
      <Environment preset="warehouse" />

      <group position={[-mesh.center[0], -mesh.center[1], -mesh.center[2]]}>
        {mesh.geometries.map((geometry: BufferGeometry, index: number) => (
          <mesh key={index} geometry={geometry} castShadow receiveShadow>
            <meshStandardMaterial color="#9fb0c4" metalness={0.85} roughness={0.35} />
          </mesh>
        ))}
      </group>

      {showGrid && (
        <Grid
          args={[mesh.span * 4, mesh.span * 4]}
          cellSize={10}
          sectionSize={50}
          cellColor="#243040"
          sectionColor="#33465c"
          fadeDistance={mesh.span * 6}
          position={[0, 0, -mesh.span * 0.75]}
          rotation={[Math.PI / 2, 0, 0]}
          infiniteGrid={false}
        />
      )}

      <OrbitControls makeDefault enablePan enableZoom enableDamping dampingFactor={0.08} />
    </Canvas>
  );
}
