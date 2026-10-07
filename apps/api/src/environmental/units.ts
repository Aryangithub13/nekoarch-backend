/** Temperature and power/energy semantics kept apart on purpose: absolute °C, differences in K, power in W, energy in Wh. */
export const KELVIN_OFFSET = 273.15;
/** Absolute temperature conversion (an offset, never a scale factor). */
export const celsiusToKelvin = (celsius: number) => celsius + KELVIN_OFFSET;
/** A difference of two absolute Celsius temperatures, in kelvin: 1 K of difference = 1 °C of difference, no offset. */
export const temperatureDifferenceK = (aCelsius: number, bCelsius: number) => aCelsius - bCelsius;
/** Constant power over a duration: E[Wh] = P[W] × Δt[h]. */
export const energyWh = (powerW: number, hours: number) => powerW * hours;
export const whToKwh = (wh: number) => wh / 1000, wToKw = (w: number) => w / 1000;
export const mm2ToM2 = (mm2: number) => mm2 / 1e6;
