import { readFile, writeFile } from 'node:fs/promises';
import { Data, NtExecutable, NtExecutableResource, Resource } from 'resedit';

/** Brand only the newly copied package executable, before any future signing. */
export async function brandWindowsExecutable(executablePath, iconPath, manifest) {
  const executable = NtExecutable.from(await readFile(executablePath), { ignoreCert: true });
  const resources = NtExecutableResource.from(executable);
  const icon = Data.IconFile.from(await readFile(iconPath));
  const groups = Resource.IconGroupEntry.fromEntries(resources.entries);
  for (const group of groups.length ? groups : [{ id: 1, lang: 1033 }]) {
    Resource.IconGroupEntry.replaceIconsForResource(
      resources.entries,
      group.id,
      group.lang,
      icon.icons.map((item) => item.data),
    );
  }
  for (const info of Resource.VersionInfo.fromEntries(resources.entries)) {
    const languages = info.getAllLanguagesForStringValues();
    for (const language of languages.length ? languages : [{ lang: 1033, codepage: 1200 }]) {
      info.setStringValues(language, {
        FileDescription: manifest.productName,
        ProductName: manifest.productName,
        InternalName: manifest.name,
        OriginalFilename: 'Virtual Cut.exe',
      });
    }
    const [major, minor, patch] = manifest.version.split('.').map(Number);
    info.setFileVersion(major, minor, patch, 0);
    info.setProductVersion(major, minor, patch, 0);
    info.outputToResourceEntries(resources.entries);
  }
  resources.outputResource(executable);
  await writeFile(executablePath, Buffer.from(executable.generate()));
}
