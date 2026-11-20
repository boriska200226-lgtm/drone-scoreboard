// Иконка и сведения о версии для .exe без Wine/rcedit (чистый JS через resedit).
const fs = require("fs");
const path = require("path");

exports.default = async function afterPack(ctx) {
  if (ctx.electronPlatformName !== "win32") return;
  const ResEdit = await import("resedit");
  const { NtExecutable, NtExecutableResource, Resource, Data } = ResEdit;
  const info = ctx.packager.appInfo;
  const exe = path.join(ctx.appOutDir, `${info.productFilename}.exe`);
  const pe = NtExecutable.from(fs.readFileSync(exe), { ignoreCert: true });
  const res = NtExecutableResource.from(pe);
  const ico = Data.IconFile.from(fs.readFileSync(path.join(__dirname, "icon.ico")));
  Resource.IconGroupEntry.replaceIconsForResource(res.entries, 1, 1033, ico.icons.map((i) => i.data));
  const vi = Resource.VersionInfo.fromEntries(res.entries)[0] ?? Resource.VersionInfo.createEmpty();
  const [a, b, c] = info.version.split(".").map(Number);
  vi.setFileVersion(a, b, c, 0, 1033);
  vi.setProductVersion(a, b, c, 0, 1033);
  const strings = {
    FileDescription: info.description || info.productName, ProductName: info.productName, CompanyName: "Борисова Анастасия Александровна",
    LegalCopyright: `© ${new Date().getFullYear()} Борисова А. А.`, InternalName: info.productName, OriginalFilename: `${info.productFilename}.exe`,
  };
  for (const lang of vi.getAllLanguagesForStringValues()) vi.setStringValues(lang, strings);
  vi.outputToResourceEntries(res.entries);
  res.outputResource(pe);
  fs.writeFileSync(exe, Buffer.from(pe.generate()));
};
