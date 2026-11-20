// Ставит значок и сведения о программе в MarshrutDobra.exe (вместо значка Electron).
// node patch-exe.js <exe> <ico> <версия>
const fs = require('fs');
const ResEdit = require('resedit');
const [exePath, icoPath, version] = process.argv.slice(2);
const exe = ResEdit.NtExecutable.from(fs.readFileSync(exePath), { ignoreCert: true });
const res = ResEdit.NtExecutableResource.from(exe);
const ico = ResEdit.Data.IconFile.from(fs.readFileSync(icoPath));
const groups = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries);
if (!groups.length) throw new Error('в exe нет значка');
ResEdit.Resource.IconGroupEntry.replaceIconsForResource(res.entries, groups[0].id, groups[0].lang, ico.icons.map(i => i.data));
const [maj, min, patch] = version.split('.').map(Number);
const vi = ResEdit.Resource.VersionInfo.fromEntries(res.entries)[0];
const lang = vi.getAllLanguagesForStringValues()[0] || { lang: 1033, codepage: 1200 };
vi.setStringValues(lang, {
  ProductName: 'Маршрут добра',
  FileDescription: 'Маршрут добра',
  CompanyName: 'Маршрут добра',
  LegalCopyright: 'Командная игра для волонтёров',
  OriginalFilename: 'MarshrutDobra.exe',
  InternalName: 'MarshrutDobra',
  FileVersion: version,
  ProductVersion: version,
});
vi.setFileVersion(maj, min, patch, 0, lang.lang);
vi.setProductVersion(maj, min, patch, 0, lang.lang);
vi.outputToResourceEntries(res.entries);
res.outputResource(exe);
fs.writeFileSync(exePath, Buffer.from(exe.generate()));
console.log('значок и сведения записаны в', exePath);
