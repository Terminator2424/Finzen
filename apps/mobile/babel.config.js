// En el APK de producción se eliminan los console.* (menos console.error): ninguna traza
// con datos del usuario debe terminar en el log del sistema (logcat).
module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    env: { production: { plugins: [['transform-remove-console', { exclude: ['error'] }]] } },
  };
};
