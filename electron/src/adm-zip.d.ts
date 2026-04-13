declare module 'adm-zip' {
  class AdmZip {
    constructor(buffer?: Buffer);
    addLocalFolder(localPath: string, zipPath?: string): void;
    toBuffer(): Buffer;
    extractAllTo(targetPath: string, overwrite?: boolean): void;
  }
  export = AdmZip;
}
