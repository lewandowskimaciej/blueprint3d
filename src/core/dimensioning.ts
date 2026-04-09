export const dimInch: string = "inch";
export const dimMeter: string = "m";
export const dimCentiMeter: string = "cm";
export const dimMilliMeter: string = "mm";

export const configDimUnit = "dimUnit";
export const configWallHeight = "wallHeight";
export const configWallThickness = "wallThickness";

export class Configuration {
  private static data: {[key: string]: any} = {
    dimUnit: dimInch,
    wallHeight: 250,
    wallThickness: 10
  };

  public static setValue(key: string, value: string | number) {
    this.data[key] = value;
  }

  public static getStringValue(key: string): string {
    switch (key) {
      case configDimUnit:
        return <string>this.data[key];
      default:
        throw new Error("Invalid string configuration parameter: " + key);
    }
  }

  public static getNumericValue(key: string): number {
    switch (key) {
      case configWallHeight:
      case configWallThickness:
        return <number>this.data[key];
      default:
        throw new Error("Invalid numeric configuration parameter: " + key);
    }
  }
}

export class Dimensioning {
  public static cmToMeasure(cm: number): string {
    switch (Configuration.getStringValue(configDimUnit)) {
      case dimInch:
        var realFeet = ((cm * 0.393700) / 12);
        var feet = Math.floor(realFeet);
        var inches = Math.round((realFeet - feet) * 12);
        return feet + "'" + inches + '"';
      case dimMilliMeter:
        return "" + Math.round(10 * cm) + " mm";
      case dimCentiMeter:
        return "" + Math.round(10 * cm) / 10 + " cm";
      case dimMeter:
      default:
        return "" + Math.round(10 * cm) / 1000 + " m";
    }
  }
}
