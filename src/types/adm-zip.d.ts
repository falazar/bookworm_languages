declare module 'adm-zip' {
  interface IZipEntry {
    entryName: string;
    getData(): Buffer;
  }
  export default class AdmZip {
    constructor(file?: string);
    getEntries(): IZipEntry[];
    addLocalFile(path: string): void;
  }
}
