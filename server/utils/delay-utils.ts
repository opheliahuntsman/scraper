/**
 * Utility functions for adding randomized delays to avoid bot detection
 */

/**
 * Add a random delay between min and max milliseconds
 * @param min Minimum delay in milliseconds
 * @param max Maximum delay in milliseconds
 * @returns Promise that resolves after the random delay
 */
export async function randomDelay(min: number, max: number): Promise<void> {
  const delay = Math.floor(Math.random() * (max - min + 1)) + min;
  await new Promise(resolve => setTimeout(resolve, delay));
}

/**
 * Add a random variation to a base delay
 * @param baseDelay Base delay in milliseconds
 * @param variationMin Minimum additional delay in milliseconds
 * @param variationMax Maximum additional delay in milliseconds
 * @returns Promise that resolves after the delay with random variation
 */
export async function delayWithVariation(
  baseDelay: number,
  variationMin: number = 0,
  variationMax: number = 2000
): Promise<void> {
  const variation = Math.floor(Math.random() * (variationMax - variationMin + 1)) + variationMin;
  const totalDelay = baseDelay + variation;
  await new Promise(resolve => setTimeout(resolve, totalDelay));
}

/**
 * Get a random delay value without executing it
 * @param min Minimum delay in milliseconds
 * @param max Maximum delay in milliseconds
 * @returns Random delay value in milliseconds
 */
export function getRandomDelay(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
