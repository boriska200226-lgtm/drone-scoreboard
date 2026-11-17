// Пресеты ez-tree, оставлены только породы тайги Коми (сосна/ель и осина/берёза).
import pineSmall from './pine_small.json';
import pineMedium from './pine_medium.json';
import pineLarge from './pine_large.json';
import aspenMedium from './aspen_medium.json';
import aspenLarge from './aspen_large.json';
import TreeOptions from '../options';

export const TreePreset = {
  'Pine Small': pineSmall,
  'Pine Medium': pineMedium,
  'Pine Large': pineLarge,
  'Aspen Medium': aspenMedium,
  'Aspen Large': aspenLarge,
};

export function loadPreset(name) {
  const preset = TreePreset[name];
  return preset ? structuredClone(preset) : new TreeOptions();
}
