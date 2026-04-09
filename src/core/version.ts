export class Version {
  public static getInformalVersion(): string {
    return "1.0 Beta 1";
  }

  public static getTechnicalVersion(): string {
    return "1.0.0.1";
  }
}

console.log("Blueprint3D " + Version.getInformalVersion() + " (" + Version.getTechnicalVersion() + ")");
