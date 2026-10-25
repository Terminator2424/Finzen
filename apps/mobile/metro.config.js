const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Mitigación de seguridad: en el APK se empaqueta nuestro decodificador lineal en lugar de
// decode-uri-component@0.2.2 (vulnerable a denegación de servicio por URLs mal formadas).
const SAFE_DECODE = path.resolve(__dirname, 'src/shims/decode-uri-component.js');
const upstream = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === 'decode-uri-component') return { type: 'sourceFile', filePath: SAFE_DECODE };
  return (upstream ?? context.resolveRequest)(context, moduleName, platform);
};

module.exports = config;
