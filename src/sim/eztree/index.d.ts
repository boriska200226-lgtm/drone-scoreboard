// Минимальные типы для вендоренной копии ez-tree.
import * as THREE from "three";
export declare class Tree extends THREE.Group {
  options: Record<string, unknown>;
  branchesMesh: THREE.Mesh;
  leavesMesh: THREE.Mesh;
  constructor();
  loadPreset(name: string): void;
  loadFromJson(json: Record<string, unknown>): void;
  generate(): void;
  get triangleCount(): number;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export declare const TreePreset: Record<string, Record<string, any>>;
export declare const BarkType: Record<string, string>;
export declare const Billboard: Record<string, string>;
export declare const LeafType: Record<string, string>;
export declare const TreeType: Record<string, string>;
