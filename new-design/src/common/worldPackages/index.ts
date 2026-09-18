// External consumers use this facade. Runtime schema definitions depend only
// on base so browser ESM initialization cannot cycle through this barrel.
export * from './base';
export * from './library';
export * from './sync';
