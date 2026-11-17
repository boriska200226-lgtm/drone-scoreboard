// Текстуры ez-tree (MIT, Daniel Greenheck): кора сосны и берёзы, хвоя сосны и листва осины.
import * as THREE from 'three';

import birchAo from './assets/birch_ao_1k.jpg';
import birchColor from './assets/birch_color_1k.jpg';
import birchNormal from './assets/birch_normal_1k.jpg';
import birchRoughness from './assets/birch_roughness_1k.jpg';
import pineAo from './assets/pine_ao_1k.jpg';
import pineColor from './assets/pine_color_1k.jpg';
import pineNormal from './assets/pine_normal_1k.jpg';
import pineRoughness from './assets/pine_roughness_1k.jpg';
// летняя листва берёзы: перекрашенная из осенней текстуры осины
import aspenLeaves from './assets/birch_leaves.png';
import pineLeaves from './assets/pine_color.png';

const textureLoader = new THREE.TextureLoader();
const loadTexture = (url, srgb = true) => {
  const texture = textureLoader.load(url);
  texture.premultiplyAlpha = true;
  if (srgb) texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
};

let textures = null;
function all() {
  // загружаем лениво, чтобы модуль можно было импортировать без немедленной загрузки картинок
  if (!textures) {
    textures = {
      bark: {
        birch: { ao: loadTexture(birchAo, false), color: loadTexture(birchColor), normal: loadTexture(birchNormal, false), roughness: loadTexture(birchRoughness, false) },
        pine: { ao: loadTexture(pineAo, false), color: loadTexture(pineColor), normal: loadTexture(pineNormal, false), roughness: loadTexture(pineRoughness, false) },
      },
      leaves: { aspen: loadTexture(aspenLeaves), pine: loadTexture(pineLeaves) },
    };
    textures.bark.oak = textures.bark.pine;
    textures.bark.willow = textures.bark.pine;
    textures.leaves.ash = textures.leaves.aspen;
    textures.leaves.oak = textures.leaves.aspen;
  }
  return textures;
}

export function getBarkTexture(barkType, fileType, scale = { x: 1, y: 1 }) {
  const texture = all().bark[barkType][fileType];
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.x = scale.x;
  texture.repeat.y = 1 / scale.y;
  return texture;
}

export function getLeafTexture(leafType) {
  return all().leaves[leafType];
}
